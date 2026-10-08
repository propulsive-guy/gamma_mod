'use server';

import mongoose from 'mongoose';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import dbConnect from '@/lib/db';
import InventoryItem, { INVENTORY_UNITS, type InventoryUnit } from '@/models/InventoryItem';
import StockMovement, { type IStockMovement } from '@/models/StockMovement';
import { apiFetch } from '@/client-lib/api';

export type InventoryInput = {
    name: string;
    sku: string;
    category: string;
    unit: string;
    currentStock?: number;
    reorderLevel: number;
    costPerUnit: number;
    supplier: string;
    notes: string;
};

const finiteNonNegative = (value: unknown) => Number.isFinite(Number(value)) && Number(value) >= 0;
const rounded = (value: unknown) => Math.round(Number(value) * 10000) / 10000;

export async function applyInventoryBillPurchase(data: {
    billReference: string;
    lines: { inventoryItemId: string; quantity: number; unit: string; unitCost: number }[];
}) {
    try {
        if (!Array.isArray(data.lines) || !data.lines.length || data.lines.length > 40) {
            return { success: false, error: 'Submit between 1 and 40 reviewed bill lines' };
        }
        const response = await apiFetch('/api/v1/inventory/bill-purchase', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) return { success: false, error: result.error || 'Could not apply bill' };
        revalidatePath('/dashboard/inventory');
        return { success: true, updated: result.updated as number };
    } catch (error: any) {
        console.error('Apply inventory bill error:', error);
        return { success: false, error: error?.message || 'Could not apply bill' };
    }
}

async function restaurantContext() {
    const session = await auth();
    if (!session?.user.restaurantId) throw new Error('Please sign in again');
    await dbConnect();
    return { restaurantId: session.user.restaurantId };
}

export async function getLowStockItems() {
    try {
        const { restaurantId } = await restaurantContext();
        const items = await InventoryItem.find({
            restaurantId,
            isActive: true,
            $expr: { $lte: ['$currentStock', '$reorderLevel'] },
        }).select('name unit currentStock reorderLevel').sort({ currentStock: 1, name: 1 }).lean();
        return { success: true as const, items: JSON.parse(JSON.stringify(items)) as {
            _id: string; name: string; unit: string; currentStock: number; reorderLevel: number;
        }[] };
    } catch (error) {
        console.error('Get low stock items error:', error);
        return { success: false as const, items: [] as {
            _id: string; name: string; unit: string; currentStock: number; reorderLevel: number;
        }[] };
    }
}

function validateInput(data: InventoryInput, creating: boolean) {
    if (!data.name?.trim()) return 'Item name is required';
    if (!INVENTORY_UNITS.includes(data.unit as any)) return 'Choose a valid unit';
    if (![data.reorderLevel, data.costPerUnit, ...(creating ? [data.currentStock] : [])].every(finiteNonNegative)) {
        return 'Stock, reorder level, and cost must be zero or greater';
    }
    return null;
}

export async function createInventoryItem(data: InventoryInput) {
    try {
        const { restaurantId } = await restaurantContext();
        const validationError = validateInput(data, true);
        if (validationError) return { success: false, error: validationError };
        const item = await InventoryItem.create({
            restaurantId, name: data.name.trim(), sku: data.sku,
            category: data.category?.trim() || 'General', unit: data.unit as InventoryUnit,
            currentStock: rounded(data.currentStock), reorderLevel: rounded(data.reorderLevel),
            costPerUnit: rounded(data.costPerUnit), supplier: data.supplier, notes: data.notes,
        });
        if (item.currentStock > 0) {
            await StockMovement.create({
                restaurantId, inventoryItemId: item._id, type: 'opening', quantity: item.currentStock,
                stockBefore: 0, stockAfter: item.currentStock, unitCost: item.costPerUnit, note: 'Opening stock',
            });
        }
        revalidatePath('/dashboard/inventory');
        return { success: true, data: JSON.parse(JSON.stringify(item)) };
    } catch (error: any) {
        if (error?.code === 11000) return { success: false, error: 'An inventory item with this name already exists' };
        console.error('Create inventory item error:', error);
        return { success: false, error: error?.message || 'Failed to add inventory item' };
    }
}

export async function updateInventoryItem(id: string, data: InventoryInput) {
    try {
        const { restaurantId } = await restaurantContext();
        if (!mongoose.Types.ObjectId.isValid(id)) return { success: false, error: 'Invalid inventory item' };
        const validationError = validateInput(data, false);
        if (validationError) return { success: false, error: validationError };
        const item = await InventoryItem.findOneAndUpdate(
            { _id: id, restaurantId, isActive: true },
            {
                name: data.name.trim(), sku: data.sku, category: data.category?.trim() || 'General',
                unit: data.unit as InventoryUnit, reorderLevel: rounded(data.reorderLevel), costPerUnit: rounded(data.costPerUnit),
                supplier: data.supplier, notes: data.notes,
            },
            { new: true, runValidators: true },
        );
        if (!item) return { success: false, error: 'Inventory item not found' };
        revalidatePath('/dashboard/inventory');
        return { success: true, data: JSON.parse(JSON.stringify(item)) };
    } catch (error: any) {
        if (error?.code === 11000) return { success: false, error: 'An inventory item with this name already exists' };
        console.error('Update inventory item error:', error);
        return { success: false, error: error?.message || 'Failed to update inventory item' };
    }
}

export async function adjustInventoryStock(id: string, data: { type: string; quantity: number; note: string; unitCost?: number }) {
    try {
        const { restaurantId } = await restaurantContext();
        if (!mongoose.Types.ObjectId.isValid(id)) return { success: false, error: 'Invalid inventory item' };
        if (!['purchase', 'usage', 'wastage', 'correction', 'return'].includes(data.type)) return { success: false, error: 'Choose a valid movement type' };
        if (!Number.isFinite(Number(data.quantity)) || Number(data.quantity) === 0) return { success: false, error: 'Quantity cannot be zero' };
        let delta = rounded(data.quantity);
        if (['usage', 'wastage'].includes(data.type)) delta = -Math.abs(delta);
        if (['purchase', 'return'].includes(data.type)) delta = Math.abs(delta);
        const filter: any = { _id: id, restaurantId, isActive: true };
        if (delta < 0) filter.currentStock = { $gte: Math.abs(delta) };
        const update: any = { $inc: { currentStock: delta } };
        if (data.type === 'purchase' && finiteNonNegative(data.unitCost)) update.$set = { costPerUnit: rounded(data.unitCost) };
        const before = await InventoryItem.findOneAndUpdate(filter, update, { runValidators: true });
        if (!before) return { success: false, error: 'Not enough stock, or the item no longer exists' };
        const stockAfter = rounded(before.currentStock + delta);
        try {
            await StockMovement.create({
                restaurantId, inventoryItemId: before._id, type: data.type as IStockMovement['type'], quantity: delta,
                stockBefore: before.currentStock, stockAfter,
                unitCost: data.type === 'purchase' && finiteNonNegative(data.unitCost) ? rounded(data.unitCost) : before.costPerUnit,
                note: data.note,
            });
        } catch (movementError) {
            await InventoryItem.updateOne({ _id: before._id, restaurantId }, { $inc: { currentStock: -delta }, $set: { costPerUnit: before.costPerUnit } });
            throw movementError;
        }
        const item = await InventoryItem.findById(before._id).lean();
        revalidatePath('/dashboard/inventory');
        return { success: true, data: JSON.parse(JSON.stringify(item)) };
    } catch (error: any) {
        console.error('Adjust inventory stock error:', error);
        return { success: false, error: error?.message || 'Failed to adjust stock' };
    }
}

export async function archiveInventoryItem(id: string) {
    try {
        const { restaurantId } = await restaurantContext();
        if (!mongoose.Types.ObjectId.isValid(id)) return { success: false, error: 'Invalid inventory item' };
        const item = await InventoryItem.findOneAndUpdate({ _id: id, restaurantId }, { isActive: false });
        if (!item) return { success: false, error: 'Inventory item not found' };
        revalidatePath('/dashboard/inventory');
        return { success: true };
    } catch (error: any) {
        console.error('Archive inventory item error:', error);
        return { success: false, error: error?.message || 'Failed to archive inventory item' };
    }
}
