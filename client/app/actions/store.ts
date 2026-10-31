'use server';

import mongoose from 'mongoose';
import { revalidatePath } from 'next/cache';
import { auth } from '@/lib/auth';
import dbConnect from '@/lib/db';
import InventoryItem from '@/models/InventoryItem';
import InventoryCategory from '@/models/InventoryCategory';
import StockMovement from '@/models/StockMovement';
import ProcurementDocument from '@/models/ProcurementDocument';
import FinancialEntry, { type FinancialEntryType } from '@/models/FinancialEntry';
import FinancialSettings from '@/models/FinancialSettings';
import KitchenDepartment from '@/models/KitchenDepartment';
import KitchenStock from '@/models/KitchenStock';
import KitchenStockLot from '@/models/KitchenStockLot';
import { createKitchenLot, consumeKitchenLots, effectiveExpiryDays } from '../../../shared/kitchenStockLots';
import { processKitchenStockExpiry } from '@/lib/kitchenStockLots';
import { canonicalExternalSalesChannel } from '@/lib/managementMis';

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

function parseDocumentDate(value?: string) {
    if (!value) return new Date();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
    const date = new Date(`${value}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

function refreshStore() {
    revalidatePath('/dashboard/store');
    revalidatePath('/dashboard/inventory');
    revalidatePath('/dashboard');
}

export async function createInventoryCategory(nameInput: string) {
    try {
        const { restaurantId } = await context();
        const name = String(nameInput || '').trim().replace(/\s+/g, ' ');
        if (name.length < 2 || name.length > 80) return { success: false, error: 'Category name must be 2–80 characters.' };
        const normalizedName = name.toLocaleLowerCase().replace(/\s+/g, ' ');
        const existing = await InventoryCategory.findOne({ restaurantId, normalizedName }).select('name').lean();
        if (existing) return { success: true, category: String(existing.name) };
        if (await InventoryCategory.countDocuments({ restaurantId }) >= 100) return { success: false, error: 'You can create up to 100 stock categories.' };
        const category = await InventoryCategory.findOneAndUpdate(
            { restaurantId, normalizedName },
            { $setOnInsert: { restaurantId, name, normalizedName } },
            { upsert: true, new: true, setDefaultsOnInsert: true, runValidators: true },
        ).select('name').lean();
        refreshStore();
        revalidatePath('/dashboard/menu');
        return { success: true, category: String(category?.name || name) };
    } catch (error: any) {
        console.error('Create inventory category error:', error);
        return { success: false, error: error?.message || 'Could not save this category.' };
    }
}

export async function getStoreStockSnapshot() {
    try {
        const { restaurantId } = await context();
        const [items, kitchenStocks] = await Promise.all([
            InventoryItem.find({ restaurantId, isActive: true })
                .select('name category unit currentStock reorderLevel costPerUnit supplier')
                .sort({ name: 1 }).lean(),
            KitchenStock.find({ restaurantId }).select('departmentId inventoryItemId currentStock').lean(),
        ]);
        return { success: true as const, items: JSON.parse(JSON.stringify(items)) as {
            _id: string; name: string; category: string; unit: string; currentStock: number;
            reorderLevel: number; costPerUnit: number; supplier?: string;
        }[], kitchenStocks: JSON.parse(JSON.stringify(kitchenStocks)) as { _id: string; departmentId: string; inventoryItemId: string; currentStock: number }[] };
    } catch (error) {
        console.error('Get Store stock snapshot error:', error);
        return { success: false as const, error: 'Could not refresh Store stock.' };
    }
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
    documentDate?: string;
    notes?: string;
    lines: { inventoryItemId: string; quantity: number }[];
}) {
    try {
        const { restaurantId } = await context();
        const documentDate = parseDocumentDate(data.documentDate);
        if (!documentDate) return { success: false, error: 'Choose a valid requisition date.' };
        if (!mongoose.Types.ObjectId.isValid(data.departmentId)) return { success: false, error: 'Choose a kitchen department.' };
        if (!Array.isArray(data.lines) || data.lines.length < 1 || data.lines.length > 60) return { success: false, error: 'Add between 1 and 60 inventory items.' };

        const quantities = new Map<string, number>();
        for (const line of data.lines) {
            const quantity = Number(line.quantity);
            if (!mongoose.Types.ObjectId.isValid(line.inventoryItemId) || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000) {
                return { success: false, error: 'Each requested quantity must be greater than zero.' };
            }
            quantities.set(line.inventoryItemId, round((quantities.get(line.inventoryItemId) || 0) + quantity));
        }

        await processKitchenStockExpiry(restaurantId);
        const session = await mongoose.startSession();
        let reference = '';
        try {
            await session.withTransaction(async () => {
                const department = await KitchenDepartment.findOne({ _id: data.departmentId, restaurantId, isActive: true }).session(session);
                if (!department) throw new Error('This kitchen department is unavailable.');
                const ids = [...quantities.keys()];
                const items = await InventoryItem.find({ restaurantId, _id: { $in: ids }, isActive: true }).session(session);
                if (items.length !== ids.length) throw new Error('One or more inventory items are unavailable. Refresh and try again.');
                const itemById = new Map(items.map((item) => [String(item._id), item]));
                const lines = ids.map((id) => {
                    const item = itemById.get(id)!;
                    const quantity = quantities.get(id)!;
                    return {
                        inventoryItemId: item._id, itemName: item.name, unit: item.unit,
                        requestedQuantity: quantity, orderedQuantity: quantity, receivedQuantity: 0,
                        unitCost: item.costPerUnit, approvedQuantity: quantity,
                    };
                });
                reference = makeReference('REQ');
                const [request] = await ProcurementDocument.create([{
                    restaurantId, type: 'requisition', status: 'approved', reference, departmentId: department._id,
                    documentDate, notes: String(data.notes || '').trim().slice(0, 500), lines,
                }], { session });

                for (const line of lines) {
                    const quantity = Number(line.approvedQuantity || 0);
                    const item = itemById.get(String(line.inventoryItemId))!;
                    const storeBefore = await InventoryItem.findOneAndUpdate(
                        { _id: item._id, restaurantId, isActive: true, currentStock: { $gte: quantity } },
                        { $inc: { currentStock: -quantity } }, { session },
                    );
                    if (!storeBefore) throw new Error(`Not enough ${item.name} in Store. Reduce the requested quantity or receive more stock first.`);
                    const storeAfter = round(Number(storeBefore.currentStock) - quantity);
                    const kitchenAfter = await KitchenStock.findOneAndUpdate(
                        { restaurantId, departmentId: department._id, inventoryItemId: item._id },
                        { $inc: { currentStock: quantity }, $setOnInsert: { restaurantId, departmentId: department._id, inventoryItemId: item._id } },
                        { session, new: true, upsert: true, setDefaultsOnInsert: true },
                    );
                    const kitchenBefore = round(Number(kitchenAfter.currentStock) - quantity);
                    await createKitchenLot(KitchenStockLot, {
                        restaurantId, departmentId: department._id, inventoryItemId: item._id,
                        quantity, expiryDays: effectiveExpiryDays(item), unitCost: line.unitCost,
                    }, session);
                    await StockMovement.create([
                        { restaurantId, inventoryItemId: item._id, departmentId: department._id, procurementDocumentId: request._id, inventoryCategory: item.category || 'General', type: 'transfer_out', quantity: -quantity, stockBefore: storeBefore.currentStock, stockAfter: storeAfter, unitCost: line.unitCost, note: `Issued to ${department.name} · ${reference}` },
                        { restaurantId, inventoryItemId: item._id, departmentId: department._id, procurementDocumentId: request._id, inventoryCategory: item.category || 'General', type: 'transfer_in', quantity, stockBefore: kitchenBefore, stockAfter: kitchenAfter.currentStock, unitCost: line.unitCost, note: `Received by ${department.name} · ${reference}` },
                    ], { session, ordered: true });
                }
            });
        } finally {
            await session.endSession();
        }
        refreshStore();
        revalidatePath('/dashboard/menu');
        return { success: true, reference };
    } catch (error: any) {
        console.error('Create and issue kitchen requisition error:', error);
        return { success: false, error: error?.message || 'Could not issue this requisition.' };
    }
}

export async function updateKitchenRequisition(data: {
    requisitionId: string;
    departmentId: string;
    documentDate: string;
    notes?: string;
    lines: { inventoryItemId: string; quantity: number }[];
}) {
    try {
        const { restaurantId } = await context();
        const documentDate = parseDocumentDate(data.documentDate);
        if (!mongoose.Types.ObjectId.isValid(data.requisitionId)) return { success: false, error: 'Choose a valid requisition.' };
        if (!documentDate) return { success: false, error: 'Choose a valid requisition date.' };
        if (!mongoose.Types.ObjectId.isValid(data.departmentId)) return { success: false, error: 'Choose a kitchen department.' };
        if (!Array.isArray(data.lines) || !data.lines.length || data.lines.length > 60) return { success: false, error: 'Add between 1 and 60 inventory items.' };
        const quantities = new Map<string, number>();
        for (const line of data.lines) {
            const quantity = Number(line.quantity);
            if (!mongoose.Types.ObjectId.isValid(line.inventoryItemId) || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000) {
                return { success: false, error: 'Each requested quantity must be greater than zero.' };
            }
            quantities.set(line.inventoryItemId, round((quantities.get(line.inventoryItemId) || 0) + quantity));
        }
        await processKitchenStockExpiry(restaurantId);
        const session = await mongoose.startSession();
        try {
            await session.withTransaction(async () => {
                const request = await ProcurementDocument.findOne({ _id: data.requisitionId, restaurantId, type: 'requisition', status: 'submitted' }).session(session);
                if (!request) throw new Error('This older requisition was already issued or is unavailable. Refresh the page.');
                const department = await KitchenDepartment.findOne({ _id: data.departmentId, restaurantId, isActive: true }).session(session);
                if (!department) throw new Error('Choose an active kitchen department.');
                const ids = [...quantities.keys()];
                const items = await InventoryItem.find({ _id: { $in: ids }, restaurantId, isActive: true }).session(session);
                if (items.length !== ids.length) throw new Error('One or more inventory items are unavailable.');
                const itemById = new Map(items.map((item) => [String(item._id), item]));
                const lines = ids.map((id) => {
                    const item = itemById.get(id)!;
                    const quantity = quantities.get(id)!;
                    return { inventoryItemId: item._id, itemName: item.name, unit: item.unit, requestedQuantity: round(quantity), orderedQuantity: round(quantity), receivedQuantity: 0, unitCost: item.costPerUnit, approvedQuantity: round(quantity) };
                });
                request.departmentId = department._id;
                request.documentDate = documentDate;
                request.notes = String(data.notes || '').trim().slice(0, 500);
                request.lines = lines as any;
                for (const line of lines) {
                    const quantity = Number(line.approvedQuantity || 0);
                    const item = itemById.get(String(line.inventoryItemId))!;
                    const storeBefore = await InventoryItem.findOneAndUpdate(
                        { _id: item._id, restaurantId, isActive: true, currentStock: { $gte: quantity } },
                        { $inc: { currentStock: -quantity } }, { session },
                    );
                    if (!storeBefore) throw new Error(`Not enough ${item.name} in Store. Reduce the quantity or receive more stock first.`);
                    const storeAfter = round(Number(storeBefore.currentStock) - quantity);
                    const kitchenAfter = await KitchenStock.findOneAndUpdate(
                        { restaurantId, departmentId: department._id, inventoryItemId: item._id },
                        { $inc: { currentStock: quantity }, $setOnInsert: { restaurantId, departmentId: department._id, inventoryItemId: item._id } },
                        { session, new: true, upsert: true, setDefaultsOnInsert: true },
                    );
                    const kitchenBefore = round(Number(kitchenAfter.currentStock) - quantity);
                    await createKitchenLot(KitchenStockLot, {
                        restaurantId, departmentId: department._id, inventoryItemId: item._id,
                        quantity, expiryDays: effectiveExpiryDays(item), unitCost: line.unitCost,
                    }, session);
                    await StockMovement.create([
                        { restaurantId, inventoryItemId: item._id, departmentId: department._id, procurementDocumentId: request._id, inventoryCategory: item.category || 'General', type: 'transfer_out', quantity: -quantity, stockBefore: storeBefore.currentStock, stockAfter: storeAfter, unitCost: line.unitCost, note: `Issued to ${department.name} · ${request.reference}` },
                        { restaurantId, inventoryItemId: item._id, departmentId: department._id, procurementDocumentId: request._id, inventoryCategory: item.category || 'General', type: 'transfer_in', quantity, stockBefore: kitchenBefore, stockAfter: kitchenAfter.currentStock, unitCost: line.unitCost, note: `Received by ${department.name} · ${request.reference}` },
                    ], { session, ordered: true });
                }
                request.status = 'approved';
                await request.save({ session });
            });
        } finally {
            await session.endSession();
        }
        refreshStore();
        return { success: true };
    } catch (error: any) {
        console.error('Update kitchen requisition error:', error);
        return { success: false, error: error?.message || 'Could not update requisition.' };
    }
}

export async function editIssuedKitchenRequisition(data: {
    requisitionId: string;
    documentDate?: string;
    notes?: string;
    lines: { inventoryItemId: string; quantity: number }[];
}) {
    try {
        const { restaurantId } = await context();
        const documentDate = parseDocumentDate(data.documentDate);
        if (!mongoose.Types.ObjectId.isValid(data.requisitionId)) return { success: false, error: 'Choose a valid requisition.' };
        if (!documentDate) return { success: false, error: 'Choose a valid requisition date.' };
        if (!Array.isArray(data.lines) || !data.lines.length || data.lines.length > 60) return { success: false, error: 'Keep between 1 and 60 requisition lines.' };

        const quantities = new Map<string, number>();
        for (const line of data.lines) {
            const quantity = Number(line.quantity);
            if (!mongoose.Types.ObjectId.isValid(line.inventoryItemId) || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000) {
                return { success: false, error: 'Each item needs a quantity greater than zero.' };
            }
            quantities.set(line.inventoryItemId, round((quantities.get(line.inventoryItemId) || 0) + quantity));
        }
        if (quantities.size > 60) return { success: false, error: 'A requisition can contain up to 60 different items.' };

        await processKitchenStockExpiry(restaurantId);
        const session = await mongoose.startSession();
        let reference = '';
        try {
            await session.withTransaction(async () => {
                const request = await ProcurementDocument.findOne({
                    _id: data.requisitionId, restaurantId, type: 'requisition', status: 'approved',
                }).session(session);
                if (!request?.departmentId) throw new Error('This issued requisition is unavailable. Refresh the page.');
                const department = await KitchenDepartment.findOne({ _id: request.departmentId, restaurantId }).session(session);
                if (!department) throw new Error('The requisition kitchen department could not be found.');

                const oldQuantities = new Map<string, number>();
                for (const line of request.lines) {
                    const id = String(line.inventoryItemId);
                    const oldQuantity = Number(line.approvedQuantity ?? line.orderedQuantity ?? line.requestedQuantity ?? 0);
                    oldQuantities.set(id, round((oldQuantities.get(id) || 0) + oldQuantity));
                }
                const allIds = [...new Set([...oldQuantities.keys(), ...quantities.keys()])];
                const items = await InventoryItem.find({ restaurantId, _id: { $in: allIds } }).session(session);
                if (items.length !== allIds.length) throw new Error('An item in this requisition is unavailable. Refresh the page.');
                const itemById = new Map(items.map((item) => [String(item._id), item]));
                for (const id of quantities.keys()) {
                    if (!itemById.get(id)?.isActive) throw new Error('Choose active stock items for this requisition.');
                }

                const adjustments: any[] = [];
                for (const id of allIds) {
                    const item = itemById.get(id)!;
                    const oldQuantity = oldQuantities.get(id) || 0;
                    const newQuantity = quantities.get(id) || 0;
                    const delta = round(newQuantity - oldQuantity);
                    if (delta === 0) continue;

                    if (delta > 0) {
                        const storeBefore = await InventoryItem.findOneAndUpdate(
                            { _id: item._id, restaurantId, isActive: true, currentStock: { $gte: delta } },
                            { $inc: { currentStock: -delta } }, { session },
                        );
                        if (!storeBefore) throw new Error(`Not enough ${item.name} in Store to add ${round(delta).toFixed(2)} ${item.unit}.`);
                        const storeAfter = round(Number(storeBefore.currentStock) - delta);
                        const kitchenAfter = await KitchenStock.findOneAndUpdate(
                            { restaurantId, departmentId: department._id, inventoryItemId: item._id },
                            { $inc: { currentStock: delta }, $setOnInsert: { restaurantId, departmentId: department._id, inventoryItemId: item._id } },
                            { session, new: true, upsert: true, setDefaultsOnInsert: true },
                        );
                        const kitchenBefore = round(Number(kitchenAfter.currentStock) - delta);
                        await createKitchenLot(KitchenStockLot, {
                            restaurantId, departmentId: department._id, inventoryItemId: item._id,
                            quantity: delta, expiryDays: effectiveExpiryDays(item), unitCost: item.costPerUnit,
                        }, session);
                        adjustments.push(
                            { restaurantId, inventoryItemId: item._id, departmentId: department._id, procurementDocumentId: request._id, inventoryCategory: item.category || 'General', type: 'transfer_out', quantity: -delta, stockBefore: storeBefore.currentStock, stockAfter: storeAfter, unitCost: item.costPerUnit, movementDate: new Date(), note: `Additional issue · ${request.reference}` },
                            { restaurantId, inventoryItemId: item._id, departmentId: department._id, procurementDocumentId: request._id, inventoryCategory: item.category || 'General', type: 'transfer_in', quantity: delta, stockBefore: kitchenBefore, stockAfter: kitchenAfter.currentStock, unitCost: item.costPerUnit, movementDate: new Date(), note: `Additional issue · ${request.reference}` },
                        );
                    } else {
                        const returnedQuantity = Math.abs(delta);
                        const kitchenBefore = await KitchenStock.findOneAndUpdate(
                            { restaurantId, departmentId: department._id, inventoryItemId: item._id, currentStock: { $gte: returnedQuantity } },
                            { $inc: { currentStock: -returnedQuantity } }, { session },
                        );
                        if (!kitchenBefore) throw new Error(`Cannot reduce ${item.name}: some of the issued stock has already been used or expired.`);
                        const storeBefore = await InventoryItem.findOneAndUpdate(
                            { _id: item._id, restaurantId }, { $inc: { currentStock: returnedQuantity } }, { session },
                        );
                        if (!storeBefore) throw new Error(`${item.name} is no longer available in Store records.`);

                        let lotQuantityToReturn = returnedQuantity;
                        const lots = await KitchenStockLot.find({
                            restaurantId, departmentId: department._id, inventoryItemId: item._id, remainingQuantity: { $gt: 0 },
                        }).sort({ issuedAt: -1, _id: -1 }).session(session);
                        for (const lot of lots) {
                            if (lotQuantityToReturn <= 0) break;
                            const amount = round(Math.min(Number(lot.remainingQuantity), lotQuantityToReturn));
                            const changed = await KitchenStockLot.updateOne(
                                { _id: lot._id, remainingQuantity: { $gte: amount } },
                                { $inc: { remainingQuantity: -amount } }, { session },
                            );
                            if (!changed.modifiedCount) throw new Error('Kitchen lot stock changed. Refresh and try again.');
                            lotQuantityToReturn = round(lotQuantityToReturn - amount);
                        }

                        const kitchenAfter = round(Number(kitchenBefore.currentStock) - returnedQuantity);
                        const storeAfter = round(Number(storeBefore.currentStock) + returnedQuantity);
                        adjustments.push(
                            { restaurantId, inventoryItemId: item._id, departmentId: department._id, procurementDocumentId: request._id, inventoryCategory: item.category || 'General', type: 'transfer_in', quantity: returnedQuantity, stockBefore: storeBefore.currentStock, stockAfter: storeAfter, unitCost: item.costPerUnit, movementDate: new Date(), note: `Returned after requisition edit · ${request.reference}` },
                            { restaurantId, inventoryItemId: item._id, departmentId: department._id, procurementDocumentId: request._id, inventoryCategory: item.category || 'General', type: 'transfer_out', quantity: -returnedQuantity, stockBefore: kitchenBefore.currentStock, stockAfter: kitchenAfter, unitCost: item.costPerUnit, movementDate: new Date(), note: `Returned after requisition edit · ${request.reference}` },
                        );
                    }
                }

                if (adjustments.length) await StockMovement.create(adjustments, { session, ordered: true });
                request.documentDate = documentDate;
                request.notes = String(data.notes || '').trim().slice(0, 500);
                request.lines = [...quantities.entries()].map(([id, quantity]) => {
                    const item = itemById.get(id)!;
                    return {
                        inventoryItemId: item._id, itemName: item.name, unit: item.unit, category: item.category || 'General',
                        requestedQuantity: quantity, orderedQuantity: quantity, receivedQuantity: 0,
                        unitCost: item.costPerUnit, approvedQuantity: quantity,
                    };
                }) as any;
                reference = request.reference;
                await request.save({ session });
            });
        } finally {
            await session.endSession();
        }
        refreshStore();
        revalidatePath('/dashboard/menu');
        return { success: true, reference };
    } catch (error: any) {
        console.error('Edit issued kitchen requisition error:', error);
        return { success: false, error: error?.message || 'Could not edit this requisition.' };
    }
}

export async function updateRequisitionDate(data: { requisitionId: string; documentDate: string }) {
    try {
        const { restaurantId } = await context();
        const documentDate = parseDocumentDate(data.documentDate);
        if (!mongoose.Types.ObjectId.isValid(data.requisitionId) || !documentDate) return { success: false, error: 'Choose a valid requisition and date.' };
        const request = await ProcurementDocument.findOneAndUpdate(
            { _id: data.requisitionId, restaurantId, type: 'requisition' },
            { $set: { documentDate } },
            { new: true, runValidators: true },
        ).select('_id');
        if (!request) return { success: false, error: 'Requisition not found.' };
        refreshStore();
        return { success: true };
    } catch (error: any) {
        console.error('Update requisition date error:', error);
        return { success: false, error: error?.message || 'Could not update requisition date.' };
    }
}

export async function approveKitchenRequisition(data: {
    requisitionId: string;
    departmentId: string;
    documentDate?: string;
    notes?: string;
    lines: { inventoryItemId: string; requestedQuantity: number; quantity: number }[];
}) {
    try {
        const { restaurantId } = await context();
        const documentDate = parseDocumentDate(data.documentDate);
        if (!mongoose.Types.ObjectId.isValid(data.requisitionId)) return { success: false, error: 'Invalid kitchen requisition.' };
        if (!documentDate) return { success: false, error: 'Choose a valid requisition date.' };
        if (!mongoose.Types.ObjectId.isValid(data.departmentId)) return { success: false, error: 'Choose an active kitchen department for this request.' };
        if (!Array.isArray(data.lines) || !data.lines.length || data.lines.length > 60) return { success: false, error: 'Add between 1 and 60 requisition lines.' };
        await processKitchenStockExpiry(restaurantId);
        const session = await mongoose.startSession();
        try {
            await session.withTransaction(async () => {
                const request = await ProcurementDocument.findOne({ _id: data.requisitionId, restaurantId, type: 'requisition', status: 'submitted' }).session(session);
                if (!request) throw new Error('This requisition was already processed or is unavailable. Refresh the page.');
                const department = await KitchenDepartment.findOne({ _id: data.departmentId, restaurantId, isActive: true }).session(session);
                if (!department) throw new Error('Choose an active kitchen department created in Store.');
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
                request.documentDate = documentDate;
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
                        quantity: issued, expiryDays: effectiveExpiryDays(itemById.get(String(line.inventoryItemId)) || {}),
                        unitCost: line.unitCost,
                    }, session);
                    await StockMovement.create([
                        { restaurantId, inventoryItemId: line.inventoryItemId, departmentId: department._id, procurementDocumentId: request._id, inventoryCategory: itemById.get(String(line.inventoryItemId))?.category || 'General', type: 'transfer_out', quantity: -issued, stockBefore: storeBefore.currentStock, stockAfter: storeAfter, unitCost: line.unitCost, note: `Issued to ${department.name} · ${request.reference}` },
                        { restaurantId, inventoryItemId: line.inventoryItemId, departmentId: department._id, procurementDocumentId: request._id, inventoryCategory: itemById.get(String(line.inventoryItemId))?.category || 'General', type: 'transfer_in', quantity: issued, stockBefore: kitchenBefore, stockAfter: kitchenAfter.currentStock, unitCost: line.unitCost, note: `Received by ${department.name} · ${request.reference}` },
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

export async function issueKitchenRequisition(requisitionId: string) {
    try {
        const { restaurantId } = await context();
        if (!mongoose.Types.ObjectId.isValid(requisitionId)) return { success: false, error: 'Choose a valid requisition.' };
        const request = await ProcurementDocument.findOne({ _id: requisitionId, restaurantId, type: 'requisition', status: 'submitted' }).lean();
        if (!request?.departmentId || !request.lines?.length) return { success: false, error: 'This requisition is already issued or unavailable.' };
        return await approveKitchenRequisition({
            requisitionId: String(request._id), departmentId: String(request.departmentId),
            documentDate: request.documentDate ? new Date(request.documentDate).toISOString().slice(0, 10) : new Date(request.createdAt).toISOString().slice(0, 10),
            notes: request.notes || '',
            lines: request.lines.map((line) => ({ inventoryItemId: String(line.inventoryItemId), requestedQuantity: Number(line.requestedQuantity), quantity: Number(line.requestedQuantity) })),
        });
    } catch (error: any) {
        console.error('Issue existing kitchen requisition error:', error);
        return { success: false, error: error?.message || 'Could not issue this requisition.' };
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
                    restaurantId, inventoryItemId: item._id, departmentId: department._id, inventoryCategory: item.category || 'General', type: 'wastage',
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
    documentDate?: string;
    notes?: string;
    lines: { inventoryItemId: string; quantity: number; unitCost: number }[];
}) {
    try {
        const { restaurantId } = await context();
        const documentDate = parseDocumentDate(data.documentDate);
        if (!documentDate) return { success: false, error: 'Choose a valid purchase order date.' };
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
            documentDate, notes: String(data.notes || '').trim().slice(0, 500), lines,
        });
        refreshStore();
        return { success: true, reference };
    } catch (error: any) {
        console.error('Create vendor purchase order error:', error);
        return { success: false, error: error?.message || 'Could not create vendor purchase order.' };
    }
}

export async function updateVendorPurchaseOrder(data: {
    purchaseOrderId: string;
    supplier: string;
    documentDate: string;
    notes?: string;
    lines: { inventoryItemId: string; quantity: number; unitCost: number }[];
}) {
    try {
        const { restaurantId } = await context();
        const supplier = String(data.supplier || '').trim();
        const documentDate = parseDocumentDate(data.documentDate);
        if (!mongoose.Types.ObjectId.isValid(data.purchaseOrderId)) return { success: false, error: 'Choose a valid purchase order.' };
        if (!supplier || supplier.length > 120) return { success: false, error: 'Enter the supplier name.' };
        if (!documentDate) return { success: false, error: 'Choose a valid purchase order date.' };
        if (!Array.isArray(data.lines) || !data.lines.length || data.lines.length > 60) return { success: false, error: 'Add between 1 and 60 items to the order.' };
        if (new Set(data.lines.map((line) => line.inventoryItemId)).size !== data.lines.length) return { success: false, error: 'Each inventory item can appear only once on an order.' };
        for (const line of data.lines) {
            if (!mongoose.Types.ObjectId.isValid(line.inventoryItemId) || !Number.isFinite(Number(line.quantity)) || Number(line.quantity) <= 0 || Number(line.quantity) > 1_000_000 || !validAmount(line.unitCost) || Number(line.unitCost) > 10_000_000) return { success: false, error: 'Check each item, quantity, and unit cost.' };
        }
        const session = await mongoose.startSession();
        try {
            await session.withTransaction(async () => {
                const po = await ProcurementDocument.findOne({ _id: data.purchaseOrderId, restaurantId, type: 'purchase_order', status: 'ordered' }).session(session);
                if (!po) throw new Error('Only an open, not-yet-received purchase order can be edited.');
                if (po.lines.some((line) => Number(line.receivedQuantity) > 0)) throw new Error('This order has received stock and is locked to preserve its purchase and stock history.');
                const items = await InventoryItem.find({ restaurantId, _id: { $in: data.lines.map((line) => line.inventoryItemId) }, isActive: true }).select('name unit').session(session);
                if (items.length !== data.lines.length) throw new Error('One or more selected inventory items are unavailable. Refresh and try again.');
                const itemById = new Map(items.map((item) => [String(item._id), item]));
                po.supplier = supplier;
                po.documentDate = documentDate;
                po.notes = String(data.notes || '').trim().slice(0, 500);
                po.lines = data.lines.map((line) => {
                    const item = itemById.get(line.inventoryItemId)!;
                    return { inventoryItemId: item._id, itemName: item.name, unit: item.unit, requestedQuantity: round(Number(line.quantity)), orderedQuantity: round(Number(line.quantity)), receivedQuantity: 0, unitCost: round(Number(line.unitCost)) };
                }) as any;
                await po.save({ session });
            });
        } finally {
            await session.endSession();
        }
        refreshStore();
        return { success: true };
    } catch (error: any) {
        console.error('Update vendor purchase order error:', error);
        return { success: false, error: error?.message || 'Could not update purchase order.' };
    }
}

export async function updateVendorPurchaseOrderDate(data: { purchaseOrderId: string; documentDate: string }) {
    try {
        const { restaurantId } = await context();
        const documentDate = parseDocumentDate(data.documentDate);
        if (!mongoose.Types.ObjectId.isValid(data.purchaseOrderId) || !documentDate) return { success: false, error: 'Choose a valid purchase order and date.' };
        const order = await ProcurementDocument.findOneAndUpdate(
            { _id: data.purchaseOrderId, restaurantId, type: 'purchase_order' },
            { $set: { documentDate } },
            { new: true, runValidators: true },
        ).select('_id');
        if (!order) return { success: false, error: 'Purchase order not found.' };
        refreshStore();
        return { success: true };
    } catch (error: any) {
        console.error('Update vendor purchase order date error:', error);
        return { success: false, error: error?.message || 'Could not update purchase order date.' };
    }
}

export async function approveLowStockPurchaseOrder(data: {
    purchaseOrderId: string;
    supplier: string;
    documentDate?: string;
    lines: { inventoryItemId: string; quantity: number; unitCost: number }[];
}) {
    try {
        const { restaurantId } = await context();
        const supplier = String(data.supplier || '').trim();
        const documentDate = parseDocumentDate(data.documentDate);
        if (!mongoose.Types.ObjectId.isValid(data.purchaseOrderId)) return { success: false, error: 'Invalid suggested order.' };
        if (!supplier || supplier.length > 120) return { success: false, error: 'Enter the vendor before approving this order.' };
        if (!documentDate) return { success: false, error: 'Choose a valid purchase order date.' };
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
                po.documentDate = documentDate;
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
                        unitCost: line.unitCost, inventoryCategory: before.category || 'General', note: `Received ${po.reference}`,
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
        const types: FinancialEntryType[] = ['expense', 'revenue', 'capital_contribution', 'owner_draw', 'loan_received', 'loan_repayment'];
        const amount = Number(data.amount);
        const entryDate = new Date(data.entryDate);
        if (!types.includes(data.type) || !Number.isFinite(amount) || amount <= 0 || Number.isNaN(entryDate.getTime())) return { success: false, error: 'Enter a valid entry type, date, and amount.' };
        const category = String(data.category || 'General').trim().slice(0, 80) || 'General';
        if (data.type === 'revenue' && !canonicalExternalSalesChannel(category)) return { success: false, error: 'Choose Party Sale or Zomato as the sales channel.' };
        await FinancialEntry.create({
            restaurantId, type: data.type, category: data.type === 'revenue' ? canonicalExternalSalesChannel(category) || category : category,
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
