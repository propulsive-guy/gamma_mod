import mongoose from 'mongoose';
import InventoryItem from '@/models/InventoryItem';
import ProcurementDocument from '@/models/ProcurementDocument';

/** Create idempotent, review-only vendor order drafts for stock at/below its minimum. */
export async function ensureLowStockPurchaseDrafts(restaurantId: string | mongoose.Types.ObjectId) {
    const lowItems = await InventoryItem.find({
        restaurantId,
        isActive: true,
        reorderLevel: { $gt: 0 },
        $expr: { $lte: ['$currentStock', '$reorderLevel'] },
    }).select('name unit currentStock reorderLevel costPerUnit supplier').lean();
    if (!lowItems.length) return 0;

    const itemIds = lowItems.map((item) => item._id);
    const [existingDrafts, allDrafts, openOrders] = await Promise.all([
        ProcurementDocument.find({ restaurantId, type: 'purchase_order', status: 'review_required', autoReorderKey: { $in: itemIds.map(String) } }).select('autoReorderKey lines notes').lean(),
        ProcurementDocument.find({ restaurantId, type: 'purchase_order', status: 'review_required', autoReorderKey: { $exists: true } }).select('autoReorderKey lines notes').lean(),
        ProcurementDocument.find({ restaurantId, type: 'purchase_order', status: { $in: ['ordered', 'partially_received'] }, 'lines.inventoryItemId': { $in: itemIds } }).select('lines.inventoryItemId').lean(),
    ]);
    const lowById = new Map(lowItems.map((item) => [String(item._id), item]));
    const alreadyOrdered = new Set(openOrders.flatMap((doc) => doc.lines.map((line) => String(line.inventoryItemId))));
    for (const draft of allDrafts) {
        const item = lowById.get(String(draft.autoReorderKey));
        if (!item || alreadyOrdered.has(String(draft.autoReorderKey))) {
            await ProcurementDocument.updateOne({ _id: draft._id, restaurantId, status: 'review_required' }, {
                $set: { status: 'cancelled', notes: `${draft.notes || ''} ${item ? 'An open vendor order already covers this item; suggestion closed automatically.' : 'Stock is now above its minimum; suggestion closed automatically.'}`.trim() },
            });
            continue;
        }
        const gap = Math.max(0, item.reorderLevel - item.currentStock);
        const suggestedQuantity = Math.max(gap, Math.min(item.reorderLevel, 1));
        const line = draft.lines[0];
        if (line && (line.orderedQuantity !== suggestedQuantity || line.unitCost !== item.costPerUnit)) {
            await ProcurementDocument.updateOne({ _id: draft._id, restaurantId, status: 'review_required' }, {
                $set: { 'lines.0.requestedQuantity': suggestedQuantity, 'lines.0.orderedQuantity': suggestedQuantity, 'lines.0.unitCost': item.costPerUnit },
            });
        }
    }
    const existingKeys = new Set(existingDrafts.map((doc) => doc.autoReorderKey));
    let created = 0;

    for (const item of lowItems) {
        const id = String(item._id);
        if (existingKeys.has(id) || alreadyOrdered.has(id)) continue;
        const gap = Math.max(0, item.reorderLevel - item.currentStock);
        // At the exact threshold, suggest a small top-up so the draft still has a valid quantity.
        const quantity = Math.max(gap, Math.min(item.reorderLevel, 1));
        if (!Number.isFinite(quantity) || quantity <= 0) continue;
        const reference = `AUTO-${new Date().toISOString().replace(/[-:TZ.]/g, '').slice(2, 12)}-${id.slice(-5).toUpperCase()}`;
        try {
            await ProcurementDocument.create({
                restaurantId,
                type: 'purchase_order',
                status: 'review_required',
                reference,
                supplier: item.supplier || '',
                notes: `Automatically suggested because stock is ${item.currentStock} ${item.unit} (minimum ${item.reorderLevel} ${item.unit}). Review before placing this order.`,
                autoReorderKey: id,
                lines: [{
                    inventoryItemId: item._id,
                    itemName: item.name,
                    unit: item.unit,
                    requestedQuantity: quantity,
                    orderedQuantity: quantity,
                    receivedQuantity: 0,
                    unitCost: item.costPerUnit,
                }],
            });
            created++;
        } catch (error: any) {
            // A parallel stock poll may have created this item's draft first.
            if (error?.code !== 11000) throw error;
        }
    }
    return created;
}
