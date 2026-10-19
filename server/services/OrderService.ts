import Order, { IOrder } from '@/models/Order';
import MenuItem from '@/models/MenuItem';
import InventoryItem from '@/models/InventoryItem';
import StockMovement from '@/models/StockMovement';
import KitchenStock from '@/models/KitchenStock';
import KitchenStockLot from '@/models/KitchenStockLot';
import Table from '@/models/Table';
import mongoose from 'mongoose';
import { consumeKitchenLots, createKitchenLot, expireDueKitchenLots, seedLegacyKitchenLots } from '../../shared/kitchenStockLots';

export class OrderInputError extends Error {}

export class OrderService {
    /**
     * Create a new order ensure it's linked to a restaurant and table
     */
    static async createOrder(data: any): Promise<IOrder> {
        if (!data || typeof data !== 'object') throw new OrderInputError('Invalid order details');
        const customerName = typeof data.customerName === 'string' ? data.customerName.trim() : '';
        const customerPhone = typeof data.customerPhone === 'string' ? data.customerPhone.trim() : '';
        const notes = typeof data.notes === 'string' ? data.notes.trim() : '';
        if (!customerName || /\p{N}/u.test(customerName)) throw new OrderInputError('Enter a name without numbers');
        if (!/^\d{10}$/.test(customerPhone)) throw new OrderInputError('Enter exactly 10 digits for the phone number');
        if (!/^[\p{L}\p{M}\s]*$/u.test(notes)) throw new OrderInputError('Kitchen requests can contain letters and spaces only');
        // Validate restaurantId and tableId are valid ObjectIds
        if (!data.restaurantId || !mongoose.Types.ObjectId.isValid(data.restaurantId)) {
            throw new OrderInputError('Invalid restaurant ID');
        }
        if (!data.tableId || !mongoose.Types.ObjectId.isValid(data.tableId)) {
            throw new OrderInputError('Invalid table ID');
        }
        if (!Array.isArray(data.items) || !data.items.length || data.items.some((item: any) =>
            !mongoose.Types.ObjectId.isValid(item.menuItemId) || !Number.isInteger(item.quantity) || item.quantity < 1
        )) throw new OrderInputError('Choose a valid quantity for every menu item');

        const session = await mongoose.startSession();
        let createdOrder: IOrder | null = null;
        try {
            await session.withTransaction(async () => {
                await seedLegacyKitchenLots({ Lot: KitchenStockLot, KitchenStock, InventoryItem }, data.restaurantId, session);
                await expireDueKitchenLots({ Lot: KitchenStockLot, KitchenStock, StockMovement }, data.restaurantId, session);
                const table = await Table.findOne({ _id: data.tableId, restaurantId: data.restaurantId, isActive: true }).session(session);
                if (!table) throw new Error('This ordering QR is unavailable');

                const menuItems = await MenuItem.find({
                    _id: { $in: data.items.map((item: any) => item.menuItemId) },
                    restaurantId: data.restaurantId,
                    isAvailable: true,
                }).session(session);
                const byId = new Map(menuItems.map((item) => [String(item._id), item]));
                const required = new Map<string, { departmentId: mongoose.Types.ObjectId; inventoryItemId: mongoose.Types.ObjectId; quantity: number }>();
                let calculatedTotal = 0;
                const orderItems = data.items.map((item: any) => {
                    const dbItem = byId.get(String(item.menuItemId));
                    if (!dbItem) throw new Error('A menu item is unavailable. Please refresh the menu.');
                    calculatedTotal += dbItem.price * item.quantity;
                    for (const part of dbItem.recipe || []) {
                        if (!dbItem.departmentId) throw new OrderInputError(`Set a kitchen department for ${dbItem.name} in Menu before accepting orders.`);
                        const key = `${dbItem.departmentId}:${part.inventoryItemId}`;
                        const existing = required.get(key);
                        required.set(key, {
                            departmentId: dbItem.departmentId,
                            inventoryItemId: part.inventoryItemId,
                            quantity: (existing?.quantity || 0) + part.quantity * item.quantity,
                        });
                    }
                    return {
                        menuItemId: dbItem._id,
                        quantity: item.quantity,
                        price: dbItem.price,
                        name: dbItem.name,
                        dietaryType: dbItem.dietaryType || 'unknown',
                        itemType: dbItem.itemType || 'food',
                    };
                });

                const [order] = await Order.create([{
                    restaurantId: data.restaurantId,
                    tableId: data.tableId,
                    orderType: table.isTakeaway ? 'takeaway' : 'dine-in',
                    items: orderItems,
                    total: calculatedTotal,
                    status: 'pending',
                    paymentStatus: 'pending',
                    sessionId: data.sessionId,
                    customerName,
                    customerPhone,
                    notes,
                }], { session });

                // Reserve recipe quantities from the assigned kitchen department
                // when the order is placed. Cancellation restores the same stock.
                const requiredIds = [...new Set([...required.values()].map((part) => String(part.inventoryItemId)))];
                const stockItems = requiredIds.length
                    ? await InventoryItem.find({
                        _id: { $in: requiredIds }, restaurantId: data.restaurantId, isActive: true,
                    }).session(session)
                    : [];
                const stockById = new Map(stockItems.map((item) => [String(item._id), item]));
                const usage = [...required.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, part]) => {
                    const inventoryItem = stockById.get(String(part.inventoryItemId));
                    if (!inventoryItem) throw new OrderInputError('A linked ingredient is unavailable. Please update the menu recipe.');
                    return {
                        inventoryItemId: inventoryItem._id,
                        departmentId: part.departmentId,
                        quantity: Math.round(part.quantity * 10000) / 10000,
                        unitCost: inventoryItem.costPerUnit,
                    };
                });
                order.inventoryUsage = usage;
                for (const part of usage) {
                    const quantity = Math.round(part.quantity * 10000) / 10000;
                    const before = await KitchenStock.findOneAndUpdate(
                        { restaurantId: data.restaurantId, departmentId: part.departmentId, inventoryItemId: part.inventoryItemId, currentStock: { $gte: quantity } },
                        { $inc: { currentStock: -quantity } },
                        { session },
                    );
                    if (!before) {
                        const ingredient = stockById.get(String(part.inventoryItemId));
                        throw new Error(`Not enough kitchen stock for ${ingredient?.name || 'an ingredient'}. Ask the store for a department requisition.`);
                    }
                    await consumeKitchenLots(KitchenStockLot, { restaurantId: data.restaurantId, departmentId: part.departmentId, inventoryItemId: part.inventoryItemId }, quantity, session);
                    await StockMovement.create([{
                        restaurantId: data.restaurantId, inventoryItemId: part.inventoryItemId, departmentId: part.departmentId, orderId: order._id,
                        type: 'usage', quantity: -quantity, stockBefore: before.currentStock,
                        stockAfter: Math.round((before.currentStock - quantity) * 10000) / 10000,
                        unitCost: part.unitCost, note: `Reserved for order ${order._id}`,
                    }], { session });
                }
                order.inventoryDeducted = usage.length > 0;
                await order.save({ session });
                createdOrder = order;
            });
            if (!createdOrder) throw new Error('Could not save order');
            return createdOrder;
        } finally {
            await session.endSession();
        }
    }

    /**
     * Get recent orders for a restaurant dashboard.
     * Always scoped by restaurantId.
     * @param restaurantId - The restaurant to fetch orders for
     * @param limit        - Max number of orders to return (default 50)
     * @param status       - Optional status filter (e.g. 'pending', 'preparing')
     * @param before       - Optional cursor: return orders created before this Date (for pagination)
     */
    static async getRestaurantOrders(
        restaurantId: string,
        limit = 50,
        status?: string,
        before?: Date
    ): Promise<IOrder[]> {
        if (!mongoose.Types.ObjectId.isValid(restaurantId)) return [];

        const filter: Record<string, any> = { restaurantId };
        if (status) filter.status = status;
        if (before) filter.createdAt = { $lt: before };

        return Order.find(filter)
            .sort({ createdAt: -1 })
            .limit(Math.min(limit, 100)) // Hard cap at 100 to protect DB
            .populate('tableId', 'tableNumber')
            .lean() as unknown as IOrder[];
    }

    /** Keep every outstanding completed bill in the dashboard, even when it is older than recent orders. */
    static async getDashboardOrders(restaurantId: string): Promise<IOrder[]> {
        if (!mongoose.Types.ObjectId.isValid(restaurantId)) return [];

        const [recent, unpaid, takeaway] = await Promise.all([
            this.getRestaurantOrders(restaurantId, 100),
            Order.find({ restaurantId, status: 'completed', paymentStatus: { $ne: 'paid' } })
                .sort({ createdAt: -1 })
                .populate('tableId', 'tableNumber')
                .lean() as unknown as Promise<IOrder[]>,
            Order.find({ restaurantId, orderType: 'takeaway' })
                .sort({ createdAt: -1 })
                .populate('tableId', 'tableNumber')
                .lean() as unknown as Promise<IOrder[]>,
        ]);

        const byId = new Map<string, IOrder>();
        for (const order of [...recent, ...unpaid, ...takeaway]) byId.set(String(order._id), order);
        return [...byId.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    }

    /**
     * Update order status with validation
     */
    static async updateStatus(orderId: string, restaurantId: string, status: IOrder['status']): Promise<IOrder | null> {
        if (!mongoose.Types.ObjectId.isValid(orderId) || !mongoose.Types.ObjectId.isValid(restaurantId)) {
            return null;
        }
        const session = await mongoose.startSession();
        let updatedOrder: IOrder | null = null;
        try {
            await session.withTransaction(async () => {
                const order = await Order.findOne({ _id: orderId, restaurantId })
                    .select('+inventoryUsage +inventoryRestored +inventoryDeducted').session(session);
                if (!order) return;
                if (order.status === 'cancelled' && status !== 'cancelled') throw new Error('Cancelled orders cannot be reopened');
                const legacyOrderAlreadyDeducted = order.inventoryDeducted === undefined && (order.inventoryUsage || []).length > 0;
                const inventoryWasDeducted = order.inventoryDeducted === true || legacyOrderAlreadyDeducted;

                if ((status === 'served' || status === 'completed') && order.inventoryDeducted === undefined) {
                    // Older orders deducted stock at placement. Preserve their
                    // historic accounting and never charge those recipes twice.
                    order.inventoryDeducted = true;
                } else if ((status === 'served' || status === 'completed') && order.inventoryDeducted === false) {
                    for (const part of [...(order.inventoryUsage || [])].sort((a, b) => String(a.inventoryItemId).localeCompare(String(b.inventoryItemId)))) {
                        const quantity = Math.round(part.quantity * 10000) / 10000;
                        const before = await InventoryItem.findOneAndUpdate(
                            { _id: part.inventoryItemId, restaurantId, isActive: true, currentStock: { $gte: quantity } },
                            { $inc: { currentStock: -quantity } },
                            { session },
                        );
                        if (!before) throw new Error('Not enough stock to serve this order. Check the inventory quantity and recipe, then try again.');
                        part.unitCost = before.costPerUnit;
                        await StockMovement.create([{
                            restaurantId, inventoryItemId: before._id, orderId: order._id,
                            type: 'usage', quantity: -quantity, stockBefore: before.currentStock,
                            stockAfter: Math.round((before.currentStock - quantity) * 10000) / 10000,
                            unitCost: before.costPerUnit, note: `Served order ${order._id}`,
                        }], { session });
                    }
                    order.inventoryDeducted = true;
                }

                if (status === 'cancelled' && order.status !== 'cancelled' && inventoryWasDeducted && !order.inventoryRestored) {
                    for (const part of order.inventoryUsage || []) {
                        if (part.departmentId) {
                            const after = await KitchenStock.findOneAndUpdate(
                                { restaurantId, departmentId: part.departmentId, inventoryItemId: part.inventoryItemId },
                                { $inc: { currentStock: part.quantity }, $setOnInsert: { restaurantId, departmentId: part.departmentId, inventoryItemId: part.inventoryItemId } },
                                { session, new: true, upsert: true, setDefaultsOnInsert: true },
                            );
                            const inventoryItem = await InventoryItem.findOne({ _id: part.inventoryItemId, restaurantId }).select('wasteBehavior').session(session);
                            await createKitchenLot(KitchenStockLot, {
                                restaurantId, departmentId: part.departmentId, inventoryItemId: part.inventoryItemId,
                                quantity: part.quantity, wasteBehavior: inventoryItem?.wasteBehavior || 'carry_forward', unitCost: part.unitCost,
                            }, session);
                            await StockMovement.create([{
                                restaurantId, inventoryItemId: part.inventoryItemId, departmentId: part.departmentId, orderId: order._id,
                                type: 'return', quantity: part.quantity, stockBefore: after.currentStock - part.quantity,
                                stockAfter: after.currentStock, unitCost: part.unitCost, note: `Cancelled order ${order._id}`,
                            }], { session });
                            continue;
                        }
                        const before = await InventoryItem.findOneAndUpdate(
                            { _id: part.inventoryItemId, restaurantId },
                            { $inc: { currentStock: part.quantity } },
                            { session },
                        );
                        if (!before) throw new Error('Could not restore order inventory');
                        await StockMovement.create([{
                            restaurantId, inventoryItemId: part.inventoryItemId, orderId: order._id,
                            type: 'return', quantity: part.quantity, stockBefore: before.currentStock,
                            stockAfter: Math.round((before.currentStock + part.quantity) * 10000) / 10000,
                            unitCost: part.unitCost, note: `Cancelled order ${order._id}`,
                        }], { session });
                    }
                    order.inventoryRestored = true;
                }
                order.status = status;
                await order.save({ session });
                updatedOrder = order;
            });
            return updatedOrder;
        } finally {
            await session.endSession();
        }
    }

    /**
     * Update payment status
     */
    static async updatePaymentStatus(orderId: string, restaurantId: string, paymentMethod: 'upi' | 'cash'): Promise<IOrder | null> {
        if (!mongoose.Types.ObjectId.isValid(orderId) || !mongoose.Types.ObjectId.isValid(restaurantId)) {
            return null;
        }
        return Order.findOneAndUpdate(
            { _id: orderId, restaurantId, status: 'completed', paymentStatus: { $ne: 'paid' } },
            { $set: { paymentStatus: 'paid', paymentMethod, paidAt: new Date() } },
            { new: true }
        );
    }

    /**
     * Get analytics for restaurant
     */
    static async getStats(restaurantId: string) {
        if (!mongoose.Types.ObjectId.isValid(restaurantId)) {
            return { totalRevenue: 0, orderCount: 0, avgOrderValue: 0 };
        }
        const stats = await Order.aggregate([
            { $match: { restaurantId: new mongoose.Types.ObjectId(restaurantId) } },
            {
                $group: {
                    _id: null,
                    totalRevenue: { $sum: '$total' },
                    orderCount: { $count: {} },
                    avgOrderValue: { $avg: '$total' }
                }
            }
        ]);
        return stats[0] || { totalRevenue: 0, orderCount: 0, avgOrderValue: 0 };
    }
}
