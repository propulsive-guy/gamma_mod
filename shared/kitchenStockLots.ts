import type mongoose from 'mongoose';

const DAY = 24 * 60 * 60 * 1000;
const round = (value: number) => Math.round(value * 10000) / 10000;

export const DEFAULT_EXPIRY_DAYS = 2;

export function effectiveExpiryDays(item: { expiryDays?: unknown; wasteBehavior?: 'carry_forward' | 'perishable' | null }) {
    const days = Number(item.expiryDays);
    if (Number.isInteger(days) && days >= 1 && days <= 3650) return days;
    // Keep existing ingredient records working while they are edited to set an expiry duration.
    return item.wasteBehavior === 'perishable' ? 1 : DEFAULT_EXPIRY_DAYS;
}

export function kitchenLotExpiry(issuedAt: Date, expiryDays: number) {
    return new Date(issuedAt.getTime() + expiryDays * DAY);
}

export async function createKitchenLot(Lot: any, data: {
    restaurantId: any; departmentId: any; inventoryItemId: any; quantity: number;
    expiryDays?: number; wasteBehavior?: 'carry_forward' | 'perishable'; unitCost?: number; issuedAt?: Date; baselineKey?: string;
}, session?: mongoose.ClientSession) {
    const issuedAt = data.issuedAt || new Date();
    const quantity = round(data.quantity);
    const expiryDays = effectiveExpiryDays(data);
    const [lot] = await Lot.create([{
        restaurantId: data.restaurantId, departmentId: data.departmentId, inventoryItemId: data.inventoryItemId,
        issuedQuantity: quantity, remainingQuantity: quantity, issuedAt,
        expiresAt: kitchenLotExpiry(issuedAt, expiryDays), expiryDays,
        // Retain the old field for existing reports/records while expiryDays is now authoritative.
        wasteBehavior: expiryDays === 1 ? 'perishable' : 'carry_forward', unitCost: round(Number(data.unitCost || 0)),
        ...(data.baselineKey ? { baselineKey: data.baselineKey } : {}),
    }], session ? { session } : undefined);
    return lot;
}

export async function consumeKitchenLots(Lot: any, filter: {
    restaurantId: any; departmentId: any; inventoryItemId: any;
}, quantityInput: number, session?: mongoose.ClientSession) {
    let remaining = round(quantityInput);
    if (remaining <= 0) return;
    const lots = await Lot.find({ ...filter, remainingQuantity: { $gt: 0 } })
        .sort({ issuedAt: 1, _id: 1 }).session(session || null);
    for (const lot of lots) {
        if (remaining <= 0) break;
        const take = round(Math.min(Number(lot.remainingQuantity), remaining));
        const result = await Lot.updateOne(
            { _id: lot._id, remainingQuantity: { $gte: take } },
            { $inc: { remainingQuantity: -take } },
            session ? { session } : undefined,
        );
        if (!result.modifiedCount) throw new Error('Kitchen stock changed while being deducted. Refresh and try again.');
        remaining = round(remaining - take);
    }
    // Older kitchen balances may predate lot tracking. The aggregate stock remains authoritative for them.
}

export async function seedLegacyKitchenLots(models: { Lot: any; KitchenStock: any; InventoryItem: any }, restaurantId: any, session?: mongoose.ClientSession) {
    const balances = await models.KitchenStock.find({ restaurantId, currentStock: { $gt: 0 } })
        .select('restaurantId departmentId inventoryItemId currentStock')
        .session(session || null).lean();
    if (!balances.length) return;

    // This is a one-time backfill for balances created before stock lots existed.
    // Check all deterministic baseline keys in one query instead of making one
    // existence request per kitchen balance on every expiry pass.
    const baselineKeys = balances.map((balance: any) => `${restaurantId}:${balance.departmentId}:${balance.inventoryItemId}`);
    const existingBaselines = await models.Lot.find({ restaurantId, baselineKey: { $in: baselineKeys } })
        .select('baselineKey').session(session || null).lean();
    const existingBaselineKeys = new Set(existingBaselines.map((lot: any) => String(lot.baselineKey)));

    for (const balance of balances) {
        const baselineKey = `${restaurantId}:${balance.departmentId}:${balance.inventoryItemId}`;
        if (existingBaselineKeys.has(baselineKey)) continue;
        const tracked = await models.Lot.aggregate([
            { $match: { restaurantId: balance.restaurantId, departmentId: balance.departmentId, inventoryItemId: balance.inventoryItemId, remainingQuantity: { $gt: 0 } } },
            { $group: { _id: null, quantity: { $sum: '$remainingQuantity' } } },
        ]).session(session || null);
        const untrackedQuantity = round(Number(balance.currentStock) - Number(tracked[0]?.quantity || 0));
        if (untrackedQuantity <= 0) continue;
        const item = await models.InventoryItem.findOne({ _id: balance.inventoryItemId, restaurantId }).select('expiryDays wasteBehavior costPerUnit').session(session || null).lean();
        try {
            await createKitchenLot(models.Lot, {
                restaurantId, departmentId: balance.departmentId, inventoryItemId: balance.inventoryItemId,
                quantity: untrackedQuantity, expiryDays: effectiveExpiryDays(item || {}), unitCost: item?.costPerUnit || 0, baselineKey,
            }, session);
        } catch (error: any) {
            if (error?.code !== 11000) throw error;
        }
    }
}

export async function expireDueKitchenLots(models: { Lot: any; KitchenStock: any; StockMovement: any; InventoryItem?: any }, restaurantId: any, session?: mongoose.ClientSession) {
    const now = new Date();
    const dueLots = await models.Lot.find({ restaurantId, expiresAt: { $lte: now }, remainingQuantity: { $gt: 0 } })
        .sort({ expiresAt: 1, _id: 1 }).session(session || null);
    const itemIds = [...new Set(dueLots.map((lot: any) => String(lot.inventoryItemId)))];
    const itemCategories = models.InventoryItem && itemIds.length
        ? await models.InventoryItem.find({ restaurantId, _id: { $in: itemIds } }).select('category').session(session || null).lean()
        : [];
    const categoryByItemId = new Map(itemCategories.map((item: any) => [String(item._id), item.category]));
    let expiredLots = 0;
    let expiredQuantity = 0;
    for (const lot of dueLots) {
        const claimed = await models.Lot.findOneAndUpdate(
            { _id: lot._id, remainingQuantity: { $gt: 0 }, expiresAt: { $lte: now } },
            { $set: { remainingQuantity: 0, expiredAt: now } },
            { session, returnDocument: 'before' },
        );
        if (!claimed) continue;
        const quantity = round(Number(claimed.remainingQuantity));
        const before = await models.KitchenStock.findOneAndUpdate(
            { restaurantId, departmentId: claimed.departmentId, inventoryItemId: claimed.inventoryItemId, currentStock: { $gte: quantity } },
            { $inc: { currentStock: -quantity } },
            { session, returnDocument: 'before' },
        );
        const actualWaste = before ? quantity : 0;
        if (actualWaste > 0) {
            const expiryDays = effectiveExpiryDays(claimed);
            await models.StockMovement.create([{
                restaurantId, departmentId: claimed.departmentId, inventoryItemId: claimed.inventoryItemId,
                inventoryCategory: categoryByItemId.get(String(claimed.inventoryItemId)),
                type: 'wastage', quantity: -actualWaste, stockBefore: before.currentStock,
                stockAfter: round(before.currentStock - actualWaste), unitCost: claimed.unitCost, movementDate: claimed.expiresAt,
                note: `Auto-expired after ${expiryDays} ${expiryDays === 1 ? 'day' : 'days'} in kitchen`,
            }], session ? { session } : undefined);
            expiredQuantity += actualWaste;
        }
        expiredLots += 1;
    }
    return { expiredLots, expiredQuantity };
}
