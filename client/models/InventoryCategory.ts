import mongoose, { Document, Model, Schema } from 'mongoose';

export interface IInventoryCategory extends Document {
    restaurantId: mongoose.Types.ObjectId;
    name: string;
    normalizedName: string;
}

const inventoryCategorySchema = new Schema<IInventoryCategory>({
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    normalizedName: { type: String, required: true, trim: true, lowercase: true, maxlength: 80 },
}, { timestamps: true });

inventoryCategorySchema.index({ restaurantId: 1, normalizedName: 1 }, { unique: true });
inventoryCategorySchema.index({ restaurantId: 1, name: 1 });

const InventoryCategory: Model<IInventoryCategory> = mongoose.models.InventoryCategory || mongoose.model<IInventoryCategory>('InventoryCategory', inventoryCategorySchema);
export default InventoryCategory;
