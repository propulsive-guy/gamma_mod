import mongoose, { Document, Model, Schema } from 'mongoose';

export const INVENTORY_UNITS = ['kg', 'g', 'l', 'ml', 'piece', 'pack', 'box', 'bottle', 'can'] as const;
export type InventoryUnit = typeof INVENTORY_UNITS[number];

export interface IInventoryItem extends Document {
    restaurantId: mongoose.Types.ObjectId;
    name: string;
    sku?: string;
    category: string;
    unit: InventoryUnit;
    currentStock: number;
    reorderLevel: number;
    costPerUnit: number;
    supplier?: string;
    notes?: string;
    wasteBehavior: 'carry_forward' | 'perishable';
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const inventoryItemSchema = new Schema<IInventoryItem>({
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true },
    name: { type: String, required: true, trim: true, maxlength: 120 },
    sku: { type: String, trim: true, maxlength: 60, default: '' },
    category: { type: String, trim: true, maxlength: 80, default: 'General' },
    unit: { type: String, enum: INVENTORY_UNITS, required: true, default: 'piece' },
    currentStock: { type: Number, required: true, min: 0, default: 0 },
    reorderLevel: { type: Number, required: true, min: 0, default: 0 },
    costPerUnit: { type: Number, required: true, min: 0, default: 0 },
    supplier: { type: String, trim: true, maxlength: 120, default: '' },
    notes: { type: String, trim: true, maxlength: 500, default: '' },
    wasteBehavior: { type: String, enum: ['carry_forward', 'perishable'], default: 'carry_forward' },
    isActive: { type: Boolean, default: true },
}, { timestamps: true });

inventoryItemSchema.index({ restaurantId: 1, name: 1 }, { unique: true });
inventoryItemSchema.index({ restaurantId: 1, isActive: 1 });

const InventoryItem: Model<IInventoryItem> = mongoose.models.InventoryItem || mongoose.model<IInventoryItem>('InventoryItem', inventoryItemSchema);
export default InventoryItem;
