import mongoose, { Document, Model, Schema } from 'mongoose';

export interface IKitchenDepartment extends Document {
    restaurantId: mongoose.Types.ObjectId;
    name: string;
    isActive: boolean;
}

const schema = new Schema<IKitchenDepartment>({
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    isActive: { type: Boolean, default: true },
}, { timestamps: true });
schema.index({ restaurantId: 1, name: 1 }, { unique: true });
schema.index({ restaurantId: 1, isActive: 1 });

const KitchenDepartment: Model<IKitchenDepartment> = mongoose.models.KitchenDepartment || mongoose.model<IKitchenDepartment>('KitchenDepartment', schema);
export default KitchenDepartment;
