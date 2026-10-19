import mongoose, { Document, Model, Schema } from 'mongoose';

export type OrderStatus = 'pending' | 'preparing' | 'served' | 'completed' | 'cancelled';

export interface IOrderItem {
    menuItemId: mongoose.Types.ObjectId;
    name: string;
    price: number;
    quantity: number;
    dietaryType?: 'veg' | 'non-veg' | 'vegan' | 'egg' | 'unknown';
    itemType?: 'food' | 'beverage' | 'water' | 'other';
}

export interface IOrderCheckout {
    couponCode?: string;
    discountAmount: number;
    tipAmount: number;
    packagingCharge?: number;
    gstRate: number;
    sgstRate: number;
    gstAmount: number;
    sgstAmount: number;
    payableAmount: number;
    preparedAt: Date;
}

export interface IOrderReview {
    foodRating?: number;
    experienceRating?: number;
    preparationRating?: number;
    packagingRating?: number;
    comment?: string;
    submittedAt: Date;
}

export interface IOrder extends Document {
    restaurantId: mongoose.Types.ObjectId;
    tableId: mongoose.Types.ObjectId;
    orderType: 'dine-in' | 'takeaway';
    items: IOrderItem[];
    inventoryUsage: { inventoryItemId: mongoose.Types.ObjectId; quantity: number; unitCost: number }[];
    inventoryRestored: boolean;
    inventoryDeducted?: boolean;
    total: number;
    status: OrderStatus;
    sessionId: string;
    customerName?: string;
    customerPhone?: string;
    notes?: string;
    createdAt: Date;
    updatedAt: Date;
    paymentStatus?: 'pending' | 'paid';
    paymentMethod?: 'upi' | 'cash';
    paidAt?: Date;
    checkout?: IOrderCheckout;
    review?: IOrderReview;
}

const orderItemSchema = new Schema<IOrderItem>(
    {
        menuItemId: {
            type: Schema.Types.ObjectId,
            ref: 'MenuItem',
            required: true,
        },
        name: {
            type: String,
            required: true,
        },
        price: {
            type: Number,
            required: true,
        },
        quantity: {
            type: Number,
            required: true,
            min: 1,
        },
        dietaryType: {
            type: String,
            enum: ['veg', 'non-veg', 'vegan', 'egg', 'unknown'],
            default: 'unknown',
        },
        itemType: {
            type: String,
            enum: ['food', 'beverage', 'water', 'other'],
            default: 'food',
        },
    },
    { _id: false }
);

const orderSchema = new Schema<IOrder>(
    {
        restaurantId: {
            type: Schema.Types.ObjectId,
            ref: 'Restaurant',
            required: true,
        },
        tableId: {
            type: Schema.Types.ObjectId,
            ref: 'Table',
            required: true,
        },
        orderType: {
            type: String,
            enum: ['dine-in', 'takeaway'],
            default: 'dine-in',
        },
        items: {
            type: [orderItemSchema],
            required: true,
            validate: {
                validator: (items: IOrderItem[]) => items.length > 0,
                message: 'Order must have at least one item',
            },
        },
        inventoryUsage: {
            type: [{
                inventoryItemId: { type: Schema.Types.ObjectId, ref: 'InventoryItem', required: true },
                quantity: { type: Number, required: true, min: 0 },
                unitCost: { type: Number, required: true, min: 0 },
            }],
            default: [],
            select: false,
        },
        inventoryRestored: { type: Boolean, default: false, select: false },
        // No default on purpose: missing values identify orders created before
        // inventory was deferred until the order is served.
        inventoryDeducted: { type: Boolean, select: false },
        total: {
            type: Number,
            required: true,
            min: 0,
        },
        status: {
            type: String,
            enum: ['pending', 'preparing', 'served', 'completed', 'cancelled'],
            default: 'pending',
        },
        paymentStatus: {
            type: String,
            enum: ['pending', 'paid'],
            default: 'pending',
        },
        paymentMethod: {
            type: String,
            enum: ['upi', 'cash'],
        },
        paidAt: Date,
        checkout: {
            couponCode: { type: String, default: '' },
            discountAmount: { type: Number, min: 0 },
            tipAmount: { type: Number, min: 0 },
            packagingCharge: { type: Number, min: 0 },
            gstRate: { type: Number, min: 0 },
            sgstRate: { type: Number, min: 0 },
            gstAmount: { type: Number, min: 0 },
            sgstAmount: { type: Number, min: 0 },
            payableAmount: { type: Number, min: 0 },
            preparedAt: Date,
        },
        review: {
            foodRating: { type: Number, min: 1, max: 5 },
            experienceRating: { type: Number, min: 1, max: 5 },
            preparationRating: { type: Number, min: 1, max: 5 },
            packagingRating: { type: Number, min: 1, max: 5 },
            comment: { type: String, maxlength: 500 },
            submittedAt: Date,
        },
        sessionId: {
            type: String,
            required: true,
        },
        customerName: {
            type: String,
            trim: true,
            default: '',
        },
        customerPhone: {
            type: String,
        },
        notes: {
            type: String,
            trim: true,
            default: '',
        },
    },
    {
        timestamps: true,
    }
);

// Indexes for efficient queries
orderSchema.index({ restaurantId: 1, createdAt: -1 });
orderSchema.index({ tableId: 1, createdAt: -1 });
orderSchema.index({ sessionId: 1, tableId: 1 }); // Compound index for getOrdersBySession query
orderSchema.index({ status: 1, restaurantId: 1 });
orderSchema.index({ restaurantId: 1, status: 1, createdAt: -1 }); // Optimized for analytics
orderSchema.index({ restaurantId: 1, status: 1, paymentStatus: 1, createdAt: -1 });

// Singleton pattern to prevent recompilation errors in development and maintain cache in production
const Order: Model<IOrder> = mongoose.models.Order || mongoose.model<IOrder>('Order', orderSchema);

export default Order;
