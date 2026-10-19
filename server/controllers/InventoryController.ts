import { Request, Response } from 'express';
import mongoose from 'mongoose';
import InventoryItem, { INVENTORY_UNITS } from '../models/InventoryItem';
import MenuItem from '../models/MenuItem';
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
        const normalized = [] as { inventoryItemId?: string; newItemName?: string; quantity: number; unit: string; unitCost: number }[];
        for (const line of lines) {
            const id = String(line?.inventoryItemId || '');
            const newItemName = String(line?.newItemName || '').trim();
            const quantity = Number(line?.quantity);
            const unit = String(line?.unit || '');
            const unitCost = Number(line?.unitCost);
            const hasExistingItem = mongoose.Types.ObjectId.isValid(id);
            if ((!hasExistingItem && (!newItemName || newItemName.length > 120)) || !INVENTORY_UNITS.includes(unit as any) || !Number.isFinite(quantity) || quantity <= 0 || quantity > 1_000_000 ||
                !Number.isFinite(unitCost) || unitCost < 0 || unitCost > 10_000_000) {
                return res.status(400).json({ error: 'Each line needs an existing or new inventory item, valid unit, quantity, and unit cost' });
            }
            normalized.push({ ...(hasExistingItem ? { inventoryItemId: id } : { newItemName }), quantity: rounded(quantity), unit, unitCost: rounded(unitCost) });
        }
        const note = String(billReference || '').trim().slice(0, 80);
        const session = await mongoose.startSession();
        try {
            await session.withTransaction(async () => {
                for (const line of normalized) {
                    let inventoryItemId = line.inventoryItemId;
                    if (!inventoryItemId && line.newItemName) {
                        const existing = await InventoryItem.findOne({ restaurantId: req.user!.restaurantId, name: line.newItemName }).session(session);
                        if (existing) {
                            if (!existing.isActive) throw new Error(`“${line.newItemName}” already exists but is archived. Restore it before applying this bill.`);
                            if (existing.unit !== line.unit) throw new Error(`“${line.newItemName}” already exists with unit ${existing.unit}. Choose that item or change its unit.`);
                            inventoryItemId = existing.id;
                        } else {
                            const [created] = await InventoryItem.create([{
                                restaurantId: req.user!.restaurantId,
                                name: line.newItemName,
                                category: 'General',
                                unit: line.unit,
                                currentStock: 0,
                                reorderLevel: 0,
                                costPerUnit: line.unitCost,
                            }], { session });
                            inventoryItemId = created.id;
                        }
                    }
                    if (!inventoryItemId) throw new Error('Choose an existing item or provide a name for the new item.');
                    const before = await InventoryItem.findOne({ _id: inventoryItemId, restaurantId: req.user!.restaurantId, isActive: true, unit: line.unit }).session(session);
                    if (!before) throw new Error('An inventory item was not found or its unit does not match. No changes were saved.');
                    const stockAfter = rounded(before.currentStock + line.quantity);
                    const averageCost = stockAfter > 0
                        ? rounded(((before.currentStock * before.costPerUnit) + (line.quantity * line.unitCost)) / stockAfter)
                        : line.unitCost;
                    before.currentStock = stockAfter;
                    before.costPerUnit = averageCost;
                    await before.save({ session });
                    await StockMovement.create([{
                        restaurantId: req.user!.restaurantId, inventoryItemId: before._id, type: 'purchase',
                        quantity: line.quantity, stockBefore: rounded(stockAfter - line.quantity), stockAfter,
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
            const { name, sku, category, unit, currentStock, reorderLevel, costPerUnit, supplier, notes, wasteBehavior } = req.body || {};
            if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'Item name is required' });
            if (!INVENTORY_UNITS.includes(unit)) return res.status(400).json({ error: 'Choose a valid unit' });
            if (![currentStock, reorderLevel, costPerUnit].every(finiteNonNegative)) return res.status(400).json({ error: 'Stock, reorder level, and cost must be zero or greater' });

            const item = await InventoryItem.create({
                restaurantId: req.user.restaurantId,
                name: name.trim(), sku, category: String(category || 'General').trim() || 'General', unit,
                currentStock: rounded(currentStock), reorderLevel: rounded(reorderLevel), costPerUnit: rounded(costPerUnit),
                supplier, notes, wasteBehavior: wasteBehavior === 'perishable' ? 'perishable' : 'carry_forward',
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
            const { name, sku, category, unit, reorderLevel, costPerUnit, supplier, notes, wasteBehavior } = req.body || {};
            if (typeof name !== 'string' || !name.trim()) return res.status(400).json({ error: 'Item name is required' });
            if (!INVENTORY_UNITS.includes(unit)) return res.status(400).json({ error: 'Choose a valid unit' });
            if (![reorderLevel, costPerUnit].every(finiteNonNegative)) return res.status(400).json({ error: 'Reorder level and cost must be zero or greater' });
            const existing = await InventoryItem.findOne({ _id: id, restaurantId: req.user.restaurantId, isActive: true }).select('unit').lean();
            if (!existing) return res.status(404).json({ error: 'Inventory item not found' });
            if (existing.unit !== unit && await MenuItem.exists({ restaurantId: req.user.restaurantId, 'recipe.inventoryItemId': id })) {
                return res.status(409).json({ error: 'This unit is used in menu recipes. Keep it unchanged, or update those recipes before changing the stock unit.' });
            }
            const item = await InventoryItem.findOneAndUpdate(
                { _id: id, restaurantId: req.user.restaurantId, isActive: true },
                { name: name.trim(), sku, category: String(category || 'General').trim() || 'General', unit, reorderLevel: rounded(reorderLevel), costPerUnit: rounded(costPerUnit), supplier, notes, wasteBehavior: wasteBehavior === 'perishable' ? 'perishable' : 'carry_forward' },
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
            const before = await InventoryItem.findOneAndUpdate(filter, update, { runValidators: true });
            if (!before) return res.status(409).json({ error: 'Not enough stock, or the item no longer exists' });
            const afterStock = rounded(before.currentStock + delta);
            const purchaseCost = type === 'purchase' && finiteNonNegative(unitCost) ? rounded(unitCost) : before.costPerUnit;
            if (type === 'purchase' && finiteNonNegative(unitCost)) {
                const averageCost = afterStock > 0
                    ? rounded(((before.currentStock * before.costPerUnit) + (delta * purchaseCost)) / afterStock)
                    : purchaseCost;
                await InventoryItem.updateOne({ _id: before._id, restaurantId: req.user.restaurantId }, { $set: { costPerUnit: averageCost } });
            }
            await StockMovement.create({
                restaurantId: req.user.restaurantId, inventoryItemId: before._id, type, quantity: delta,
                stockBefore: before.currentStock, stockAfter: afterStock,
                unitCost: purchaseCost,
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
