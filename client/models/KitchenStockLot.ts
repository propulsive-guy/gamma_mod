import mongoose, { Document, Model, Schema } from 'mongoose';

export interface IKitchenStockLot extends Document {
    restaurantId: mongoose.Types.ObjectId;
    departmentId: mongoose.Types.ObjectId;
    inventoryItemId: mongoose.Types.ObjectId;
    issuedQuantity: number;
    remainingQuantity: number;
    issuedAt: Date;
    expiresAt: Date;
    wasteBehavior: 'carry_forward' | 'perishable';
    unitCost: number;
    baselineKey?: string;
    expiredAt?: Date;
}

const schema = new Schema<IKitchenStockLot>({
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true },
    departmentId: { type: Schema.Types.ObjectId, ref: 'KitchenDepartment', required: true },
    inventoryItemId: { type: Schema.Types.ObjectId, ref: 'InventoryItem', required: true },
    issuedQuantity: { type: Number, required: true, min: 0 },
    remainingQuantity: { type: Number, required: true, min: 0 },
    issuedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
    wasteBehavior: { type: String, enum: ['carry_forward', 'perishable'], required: true },
    unitCost: { type: Number, required: true, min: 0, default: 0 },
    baselineKey: { type: String },
    expiredAt: Date,
}, { timestamps: true });

schema.index({ restaurantId: 1, departmentId: 1, inventoryItemId: 1, issuedAt: 1 });
schema.index({ restaurantId: 1, expiresAt: 1, remainingQuantity: 1 });
schema.index({ baselineKey: 1 }, { unique: true, sparse: true });

const KitchenStockLot: Model<IKitchenStockLot> = mongoose.models.KitchenStockLot || mongoose.model<IKitchenStockLot>('KitchenStockLot', schema);
export default KitchenStockLot;
