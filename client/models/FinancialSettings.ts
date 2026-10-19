import mongoose, { Document, Model, Schema } from 'mongoose';

export interface IFinancialSettings extends Document {
    restaurantId: mongoose.Types.ObjectId;
    openingDate: Date;
    openingCash: number;
    openingInventoryValue: number;
    otherAssets: number;
    openingPayables: number;
    openingLoans: number;
    otherLiabilities: number;
    createdAt: Date;
    updatedAt: Date;
}

const financialSettingsSchema = new Schema<IFinancialSettings>({
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true, unique: true },
    openingDate: { type: Date, required: true, default: Date.now },
    openingCash: { type: Number, min: 0, required: true, default: 0 },
    openingInventoryValue: { type: Number, min: 0, required: true, default: 0 },
    otherAssets: { type: Number, min: 0, required: true, default: 0 },
    openingPayables: { type: Number, min: 0, required: true, default: 0 },
    openingLoans: { type: Number, min: 0, required: true, default: 0 },
    otherLiabilities: { type: Number, min: 0, required: true, default: 0 },
}, { timestamps: true });

const FinancialSettings: Model<IFinancialSettings> = mongoose.models.FinancialSettings || mongoose.model<IFinancialSettings>('FinancialSettings', financialSettingsSchema);
export default FinancialSettings;
