import mongoose, { Document, Model, Schema } from 'mongoose';

export interface ITable extends Document {
    tableNumber: string;
    restaurantId: mongoose.Types.ObjectId;
    qrCodeDataUrl?: string;
    isActive: boolean;
    isTakeaway: boolean;
    captainToken?: string;
    createdAt: Date;
    updatedAt: Date;
}

const tableSchema = new Schema<ITable>(
    {
        tableNumber: {
            type: String,
            required: [true, 'Table number is required'],
            trim: true,
        },
        restaurantId: {
            type: Schema.Types.ObjectId,
            ref: 'Restaurant',
            required: true,
        },
        qrCodeDataUrl: {
            type: String,
            default: '',
        },
        isActive: {
            type: Boolean,
            default: true,
        },
        isTakeaway: {
            type: Boolean,
            default: false,
        },
        captainToken: {
            type: String,
            select: false,
        },
    },
    {
        timestamps: true,
    }
);

// Ensure unique table numbers within a restaurant
tableSchema.index({ restaurantId: 1, tableNumber: 1 }, { unique: true });
tableSchema.index({ captainToken: 1 }, { unique: true, sparse: true });

const Table: Model<ITable> =
    mongoose.models.Table || mongoose.model<ITable>('Table', tableSchema);

export default Table;
