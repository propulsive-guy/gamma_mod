import mongoose, { Document, Model, Schema } from 'mongoose';

export interface IStockMovement extends Document {
    restaurantId: mongoose.Types.ObjectId;
    inventoryItemId: mongoose.Types.ObjectId;
    orderId?: mongoose.Types.ObjectId;
    procurementDocumentId?: mongoose.Types.ObjectId;
    type: 'opening' | 'purchase' | 'usage' | 'wastage' | 'correction' | 'return' | 'transfer_out' | 'transfer_in';
    departmentId?: mongoose.Types.ObjectId;
    quantity: number;
    stockBefore: number;
    stockAfter: number;
    unitCost?: number;
    note?: string;
    createdAt: Date;
}

const stockMovementSchema = new Schema<IStockMovement>({
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true },
    inventoryItemId: { type: Schema.Types.ObjectId, ref: 'InventoryItem', required: true },
    orderId: { type: Schema.Types.ObjectId, ref: 'Order' },
    procurementDocumentId: { type: Schema.Types.ObjectId, ref: 'ProcurementDocument' },
    type: { type: String, enum: ['opening', 'purchase', 'usage', 'wastage', 'correction', 'return', 'transfer_out', 'transfer_in'], required: true },
    departmentId: { type: Schema.Types.ObjectId, ref: 'KitchenDepartment' },
    quantity: { type: Number, required: true },
    stockBefore: { type: Number, required: true, min: 0 },
    stockAfter: { type: Number, required: true, min: 0 },
    unitCost: { type: Number, min: 0 },
    note: { type: String, trim: true, maxlength: 300, default: '' },
}, { timestamps: true });

stockMovementSchema.index({ restaurantId: 1, createdAt: -1 });
stockMovementSchema.index({ inventoryItemId: 1, createdAt: -1 });

const StockMovement: Model<IStockMovement> = mongoose.models.StockMovement || mongoose.model<IStockMovement>('StockMovement', stockMovementSchema);
export default StockMovement;
