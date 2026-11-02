'use server';

import mongoose from 'mongoose';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import dbConnect from '@/lib/db';
import InventoryItem, { INVENTORY_UNITS, type InventoryUnit } from '@/models/InventoryItem';
import MenuItem from '@/models/MenuItem';
import ProcurementDocument, { type IProcurementLine } from '@/models/ProcurementDocument';
import StockMovement, { type IStockMovement } from '@/models/StockMovement';
import { DEFAULT_EXPIRY_DAYS } from '../../../shared/kitchenStockLots';

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
    expiryDays: number;
};

const finiteNonNegative = (value: unknown) => Number.isFinite(Number(value)) && Number(value) >= 0;
const rounded = (value: unknown) => Math.round(Number(value) * 10000) / 10000;

export async function applyInventoryBillPurchase(data: {
    supplier: string;
    billReference: string;
    invoiceDate: string;
    notes?: string;
    lines: { inventoryItemId: string; newItemName?: string; category?: string; quantity: number; unit: string; unitCost: number }[];
}) {
    let session: mongoose.ClientSession | undefined;
    try {
        const supplier = String(data.supplier || '').trim();
        const billReference = String(data.billReference || '').trim();
        const invoiceDate = new Date(data.invoiceDate);
        if (!supplier || supplier.length > 120) return { success: false, error: 'Enter the supplier name before saving the bill.' };
        if (billReference.length > 80) return { success: false, error: 'Invoice number must be 80 characters or less.' };
        if (!/^\d{4}-\d{2}-\d{2}$/.test(data.invoiceDate) || Number.isNaN(invoiceDate.getTime()) || invoiceDate.toISOString().slice(0, 10) !== data.invoiceDate) return { success: false, error: 'Choose a valid invoice date.' };
        if (!Array.isArray(data.lines) || !data.lines.length || data.lines.length > 60) {
            return { success: false, error: 'Submit between 1 and 60 reviewed bill lines.' };
        }
        for (const line of data.lines) {
            const existingItem = Boolean(line.inventoryItemId && mongoose.Types.ObjectId.isValid(line.inventoryItemId));
            const newItemName = String(line.newItemName || '').trim();
            if ((!existingItem && (!newItemName || newItemName.length > 120)) || !INVENTORY_UNITS.includes(line.unit as InventoryUnit)) {
                return { success: false, error: 'Choose an existing item or enter a valid new item name and unit.' };
            }
            if (!Number.isFinite(Number(line.quantity)) || Number(line.quantity) <= 0 || Number(line.quantity) > 1_000_000 || !finiteNonNegative(line.unitCost) || Number(line.unitCost) > 10_000_000) {
                return { success: false, error: 'Check each bill quantity and unit cost.' };
            }
        }
        const { restaurantId } = await restaurantContext();
        const restaurantObjectId = new mongoose.Types.ObjectId(restaurantId);
        const normalizedSupplier = supplier.toLocaleLowerCase().replace(/\s+/g, ' ');
        const vendorBillKey = billReference ? `${normalizedSupplier}::${billReference.toLocaleLowerCase().replace(/\s+/g, ' ')}` : undefined;
        if (vendorBillKey && vendorBillKey.length > 220) return { success: false, error: 'Supplier and invoice number are too long to save.' };

        session = await mongoose.startSession();
        let savedReference = '';
        let savedLines = 0;
        await session.withTransaction(async () => {
            if (vendorBillKey && await ProcurementDocument.exists({ restaurantId: restaurantObjectId, vendorBillKey }).session(session!)) {
                throw new Error(`Invoice ${billReference} from ${supplier} is already recorded.`);
            }

            const grouped = new Map<string, { item: InstanceType<typeof InventoryItem>; category: string; quantity: number; lineTotal: number }>();
            const billLines: IProcurementLine[] = [];
            for (const line of data.lines) {
                let item = line.inventoryItemId && mongoose.Types.ObjectId.isValid(line.inventoryItemId)
                    ? await InventoryItem.findOne({ _id: line.inventoryItemId, restaurantId: restaurantObjectId, isActive: true }).session(session!)
                    : null;
                if (!item) {
                    if (line.inventoryItemId) throw new Error('An inventory item is unavailable. Refresh the bill and review it again.');
                    const itemName = String(line.newItemName || '').trim();
                    const sameName = await InventoryItem.findOne({ restaurantId: restaurantObjectId, name: itemName }).session(session!);
                    if (sameName) {
                        if (!sameName.isActive) throw new Error(`“${itemName}” is archived. Restore it before recording this bill.`);
                        if (sameName.unit !== line.unit) throw new Error(`“${itemName}” already uses ${sameName.unit}. Convert the bill quantity before saving.`);
                        item = sameName;
                    } else {
                        item = new InventoryItem({
                            restaurantId: restaurantObjectId, name: itemName,
                            category: String(line.category || 'General').trim().slice(0, 80) || 'General',
                            unit: line.unit as InventoryUnit, currentStock: 0, reorderLevel: 0,
                            costPerUnit: Number(line.unitCost), supplier, expiryDays: DEFAULT_EXPIRY_DAYS,
                        });
                        await item.save({ session: session! });
                    }
                }
                if (item.unit !== line.unit) throw new Error(`“${item.name}” uses ${item.unit}; convert the bill quantity before saving.`);
                const key = String(item._id);
                const category = String(line.category || 'Other').trim().slice(0, 80) || 'Other';
                const current = grouped.get(key) || { item, category, quantity: 0, lineTotal: 0 };
                if (current.category !== category) throw new Error(`Choose one MIS category for all bill lines matching “${item.name}”.`);
                item.category = category;
                current.quantity = rounded(current.quantity + Number(line.quantity));
                current.lineTotal = rounded(current.lineTotal + Number(line.quantity) * Number(line.unitCost));
                grouped.set(key, current);
                billLines.push({
                    inventoryItemId: item._id, itemName: item.name, unit: item.unit, category,
                    requestedQuantity: rounded(Number(line.quantity)), orderedQuantity: rounded(Number(line.quantity)),
                    receivedQuantity: rounded(Number(line.quantity)), unitCost: rounded(Number(line.unitCost)),
                });
            }

            const now = new Date();
            const reference = `BILL-${now.toISOString().slice(0, 10).replaceAll('-', '')}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
            const document = new ProcurementDocument({
                restaurantId: restaurantObjectId, type: 'purchase_order', status: 'received', reference,
                supplier, vendorBillNumber: billReference || undefined, vendorBillKey, entrySource: 'supplier_bill',
                invoiceDate, documentDate: invoiceDate, notes: String(data.notes || '').trim().slice(0, 500) || 'Received from reviewed supplier bill entry', lines: billLines, payments: [],
            });
            await document.save({ session: session! });

            for (const { item, category, quantity, lineTotal } of grouped.values()) {
                const stockBefore = Number(item.currentStock || 0);
                const stockAfter = rounded(stockBefore + quantity);
                const unitCost = quantity > 0 ? rounded(lineTotal / quantity) : 0;
                item.currentStock = stockAfter;
                item.costPerUnit = stockAfter > 0
                    ? rounded(((stockBefore * Number(item.costPerUnit || 0)) + lineTotal) / stockAfter)
                    : unitCost;
                item.supplier = supplier;
                await item.save({ session: session! });
                await StockMovement.create([{
                    restaurantId: restaurantObjectId, inventoryItemId: item._id, procurementDocumentId: document._id,
                    type: 'purchase', quantity, stockBefore, stockAfter,
                    unitCost, inventoryCategory: category, movementDate: invoiceDate,
                    note: `Received from ${supplier}${billReference ? ` · invoice ${billReference}` : ''}`,
                }], { session: session!, ordered: true });
            }
            savedReference = reference;
            savedLines = billLines.length;
        });
        revalidatePath('/dashboard/inventory');
        revalidatePath('/dashboard/store');
        revalidatePath('/dashboard');
        return { success: true, reference: savedReference, updated: savedLines };
    } catch (error: any) {
        console.error('Apply inventory bill error:', error);
        if (error?.code === 11000) return { success: false, error: 'This supplier invoice is already recorded. Check the invoice number and Store purchase history.' };
        return { success: false, error: error?.message || 'Could not apply bill' };
    } finally {
        await session?.endSession();
    }
}

export async function updateInventoryBillPurchase(data: {
    purchaseDocumentId: string;
    supplier: string;
    billReference: string;
    invoiceDate: string;
    notes?: string;
    lines: { inventoryItemId: string; newItemName?: string; category?: string; quantity: number; unit: string; unitCost: number }[];
    payments: { amount: number; paidAt: string; reference?: string }[];
}) {
    let session: mongoose.ClientSession | undefined;
    try {
        const supplier = String(data.supplier || '').trim();
        const billReference = String(data.billReference || '').trim();
        const invoiceDate = new Date(data.invoiceDate);
        if (!mongoose.Types.ObjectId.isValid(data.purchaseDocumentId)) return { success: false, error: 'Choose a valid supplier bill.' };
        if (!supplier || supplier.length > 120) return { success: false, error: 'Enter the supplier name.' };
        if (billReference.length > 80) return { success: false, error: 'Invoice number must be 80 characters or less.' };
        if (!/^\d{4}-\d{2}-\d{2}$/.test(data.invoiceDate) || Number.isNaN(invoiceDate.getTime()) || invoiceDate.toISOString().slice(0, 10) !== data.invoiceDate) return { success: false, error: 'Choose a valid invoice date.' };
        if (!Array.isArray(data.lines) || !data.lines.length || data.lines.length > 60) return { success: false, error: 'Keep between 1 and 60 bill lines.' };
        if (!Array.isArray(data.payments) || data.payments.length > 60 || data.payments.some((payment) =>
            !finiteNonNegative(payment.amount) || Number(payment.amount) <= 0 || Number(payment.amount) > 10_000_000
            || !/^\d{4}-\d{2}-\d{2}$/.test(payment.paidAt) || Number.isNaN(new Date(payment.paidAt).getTime())
            || new Date(payment.paidAt).toISOString().slice(0, 10) !== payment.paidAt
            || String(payment.reference || '').length > 100
        )) return { success: false, error: 'Check each payment amount, date, and reference.' };
        for (const line of data.lines) {
            const hasItem = Boolean(line.inventoryItemId && mongoose.Types.ObjectId.isValid(line.inventoryItemId));
            const newItemName = String(line.newItemName || '').trim();
            if ((!hasItem && (!newItemName || newItemName.length > 120)) || !INVENTORY_UNITS.includes(line.unit as InventoryUnit)) return { success: false, error: 'Choose an inventory item or enter a valid new item and unit.' };
            if (!Number.isFinite(Number(line.quantity)) || Number(line.quantity) <= 0 || Number(line.quantity) > 1_000_000 || !finiteNonNegative(line.unitCost) || Number(line.unitCost) > 10_000_000) return { success: false, error: 'Check every bill quantity and unit cost.' };
        }

        const { restaurantId } = await restaurantContext();
        const restaurantObjectId = new mongoose.Types.ObjectId(restaurantId);
        const normalizedSupplier = supplier.toLocaleLowerCase().replace(/\s+/g, ' ');
        const vendorBillKey = billReference ? `${normalizedSupplier}::${billReference.toLocaleLowerCase().replace(/\s+/g, ' ')}` : undefined;
        if (vendorBillKey && vendorBillKey.length > 220) return { success: false, error: 'Supplier and invoice number are too long to save.' };

        session = await mongoose.startSession();
        let savedLineCount = 0;
        await session.withTransaction(async () => {
            const document = await ProcurementDocument.findOne({ _id: data.purchaseDocumentId, restaurantId: restaurantObjectId, type: 'purchase_order', status: 'received' }).session(session!);
            if (!document) throw new Error('Only received supplier bills can be edited here. Open orders are edited from the order list.');
            const isSupplierBill = document.entrySource === 'supplier_bill'
                || document.reference.startsWith('BILL-')
                || String(document.notes || '').toLowerCase().includes('supplier bill entry');
            if (!isSupplierBill) throw new Error('This record is a received purchase order, not a supplier bill entry.');
            const duplicate = vendorBillKey && await ProcurementDocument.exists({ _id: { $ne: document._id }, restaurantId: restaurantObjectId, vendorBillKey }).session(session!);
            if (duplicate) throw new Error(`Invoice ${billReference} from ${supplier} is already recorded.`);

            const oldTotals = new Map<string, { quantity: number; value: number; itemId: mongoose.Types.ObjectId }>();
            for (const line of document.lines) {
                const id = String(line.inventoryItemId);
                const entry = oldTotals.get(id) || { quantity: 0, value: 0, itemId: line.inventoryItemId };
                entry.quantity = rounded(entry.quantity + Number(line.receivedQuantity || 0));
                entry.value = rounded(entry.value + Number(line.receivedQuantity || 0) * Number(line.unitCost || 0));
                oldTotals.set(id, entry);
            }

            const oldIds = [...oldTotals.values()].map((entry) => entry.itemId);
            const selectedIds = data.lines.filter((line) => mongoose.Types.ObjectId.isValid(line.inventoryItemId)).map((line) => line.inventoryItemId);
            const existingItems = await InventoryItem.find({ restaurantId: restaurantObjectId, _id: { $in: [...oldIds, ...selectedIds] } }).session(session!);
            const itemById = new Map(existingItems.map((item) => [String(item._id), item]));
            const itemTotals = new Map<string, { item: InstanceType<typeof InventoryItem>; quantity: number; value: number; category: string }>();
            const newLines: IProcurementLine[] = [];

            for (const line of data.lines) {
                let item = mongoose.Types.ObjectId.isValid(line.inventoryItemId) ? itemById.get(line.inventoryItemId) || null : null;
                if (!item) {
                    if (line.inventoryItemId) throw new Error('An inventory item was not found. Refresh and edit the bill again.');
                    const itemName = String(line.newItemName || '').trim();
                    const sameName = await InventoryItem.findOne({ restaurantId: restaurantObjectId, name: itemName }).session(session!);
                    if (sameName) {
                        if (!sameName.isActive) throw new Error(`“${itemName}” is archived. Restore it or choose another inventory item.`);
                        if (sameName.unit !== line.unit) throw new Error(`“${itemName}” already uses ${sameName.unit}. Convert the bill quantity before saving.`);
                        item = sameName;
                    } else {
                        item = new InventoryItem({
                            restaurantId: restaurantObjectId, name: itemName,
                            category: String(line.category || 'General').trim().slice(0, 80) || 'General',
                            unit: line.unit as InventoryUnit, currentStock: 0, reorderLevel: 0,
                            costPerUnit: Number(line.unitCost), supplier, expiryDays: DEFAULT_EXPIRY_DAYS,
                        });
                        await item.save({ session: session! });
                    }
                    itemById.set(String(item._id), item);
                }
                if (!item.isActive) throw new Error(`“${item.name}” is archived. Restore it or choose another inventory item.`);
                if (item.unit !== line.unit) throw new Error(`“${item.name}” uses ${item.unit}; convert the bill quantity before saving.`);
                const category = String(line.category || item.category || 'General').trim().slice(0, 80) || 'General';
                const id = String(item._id);
                const total = itemTotals.get(id) || { item, quantity: 0, value: 0, category };
                if (total.category !== category) throw new Error(`Use one Store category for all bill lines matching “${item.name}”.`);
                total.quantity = rounded(total.quantity + Number(line.quantity));
                total.value = rounded(total.value + Number(line.quantity) * Number(line.unitCost));
                itemTotals.set(id, total);
                newLines.push({
                    inventoryItemId: item._id, itemName: item.name, unit: item.unit, category,
                    requestedQuantity: rounded(Number(line.quantity)), orderedQuantity: rounded(Number(line.quantity)),
                    receivedQuantity: rounded(Number(line.quantity)), unitCost: rounded(Number(line.unitCost)),
                });
            }

            const newBillTotal = rounded([...itemTotals.values()].reduce((sum, entry) => sum + entry.value, 0));
            const paidTotal = rounded(data.payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0));
            if (newBillTotal + 0.01 < paidTotal) throw new Error(`The edited bill total cannot be less than the ${rounded(paidTotal).toFixed(2)} already paid. Update the payment record first.`);

            for (const [id, oldEntry] of oldTotals) {
                if (!itemById.has(id)) throw new Error('A previously billed item no longer exists. Restore it before editing this bill.');
            }
            const affectedIds = new Set([...oldTotals.keys(), ...itemTotals.keys()]);
            for (const id of affectedIds) {
                const item = itemById.get(id)!;
                const oldEntry = oldTotals.get(id) || { quantity: 0, value: 0, itemId: item._id };
                const newEntry = itemTotals.get(id) || { item, quantity: 0, value: 0, category: item.category || 'General' };
                const stockBefore = Number(item.currentStock || 0);
                const stockDelta = rounded(newEntry.quantity - oldEntry.quantity);
                const stockAfter = rounded(stockBefore + stockDelta);
                if (stockAfter < 0) throw new Error(`Store no longer has enough ${item.name} to reduce this bill by ${Math.abs(stockDelta)} ${item.unit}. Stock has already been issued or used.`);

                const oldCost = oldEntry.quantity > 0 ? oldEntry.value / oldEntry.quantity : Number(item.costPerUnit || 0);
                const newCost = newEntry.quantity > 0 ? newEntry.value / newEntry.quantity : oldCost;
                const oldQuantityStillOnHand = Math.min(oldEntry.quantity, stockBefore);
                const newQuantityStillOnHand = Math.min(newEntry.quantity, stockAfter);
                const stockValueAfter = Math.max(0,
                    stockBefore * Number(item.costPerUnit || 0)
                    - oldQuantityStillOnHand * oldCost
                    + newQuantityStillOnHand * newCost,
                );
                item.currentStock = stockAfter;
                if (stockAfter > 0) item.costPerUnit = rounded(stockValueAfter / stockAfter);
                else if (newEntry.quantity > 0) item.costPerUnit = rounded(newCost);
                if (itemTotals.has(id)) {
                    item.category = newEntry.category;
                    item.supplier = supplier;
                }
                await item.save({ session: session! });
            }

            const existingPurchaseMovements = await StockMovement.find({ restaurantId: restaurantObjectId, procurementDocumentId: document._id, type: 'purchase' }).session(session!);
            const stockBeforeByItem = new Map<string, number>();
            for (const movement of existingPurchaseMovements) {
                const key = String(movement.inventoryItemId);
                if (!stockBeforeByItem.has(key)) stockBeforeByItem.set(key, Number(movement.stockBefore || 0));
            }
            await StockMovement.deleteMany({ restaurantId: restaurantObjectId, procurementDocumentId: document._id, type: 'purchase' }, { session: session! });
            const replacementMovements = [...itemTotals.values()].map(({ item, quantity, value, category }) => {
                const unitCost = quantity > 0 ? rounded(value / quantity) : 0;
                const stockBefore = stockBeforeByItem.get(String(item._id)) ?? Math.max(0, Number(item.currentStock || 0) - quantity);
                return {
                    restaurantId: restaurantObjectId, inventoryItemId: item._id, procurementDocumentId: document._id,
                    type: 'purchase' as const, quantity, stockBefore, stockAfter: rounded(stockBefore + quantity), unitCost,
                    inventoryCategory: category, movementDate: invoiceDate,
                    note: `Received from ${supplier}${billReference ? ` · invoice ${billReference}` : ''}`,
                };
            });
            if (replacementMovements.length) await StockMovement.create(replacementMovements, { session: session!, ordered: true });

            document.supplier = supplier;
            document.vendorBillNumber = billReference || undefined;
            document.vendorBillKey = vendorBillKey;
            document.invoiceDate = invoiceDate;
            document.documentDate = invoiceDate;
            document.notes = String(data.notes || '').trim().slice(0, 500);
            document.entrySource = 'supplier_bill';
            document.lines = newLines as any;
            document.payments = data.payments.map((payment) => ({
                amount: rounded(Number(payment.amount)), paidAt: new Date(payment.paidAt),
                reference: String(payment.reference || '').trim().slice(0, 100),
            })) as any;
            await document.save({ session: session! });
            savedLineCount = newLines.length;
        });

        revalidatePath('/dashboard/inventory');
        revalidatePath('/dashboard/store');
        revalidatePath('/dashboard');
        return { success: true, updated: savedLineCount };
    } catch (error: any) {
        console.error('Update supplier bill error:', error);
        if (error?.code === 11000) return { success: false, error: 'That supplier invoice is already recorded. Check the supplier and invoice number.' };
        return { success: false, error: error?.message || 'Could not update supplier bill.' };
    } finally {
        await session?.endSession();
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
            reorderLevel: { $gt: 0 },
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
    if (!Number.isInteger(Number(data.expiryDays)) || Number(data.expiryDays) < 1 || Number(data.expiryDays) > 3650) {
        return 'Expiry must be a whole number from 1 to 3650 days';
    }
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
            costPerUnit: rounded(data.costPerUnit), supplier: data.supplier, notes: data.notes, expiryDays: Number(data.expiryDays),
        });
        if (item.currentStock > 0) {
            await StockMovement.create({
                restaurantId, inventoryItemId: item._id, type: 'opening', quantity: item.currentStock,
                stockBefore: 0, stockAfter: item.currentStock, unitCost: item.costPerUnit, inventoryCategory: item.category || 'General', note: 'Opening stock',
            });
        }
        revalidatePath('/dashboard/inventory');
        revalidatePath('/dashboard/store');
        revalidatePath('/dashboard');
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
        const existing = await InventoryItem.findOne({ _id: id, restaurantId, isActive: true }).select('unit').lean();
        if (!existing) return { success: false, error: 'Inventory item not found' };
        if (existing.unit !== data.unit && await MenuItem.exists({ restaurantId, 'recipe.inventoryItemId': id })) {
            return { success: false, error: 'This unit is used in menu recipes. Keep it unchanged, or update those recipes before changing the stock unit.' };
        }
        const item = await InventoryItem.findOneAndUpdate(
            { _id: id, restaurantId, isActive: true },
            {
                name: data.name.trim(), sku: data.sku, category: data.category?.trim() || 'General',
                unit: data.unit as InventoryUnit, reorderLevel: rounded(data.reorderLevel), costPerUnit: rounded(data.costPerUnit),
                supplier: data.supplier, notes: data.notes, expiryDays: Number(data.expiryDays),
            },
            { new: true, runValidators: true },
        );
        if (!item) return { success: false, error: 'Inventory item not found' };
        revalidatePath('/dashboard/inventory');
        revalidatePath('/dashboard/store');
        revalidatePath('/dashboard');
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
        const before = await InventoryItem.findOneAndUpdate(filter, update, { runValidators: true });
        if (!before) return { success: false, error: 'Not enough stock, or the item no longer exists' };
        const stockAfter = rounded(before.currentStock + delta);
        const purchaseCost = data.type === 'purchase' && finiteNonNegative(data.unitCost) ? rounded(data.unitCost) : before.costPerUnit;
        if (data.type === 'purchase' && finiteNonNegative(data.unitCost)) {
            const averageCost = stockAfter > 0
                ? rounded(((before.currentStock * before.costPerUnit) + (delta * purchaseCost)) / stockAfter)
                : purchaseCost;
            await InventoryItem.updateOne({ _id: before._id, restaurantId }, { $set: { costPerUnit: averageCost } });
        }
        try {
            await StockMovement.create({
                restaurantId, inventoryItemId: before._id, type: data.type as IStockMovement['type'], quantity: delta,
                stockBefore: before.currentStock, stockAfter,
                unitCost: purchaseCost, inventoryCategory: before.category || 'General',
                note: data.note,
            });
        } catch (movementError) {
            await InventoryItem.updateOne({ _id: before._id, restaurantId }, { $inc: { currentStock: -delta }, $set: { costPerUnit: before.costPerUnit } });
            throw movementError;
        }
        const item = await InventoryItem.findById(before._id).lean();
        revalidatePath('/dashboard/inventory');
        revalidatePath('/dashboard/store');
        revalidatePath('/dashboard');
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
        revalidatePath('/dashboard/store');
        return { success: true };
    } catch (error: any) {
        console.error('Archive inventory item error:', error);
        return { success: false, error: error?.message || 'Failed to archive inventory item' };
    }
}
