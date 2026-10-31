'use server';

import mongoose from 'mongoose';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import dbConnect from '@/lib/db';
import InventoryItem from '@/models/InventoryItem';
import KitchenStock from '@/models/KitchenStock';
import KitchenStockLot from '@/models/KitchenStockLot';
import MenuItem from '@/models/MenuItem';
import Order from '@/models/Order';
import Restaurant from '@/models/Restaurant';
import StockMovement from '@/models/StockMovement';
import Table from '@/models/Table';
import {
    consumeKitchenLots,
    createKitchenLot,
    expireDueKitchenLots,
    seedLegacyKitchenLots,
} from '../../../shared/kitchenStockLots';

const roundQuantity = (value: number) => Math.round(value * 10000) / 10000;
const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const orderStatuses = new Set(['pending', 'preparing', 'served', 'completed', 'cancelled']);

async function currentRestaurantId() {
    const session = await auth();
    const value = String(session?.user?.restaurantId || '');
    return mongoose.Types.ObjectId.isValid(value) ? value : null;
}

function resultError(label: string, error: unknown, fallback: string) {
    console.error(label, error);
    return error instanceof Error ? error.message : fallback;
}

function withoutInventoryDetails(order: any) {
    if (!order) return order;
    const { inventoryUsage, inventoryRestored, inventoryDeducted, ...publicFields } = order;
    return publicFields;
}

/** Update an order only within the signed-in owner's restaurant. */
export async function updateOrderStatus(orderId: string, status: string) {
    const restaurantId = await currentRestaurantId();
    if (!restaurantId) return { success: false, error: 'Your session has expired. Sign in again.' };
    if (!mongoose.Types.ObjectId.isValid(orderId) || !orderStatuses.has(status)) {
        return { success: false, error: 'Invalid order update. Refresh the page and try again.' };
    }

    let session: mongoose.ClientSession | null = null;
    let updatedOrder: any = null;
    try {
        await dbConnect();
        const activeSession = await mongoose.startSession();
        session = activeSession;
        await activeSession.withTransaction(async () => {
            const order = await Order.findOne({ _id: orderId, restaurantId })
                .select('+inventoryUsage +inventoryRestored +inventoryDeducted')
                .session(activeSession);
            if (!order) throw new Error('Order not found. Refresh the page and try again.');
            if (order.status === 'cancelled' && status !== 'cancelled') {
                throw new Error('Cancelled orders cannot be reopened.');
            }

            const legacyOrderAlreadyDeducted = order.inventoryDeducted === undefined && (order.inventoryUsage || []).length > 0;
            const inventoryWasDeducted = order.inventoryDeducted === true || legacyOrderAlreadyDeducted;

            if ((status === 'served' || status === 'completed') && order.inventoryDeducted === undefined) {
                order.inventoryDeducted = true;
            } else if ((status === 'served' || status === 'completed') && order.inventoryDeducted === false) {
                for (const part of [...(order.inventoryUsage || [])].sort((a: any, b: any) => String(a.inventoryItemId).localeCompare(String(b.inventoryItemId)))) {
                    const quantity = roundQuantity(part.quantity);
                    const before = await InventoryItem.findOneAndUpdate(
                        { _id: part.inventoryItemId, restaurantId, isActive: true, currentStock: { $gte: quantity } },
                        { $inc: { currentStock: -quantity } },
                        { session: activeSession },
                    );
                    if (!before) throw new Error('Not enough stock to serve this order. Check the inventory quantity and recipe, then try again.');
                    part.unitCost = before.costPerUnit;
                    await StockMovement.create([{
                        restaurantId,
                        inventoryItemId: before._id,
                        orderId: order._id,
                        type: 'usage',
                        quantity: -quantity,
                        stockBefore: before.currentStock,
                        stockAfter: roundQuantity(before.currentStock - quantity),
                        unitCost: before.costPerUnit,
                        note: `Served order ${order._id}`,
                    }], { session: activeSession });
                }
                order.inventoryDeducted = true;
            }

            if (status === 'cancelled' && order.status !== 'cancelled' && inventoryWasDeducted && !order.inventoryRestored) {
                for (const part of order.inventoryUsage || []) {
                    if (part.departmentId) {
                        const after = await KitchenStock.findOneAndUpdate(
                            { restaurantId, departmentId: part.departmentId, inventoryItemId: part.inventoryItemId },
                            {
                                $inc: { currentStock: part.quantity },
                                $setOnInsert: { restaurantId, departmentId: part.departmentId, inventoryItemId: part.inventoryItemId },
                            },
                            { session: activeSession, new: true, upsert: true, setDefaultsOnInsert: true },
                        );
                        const inventoryItem = await InventoryItem.findOne({ _id: part.inventoryItemId, restaurantId })
                            .select('wasteBehavior').session(activeSession);
                        await createKitchenLot(KitchenStockLot, {
                            restaurantId,
                            departmentId: part.departmentId,
                            inventoryItemId: part.inventoryItemId,
                            quantity: part.quantity,
                            wasteBehavior: inventoryItem?.wasteBehavior || 'carry_forward',
                            unitCost: part.unitCost,
                        }, activeSession);
                        await StockMovement.create([{
                            restaurantId,
                            inventoryItemId: part.inventoryItemId,
                            departmentId: part.departmentId,
                            orderId: order._id,
                            type: 'return',
                            quantity: part.quantity,
                            stockBefore: after.currentStock - part.quantity,
                            stockAfter: after.currentStock,
                            unitCost: part.unitCost,
                            note: `Cancelled order ${order._id}`,
                        }], { session: activeSession });
                        continue;
                    }

                    const before = await InventoryItem.findOneAndUpdate(
                        { _id: part.inventoryItemId, restaurantId },
                        { $inc: { currentStock: part.quantity } },
                        { session: activeSession },
                    );
                    if (!before) throw new Error('Could not restore order inventory.');
                    await StockMovement.create([{
                        restaurantId,
                        inventoryItemId: part.inventoryItemId,
                        orderId: order._id,
                        type: 'return',
                        quantity: part.quantity,
                        stockBefore: before.currentStock,
                        stockAfter: roundQuantity(before.currentStock + part.quantity),
                        unitCost: part.unitCost,
                        note: `Cancelled order ${order._id}`,
                    }], { session: activeSession });
                }
                order.inventoryRestored = true;
            }

            order.status = status as typeof order.status;
            await order.save({ session: activeSession });
            await order.populate('tableId', 'tableNumber');
            updatedOrder = withoutInventoryDetails(order.toObject());
        });

        revalidatePath('/dashboard/orders');
        return { success: true, data: JSON.parse(JSON.stringify(updatedOrder)) };
    } catch (error) {
        return { success: false, error: resultError('Error updating order status:', error, 'Failed to update order status') };
    } finally {
        if (session) await session.endSession();
    }
}

/**
 * Create customer orders against the same MongoDB used by the Next.js menu and
 * table actions. The browser never supplies authoritative item prices.
 */
export async function createOrder(data: any) {
    if (!data || typeof data !== 'object') return { success: false, error: 'Invalid order details.' };

    const restaurantId = String(data.restaurantId || '');
    const tableId = String(data.tableId || '');
    const customerName = typeof data.customerName === 'string' ? data.customerName.trim() : '';
    const customerPhone = typeof data.customerPhone === 'string' ? data.customerPhone.replace(/\D/g, '') : '';
    const notes = typeof data.notes === 'string' ? data.notes.trim() : '';
    const sessionId = typeof data.sessionId === 'string' ? data.sessionId.trim() : '';
    if (!customerName || customerName.length > 120 || /[\u0000-\u001f\u007f]/.test(customerName)) {
        return { success: false, error: 'Enter your name (up to 120 characters).' };
    }
    if (!/^\d{10}$/.test(customerPhone)) return { success: false, error: 'Enter a valid 10-digit phone number.' };
    if (notes.length > 500 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(notes)) {
        return { success: false, error: 'Kitchen requests must be 500 characters or fewer.' };
    }
    if (!/^[a-zA-Z0-9_-]{16,128}$/.test(sessionId)) return { success: false, error: 'Refresh the menu and try placing your order again.' };
    if (!mongoose.Types.ObjectId.isValid(restaurantId)) return { success: false, error: 'This restaurant link is invalid.' };
    if (!mongoose.Types.ObjectId.isValid(tableId)) return { success: false, error: 'This table link is invalid.' };
    if (!Array.isArray(data.items) || data.items.length < 1 || data.items.length > 50 || data.items.some((item: any) =>
        !mongoose.Types.ObjectId.isValid(item?.menuItemId) || !Number.isInteger(Number(item?.quantity)) || Number(item.quantity) < 1 || Number(item.quantity) > 99
    )) {
        return { success: false, error: 'Choose a valid quantity for every menu item.' };
    }

    let session: mongoose.ClientSession | null = null;
    let createdOrder: any = null;
    try {
        await dbConnect();
        const activeSession = await mongoose.startSession();
        session = activeSession;
        await activeSession.withTransaction(async () => {
            const restaurant = await Restaurant.findById(restaurantId).select('inventoryTrackingEnabled').session(activeSession);
            if (!restaurant) throw new Error('This restaurant is no longer available. Refresh the menu and try again.');
            const inventoryTrackingEnabled = restaurant.inventoryTrackingEnabled !== false;

            if (inventoryTrackingEnabled) {
                await seedLegacyKitchenLots({ Lot: KitchenStockLot, KitchenStock, InventoryItem }, restaurantId, activeSession);
                await expireDueKitchenLots({ Lot: KitchenStockLot, KitchenStock, StockMovement }, restaurantId, activeSession);
            }

            const table = await Table.findOne({ _id: tableId, restaurantId, isActive: true }).session(activeSession);
            if (!table) throw new Error('This table is unavailable. Ask the restaurant staff for help.');

            const recentOrderCount = await Order.countDocuments({
                tableId,
                sessionId,
                createdAt: { $gte: new Date(Date.now() - 60_000) },
            }).session(activeSession);
            if (recentOrderCount >= 10) throw new Error('Too many orders were placed in a short time. Please wait a minute and try again.');

            const menuItems = await MenuItem.find({
                _id: { $in: data.items.map((item: any) => item.menuItemId) },
                restaurantId,
                isAvailable: true,
            }).session(activeSession);
            const itemsById = new Map(menuItems.map((item) => [String(item._id), item]));
            const required = new Map<string, { departmentId: mongoose.Types.ObjectId; inventoryItemId: mongoose.Types.ObjectId; quantity: number }>();
            let total = 0;

            const orderItems = data.items.map((requested: any) => {
                const menuItem = itemsById.get(String(requested.menuItemId));
                if (!menuItem) throw new Error('A menu item is no longer available. Refresh the menu and try again.');
                const quantity = Number(requested.quantity);
                total += menuItem.price * quantity;

                for (const part of inventoryTrackingEnabled ? menuItem.recipe || [] : []) {
                    // Menu items without an assigned kitchen department are not
                    // inventory-linked yet. Keep ordering available and only
                    // deduct stock for recipes that have a department mapping.
                    if (!menuItem.departmentId) continue;
                    const key = `${menuItem.departmentId}:${part.inventoryItemId}`;
                    const existing = required.get(key);
                    required.set(key, {
                        departmentId: menuItem.departmentId,
                        inventoryItemId: part.inventoryItemId,
                        quantity: (existing?.quantity || 0) + part.quantity * quantity,
                    });
                }

                return {
                    menuItemId: menuItem._id,
                    quantity,
                    price: menuItem.price,
                    name: menuItem.name,
                    dietaryType: menuItem.dietaryType || 'unknown',
                    itemType: menuItem.itemType || 'food',
                };
            });

            const [order] = await Order.create([{
                restaurantId,
                tableId,
                orderType: table.isTakeaway ? 'takeaway' : 'dine-in',
                items: orderItems,
                total: roundMoney(total),
                status: 'pending',
                paymentStatus: 'pending',
                sessionId,
                customerName,
                customerPhone,
                notes,
            }], { session: activeSession });

            const requiredIds = inventoryTrackingEnabled
                ? [...new Set([...required.values()].map((part) => String(part.inventoryItemId)))]
                : [];
            const stockItems = requiredIds.length
                ? await InventoryItem.find({ _id: { $in: requiredIds }, restaurantId, isActive: true }).session(activeSession)
                : [];
            const stockById = new Map(stockItems.map((item) => [String(item._id), item]));
            const usage = inventoryTrackingEnabled
                ? [...required.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, part]) => {
                    const inventoryItem = stockById.get(String(part.inventoryItemId));
                    if (!inventoryItem) throw new Error('A linked ingredient is unavailable. Please update the menu recipe.');
                    return {
                        inventoryItemId: inventoryItem._id,
                        departmentId: part.departmentId,
                        quantity: roundQuantity(part.quantity),
                        unitCost: inventoryItem.costPerUnit,
                    };
                })
                : [];

            order.inventoryUsage = usage;
            for (const part of usage) {
                const quantity = roundQuantity(part.quantity);
                const before = await KitchenStock.findOneAndUpdate(
                    { restaurantId, departmentId: part.departmentId, inventoryItemId: part.inventoryItemId, currentStock: { $gte: quantity } },
                    { $inc: { currentStock: -quantity } },
                    { session: activeSession },
                );
                if (!before) {
                    const ingredient = stockById.get(String(part.inventoryItemId));
                    throw new Error(`Not enough kitchen stock for ${ingredient?.name || 'an ingredient'}. Ask the store for a department requisition.`);
                }
                await consumeKitchenLots(KitchenStockLot, {
                    restaurantId,
                    departmentId: part.departmentId,
                    inventoryItemId: part.inventoryItemId,
                }, quantity, activeSession);
                await StockMovement.create([{
                    restaurantId,
                    inventoryItemId: part.inventoryItemId,
                    departmentId: part.departmentId,
                    orderId: order._id,
                    type: 'usage',
                    quantity: -quantity,
                    stockBefore: before.currentStock,
                    stockAfter: roundQuantity(before.currentStock - quantity),
                    unitCost: part.unitCost,
                    note: `Reserved for order ${order._id}`,
                }], { session: activeSession });
            }

            order.inventoryDeducted = !inventoryTrackingEnabled || usage.length > 0;
            await order.save({ session: activeSession });
            createdOrder = withoutInventoryDetails(order.toObject());
        });

        if (!createdOrder) throw new Error('The order could not be saved. Please try again.');
        revalidatePath('/dashboard/orders');
        return { success: true, data: JSON.parse(JSON.stringify(createdOrder)) };
    } catch (error) {
        return { success: false, error: resultError('Error creating order:', error, 'Failed to place order. Please try again.') };
    } finally {
        if (session) await session.endSession();
    }
}

/** Return recent and outstanding orders from the same database as the dashboard. */
export async function getOrders() {
    try {
        const restaurantId = await currentRestaurantId();
        if (!restaurantId) return { success: false, error: 'Your session has expired. Sign in again.' };
        await dbConnect();
        const [recent, unpaid, takeaway] = await Promise.all([
            Order.find({ restaurantId }).sort({ createdAt: -1 }).limit(100).populate('tableId', 'tableNumber').lean(),
            Order.find({ restaurantId, status: 'completed', paymentStatus: { $ne: 'paid' } })
                .sort({ createdAt: -1 }).populate('tableId', 'tableNumber').lean(),
            Order.find({ restaurantId, orderType: 'takeaway' }).sort({ createdAt: -1 }).populate('tableId', 'tableNumber').lean(),
        ]);
        const byId = new Map([...recent, ...unpaid, ...takeaway].map((order) => [String(order._id), order]));
        const orders = [...byId.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return { success: true, data: JSON.parse(JSON.stringify(orders)) };
    } catch (error) {
        return { success: false, error: resultError('Error fetching orders:', error, 'Failed to fetch orders.') };
    }
}

/** Customer order history for the current table visit. */
export async function getOrdersBySession(sessionId: string, tableId: string) {
    try {
        if (!/^[a-zA-Z0-9_-]{16,128}$/.test(sessionId) || !mongoose.Types.ObjectId.isValid(tableId)) {
            return { success: false, orders: [], error: 'Refresh the menu and try again.' };
        }
        await dbConnect();
        const orders = await Order.find({ sessionId, tableId }).sort({ createdAt: -1 }).lean();
        return { success: true, orders: JSON.parse(JSON.stringify(orders)) };
    } catch (error) {
        return { success: false, orders: [], error: resultError('Error fetching customer orders:', error, 'Failed to fetch orders.') };
    }
}

/** Save the checkout quote and optional feedback before showing UPI payment. */
export async function prepareCustomerCheckout(data: {
    orderId: string;
    sessionId: string;
    tableId: string;
    couponCode: string;
    tipAmount: number;
    foodRating?: number;
    experienceRating?: number;
    preparationRating?: number;
    packagingRating?: number;
    reviewText?: string;
}) {
    try {
        if (!mongoose.Types.ObjectId.isValid(data.orderId) || !mongoose.Types.ObjectId.isValid(data.tableId) ||
            !/^[a-zA-Z0-9_-]{16,128}$/.test(data.sessionId)) {
            return { success: false, error: 'Invalid order details.' };
        }
        await dbConnect();
        const order = await Order.findOne({ _id: data.orderId, tableId: data.tableId, sessionId: data.sessionId });
        if (!order) return { success: false, error: 'Order not found.' };
        if (order.status !== 'completed') return { success: false, error: 'Payment opens once your order is complete.' };
        if (order.paymentStatus === 'paid') return { success: false, error: 'This order is already paid.' };

        const isTakeaway = order.orderType === 'takeaway';
        if (isTakeaway && (data.couponCode?.trim() || (data.tipAmount != null && data.tipAmount !== 0))) {
            return { success: false, error: 'Discount codes and tips are unavailable for takeaway orders. Please refresh the page.' };
        }
        const ratings = isTakeaway
            ? [data.preparationRating, data.packagingRating]
            : [data.foodRating, data.experienceRating];
        const hasRating = ratings.some((rating) => rating != null);
        const hasWrongRating = isTakeaway
            ? data.foodRating != null || data.experienceRating != null
            : data.preparationRating != null || data.packagingRating != null;
        if (hasWrongRating) return { success: false, error: 'Please refresh this page to rate your order.' };
        if (hasRating && !ratings.every((rating) => Number.isInteger(rating) && rating! >= 1 && rating! <= 5)) {
            return { success: false, error: isTakeaway ? 'Rate preparation and packaging from 1 to 5 stars.' : 'Rate food and experience from 1 to 5 stars.' };
        }
        if (data.reviewText != null && (typeof data.reviewText !== 'string' || data.reviewText.length > 500)) {
            return { success: false, error: 'Review must be under 500 characters.' };
        }
        if (data.reviewText?.trim() && !hasRating) return { success: false, error: 'Add both ratings with your review.' };

        const restaurant = await Restaurant.findById(order.restaurantId).select('gstPercentage sgstPercentage packagingCharge');
        if (!restaurant) return { success: false, error: 'Restaurant not found.' };
        const couponCode = (data.couponCode || '').trim().toUpperCase();
        if (couponCode && couponCode !== 'DINE10') return { success: false, error: 'That discount code is not valid.' };
        const tipAmount = data.tipAmount == null ? 0 : data.tipAmount;
        if (typeof tipAmount !== 'number' || !Number.isFinite(tipAmount) || tipAmount < 0 || tipAmount > 10000) {
            return { success: false, error: 'Tip must be between ₹0 and ₹10,000.' };
        }

        const discountAmount = couponCode ? roundMoney(order.total * 0.1) : 0;
        const taxableSubtotal = roundMoney(order.total - discountAmount);
        const gstRate = Math.max(0, Number(restaurant.gstPercentage) || 0);
        const sgstRate = Math.max(0, Number(restaurant.sgstPercentage) || 0);
        const packagingCharge = isTakeaway ? Math.max(0, Number(restaurant.packagingCharge) || 0) : 0;
        order.checkout = {
            couponCode,
            discountAmount,
            tipAmount: roundMoney(tipAmount),
            packagingCharge: roundMoney(packagingCharge),
            gstRate,
            sgstRate,
            gstAmount: roundMoney(taxableSubtotal * gstRate / 100),
            sgstAmount: roundMoney(taxableSubtotal * sgstRate / 100),
            payableAmount: roundMoney(taxableSubtotal + taxableSubtotal * gstRate / 100 + taxableSubtotal * sgstRate / 100 + tipAmount + packagingCharge),
            preparedAt: new Date(),
        };
        if (hasRating) {
            order.review = {
                ...(isTakeaway
                    ? { preparationRating: data.preparationRating, packagingRating: data.packagingRating }
                    : { foodRating: data.foodRating, experienceRating: data.experienceRating }),
                comment: data.reviewText?.trim() || '',
                submittedAt: new Date(),
            };
        }
        await order.save();
        revalidatePath('/dashboard/orders');
        return { success: true, order: JSON.parse(JSON.stringify(order)) };
    } catch (error) {
        return { success: false, error: resultError('Prepare checkout error:', error, 'Payment service is unavailable.') };
    }
}

/** Update payment status within the signed-in owner's restaurant. */
export async function updatePaymentStatus(orderId: string, paymentStatus: 'paid', paymentMethod: 'upi' | 'cash') {
    try {
        const restaurantId = await currentRestaurantId();
        if (!restaurantId) return { success: false, error: 'Your session has expired. Sign in again.' };
        if (!mongoose.Types.ObjectId.isValid(orderId) || paymentStatus !== 'paid' || !['upi', 'cash'].includes(paymentMethod)) {
            return { success: false, error: 'Choose UPI or cash before marking this order paid.' };
        }
        await dbConnect();
        const order = await Order.findOneAndUpdate(
            { _id: orderId, restaurantId, status: 'completed', paymentStatus: { $ne: 'paid' } },
            { $set: { paymentStatus: 'paid', paymentMethod, paidAt: new Date() } },
            { new: true },
        ).populate('tableId', 'tableNumber');
        if (!order) return { success: false, error: 'Order must be completed and unpaid before recording payment.' };
        revalidatePath('/dashboard/orders');
        return { success: true, data: JSON.parse(JSON.stringify(order)) };
    } catch (error) {
        return { success: false, error: resultError('Error updating payment status:', error, 'Failed to update payment status.') };
    }
}
