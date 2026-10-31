import mongoose, { Document, Model, Schema } from 'mongoose';

export type FinancialEntryType = 'expense' | 'revenue' | 'capital_contribution' | 'owner_draw' | 'loan_received' | 'loan_repayment';

export interface IFinancialEntry extends Document {
    restaurantId: mongoose.Types.ObjectId;
    type: FinancialEntryType;
    category: string;
    amount: number;
    entryDate: Date;
    reference?: string;
    note?: string;
    createdAt: Date;
}

const financialEntrySchema = new Schema<IFinancialEntry>({
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true },
    type: { type: String, enum: ['expense', 'revenue', 'capital_contribution', 'owner_draw', 'loan_received', 'loan_repayment'], required: true },
    category: { type: String, trim: true, maxlength: 80, default: 'General' },
    amount: { type: Number, required: true, min: 0.01 },
    entryDate: { type: Date, required: true, default: Date.now },
    reference: { type: String, trim: true, maxlength: 100, default: '' },
    note: { type: String, trim: true, maxlength: 300, default: '' },
}, { timestamps: true });

financialEntrySchema.index({ restaurantId: 1, entryDate: -1 });

// Recompile the cached model during Next.js dev hot reload when the entry enum changes.
const existingFinancialEntryModel = mongoose.models.FinancialEntry as Model<IFinancialEntry> | undefined;
if (existingFinancialEntryModel && !existingFinancialEntryModel.schema.path('type')?.enumValues?.includes('revenue')) {
    mongoose.deleteModel('FinancialEntry');
}
const FinancialEntry: Model<IFinancialEntry> = mongoose.models.FinancialEntry || mongoose.model<IFinancialEntry>('FinancialEntry', financialEntrySchema);
export default FinancialEntry;
