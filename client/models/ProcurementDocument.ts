import mongoose, { Document, Model, Schema } from 'mongoose';

export type ProcurementType = 'requisition' | 'purchase_order';
export type ProcurementStatus = 'submitted' | 'review_required' | 'approved' | 'ordered' | 'partially_received' | 'received' | 'cancelled';

export interface IProcurementLine {
    inventoryItemId: mongoose.Types.ObjectId;
    itemName: string;
    unit: string;
    requestedQuantity: number;
    orderedQuantity: number;
    receivedQuantity: number;
    unitCost: number;
    approvedQuantity?: number;
}

export interface IProcurementPayment {
    amount: number;
    paidAt: Date;
    reference?: string;
}

export interface IProcurementDocument extends Document {
    restaurantId: mongoose.Types.ObjectId;
    type: ProcurementType;
    status: ProcurementStatus;
    reference: string;
    supplier: string;
    notes?: string;
    lines: IProcurementLine[];
    payments: IProcurementPayment[];
    sourceRequisitionId?: mongoose.Types.ObjectId;
    autoReorderKey?: string;
    departmentId?: mongoose.Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

const procurementLineSchema = new Schema<IProcurementLine>({
    inventoryItemId: { type: Schema.Types.ObjectId, ref: 'InventoryItem', required: true },
    itemName: { type: String, required: true, trim: true, maxlength: 120 },
    unit: { type: String, required: true, maxlength: 20 },
    requestedQuantity: { type: Number, required: true, min: 0.0001 },
    orderedQuantity: { type: Number, required: true, min: 0.0001 },
    receivedQuantity: { type: Number, required: true, min: 0, default: 0 },
    unitCost: { type: Number, required: true, min: 0, default: 0 },
    approvedQuantity: { type: Number, min: 0 },
}, { _id: false });

const procurementDocumentSchema = new Schema<IProcurementDocument>({
    restaurantId: { type: Schema.Types.ObjectId, ref: 'Restaurant', required: true },
    type: { type: String, enum: ['requisition', 'purchase_order'], required: true },
    status: { type: String, enum: ['submitted', 'review_required', 'approved', 'ordered', 'partially_received', 'received', 'cancelled'], required: true, default: 'submitted' },
    reference: { type: String, required: true, trim: true, maxlength: 40 },
    supplier: { type: String, trim: true, maxlength: 120, default: '' },
    notes: { type: String, trim: true, maxlength: 500, default: '' },
    lines: { type: [procurementLineSchema], required: true, validate: (lines: IProcurementLine[]) => lines.length > 0 },
    payments: [{ amount: { type: Number, required: true, min: 0.01 }, paidAt: { type: Date, required: true }, reference: { type: String, trim: true, maxlength: 100, default: '' } }],
    sourceRequisitionId: { type: Schema.Types.ObjectId, ref: 'ProcurementDocument' },
    autoReorderKey: { type: String, trim: true, maxlength: 100 },
    departmentId: { type: Schema.Types.ObjectId, ref: 'KitchenDepartment' },
}, { timestamps: true });

procurementDocumentSchema.index({ restaurantId: 1, type: 1, createdAt: -1 });
procurementDocumentSchema.index({ restaurantId: 1, reference: 1 }, { unique: true });
procurementDocumentSchema.index({ restaurantId: 1, autoReorderKey: 1 }, { unique: true, partialFilterExpression: { autoReorderKey: { $type: 'string' } } });

const ProcurementDocument: Model<IProcurementDocument> = mongoose.models.ProcurementDocument || mongoose.model<IProcurementDocument>('ProcurementDocument', procurementDocumentSchema);
export default ProcurementDocument;
