'use server';

import { apiFetch } from '@/client-lib/api';
import { revalidatePath, revalidateTag } from 'next/cache';
import mongoose from 'mongoose';
import dbConnect from '@/lib/db';
import Restaurant from '@/models/Restaurant';
import { auth } from '@/lib/auth';

export async function getRestaurant() {
    try {
        const res = await apiFetch('/api/v1/restaurant/profile');
        if (!res.ok) {
            return null;
        }
        return await res.json();
    } catch (error) {
        console.error('Error fetching restaurant:', error);
        return null;
    }
}

/** Save customer-facing social links directly from the Vercel server action to MongoDB. */
export async function saveRestaurantSocialLinks(instagramUrl: string, googleReviewUrl: string) {
    try {
        if (typeof instagramUrl !== 'string' || typeof googleReviewUrl !== 'string') {
            return { success: false, error: 'Enter both social links as text.' };
        }
        if (instagramUrl.length > 2048 || googleReviewUrl.length > 2048) {
            return { success: false, error: 'Each link must be 2,048 characters or fewer.' };
        }

        const session = await auth();
        const restaurantId = session?.user?.restaurantId;
        if (!restaurantId) return { success: false, error: 'Your restaurant session has expired. Please sign in again.' };

        await dbConnect();
        const restaurantObjectId = new mongoose.Types.ObjectId(restaurantId);
        const writeResult = await Restaurant.collection.updateOne(
            { _id: restaurantObjectId },
            { $set: { instagramHandle: '', instagramUrl, googleReviewUrl } }
        );
        if (!writeResult.acknowledged) {
            return { success: false, error: 'MongoDB did not acknowledge the social-link update.' };
        }
        if (writeResult.matchedCount !== 1) {
            return { success: false, error: 'Restaurant record was not found in the MongoDB database configured for Vercel.' };
        }

        // Read from the primary to avoid a stale replica making a successful write look missing.
        const savedRestaurant = await Restaurant.collection.findOne(
            { _id: restaurantObjectId },
            { projection: { instagramUrl: 1, googleReviewUrl: 1 }, readPreference: 'primary' }
        );

        const fieldsNotSaved = [
            savedRestaurant?.instagramUrl !== instagramUrl ? 'Instagram URL' : '',
            savedRestaurant?.googleReviewUrl !== googleReviewUrl ? 'Google review URL' : '',
        ].filter(Boolean);
        if (fieldsNotSaved.length > 0) {
            console.error('Social link MongoDB verification mismatch', {
                restaurantId,
                matchedCount: writeResult.matchedCount,
                instagramMatches: savedRestaurant?.instagramUrl === instagramUrl,
                googleReviewMatches: savedRestaurant?.googleReviewUrl === googleReviewUrl,
            });
            return { success: false, error: `MongoDB matched the restaurant, but did not return the saved ${fieldsNotSaved.join(' and ')} from the primary. Check the Vercel database/collection and MongoDB write permissions.` };
        }

        revalidatePath('/dashboard/profile');
        revalidatePath('/table/[restaurantId]/[tableId]/order-status', 'page');
        revalidateTag(`restaurant-${restaurantObjectId}`, 'max');
        return { success: true, instagramUrl: savedRestaurant?.instagramUrl, googleReviewUrl: savedRestaurant?.googleReviewUrl };
    } catch (error) {
        console.error('Error saving restaurant social links to MongoDB:', error);
        return { success: false, error: error instanceof Error ? error.message : 'Failed to save social links to MongoDB' };
    }
}

export async function updateRestaurant(formData: FormData) {
    try {
        const readText = (key: string) => {
            const value = formData.get(key);
            return typeof value === 'string' ? value.trim() : '';
        };
        const name = readText('name');
        const restaurantId = (await auth())?.user?.restaurantId;
        if (!restaurantId) return { success: false, error: 'Your restaurant session has expired. Please sign in again.' };
        if (!mongoose.Types.ObjectId.isValid(restaurantId)) {
            return { success: false, error: 'Your restaurant session is invalid. Please sign in again.' };
        }
        if (!name) return { success: false, error: 'Restaurant name is required.' };
        if (name.length > 120) return { success: false, error: 'Restaurant name must be 120 characters or fewer.' };

        const parsePercentage = (key: string) => {
            const raw = readText(key);
            const value = raw === '' ? 0 : Number(raw);
            return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
        };
        const gstPercentage = parsePercentage('gstPercentage');
        const sgstPercentage = parsePercentage('sgstPercentage');
        if (gstPercentage === null || sgstPercentage === null) {
            return { success: false, error: 'Tax percentages must be between 0 and 100.' };
        }

        const packagingCharge = Number(readText('packagingCharge') || 0);
        if (!Number.isFinite(packagingCharge) || packagingCharge < 0 || packagingCharge > 10000 ||
            Math.abs(Math.round(packagingCharge * 100) - packagingCharge * 100) > 1e-8) {
            return { success: false, error: 'Enter a valid packaging charge between ₹0 and ₹10,000.' };
        }

        const logoFile = formData.get('logo');
        const coverFile = formData.get('cover');
        const imageData = async (value: FormDataEntryValue | null, label: string) => {
            if (!(value instanceof File) || value.size === 0) return undefined;
            if (!value.type.startsWith('image/')) throw new Error(`${label} must be an image file.`);
            if (value.size > 2 * 1024 * 1024) throw new Error(`${label} must be 2MB or smaller.`);
            const base64 = Buffer.from(await value.arrayBuffer()).toString('base64');
            return `data:${value.type};base64,${base64}`;
        };

        const [logoUrl, coverImageUrl] = await Promise.all([
            imageData(logoFile, 'Logo'),
            imageData(coverFile, 'Aesthetic photo'),
        ]);

        const restaurantObjectId = new mongoose.Types.ObjectId(restaurantId);
        const existing = await Restaurant.findById(restaurantObjectId).select('_id logoUrl').lean();
        if (!existing) return { success: false, error: 'Restaurant record was not found in the configured MongoDB database.' };

        const update: Record<string, unknown> = {
            name,
            phone: readText('phone').slice(0, 40),
            address: readText('address').slice(0, 300),
            upiId: readText('upiId').slice(0, 120),
            upiPayeeName: readText('upiPayeeName').slice(0, 120),
            merchantCode: readText('merchantCode').slice(0, 50) || '0000',
            appId: readText('appId').slice(0, 100),
            themeColor: /^#[0-9a-f]{6}$/i.test(readText('themeColor')) ? readText('themeColor') : '#38bdf8',
            accentSource: readText('accentSource') === 'custom' ? 'custom' : 'logo',
            fontFamily: ['inter', 'outfit', 'poppins', 'roboto', 'playfair'].includes(readText('fontFamily')) ? readText('fontFamily') : 'inter',
            colorScheme: ['light', 'dark', 'warm', 'cool'].includes(readText('colorScheme')) ? readText('colorScheme') : 'light',
            gstNumber: readText('gstNumber').slice(0, 30),
            fssaiNumber: readText('fssaiNumber').slice(0, 30),
            gstPercentage,
            sgstPercentage,
            packagingCharge,
            enableAestheticDownloads: readText('enableAestheticDownloads') === 'true',
        };
        if (logoUrl !== undefined) update.logoUrl = logoUrl;
        if (coverImageUrl !== undefined) update.coverImageUrl = coverImageUrl;

        const restaurant = await Restaurant.findOneAndUpdate(
            { _id: restaurantObjectId },
            { $set: update },
            { new: true, runValidators: true }
        ).lean();
        if (!restaurant) return { success: false, error: 'Restaurant profile could not be saved.' };

        const fieldsNotSaved = [
            restaurant.upiId !== update.upiId ? 'UPI ID' : '',
            restaurant.upiPayeeName !== update.upiPayeeName ? 'UPI payee name' : '',
            restaurant.merchantCode !== update.merchantCode ? 'merchant code' : '',
            restaurant.appId !== update.appId ? 'app ID' : '',
            restaurant.name !== update.name ? 'restaurant name' : '',
        ].filter(Boolean);
        if (fieldsNotSaved.length) {
            console.error('Profile MongoDB verification mismatch', { restaurantId, fieldsNotSaved });
            return { success: false, error: `MongoDB did not return the saved ${fieldsNotSaved.join(', ')}. Check the Vercel MongoDB connection and write permissions.` };
        }

        revalidatePath('/dashboard/profile');
        revalidatePath('/dashboard');
        revalidatePath('/table/[restaurantId]/[tableId]/order-status', 'page');
        revalidateTag(`restaurant-${restaurantObjectId}`, 'max');
        return { success: true };
    } catch (error: any) {
        console.error('Error updating restaurant:', error);
        return { success: false, error: error?.message || 'Failed to update restaurant' };
    }
}

export async function getPublicRestaurantInfo(restaurantId: string) {
    try {
        await dbConnect();
        const restaurant = await Restaurant.findById(restaurantId)
            .select('name address phone upiId upiPayeeName merchantCode appId gstPercentage sgstPercentage packagingCharge fssaiNumber themeColor logoAccentColor accentSource fontFamily colorScheme logoUrl coverImageUrl enableAestheticDownloads instagramHandle instagramUrl googleReviewUrl')
            .lean();
        return restaurant ? JSON.parse(JSON.stringify(restaurant)) : null;
    } catch (error) {
        console.error('Error fetching public restaurant info:', error);
        return null;
    }
}
