import mongoose, { Document, Model, Schema } from 'mongoose';

export interface IMenuItem extends Document {
    name: string;
    description: string;
    price: number;
    imageUrl?: string;
    aestheticImageUrl?: string;
    category: string;
    dietaryType: 'veg' | 'non-veg' | 'vegan' | 'egg' | 'unknown';
    itemType: 'food' | 'beverage' | 'water' | 'other';
    isAvailable: boolean;
    recipe: { inventoryItemId: mongoose.Types.ObjectId; quantity: number }[];
    departmentId?: mongoose.Types.ObjectId;
    restaurantId: mongoose.Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

const menuItemSchema = new Schema<IMenuItem>(
    {
        name: {
            type: String,
            required: [true, 'Item name is required'],
            trim: true,
        },
        description: {
            type: String,
            trim: true,
            default: '',
        },
        price: {
            type: Number,
            required: [true, 'Price is required'],
            min: [0, 'Price must be positive'],
        },
        imageUrl: {
            type: String,
            default: '',
        },
        aestheticImageUrl: {
            type: String,
            default: '',
        },
        category: {
            type: String,
            required: [true, 'Category is required'],
            trim: true,
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
        isAvailable: {
            type: Boolean,
            default: true,
        },
        recipe: {
            type: [{
                inventoryItemId: { type: Schema.Types.ObjectId, ref: 'InventoryItem', required: true },
                quantity: { type: Number, required: true, min: 0.0001 },
            }],
            default: [],
        },
        departmentId: { type: Schema.Types.ObjectId, ref: 'KitchenDepartment' },
        restaurantId: {
            type: Schema.Types.ObjectId,
            ref: 'Restaurant',
            required: true,
        },
    },
    {
        timestamps: true,
    }
);

// Index for faster queries
menuItemSchema.index({ restaurantId: 1, category: 1 });
menuItemSchema.index({ restaurantId: 1, isAvailable: 1 });

if (process.env.NODE_ENV === 'development') {
    delete mongoose.models.MenuItem;
}

const MenuItem: Model<IMenuItem> =
    mongoose.models.MenuItem || mongoose.model<IMenuItem>('MenuItem', menuItemSchema);

export default MenuItem;
