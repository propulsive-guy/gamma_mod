import { Request, Response } from 'express';
import { OrderInputError, OrderService } from '../services/OrderService';
import Order from '../models/Order';
import Restaurant from '../models/Restaurant';
import mongoose from 'mongoose';
import { calculateCheckout } from '../lib/checkout';

export class OrderController {
    /**
     * Get all orders for the owner's restaurant
     */
    static async getOrders(req: Request, res: Response) {
        try {
            const user = req.user;
            if (!user || !user.restaurantId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const orders = await OrderService.getDashboardOrders(user.restaurantId.toString());
            res.json(orders);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }

    /**
     * Update order status
     */
    static async updateStatus(req: Request, res: Response) {
        try {
            const { orderId } = req.params;
            const { status } = req.body;
            const user = req.user;

            if (!user || !user.restaurantId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const order = await OrderService.updateStatus(orderId as string, user.restaurantId.toString(), status);
            if (!order) {
                return res.status(404).json({ error: 'Order not found' });
            }

            await order.populate('tableId', 'tableNumber');
            const { inventoryUsage, inventoryRestored, inventoryDeducted, ...updatedOrder } = order.toObject();

            // Emit socket event
            if ((global as any).io) {
                (global as any).io.to(`restaurant-${user.restaurantId}`).emit('order-updated', updatedOrder);
            }

            res.json(updatedOrder);
        } catch (error: any) {
            const stockUnavailable = error?.message?.toLowerCase().includes('stock') || error?.message?.includes('ingredient is unavailable');
            res.status(stockUnavailable ? 409 : 500).json({ error: error.message });
        }
    }

    /**
     * Update order payment status
     */
    static async updatePaymentStatus(req: Request, res: Response) {
        try {
            const { orderId } = req.params;
            const { paymentStatus, paymentMethod } = req.body;
            const user = req.user;

            if (!user || !user.restaurantId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            if (paymentStatus !== 'paid' || !['upi', 'cash'].includes(paymentMethod)) {
                return res.status(400).json({ error: 'Choose UPI or cash before marking this order paid' });
            }

            const order = await OrderService.updatePaymentStatus(orderId as string, user.restaurantId.toString(), paymentMethod);
            if (!order) {
                return res.status(409).json({ error: 'Order must be completed and unpaid before recording payment' });
            }

            await order.populate('tableId', 'tableNumber');
            if ((global as any).io) {
                (global as any).io.to(`restaurant-${user.restaurantId}`).emit('order-updated', order);
            }

            res.json(order);
        } catch (error: any) {
            res.status(500).json({ error: error.message });
        }
    }

    /**
     * Create a new order (customer-facing)
     */
    static async create(req: Request, res: Response) {
        try {
            const orderData = req.body;
            const order = await OrderService.createOrder(orderData);
            const { inventoryUsage, inventoryRestored, inventoryDeducted, ...createdOrder } = order.toObject();

            // Broadcast real-time notification
            if ((global as any).io) {
                try {
                    await order.populate('tableId', 'tableNumber');
                } catch (error) {
                    console.error('Could not load table number for order notification:', error);
                }
                (global as any).io.to(`restaurant-${orderData.restaurantId}`).emit('new-order', order);
            }

            res.status(201).json(createdOrder);
        } catch (error: any) {
            console.error('Create order API error:', error);
            const stockUnavailable = error?.message?.toLowerCase().includes('stock') || error?.message?.includes('ingredient is unavailable');
            res.status(error instanceof OrderInputError ? 400 : stockUnavailable ? 409 : 500)
                .json({ error: error.message || 'Failed to place order' });
        }
    }

    /**
     * Get orders by session and table (customer-facing)
     */
    static async getOrdersBySession(req: Request, res: Response) {
        try {
            const { sessionId, tableId } = req.query;

            if (!sessionId || !tableId) {
                return res.status(400).json({ error: 'Missing parameters' });
            }

            // Clean sanitization
            if (!/^[a-zA-Z0-9_-]+$/.test(sessionId as string)) {
                return res.status(400).json({ error: 'Invalid parameters' });
            }

            const orders = await Order.find({
                sessionId: sessionId as string,
                tableId: tableId as string,
            }).sort({ createdAt: -1 });

            res.json({ orders });
        } catch (error: any) {
            console.error('Get orders by session API error:', error);
            res.status(500).json({ error: 'Failed to fetch orders' });
        }
    }

    /** Prepare a customer checkout only after the order is complete. */
    static async prepareCheckout(req: Request, res: Response) {
        try {
            const orderId = req.params.orderId as string;
            const { sessionId, tableId, couponCode, tipAmount, foodRating, experienceRating, preparationRating, packagingRating, reviewText } = req.body || {};

            if (!mongoose.Types.ObjectId.isValid(orderId) ||
                !mongoose.Types.ObjectId.isValid(tableId) ||
                typeof sessionId !== 'string' || !/^[a-zA-Z0-9_-]{16,128}$/.test(sessionId)) {
                return res.status(400).json({ error: 'Invalid order details' });
            }

            const order = await Order.findOne({ _id: orderId, tableId, sessionId });
            if (!order) return res.status(404).json({ error: 'Order not found' });
            if (order.status !== 'completed') return res.status(409).json({ error: 'Payment opens once your order is complete' });
            if (order.paymentStatus === 'paid') return res.status(409).json({ error: 'This order is already paid' });

            const isTakeaway = order.orderType === 'takeaway';
            if (isTakeaway && ((typeof couponCode === 'string' ? couponCode.trim() !== '' : couponCode != null) ||
                (tipAmount != null && tipAmount !== 0))) {
                return res.status(400).json({ error: 'Discount codes and tips are unavailable for takeaway orders. Please refresh the page.' });
            }
            const ratings = isTakeaway ? [preparationRating, packagingRating] : [foodRating, experienceRating];
            const hasRating = ratings.some((rating) => rating != null);
            const hasWrongRating = isTakeaway
                ? foodRating != null || experienceRating != null
                : preparationRating != null || packagingRating != null;
            if (hasWrongRating) {
                return res.status(400).json({ error: 'Please refresh this page to rate your order' });
            }
            if (hasRating && !ratings.every((rating) => Number.isInteger(rating) && rating >= 1 && rating <= 5)) {
                return res.status(400).json({ error: isTakeaway
                    ? 'Please rate Fast Preparation and Packaging from 1 to 5 stars'
                    : 'Please rate Food and Experience from 1 to 5 stars' });
            }
            if (typeof reviewText !== 'undefined' && (typeof reviewText !== 'string' || reviewText.length > 500)) {
                return res.status(400).json({ error: 'Review must be under 500 characters' });
            }
            if (reviewText?.trim() && !hasRating) {
                return res.status(400).json({ error: 'Add both ratings with your review' });
            }

            const restaurant = await Restaurant.findById(order.restaurantId).select('gstPercentage sgstPercentage packagingCharge');
            if (!restaurant) return res.status(404).json({ error: 'Restaurant not found' });

            try {
                order.checkout = calculateCheckout(order.total, isTakeaway ? '' : couponCode, isTakeaway ? 0 : tipAmount,
                    restaurant.gstPercentage || 0, restaurant.sgstPercentage || 0,
                    order.orderType === 'takeaway' ? restaurant.packagingCharge || 0 : 0);
            } catch (error) {
                return res.status(400).json({ error: (error as Error).message });
            }

            if (hasRating) {
                order.review = {
                    ...(isTakeaway ? { preparationRating, packagingRating } : { foodRating, experienceRating }),
                    comment: reviewText?.trim() || '',
                    submittedAt: new Date(),
                };
            }

            await order.save();
            res.json(order);
        } catch (error) {
            console.error('Prepare checkout error:', error);
            res.status(500).json({ error: 'Could not prepare payment' });
        }
    }
}
