'use server';

import mongoose from 'mongoose';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import dbConnect from '@/lib/db';
import InventoryItem from '@/models/InventoryItem';
import StockMovement from '@/models/StockMovement';
import ProcurementDocument from '@/models/ProcurementDocument';
import FinancialEntry, { type FinancialEntryType } from '@/models/FinancialEntry';
import FinancialSettings from '@/models/FinancialSettings';
import KitchenDepartment from '@/models/KitchenDepartment';
import KitchenStock from '@/models/KitchenStock';
import KitchenStockLot from '@/models/KitchenStockLot';
import { createKitchenLot, consumeKitchenLots } from '../../../shared/kitchenStockLots';
import { processKitchenStockExpiry } from '@/lib/kitchenStockLots';

const round = (value: number) => Math.round(value * 10000) / 10000;
const validAmount = (value: unknown) => Number.isFinite(Number(value)) && Number(value) >= 0;

async function context() {
    const session = await auth();
    if (!session?.user?.restaurantId) throw new Error('Please sign in again');
    await dbConnect();
    return { restaurantId: new mongoose.Types.ObjectId(String(session.user.restaurantId)) };
}

function makeReference(prefix: 'REQ' | 'PO') {
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(2, 12);
    return `${prefix}-${stamp}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function refreshStore() {
    revalidatePath('/dashboard/store');
    revalidatePath('/dashboard/inventory');
    revalidatePath('/dashboard');
}

export async function updateMinimumStockThreshold(data: { inventoryItemId: string; minimumStock: number }) {
    try {
        const { restaurantId } = await context();
        const minimumStock = Number(data.minimumStock);
        if (!mongoose.Types.ObjectId.isValid(data.inventoryItemId)) return { success: false, error: 'Choose a valid inventory item.' };
        if (!Number.isFinite(minimumStock) || minimumStock < 0 || minimumStock > 1_000_000) return { success: false, error: 'Minimum stock must be between 0 and 1,000,000.' };
        const item = await InventoryItem.findOneAndUpdate(
            { _id: data.inventoryItemId, restaurantId, isActive: true },
            { $set: { reorderLevel: round(minimumStock) } },
            { new: true, runValidators: true },
        ).select('_id');
        if (!item) return { success: false, error: 'Inventory item not found.' };
        refreshStore();
        return { success: true };
    } catch (error: any) {
        console.error('Update minimum stock threshold error:', error);
        return { success: false, error: error?.message || 'Could not save minimum stock.' };
    }
}

export async function createKitchenDepartment(nameInput: string) {
    try {
        const { restaurantId } = await context();
        const name = String(nameInput || '').trim().replace(/\s+/g, ' ');
        if (name.length < 2 || name.length > 80) return { success: false, error: 'Department name must be 2–80 characters.' };
        if (await KitchenDepartment.countDocuments({ restaurantId, isActive: true }) >= 30) return { success: false, error: 'You can create up to 30 active kitchen departments.' };
        const department = await KitchenDepartment.create({ restaurantId, name, isActive: true });
        refreshStore();
        revalidatePath('/dashboard/menu');
        return { success: true, department: JSON.parse(JSON.stringify(department)) };
    } catch (error: any) {
        if (error?.code === 11000) return { success: false, error: 'A department with this name already exists.' };
        console.error('Create kitchen department error:', error);
        return { success: false, error: error?.message || 'Could not create department.' };
    }
}

export async function createKitchenRequisition(data: {
    departmentId: string;
    notes?: string;
    lines: { inventoryItemId: string; quantity: number }[];
}) {
    try {
        const { restaurantId } = await context();
        if (!mongoose.Types.ObjectId.isValid(data.departmentId)) return { success: false, error: 'Choose a kitchen department.' };
        const department = await KitchenDepartment.findOne({ _id: data.departmentId, restaurantId, isActive: true }).select('_id').lean();
        if (!department) return { success: false, error: 'This kitchen department is unavailable.' };
        if (!Array.isArray(data.lines) || data.lines.length < 1 || data.lines.length > 60) return { success: false, error: 'Add between 1 and 60 inventory items.' };
        const quantities = new Map<string, number>();
        for (const line of data.lines) {
            if (!mongoose.Types.ObjectId.isValid(line.inventoryItemId) || !Number.isFinite(Number(line.quantity)) || Number(line.quantity) <= 0 || Number(line.quantity) > 1_000_000) {
                return { success: false, error: 'Each requested quantity must be greater than zero.' };
            }
            quantities.set(line.inventoryItemId, round((quantities.get(line.inventoryItemId) || 0) + Number(line.quantity)));
        }
        const items = await InventoryItem.find({ restaurantId, _id: { $in: [...quantities.keys()] }, isActive: true }).select('name unit costPerUnit').lean();
        if (items.length !== quantities.size) return { success: false, error: 'One or more inventory items are unavailable. Refresh and try again.' };
        const lines = items.map((item) => ({
            inventoryItemId: item._id, itemName: item.name, unit: item.unit,
            requestedQuantity: quantities.get(String(item._id))!, orderedQuantity: quantities.get(String(item._id))!,
            receivedQuantity: 0, unitCost: item.costPerUnit,
        }));
        const doc = await ProcurementDocument.create({
            restaurantId, type: 'requisition', status: 'submitted', reference: makeReference('REQ'), departmentId: department._id,
            notes: String(data.notes || '').trim().slice(0, 500), lines,
        });
        refreshStore();
        return { success: true, reference: doc.reference };
    } catch (error: any) {
        console.error('Create kitchen requisition error:', error);
        return { success: false, error: error?.message || 'Could not create requisition.' };
    }
}

export async function approveKitchenRequisition(data: {
    requisitionId: string;
    departmentId: string;
    notes?: string;
    lines: { inventoryItemId: string; requestedQuantity: number; quantity: number }[];
}) {
    try {
        const { restaurantId } = await context();
        if (!mongoose.Types.ObjectId.isValid(data.requisitionId)) return { success: false, error: 'Invalid kitchen requisition.' };
        if (!mongoose.Types.ObjectId.isValid(data.departmentId)) return { success: false, error: 'Choose an active kitchen department for this request.' };
        if (!Array.isArray(data.lines) || !data.lines.length || data.lines.length > 60) return { success: false, error: 'Add between 1 and 60 requisition lines.' };
        await processKitchenStockExpiry(restaurantId);
        const session = await mongoose.startSession();
        try {
            await session.withTransaction(async () => {
                const request = await ProcurementDocument.findOne({ _id: data.requisitionId, restaurantId, type: 'requisition', status: 'submitted' }).session(session);
                if (!request) throw new Error('This requisition was already processed or is unavailable. Refresh the page.');
                const department = await KitchenDepartment.findOne({ _id: data.departmentId, restaurantId, isActive: true }).session(session);
                if (!department) throw new Error('Choose an active kitchen department created in Kitchen Inventory.');
                if (new Set(data.lines.map((line) => line.inventoryItemId)).size !== data.lines.length) throw new Error('Each stock item can appear only once.');
                const ids = data.lines.map((line) => line.inventoryItemId);
                if (ids.some((id) => !mongoose.Types.ObjectId.isValid(id))) throw new Error('Choose a valid inventory item on each line.');
                const items = await InventoryItem.find({ _id: { $in: ids }, restaurantId, isActive: true }).session(session);
                const itemById = new Map(items.map((item) => [String(item._id), item]));
                if (items.length !== ids.length) throw new Error('One or more inventory items are unavailable. Refresh the requisition.');
                const editableLines = data.lines.map((input) => {
                    const item = itemById.get(input.inventoryItemId)!;
                    const requested = Number(input.requestedQuantity);
                    const issue = Number(input.quantity);
                    if (!Number.isFinite(requested) || requested <= 0 || requested > 1_000_000 || !Number.isFinite(issue) || issue < 0 || issue > requested) {
                        throw new Error('Check requested and issue quantities. Issue quantity cannot exceed the requested quantity.');
                    }
                    return {
                        inventoryItemId: item._id, itemName: item.name, unit: item.unit,
                        requestedQuantity: round(requested), orderedQuantity: round(requested),
                        receivedQuantity: 0, unitCost: item.costPerUnit, approvedQuantity: round(issue),
                    };
                });
                request.departmentId = department._id;
                request.notes = String(data.notes || '').trim().slice(0, 500);
                request.lines = editableLines as any;
                for (const line of editableLines) {
                    const issued = Number(line.approvedQuantity || 0);
                    if (!issued) continue;
                    const storeBefore = await InventoryItem.findOneAndUpdate(
                        { _id: line.inventoryItemId, restaurantId, isActive: true, currentStock: { $gte: issued } },
                        { $inc: { currentStock: -issued } }, { session },
                    );
                    if (!storeBefore) throw new Error(`Not enough store stock for ${line.itemName}. Reduce the issue quantity or receive more vendor stock first.`);
                    const storeAfter = round(storeBefore.currentStock - issued);
                    const kitchenAfter = await KitchenStock.findOneAndUpdate(
                        { restaurantId, departmentId: department._id, inventoryItemId: line.inventoryItemId },
                        { $inc: { currentStock: issued }, $setOnInsert: { restaurantId, departmentId: department._id, inventoryItemId: line.inventoryItemId } },
                        { session, new: true, upsert: true, setDefaultsOnInsert: true },
                    );
                    const kitchenBefore = round(kitchenAfter.currentStock - issued);
                    await createKitchenLot(KitchenStockLot, {
                        restaurantId, departmentId: department._id, inventoryItemId: line.inventoryItemId,
                        quantity: issued, wasteBehavior: itemById.get(String(line.inventoryItemId))?.wasteBehavior || 'carry_forward',
                        unitCost: line.unitCost,
                    }, session);
                    await StockMovement.create([
                        { restaurantId, inventoryItemId: line.inventoryItemId, departmentId: department._id, procurementDocumentId: request._id, type: 'transfer_out', quantity: -issued, stockBefore: storeBefore.currentStock, stockAfter: storeAfter, unitCost: line.unitCost, note: `Issued to ${department.name} · ${request.reference}` },
                        { restaurantId, inventoryItemId: line.inventoryItemId, departmentId: department._id, procurementDocumentId: request._id, type: 'transfer_in', quantity: issued, stockBefore: kitchenBefore, stockAfter: kitchenAfter.currentStock, unitCost: line.unitCost, note: `Received by ${department.name} · ${request.reference}` },
                    ], { session, ordered: true });
                }
                request.status = 'approved';
                await request.save({ session });
            });
        } finally {
            await session.endSession();
        }
        refreshStore();
        revalidatePath('/dashboard/inventory');
        revalidatePath('/dashboard/menu');
        return { success: true };
    } catch (error: any) {
        console.error('Approve kitchen requisition error:', error);
        return { success: false, error: error?.message || 'Could not issue the kitchen requisition.' };
    }
}

export async function recordKitchenWastage(data: { departmentId: string; inventoryItemId: string; quantity: number; note: string }) {
    try {
        const { restaurantId } = await context();
        await processKitchenStockExpiry(restaurantId);
        const quantity = Number(data.quantity);
        const note = String(data.note || '').trim().slice(0, 300);
        if (!mongoose.Types.ObjectId.isValid(data.departmentId) || !mongoose.Types.ObjectId.isValid(data.inventoryItemId)) return { success: false, error: 'Choose a valid department and ingredient.' };
        if (!Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000) return { success: false, error: 'Waste quantity must be greater than zero.' };
        if (!note) return { success: false, error: 'Add a short reason for this waste entry.' };
        const session = await mongoose.startSession();
        try {
            await session.withTransaction(async () => {
                const [department, item] = await Promise.all([
                    KitchenDepartment.findOne({ _id: data.departmentId, restaurantId, isActive: true }).session(session),
                    InventoryItem.findOne({ _id: data.inventoryItemId, restaurantId, isActive: true }).session(session),
                ]);
                if (!department || !item) throw new Error('Department or inventory item is unavailable. Refresh the page.');
                const before = await KitchenStock.findOneAndUpdate(
                    { restaurantId, departmentId: department._id, inventoryItemId: item._id, currentStock: { $gte: quantity } },
                    { $inc: { currentStock: -round(quantity) } }, { session },
                );
                if (!before) throw new Error(`Not enough ${item.name} in ${department.name} to record that waste.`);
                await consumeKitchenLots(KitchenStockLot, { restaurantId, departmentId: department._id, inventoryItemId: item._id }, quantity, session);
                await StockMovement.create([{
                    restaurantId, inventoryItemId: item._id, departmentId: department._id, type: 'wastage',
                    quantity: -round(quantity), stockBefore: before.currentStock, stockAfter: round(before.currentStock - quantity),
                    unitCost: item.costPerUnit, note: `${department.name}: ${note}`,
                }], { session });
            });
        } finally {
            await session.endSession();
        }
        refreshStore();
        return { success: true };
    } catch (error: any) {
        console.error('Record kitchen wastage error:', error);
        return { success: false, error: error?.message || 'Could not record kitchen waste.' };
    }
}

export async function createVendorPurchaseOrder(data: {
    supplier: string;
    notes?: string;
    lines: { inventoryItemId: string; quantity: number; unitCost: number }[];
}) {
    try {
        const { restaurantId } = await context();
        const supplier = String(data.supplier || '').trim();
        if (!supplier || supplier.length > 120) return { success: false, error: 'Enter the supplier name.' };
        if (!Array.isArray(data.lines) || !data.lines.length || data.lines.length > 60) return { success: false, error: 'Add between 1 and 60 items to the order.' };
        if (new Set(data.lines.map((line) => line.inventoryItemId)).size !== data.lines.length) return { success: false, error: 'Each inventory item can appear only once on an order.' };
        for (const line of data.lines) {
            if (!mongoose.Types.ObjectId.isValid(line.inventoryItemId) || !Number.isFinite(Number(line.quantity)) || Number(line.quantity) <= 0 || Number(line.quantity) > 1_000_000 || !validAmount(line.unitCost) || Number(line.unitCost) > 10_000_000) {
                return { success: false, error: 'Check each item, quantity, and unit cost.' };
            }
        }
        const items = await InventoryItem.find({ restaurantId, _id: { $in: data.lines.map((line) => line.inventoryItemId) }, isActive: true }).select('name unit').lean();
        if (items.length !== data.lines.length) return { success: false, error: 'One or more selected inventory items are unavailable. Refresh and try again.' };
        const itemById = new Map(items.map((item) => [String(item._id), item]));
        const lines = data.lines.map((line) => {
            const item = itemById.get(line.inventoryItemId)!;
            return {
                inventoryItemId: item._id, itemName: item.name, unit: item.unit,
                requestedQuantity: round(Number(line.quantity)), orderedQuantity: round(Number(line.quantity)),
                receivedQuantity: 0, unitCost: round(Number(line.unitCost)),
            };
        });
        const reference = makeReference('PO');
        await ProcurementDocument.create({
            restaurantId, type: 'purchase_order', status: 'ordered', reference, supplier,
            notes: String(data.notes || '').trim().slice(0, 500), lines,
        });
        refreshStore();
        return { success: true, reference };
    } catch (error: any) {
        console.error('Create vendor purchase order error:', error);
        return { success: false, error: error?.message || 'Could not create vendor purchase order.' };
    }
}

export async function approveLowStockPurchaseOrder(data: {
    purchaseOrderId: string;
    supplier: string;
    lines: { inventoryItemId: string; quantity: number; unitCost: number }[];
}) {
    try {
        const { restaurantId } = await context();
        const supplier = String(data.supplier || '').trim();
        if (!mongoose.Types.ObjectId.isValid(data.purchaseOrderId)) return { success: false, error: 'Invalid suggested order.' };
        if (!supplier || supplier.length > 120) return { success: false, error: 'Enter the vendor before approving this order.' };
        if (!Array.isArray(data.lines) || !data.lines.length || data.lines.length > 60) return { success: false, error: 'Add at least one order line.' };
        if (new Set(data.lines.map((line) => line.inventoryItemId)).size !== data.lines.length) return { success: false, error: 'Each inventory item can appear only once on an order.' };

        const session = await mongoose.startSession();
        try {
            await session.withTransaction(async () => {
                const po = await ProcurementDocument.findOne({ _id: data.purchaseOrderId, restaurantId, type: 'purchase_order', status: 'review_required' }).session(session);
                if (!po) throw new Error('This suggestion was already reviewed or is no longer available. Refresh the page.');
                const byId = new Map(po.lines.map((line) => [String(line.inventoryItemId), line]));
                for (const line of data.lines) {
                    const existing = byId.get(line.inventoryItemId);
                    const quantity = Number(line.quantity);
                    const unitCost = Number(line.unitCost);
                    if (!existing || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000 || !validAmount(unitCost) || unitCost > 10_000_000) {
                        throw new Error('Check the suggested quantity and unit cost.');
                    }
                    existing.requestedQuantity = round(quantity);
                    existing.orderedQuantity = round(quantity);
                    existing.unitCost = round(unitCost);
                }
                if (data.lines.length !== po.lines.length) throw new Error('Keep every suggested inventory item on the order.');
                po.supplier = supplier;
                po.status = 'ordered';
                po.autoReorderKey = undefined;
                await po.save({ session });
            });
        } finally {
            await session.endSession();
        }
        refreshStore();
        return { success: true };
    } catch (error: any) {
        console.error('Approve low-stock purchase order error:', error);
        return { success: false, error: error?.message || 'Could not approve suggested order.' };
    }
}

export async function receivePurchaseOrder(data: {
    purchaseOrderId: string;
    lines: { inventoryItemId: string; quantity: number }[];
}) {
    try {
        const { restaurantId } = await context();
        if (!mongoose.Types.ObjectId.isValid(data.purchaseOrderId) || !Array.isArray(data.lines) || !data.lines.length) return { success: false, error: 'Choose at least one line to receive.' };
        if (new Set(data.lines.map((line) => line.inventoryItemId)).size !== data.lines.length) return { success: false, error: 'Each item can be received only once per submission.' };
        const session = await mongoose.startSession();
        try {
            await session.withTransaction(async () => {
                const po = await ProcurementDocument.findOne({ _id: data.purchaseOrderId, restaurantId, type: 'purchase_order', status: { $in: ['ordered', 'partially_received'] } }).session(session);
                if (!po) throw new Error('This purchase order is not open for receiving.');
                for (const received of data.lines) {
                    const line = po.lines.find((item) => String(item.inventoryItemId) === received.inventoryItemId);
                    const quantity = Number(received.quantity);
                    if (!line || !Number.isFinite(quantity) || quantity < 0 || quantity > 1_000_000) throw new Error('Enter a valid quantity for every received item.');
                    if (!quantity) continue;
                    const remaining = round(line.orderedQuantity - line.receivedQuantity);
                    if (quantity > remaining) throw new Error(`${line.itemName}: only ${remaining} ${line.unit} remain on this order.`);
                    const before = await InventoryItem.findOne({ _id: line.inventoryItemId, restaurantId, isActive: true }).session(session);
                    if (!before) throw new Error(`${line.itemName} is missing from active inventory.`);
                    const nextStock = round(before.currentStock + quantity);
                    const nextCost = nextStock > 0
                        ? round(((before.currentStock * before.costPerUnit) + (quantity * line.unitCost)) / nextStock)
                        : line.unitCost;
                    before.currentStock = nextStock;
                    before.costPerUnit = nextCost;
                    await before.save({ session });
                    line.receivedQuantity = round(line.receivedQuantity + quantity);
                    await StockMovement.create([{
                        restaurantId, inventoryItemId: before._id, procurementDocumentId: po._id,
                        type: 'purchase', quantity, stockBefore: nextStock - quantity, stockAfter: nextStock,
                        unitCost: line.unitCost, note: `Received ${po.reference}`,
                    }], { session });
                }
                if (!data.lines.some((line) => Number(line.quantity) > 0)) throw new Error('Enter a received quantity greater than zero.');
                po.status = po.lines.every((line) => line.receivedQuantity >= line.orderedQuantity) ? 'received' : 'partially_received';
                await po.save({ session });
            });
        } finally {
            await session.endSession();
        }
        refreshStore();
        return { success: true };
    } catch (error: any) {
        console.error('Receive purchase order error:', error);
        return { success: false, error: error?.message || 'Could not receive purchase order.' };
    }
}

export async function recordPurchasePayment(data: { purchaseOrderId: string; amount: number; reference?: string }) {
    try {
        const { restaurantId } = await context();
        if (!mongoose.Types.ObjectId.isValid(data.purchaseOrderId) || !Number.isFinite(Number(data.amount)) || Number(data.amount) <= 0) return { success: false, error: 'Enter a payment amount greater than zero.' };
        const session = await mongoose.startSession();
        try {
            await session.withTransaction(async () => {
                const po = await ProcurementDocument.findOne({ _id: data.purchaseOrderId, restaurantId, type: 'purchase_order', status: { $in: ['partially_received', 'received'] } }).session(session);
                if (!po) throw new Error('Receive at least part of this order before recording a payment.');
                const receivedValue = po.lines.reduce((sum, line) => sum + line.receivedQuantity * line.unitCost, 0);
                const paid = po.payments.reduce((sum, payment) => sum + payment.amount, 0);
                const due = round(receivedValue - paid);
                const amount = round(Number(data.amount));
                if (amount > due + 0.01) throw new Error(`Payment exceeds the current balance of ₹${due.toFixed(2)}.`);
                po.payments.push({ amount, paidAt: new Date(), reference: String(data.reference || '').trim().slice(0, 100) });
                await po.save({ session });
            });
        } finally {
            await session.endSession();
        }
        refreshStore();
        return { success: true };
    } catch (error: any) {
        console.error('Record purchase payment error:', error);
        return { success: false, error: error?.message || 'Could not record payment.' };
    }
}

export async function createFinancialEntry(data: {
    type: FinancialEntryType;
    category: string;
    amount: number;
    entryDate: string;
    reference?: string;
    note?: string;
}) {
    try {
        const { restaurantId } = await context();
        const types: FinancialEntryType[] = ['expense', 'capital_contribution', 'owner_draw', 'loan_received', 'loan_repayment'];
        const amount = Number(data.amount);
        const entryDate = new Date(data.entryDate);
        if (!types.includes(data.type) || !Number.isFinite(amount) || amount <= 0 || Number.isNaN(entryDate.getTime())) return { success: false, error: 'Enter a valid entry type, date, and amount.' };
        await FinancialEntry.create({
            restaurantId, type: data.type, category: String(data.category || 'General').trim().slice(0, 80) || 'General',
            amount: round(amount), entryDate, reference: String(data.reference || '').trim().slice(0, 100), note: String(data.note || '').trim().slice(0, 300),
        });
        refreshStore();
        return { success: true };
    } catch (error: any) {
        console.error('Create financial entry error:', error);
        return { success: false, error: error?.message || 'Could not save financial entry.' };
    }
}

export async function saveOpeningBalances(data: {
    openingDate: string;
    openingCash: number;
    openingInventoryValue: number;
    otherAssets: number;
    openingPayables: number;
    openingLoans: number;
    otherLiabilities: number;
}) {
    try {
        const { restaurantId } = await context();
        const openingDate = new Date(data.openingDate);
        const fields = [data.openingCash, data.openingInventoryValue, data.otherAssets, data.openingPayables, data.openingLoans, data.otherLiabilities];
        if (Number.isNaN(openingDate.getTime()) || !fields.every(validAmount)) return { success: false, error: 'Opening balances must have a valid date and non-negative amounts.' };
        await FinancialSettings.findOneAndUpdate({ restaurantId }, {
            restaurantId, openingDate,
            openingCash: round(Number(data.openingCash)), openingInventoryValue: round(Number(data.openingInventoryValue)),
            otherAssets: round(Number(data.otherAssets)), openingPayables: round(Number(data.openingPayables)),
            openingLoans: round(Number(data.openingLoans)), otherLiabilities: round(Number(data.otherLiabilities)),
        }, { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true });
        refreshStore();
        return { success: true };
    } catch (error: any) {
        console.error('Save opening balances error:', error);
        return { success: false, error: error?.message || 'Could not save opening balances.' };
    }
}
