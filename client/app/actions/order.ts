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
    effectiveExpiryDays,
    seedLegacyKitchenLots,
} from '../../../shared/kitchenStockLots';
import { calculateCheckout } from '../../../server/lib/checkout';

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
    if (Array.isArray(publicFields.items)) {
        publicFields.items = publicFields.items.map((item: any) => {
            const { recipeSnapshot, ...publicItem } = item;
            return publicItem;
        });
    }
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
    if (customerName.length > 120 || /[\u0000-\u001f\u007f]/.test(customerName)) {
        return { success: false, error: 'Name must be 120 characters or fewer.' };
    }
    if (customerPhone && !/^\d{10}$/.test(customerPhone)) return { success: false, error: 'Enter a valid 10-digit phone number, or leave it blank.' };
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
            const restaurant = await Restaurant.findById(restaurantId)
                .select('inventoryTrackingEnabled gstPercentage sgstPercentage packagingCharge')
                .session(activeSession);
            if (!restaurant) throw new Error('This restaurant is no longer available. Refresh the menu and try again.');
            const inventoryTrackingEnabled = restaurant.inventoryTrackingEnabled !== false;

            if (inventoryTrackingEnabled) {
                await seedLegacyKitchenLots({ Lot: KitchenStockLot, KitchenStock, InventoryItem }, restaurantId, activeSession);
                await expireDueKitchenLots({ Lot: KitchenStockLot, KitchenStock, StockMovement, InventoryItem }, restaurantId, activeSession);
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

            const gstRate = Math.max(0, Number(restaurant.gstPercentage) || 0);
            const sgstRate = Math.max(0, Number(restaurant.sgstPercentage) || 0);
            const packagingCharge = table.isTakeaway ? Math.max(0, Number(restaurant.packagingCharge) || 0) : 0;
            const taxableSubtotal = roundMoney(total);
            const gstAmount = roundMoney(taxableSubtotal * gstRate / 100);
            const sgstAmount = roundMoney(taxableSubtotal * sgstRate / 100);
            const checkout = {
                couponCode: '',
                discountAmount: 0,
                tipAmount: 0,
                packagingCharge: roundMoney(packagingCharge),
                gstRate,
                sgstRate,
                gstAmount,
                sgstAmount,
                payableAmount: roundMoney(taxableSubtotal + gstAmount + sgstAmount + packagingCharge),
                preparedAt: new Date(),
            };

            const [order] = await Order.create([{
                restaurantId,
                tableId,
                orderType: table.isTakeaway ? 'takeaway' : 'dine-in',
                orderChannel: data.orderChannel === 'waiter' ? 'waiter' : 'customer',
                items: orderItems,
                total: roundMoney(total),
                checkout,
                status: 'pending',
                paymentStatus: 'pending',
                sessionId,
                customerName,
                ...(customerPhone ? { customerPhone } : {}),
                notes,
            }], { session: activeSession });

            const requiredIds = inventoryTrackingEnabled
                ? [...new Set([...required.values()].map((part) => String(part.inventoryItemId)))]
                : [];
            const stockItems = requiredIds.length
                ? await InventoryItem.find({ _id: { $in: requiredIds }, restaurantId, isActive: true }).session(activeSession)
                : [];
            const stockById = new Map(stockItems.map((item) => [String(item._id), item]));
            order.items = orderItems.map((line: any) => {
                const menuItem = itemsById.get(String(line.menuItemId));
                const recipeSnapshot = inventoryTrackingEnabled && menuItem?.departmentId
                    ? (menuItem.recipe || []).map((part: any) => {
                        const inventoryItem = stockById.get(String(part.inventoryItemId));
                        return {
                            inventoryItemId: part.inventoryItemId,
                            quantity: roundQuantity(Number(part.quantity || 0)),
                            inventoryCategory: inventoryItem?.category || 'Uncategorized',
                            unitCost: Number(inventoryItem?.costPerUnit || 0),
                            unit: inventoryItem?.unit || '',
                        };
                    })
                    : [];
                return { ...line, recipeSnapshot };
            }) as any;
            const usage = inventoryTrackingEnabled
                ? [...required.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, part]) => {
                    const inventoryItem = stockById.get(String(part.inventoryItemId));
                    if (!inventoryItem) throw new Error('A linked ingredient is unavailable. Please update the menu recipe.');
                    return {
                        inventoryItemId: inventoryItem._id,
                        departmentId: part.departmentId,
                        inventoryCategory: inventoryItem.category || 'Uncategorized',
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
                    inventoryCategory: part.inventoryCategory,
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
        const orderFields = 'items.name items.price items.quantity total status paymentStatus paymentMethod orderType source checkout review restaurantId tableId customerName customerPhone notes createdAt';
        const [recent, outstanding] = await Promise.all([
            Order.find({ restaurantId }).select(orderFields).sort({ createdAt: -1 }).limit(100).populate('tableId', 'tableNumber').lean(),
            Order.find({
                restaurantId,
                $or: [
                    { status: { $ne: 'cancelled' }, paymentStatus: { $ne: 'paid' } },
                    { orderType: 'takeaway' },
                ],
            }).select(orderFields).sort({ createdAt: -1 }).populate('tableId', 'tableNumber').lean(),
        ]);
        const byId = new Map([...recent, ...outstanding].map((order) => [String(order._id), order]));
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

async function captainRestaurantId(captainKey: string) {
    const key = String(captainKey || '').trim();
    if (mongoose.Types.ObjectId.isValid(key)) {
        const restaurant = await Restaurant.findById(key).select('_id').lean();
        return restaurant ? String(restaurant._id) : null;
    }
    if (!/^[a-f0-9]{64}$/i.test(key)) return null;
    const restaurant = await Restaurant.findOne({ captainToken: key }).select('_id').lean();
    return restaurant ? String(restaurant._id) : null;
}

function captainOrderResult(order: any) {
    const plain = typeof order?.toObject === 'function' ? order.toObject() : order;
    return JSON.parse(JSON.stringify(withoutInventoryDetails(plain)));
}

/** List recent table orders, including older orders created before order channels were recorded. */
export async function getCaptainTableOrders(captainKey: string, tableId: string) {
    try {
        if (!mongoose.Types.ObjectId.isValid(tableId)) return { success: false, error: 'Choose a valid table.', orders: [] };
        await dbConnect();
        const restaurantId = await captainRestaurantId(captainKey);
        if (!restaurantId) return { success: false, error: 'This waiter link is no longer valid.', orders: [] };
        const table = await Table.findOne({ _id: tableId, restaurantId, isActive: true, isTakeaway: { $ne: true } }).select('_id').lean();
        if (!table) return { success: false, error: 'This table is unavailable.', orders: [] };
        const orders = await Order.find({ restaurantId, tableId })
            .select('items.name items.price items.quantity total status paymentStatus paymentMethod orderType orderChannel checkout customerName customerPhone notes createdAt updatedAt')
            .sort({ createdAt: -1 }).limit(60).populate('tableId', 'tableNumber').lean();
        return { success: true, orders: JSON.parse(JSON.stringify(orders)) };
    } catch (error) {
        return { success: false, error: resultError('Get waiter table orders error:', error, 'Could not load table orders.'), orders: [] };
    }
}

/** List recent orders across all active restaurant tables for the permanent captain page. */
export async function getCaptainRestaurantOrders(captainKey: string) {
    try {
        await dbConnect();
        const restaurantId = await captainRestaurantId(captainKey);
        if (!restaurantId) return { success: false, error: 'This waiter link is no longer valid.', orders: [] };
        const dineInTableIds = await Table.find({ restaurantId, isActive: true, isTakeaway: { $ne: true } }).distinct('_id');
        if (dineInTableIds.length === 0) return { success: true, orders: [] };
        const orders = await Order.find({
            restaurantId,
            tableId: { $in: dineInTableIds },
        })
            .select('items.menuItemId items.name items.price items.quantity total status paymentStatus paymentMethod orderType orderChannel checkout customerName customerPhone notes createdAt updatedAt')
            .sort({ createdAt: -1 }).limit(200).populate('tableId', 'tableNumber').lean();
        return { success: true, orders: JSON.parse(JSON.stringify(orders)) };
    } catch (error) {
        return { success: false, error: resultError('Get captain restaurant orders error:', error, 'Could not load restaurant orders.'), orders: [] };
    }
}

/** Edit an unpaid waiter order, applying the ingredient stock difference in the same Mongo transaction. */
export async function editCaptainOrder(captainKey: string, sourceTableId: string, orderId: string, linesInput: { menuItemId: string; quantity: number }[], notesInput?: string) {
    if (!mongoose.Types.ObjectId.isValid(sourceTableId) || !mongoose.Types.ObjectId.isValid(orderId) || !Array.isArray(linesInput) || linesInput.length < 1 || linesInput.length > 50) {
        return { success: false, error: 'Add at least one valid menu item.' };
    }
    const lines = linesInput.map((line) => ({ menuItemId: String(line?.menuItemId || ''), quantity: Number(line?.quantity) }));
    if (lines.some((line) => !mongoose.Types.ObjectId.isValid(line.menuItemId) || !Number.isInteger(line.quantity) || line.quantity < 1 || line.quantity > 99) ||
        new Set(lines.map((line) => line.menuItemId)).size !== lines.length) {
        return { success: false, error: 'Check the menu items and quantities, then try again.' };
    }
    const notes = typeof notesInput === 'string' ? notesInput.trim() : '';
    if (notes.length > 500) return { success: false, error: 'Order notes must be 500 characters or fewer.' };

    let session: mongoose.ClientSession | null = null;
    let updatedOrder: any = null;
    try {
        await dbConnect();
        const restaurantId = await captainRestaurantId(captainKey);
        if (!restaurantId) return { success: false, error: 'This waiter link is no longer valid.' };
        const activeSession = await mongoose.startSession();
        session = activeSession;
        await activeSession.withTransaction(async () => {
            const restaurant = await Restaurant.findById(restaurantId)
                .select('inventoryTrackingEnabled gstPercentage sgstPercentage')
                .session(activeSession);
            const order = await Order.findOne({ _id: orderId, restaurantId, tableId: sourceTableId })
                .select('+inventoryUsage +inventoryDeducted +items.recipeSnapshot')
                .session(activeSession);
            if (!restaurant || !order) throw new Error('Waiter order not found. Refresh the table orders.');
            if (order.paymentStatus === 'paid' || order.status === 'cancelled') {
                throw new Error('Paid or cancelled orders cannot be edited.');
            }

            const table = await Table.findOne({ _id: order.tableId, restaurantId, isActive: true, isTakeaway: { $ne: true } }).session(activeSession);
            if (!table) throw new Error('The order table is no longer available.');
            const menuItems = await MenuItem.find({ _id: { $in: lines.map((line) => line.menuItemId) }, restaurantId, isAvailable: true }).session(activeSession);
            const menuById = new Map(menuItems.map((item) => [String(item._id), item]));
            const trackingEnabled = restaurant.inventoryTrackingEnabled !== false;
            const required = new Map<string, { departmentId: any; inventoryItemId: any; quantity: number }>();
            let subtotal = 0;
            const nextItems = lines.map(({ menuItemId, quantity }) => {
                const menuItem = menuById.get(menuItemId);
                if (!menuItem) throw new Error('A selected dish is no longer available. Refresh the menu and try again.');
                subtotal += Number(menuItem.price) * quantity;
                for (const recipePart of trackingEnabled && menuItem.departmentId ? menuItem.recipe || [] : []) {
                    const key = `${menuItem.departmentId}:${recipePart.inventoryItemId}`;
                    const current = required.get(key);
                    required.set(key, {
                        departmentId: menuItem.departmentId,
                        inventoryItemId: recipePart.inventoryItemId,
                        quantity: roundQuantity((current?.quantity || 0) + Number(recipePart.quantity) * quantity),
                    });
                }
                return {
                    menuItemId: menuItem._id,
                    name: menuItem.name,
                    price: menuItem.price,
                    quantity,
                    dietaryType: menuItem.dietaryType || 'unknown',
                    itemType: menuItem.itemType || 'food',
                };
            });
            if (!Number.isFinite(subtotal) || subtotal > 10_000_000) throw new Error('The updated order total is outside the supported range.');

            const requiredIds = [...new Set([...required.values()].map((part) => String(part.inventoryItemId)))];
            const inventoryItems = requiredIds.length
                ? await InventoryItem.find({ _id: { $in: requiredIds }, restaurantId }).select('name category unit costPerUnit expiryDays wasteBehavior isActive').session(activeSession)
                : [];
            const inventoryById = new Map(inventoryItems.map((item) => [String(item._id), item]));
            for (const part of required.values()) {
                const item = inventoryById.get(String(part.inventoryItemId));
                if (!item || !item.isActive) throw new Error('A linked ingredient is unavailable. Update the recipe before editing this order.');
            }

            const nextUsage = trackingEnabled
                ? [...required.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([, part]) => {
                    const inventoryItem = inventoryById.get(String(part.inventoryItemId))!;
                    return {
                        inventoryItemId: inventoryItem._id,
                        departmentId: part.departmentId,
                        inventoryCategory: inventoryItem.category || 'Uncategorized',
                        quantity: roundQuantity(part.quantity),
                        unitCost: Number(inventoryItem.costPerUnit || 0),
                    };
                })
                : [];
            const nextItemsWithSnapshots = nextItems.map((line: any) => {
                const menuItem = menuById.get(String(line.menuItemId));
                const recipeSnapshot = trackingEnabled && menuItem?.departmentId
                    ? (menuItem.recipe || []).map((part: any) => {
                        const inventoryItem = inventoryById.get(String(part.inventoryItemId));
                        return {
                            inventoryItemId: part.inventoryItemId,
                            quantity: roundQuantity(Number(part.quantity || 0)),
                            inventoryCategory: inventoryItem?.category || 'Uncategorized',
                            unitCost: Number(inventoryItem?.costPerUnit || 0),
                            unit: inventoryItem?.unit || '',
                        };
                    })
                    : [];
                return { ...line, recipeSnapshot };
            });

            if (trackingEnabled) {
                await seedLegacyKitchenLots({ Lot: KitchenStockLot, KitchenStock, InventoryItem }, restaurantId, activeSession);
                await expireDueKitchenLots({ Lot: KitchenStockLot, KitchenStock, StockMovement, InventoryItem }, restaurantId, activeSession);
                const reservedBefore = order.inventoryDeducted === false ? [] : (order.inventoryUsage || []);
                const oldByKey = new Map(reservedBefore.map((part: any) => [`${part.departmentId}:${part.inventoryItemId}`, part]));
                const nextByKey = new Map(nextUsage.map((part: any) => [`${part.departmentId}:${part.inventoryItemId}`, part]));
                const keys = [...new Set([...oldByKey.keys(), ...nextByKey.keys()])].sort();
                for (const key of keys) {
                    const previous: any = oldByKey.get(key);
                    const next: any = nextByKey.get(key);
                    const difference = roundQuantity(Number(next?.quantity || 0) - Number(previous?.quantity || 0));
                    if (Math.abs(difference) < 0.0001) continue;
                    const part = next || previous;
                    const inventoryItem = inventoryById.get(String(part.inventoryItemId)) || await InventoryItem.findOne({ _id: part.inventoryItemId, restaurantId }).select('name category unit costPerUnit expiryDays wasteBehavior').session(activeSession);
                    if (difference > 0) {
                        const before = await KitchenStock.findOneAndUpdate(
                            { restaurantId, departmentId: part.departmentId, inventoryItemId: part.inventoryItemId, currentStock: { $gte: difference } },
                            { $inc: { currentStock: -difference } }, { session: activeSession },
                        );
                        if (!before) throw new Error(`Not enough kitchen stock for ${inventoryItem?.name || 'an ingredient'}.`);
                        await consumeKitchenLots(KitchenStockLot, { restaurantId, departmentId: part.departmentId, inventoryItemId: part.inventoryItemId }, difference, activeSession);
                        await StockMovement.create([{
                            restaurantId, departmentId: part.departmentId, inventoryItemId: part.inventoryItemId,
                            inventoryCategory: inventoryItem?.category || part.inventoryCategory,
                            orderId: order._id, type: 'usage', quantity: -difference,
                            stockBefore: before.currentStock, stockAfter: roundQuantity(before.currentStock - difference),
                            unitCost: inventoryItem?.costPerUnit ?? part.unitCost, note: `Added to waiter order ${order._id}`,
                        }], { session: activeSession });
                    } else {
                        const returned = Math.abs(difference);
                        const after = await KitchenStock.findOneAndUpdate(
                            { restaurantId, departmentId: part.departmentId, inventoryItemId: part.inventoryItemId },
                            { $inc: { currentStock: returned }, $setOnInsert: { restaurantId, departmentId: part.departmentId, inventoryItemId: part.inventoryItemId } },
                            { session: activeSession, new: true, upsert: true, setDefaultsOnInsert: true },
                        );
                        await createKitchenLot(KitchenStockLot, {
                            restaurantId, departmentId: part.departmentId, inventoryItemId: part.inventoryItemId,
                            quantity: returned, expiryDays: effectiveExpiryDays(inventoryItem || {}), unitCost: inventoryItem?.costPerUnit ?? part.unitCost,
                        }, activeSession);
                        await StockMovement.create([{
                            restaurantId, departmentId: part.departmentId, inventoryItemId: part.inventoryItemId,
                            inventoryCategory: inventoryItem?.category || part.inventoryCategory,
                            orderId: order._id, type: 'return', quantity: returned,
                            stockBefore: roundQuantity(after.currentStock - returned), stockAfter: after.currentStock,
                            unitCost: inventoryItem?.costPerUnit ?? part.unitCost, note: `Removed from waiter order ${order._id}`,
                        }], { session: activeSession });
                    }
                }
            }

            const gstRate = Math.max(0, Number(restaurant.gstPercentage) || 0);
            const sgstRate = Math.max(0, Number(restaurant.sgstPercentage) || 0);
            const checkout = calculateCheckout(
                roundMoney(subtotal),
                order.checkout?.couponCode || '',
                Number(order.checkout?.tipAmount || 0),
                gstRate,
                sgstRate,
                0,
            );
            order.items = nextItemsWithSnapshots as any;
            order.total = roundMoney(subtotal);
            order.checkout = checkout as any;
            order.notes = notes;
            order.inventoryUsage = nextUsage as any;
            order.inventoryDeducted = true;
            await order.save({ session: activeSession });
            await order.populate('tableId', 'tableNumber');
            updatedOrder = withoutInventoryDetails(order.toObject());
        });
        revalidatePath('/dashboard/orders');
        if (!updatedOrder) return { success: false, error: 'Could not update this order.' };
        return { success: true, data: captainOrderResult(updatedOrder) };
    } catch (error) {
        return { success: false, error: resultError('Edit waiter order error:', error, 'Could not update this order.') };
    } finally {
        if (session) await session.endSession();
    }
}

/** Move an unpaid waiter order to another active dine-in table in the same restaurant. */
export async function transferCaptainOrder(captainKey: string, sourceTableId: string, orderId: string, targetTableId: string) {
    try {
        if (!mongoose.Types.ObjectId.isValid(sourceTableId) || !mongoose.Types.ObjectId.isValid(orderId) || !mongoose.Types.ObjectId.isValid(targetTableId)) {
            return { success: false, error: 'Choose a valid order and destination table.' };
        }
        await dbConnect();
        const restaurantId = await captainRestaurantId(captainKey);
        if (!restaurantId) return { success: false, error: 'This waiter link is no longer valid.' };
        const targetTable = await Table.findOne({ _id: targetTableId, restaurantId, isActive: true, isTakeaway: { $ne: true } }).select('_id').lean();
        if (!targetTable) return { success: false, error: 'Choose an active dine-in table.' };
        const order = await Order.findOneAndUpdate(
            { _id: orderId, restaurantId, tableId: sourceTableId, status: { $ne: 'cancelled' }, paymentStatus: { $ne: 'paid' } },
            { $set: { tableId: targetTableId } }, { new: true },
        ).select('items.name items.price items.quantity total status paymentStatus paymentMethod orderType orderChannel checkout customerName customerPhone notes createdAt updatedAt')
            .populate('tableId', 'tableNumber');
        if (!order) return { success: false, error: 'This order cannot be transferred because it is closed, paid, or no longer available.' };
        revalidatePath('/dashboard/orders');
        return { success: true, data: captainOrderResult(order) };
    } catch (error) {
        return { success: false, error: resultError('Transfer waiter order error:', error, 'Could not transfer this order.') };
    }
}

/** Mark an order served from the public waiter link and account for any legacy stock not yet deducted. */
export async function markCaptainOrderServed(captainKey: string, sourceTableId: string, orderId: string) {
    let session: mongoose.ClientSession | null = null;
    let updatedOrder: any = null;
    try {
        if (!mongoose.Types.ObjectId.isValid(sourceTableId) || !mongoose.Types.ObjectId.isValid(orderId)) {
            return { success: false, error: 'Choose a valid order.' };
        }
        await dbConnect();
        const restaurantId = await captainRestaurantId(captainKey);
        if (!restaurantId) return { success: false, error: 'This waiter link is no longer valid.' };
        const activeSession = await mongoose.startSession();
        session = activeSession;
        await activeSession.withTransaction(async () => {
            const order = await Order.findOne({ _id: orderId, restaurantId, tableId: sourceTableId })
                .select('+inventoryUsage +inventoryDeducted')
                .session(activeSession);
            if (!order || order.status === 'cancelled' || order.status === 'completed') {
                throw new Error('This order can no longer be marked as served. Refresh the table orders.');
            }
            if (order.paymentStatus === 'paid') throw new Error('This order is already paid.');
            const restaurant = await Restaurant.findById(restaurantId).select('inventoryTrackingEnabled').session(activeSession);
            if (restaurant?.inventoryTrackingEnabled !== false && order.inventoryDeducted === false && order.inventoryUsage?.length) {
                await seedLegacyKitchenLots({ Lot: KitchenStockLot, KitchenStock, InventoryItem }, restaurantId, activeSession);
                await expireDueKitchenLots({ Lot: KitchenStockLot, KitchenStock, StockMovement, InventoryItem }, restaurantId, activeSession);
                for (const part of [...order.inventoryUsage].sort((left: any, right: any) => String(left.inventoryItemId).localeCompare(String(right.inventoryItemId)))) {
                    const quantity = roundQuantity(Number(part.quantity));
                    const before = await KitchenStock.findOneAndUpdate(
                        { restaurantId, departmentId: part.departmentId, inventoryItemId: part.inventoryItemId, currentStock: { $gte: quantity } },
                        { $inc: { currentStock: -quantity } }, { session: activeSession },
                    );
                    if (!before) throw new Error('Not enough kitchen stock to serve this order.');
                    await consumeKitchenLots(KitchenStockLot, { restaurantId, departmentId: part.departmentId, inventoryItemId: part.inventoryItemId }, quantity, activeSession);
                    await StockMovement.create([{
                        restaurantId, departmentId: part.departmentId, inventoryItemId: part.inventoryItemId,
                        inventoryCategory: part.inventoryCategory, orderId: order._id, type: 'usage', quantity: -quantity,
                        stockBefore: before.currentStock, stockAfter: roundQuantity(before.currentStock - quantity),
                        unitCost: part.unitCost, note: `Served waiter order ${order._id}`,
                    }], { session: activeSession });
                }
                order.inventoryDeducted = true;
            } else if (order.inventoryDeducted === undefined) {
                order.inventoryDeducted = true;
            }
            order.status = 'served';
            await order.save({ session: activeSession });
            await order.populate('tableId', 'tableNumber');
            updatedOrder = withoutInventoryDetails(order.toObject());
        });
        revalidatePath('/dashboard/orders');
        if (!updatedOrder) return { success: false, error: 'Could not mark this order as served.' };
        return { success: true, data: captainOrderResult(updatedOrder) };
    } catch (error) {
        return { success: false, error: resultError('Mark waiter order served error:', error, 'Could not mark this order as served.') };
    } finally {
        if (session) await session.endSession();
    }
}

/** Complete a served order from the waiter screen and prepare it for payment. */
export async function completeCaptainOrder(captainKey: string, sourceTableId: string, orderId: string) {
    let session: mongoose.ClientSession | null = null;
    let updatedOrder: any = null;
    try {
        if (!mongoose.Types.ObjectId.isValid(sourceTableId) || !mongoose.Types.ObjectId.isValid(orderId)) return { success: false, error: 'Choose a valid order.' };
        await dbConnect();
        const restaurantId = await captainRestaurantId(captainKey);
        if (!restaurantId) return { success: false, error: 'This waiter link is no longer valid.' };
        const activeSession = await mongoose.startSession();
        session = activeSession;
        await activeSession.withTransaction(async () => {
            const order = await Order.findOne({ _id: orderId, restaurantId, tableId: sourceTableId })
                .select('+inventoryUsage +inventoryDeducted')
                .session(activeSession);
            if (!order || order.status !== 'served') throw new Error('Mark this order as served before completing it.');
            if (order.paymentStatus === 'paid') throw new Error('This order is already paid.');
            const restaurant = await Restaurant.findById(restaurantId).select('inventoryTrackingEnabled').session(activeSession);
            if (restaurant?.inventoryTrackingEnabled !== false && order.inventoryDeducted === false && order.inventoryUsage?.length) {
                await seedLegacyKitchenLots({ Lot: KitchenStockLot, KitchenStock, InventoryItem }, restaurantId, activeSession);
                await expireDueKitchenLots({ Lot: KitchenStockLot, KitchenStock, StockMovement, InventoryItem }, restaurantId, activeSession);
                for (const part of [...order.inventoryUsage].sort((left: any, right: any) => String(left.inventoryItemId).localeCompare(String(right.inventoryItemId)))) {
                    const quantity = roundQuantity(Number(part.quantity));
                    const before = await KitchenStock.findOneAndUpdate(
                        { restaurantId, departmentId: part.departmentId, inventoryItemId: part.inventoryItemId, currentStock: { $gte: quantity } },
                        { $inc: { currentStock: -quantity } }, { session: activeSession },
                    );
                    if (!before) throw new Error('Not enough kitchen stock to complete this order.');
                    await consumeKitchenLots(KitchenStockLot, { restaurantId, departmentId: part.departmentId, inventoryItemId: part.inventoryItemId }, quantity, activeSession);
                    await StockMovement.create([{
                        restaurantId, departmentId: part.departmentId, inventoryItemId: part.inventoryItemId,
                        inventoryCategory: part.inventoryCategory, orderId: order._id, type: 'usage', quantity: -quantity,
                        stockBefore: before.currentStock, stockAfter: roundQuantity(before.currentStock - quantity),
                        unitCost: part.unitCost, note: `Completed waiter order ${order._id}`,
                    }], { session: activeSession });
                }
                order.inventoryDeducted = true;
            }
            order.status = 'completed';
            await order.save({ session: activeSession });
            await order.populate('tableId', 'tableNumber');
            updatedOrder = withoutInventoryDetails(order.toObject());
        });
        revalidatePath('/dashboard/orders');
        if (!updatedOrder) return { success: false, error: 'Could not complete this order.' };
        return { success: true, data: captainOrderResult(updatedOrder) };
    } catch (error) {
        return { success: false, error: resultError('Complete waiter order error:', error, 'Could not complete this order.') };
    } finally {
        if (session) await session.endSession();
    }
}

/** Record a captain's manual confirmation after checking that the UPI payment arrived. */
export async function markCaptainOrderPaid(captainKey: string, tableId: string, orderId: string) {
    try {
        if (!mongoose.Types.ObjectId.isValid(tableId) || !mongoose.Types.ObjectId.isValid(orderId)) {
            return { success: false, error: 'Choose a valid table order.' };
        }
        await dbConnect();
        const restaurantId = await captainRestaurantId(captainKey);
        if (!restaurantId) return { success: false, error: 'This waiter link is no longer valid.' };
        const order = await Order.findOneAndUpdate(
            { _id: orderId, restaurantId, tableId, status: 'completed', paymentStatus: { $ne: 'paid' } },
            { $set: { paymentStatus: 'paid', paymentMethod: 'upi', paidAt: new Date() } },
            { new: true },
        ).select('items.name items.price items.quantity total status paymentStatus paymentMethod orderType orderChannel checkout customerName customerPhone notes createdAt updatedAt')
            .populate('tableId', 'tableNumber').lean();
        if (!order) return { success: false, error: 'Only a completed, unpaid order can be marked as paid.' };
        revalidatePath('/dashboard/orders');
        return { success: true, data: captainOrderResult(order) };
    } catch (error) {
        return { success: false, error: resultError('Mark waiter payment error:', error, 'Could not record this payment.') };
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
        if (order.status === 'cancelled') return { success: false, error: 'Cancelled orders cannot be paid.' };
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
            { _id: orderId, restaurantId, status: { $ne: 'cancelled' }, paymentStatus: { $ne: 'paid' } },
            { $set: { paymentStatus: 'paid', paymentMethod, paidAt: new Date() } },
            { new: true },
        ).populate('tableId', 'tableNumber');
        if (!order) return { success: false, error: 'Order must be active and unpaid before recording payment.' };
        revalidatePath('/dashboard/orders');
        return { success: true, data: JSON.parse(JSON.stringify(order)) };
    } catch (error) {
        return { success: false, error: resultError('Error updating payment status:', error, 'Failed to update payment status.') };
    }
}
