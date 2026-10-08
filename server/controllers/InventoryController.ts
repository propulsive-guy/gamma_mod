import { Request, Response } from 'express';
import mongoose from 'mongoose';
import InventoryItem, { INVENTORY_UNITS } from '../models/InventoryItem';
import StockMovement, { StockMovementType } from '../models/StockMovement';

const movementTypes: StockMovementType[] = ['purchase', 'usage', 'wastage', 'correction', 'return'];
const finiteNonNegative = (value: unknown) => Number.isFinite(Number(value)) && Number(value) >= 0;
const rounded = (value: unknown) => Math.round(Number(value) * 10000) / 10000;

export class InventoryController {
    static async purchaseFromBill(req: Request, res: Response) {
        if (!req.user?.restaurantId) return res.status(401).json({ error: 'Unauthorized' });
        const { lines, billReference } = req.body || {};
        if (!Array.isArray(lines) || lines.length < 1 || lines.length > 40) {
            return res.status(400).json({ error: 'Submit between 1 and 40 reviewed bill lines' });
        }
        const normalized = [] as { inventoryItemId: string; quantity: number; unitCost: number }[];
        for (const line of lines) {
            const id = String(line?.inventoryItemId || '');
            const quantity = Number(line?.quantity);
            const unitCost = Number(line?.unitCost);
            if (!mongoose.Types.ObjectId.isValid(id) || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000 ||
                !Number.isFinite(unitCost) || unitCost < 0 || unitCost > 10_000_000) {
                return res.status(400).json({ error: 'Each line needs a valid inventory item, quantity, and unit cost' });
            }
            normalized.push({ inventoryItemId: id, quantity: rounded(quantity), unitCost: rounded(unitCost) });
        }
        const note = String(billReference || '').trim().slice(0, 80);
        const session = await mongoose.startSession();
        try {
            await session.withTransaction(async () => {
                for (const line of normalized) {
                    const before = await InventoryItem.findOneAndUpdate(
                        { _id: line.inventoryItemId, restaurantId: req.user!.restaurantId, isActive: true },
                        { $inc: { currentStock: line.quantity }, $set: { costPerUnit: line.unitCost } },
                        { session, runValidators: true },
                    );
                    if (!before) throw new Error('An inventory item was not found. No changes were saved.');
                    const stockAfter = rounded(before.currentStock + line.quantity);
                    await StockMovement.create([{
                        restaurantId: req.user!.restaurantId, inventoryItemId: before._id, type: 'purchase',
                        quantity: line.quantity, stockBefore: before.currentStock, stockAfter,
                        unitCost: line.unitCost, note: note ? `Bill ${note}` : 'Scanned supplier bill', createdBy: req.user!.id,
                    }], { session });
                }
            });
            return res.json({ success: true, updated: normalized.length });
        } catch (error) {
            console.error('Apply inventory bill error:', error);
            return res.status(400).json({ error: error instanceof Error ? error.message : 'Could not apply bill. No stock changes were saved.' });
        } finally {
            await session.endSession();
        }
    }

    static async list(req: Request, res: Response) {
        try {
            if (!req.user?.restaurantId) return res.status(401).json({ error: 'Unauthorized' });
            const restaurantId = req.user.restaurantId;
            const [items, movements] = await Promise.all([
                InventoryItem.find({ restaurantId, isActive: true }).sort({ category: 1, name: 1 }).lean(),
                StockMovement.find({ restaurantId }).sort({ createdAt: -1 }).limit(60)
                    .populate('inventoryItemId', 'name unit').lean(),
            ]);
            const inventoryValue = items.reduce((sum, item) => sum + item.currentStock * item.costPerUnit, 0);
            res.json({
                items,
                movements,
                summary: {
                    totalItems: items.length,
                    lowStock: items.filter((item) => item.currentStock > 0 && item.currentStock <= item.reorderLevel).length,
                    outOfStock: items.filter((item) => item.currentStock === 0).length,
                    inventoryValue: Math.round(inventoryValue * 100) / 100,
                },
            });
        } catch (error) {
            console.error('List inventory error:', error);
            res.status(500).json({ error: 'Failed to load inventory' });
        }
    }

    static async create(req: Request, res: Response) {
        try {
            if (!req.user?.restaurantId) return res.status(401).json({ error: 'Unauthorized' });
            const { name, sku, category, unit, currentStock, reorderLevel, costPerUnit, supplier, notes } = req.body || {};
            if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'Item name is required' });
            if (!INVENTORY_UNITS.includes(unit)) return res.status(400).json({ error: 'Choose a valid unit' });
            if (![currentStock, reorderLevel, costPerUnit].every(finiteNonNegative)) return res.status(400).json({ error: 'Stock, reorder level, and cost must be zero or greater' });

            const item = await InventoryItem.create({
                restaurantId: req.user.restaurantId,
                name: name.trim(), sku, category: String(category || 'General').trim() || 'General', unit,
                currentStock: rounded(currentStock), reorderLevel: rounded(reorderLevel), costPerUnit: rounded(costPerUnit),
                supplier, notes,
            });
            if (item.currentStock > 0) {
                await StockMovement.create({
                    restaurantId: req.user.restaurantId, inventoryItemId: item._id, type: 'opening',
                    quantity: item.currentStock, stockBefore: 0, stockAfter: item.currentStock,
                    unitCost: item.costPerUnit, note: 'Opening stock', createdBy: req.user.id,
                });
            }
            res.status(201).json(item);
        } catch (error: any) {
            if (error?.code === 11000) return res.status(409).json({ error: 'An inventory item with this name already exists' });
            console.error('Create inventory error:', error);
            res.status(500).json({ error: 'Failed to create inventory item' });
        }
    }

    static async update(req: Request, res: Response) {
        try {
            if (!req.user?.restaurantId) return res.status(401).json({ error: 'Unauthorized' });
            const id = req.params.id as string;
            if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid inventory item' });
            const { name, sku, category, unit, reorderLevel, costPerUnit, supplier, notes } = req.body || {};
            if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'Item name is required' });
            if (!INVENTORY_UNITS.includes(unit)) return res.status(400).json({ error: 'Choose a valid unit' });
            if (![reorderLevel, costPerUnit].every(finiteNonNegative)) return res.status(400).json({ error: 'Reorder level and cost must be zero or greater' });
            const item = await InventoryItem.findOneAndUpdate(
                { _id: id, restaurantId: req.user.restaurantId, isActive: true },
                { name: name.trim(), sku, category: String(category || 'General').trim() || 'General', unit, reorderLevel: rounded(reorderLevel), costPerUnit: rounded(costPerUnit), supplier, notes },
                { new: true, runValidators: true },
            );
            if (!item) return res.status(404).json({ error: 'Inventory item not found' });
            res.json(item);
        } catch (error: any) {
            if (error?.code === 11000) return res.status(409).json({ error: 'An inventory item with this name already exists' });
            console.error('Update inventory error:', error);
            res.status(500).json({ error: 'Failed to update inventory item' });
        }
    }

    static async adjust(req: Request, res: Response) {
        try {
            if (!req.user?.restaurantId) return res.status(401).json({ error: 'Unauthorized' });
            const id = req.params.id as string;
            const { type, quantity, note, unitCost } = req.body || {};
            if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid inventory item' });
            if (!movementTypes.includes(type)) return res.status(400).json({ error: 'Choose a valid stock movement' });
            if (!Number.isFinite(Number(quantity)) || Number(quantity) === 0) return res.status(400).json({ error: 'Quantity cannot be zero' });

            let delta = rounded(quantity);
            if (['usage', 'wastage'].includes(type)) delta = -Math.abs(delta);
            if (['purchase', 'return'].includes(type)) delta = Math.abs(delta);
            const filter: any = { _id: id, restaurantId: req.user.restaurantId, isActive: true };
            if (delta < 0) filter.currentStock = { $gte: Math.abs(delta) };
            const update: any = { $inc: { currentStock: delta } };
            if (type === 'purchase' && finiteNonNegative(unitCost)) update.$set = { costPerUnit: rounded(unitCost) };
            const before = await InventoryItem.findOneAndUpdate(filter, update, { runValidators: true });
            if (!before) return res.status(409).json({ error: 'Not enough stock, or the item no longer exists' });
            const afterStock = rounded(before.currentStock + delta);
            await StockMovement.create({
                restaurantId: req.user.restaurantId, inventoryItemId: before._id, type, quantity: delta,
                stockBefore: before.currentStock, stockAfter: afterStock,
                unitCost: type === 'purchase' && finiteNonNegative(unitCost) ? rounded(unitCost) : before.costPerUnit,
                note, createdBy: req.user.id,
            });
            const item = await InventoryItem.findById(before._id);
            res.json(item);
        } catch (error) {
            console.error('Adjust inventory error:', error);
            res.status(500).json({ error: 'Failed to adjust stock' });
        }
    }

    static async archive(req: Request, res: Response) {
        try {
            if (!req.user?.restaurantId) return res.status(401).json({ error: 'Unauthorized' });
            const id = req.params.id as string;
            if (!mongoose.Types.ObjectId.isValid(id)) return res.status(400).json({ error: 'Invalid inventory item' });
            const item = await InventoryItem.findOneAndUpdate({ _id: id, restaurantId: req.user.restaurantId }, { isActive: false }, { new: true });
            if (!item) return res.status(404).json({ error: 'Inventory item not found' });
            res.json({ success: true });
        } catch (error) {
            console.error('Archive inventory error:', error);
            res.status(500).json({ error: 'Failed to archive inventory item' });
        }
    }
}
