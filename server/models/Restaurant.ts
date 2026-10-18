import mongoose, { Document, Model, Schema } from 'mongoose';

export interface IRestaurant extends Document {
    name: string;
    slug: string;
    description: string;
    ownerId: mongoose.Types.ObjectId;
    logoUrl?: string;
    coverImageUrl?: string;
    themeColor?: string;
    logoAccentColor?: string;
    accentSource?: 'logo' | 'custom';
    fontFamily?: string;
    colorScheme?: string;
    upiId?: string;
    upiPayeeName?: string;
    merchantCode?: string;
    appId?: string;
    gstNumber?: string;
    fssaiNumber?: string;
    gstPercentage?: number;
    sgstPercentage?: number;
    packagingCharge?: number;
    phone?: string;
    address?: string;
    status: 'active' | 'suspended' | 'onboarding';
    customDomain?: string;
    enableAestheticDownloads?: boolean;
    instagramHandle?: string;
    instagramUrl?: string;
    googleReviewUrl?: string;
    createdAt: Date;
    updatedAt: Date;
}

const restaurantSchema = new Schema<IRestaurant>(
    {
        name: {
            type: String,
            required: [true, 'Restaurant name is required'],
            trim: true,
        },
        slug: {
            type: String,
            required: [true, 'Slug is required'],
            unique: true,
            lowercase: true,
            trim: true,
        },
        description: {
            type: String,
            trim: true,
            default: '',
        },
        ownerId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
        },
        logoUrl: {
            type: String,
            default: '',
        },
        coverImageUrl: {
            type: String,
            default: '',
        },
        themeColor: {
            type: String,
            default: '#38bdf8',
        },
        logoAccentColor: {
            type: String,
            default: '',
        },
        accentSource: {
            type: String,
            enum: ['logo', 'custom'],
            default: 'logo',
        },
        fontFamily: {
            type: String,
            enum: ['inter', 'outfit', 'poppins', 'roboto', 'playfair'],
            default: 'inter',
        },
        colorScheme: {
            type: String,
            enum: ['light', 'dark', 'warm', 'cool'],
            default: 'light',
        },
        upiId: {
            type: String,
            trim: true,
            default: '',
        },
        upiPayeeName: {
            type: String,
            trim: true,
            default: '',
        },
        merchantCode: {
            type: String,
            trim: true,
            default: '0000',
        },
        appId: {
            type: String,
            trim: true,
            default: '',
        },
        gstNumber: {
            type: String,
            trim: true,
            default: '',
        },
        fssaiNumber: {
            type: String,
            trim: true,
            default: '',
        },
        gstPercentage: {
            type: Number,
            default: 0,
            min: 0,
        },
        sgstPercentage: {
            type: Number,
            default: 0,
            min: 0,
        },
        packagingCharge: {
            type: Number,
            default: 0,
            min: 0,
            max: 10000,
        },
        phone: {
            type: String,
            trim: true,
            default: '',
        },
        address: {
            type: String,
            trim: true,
            default: '',
        },
        status: {
            type: String,
            enum: ['active', 'suspended', 'onboarding'],
            default: 'onboarding',
        },
        customDomain: {
            type: String,
            trim: true,
            unique: true,
            sparse: true,
        },
        enableAestheticDownloads: {
            type: Boolean,
            default: false,
        },
        instagramHandle: {
            type: String,
            trim: true,
            default: '',
            maxlength: 30,
        },
        instagramUrl: {
            type: String,
            default: '',
            maxlength: 2048,
        },
        googleReviewUrl: {
            type: String,
            default: '',
            maxlength: 2048,
        },
    },
    {
        timestamps: true,
    }
);


const Restaurant: Model<IRestaurant> =
    mongoose.models.Restaurant || mongoose.model<IRestaurant>('Restaurant', restaurantSchema);

export default Restaurant;
