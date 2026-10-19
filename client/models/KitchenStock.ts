import mongoose, { Document, Model, Schema } from 'mongoose';

export interface IKitchenStock extends Document {
    restaurantId: mongoose.Types.ObjectId;
    departmentId: mongoose.Types.ObjectId;
    inventoryItemId: mongoose.Types.ObjectId;
    currentStock: number;
    updatedAt: Date;
}

const schema = new Schema<IKitchenStock>({
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true },
    departmentId: { type: Schema.Types.ObjectId, ref: 'KitchenDepartment', required: true },
    inventoryItemId: { type: Schema.Types.ObjectId, ref: 'InventoryItem', required: true },
    currentStock: { type: Number, required: true, min: 0, default: 0 },
}, { timestamps: true });
schema.index({ restaurantId: 1, departmentId: 1, inventoryItemId: 1 }, { unique: true });
schema.index({ restaurantId: 1, inventoryItemId: 1 });

const KitchenStock: Model<IKitchenStock> = mongoose.models.KitchenStock || mongoose.model<IKitchenStock>('KitchenStock', schema);
export default KitchenStock;
