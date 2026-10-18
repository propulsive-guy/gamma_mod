'use server';

import { apiFetch } from '@/client-lib/api';
import { revalidatePath, revalidateTag } from 'next/cache';
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

export async function updateRestaurant(formData: FormData) {
    try {
        const name = formData.get('name') as string;
        const upiId = formData.get('upiId') as string;
        const upiPayeeName = formData.get('upiPayeeName') as string;
        const merchantCode = formData.get('merchantCode') as string;
        const appId = formData.get('appId') as string;
        const themeColor = formData.get('themeColor') as string || '#38bdf8';
        const accentSource = formData.get('accentSource') === 'custom' ? 'custom' : 'logo';
        const fontFamily = formData.get('fontFamily') as string || 'inter';
        const colorScheme = formData.get('colorScheme') as string || 'light';

        const gstNumber = formData.get('gstNumber') as string;
        const fssaiNumber = formData.get('fssaiNumber') as string;
        const gstPercentage = parseFloat(formData.get('gstPercentage') as string) || 0;
        const sgstPercentage = parseFloat(formData.get('sgstPercentage') as string) || 0;
        const packagingCharge = Number(formData.get('packagingCharge') ?? 0);
        const phone = formData.get('phone') as string;
        const address = formData.get('address') as string;
        const enableAestheticDownloads = formData.get('enableAestheticDownloads') === 'true';
        const instagramHandleInput = String(formData.get('instagramHandle') ?? '').trim().replace(/^@/, '');
        const googleReviewUrl = String(formData.get('googleReviewUrl') ?? '').trim();

        if (instagramHandleInput && !/^[A-Za-z0-9._]{1,30}$/.test(instagramHandleInput)) {
            return { success: false, error: 'Enter a valid Instagram username (letters, numbers, periods, or underscores)' };
        }
        if (googleReviewUrl) {
            try {
                if (new URL(googleReviewUrl).protocol !== 'https:') throw new Error();
            } catch {
                return { success: false, error: 'Enter a valid Google Maps or review link starting with https://' };
            }
        }

        let logoUrl = formData.get('logoUrl') as string;
        const logoFile = formData.get('logo') as File;

        let coverImageUrl = formData.get('coverImageUrl') as string;
        const coverFile = formData.get('cover') as File;

        if (!name) {
            throw new Error('Restaurant name is required');
        }
        if (!address?.trim()) {
            return { success: false, error: 'Restaurant address is required' };
        }
        if (!Number.isFinite(packagingCharge) || packagingCharge < 0 || packagingCharge > 10000 ||
            Math.abs(Math.round(packagingCharge * 100) - packagingCharge * 100) > 1e-8) {
            return { success: false, error: 'Enter a valid packaging charge between ₹0 and ₹10,000' };
        }

        if (logoFile && logoFile.size > 0 && logoFile.type.startsWith('image/')) {
            if (logoFile.size > 2 * 1024 * 1024) {
                return { success: false, error: 'Logo must be under 2MB' };
            }
            try {
                const arrayBuffer = await logoFile.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);
                const base64 = buffer.toString('base64');
                logoUrl = `data:${logoFile.type};base64,${base64}`;
            } catch (error) {
                console.error("Error processing logo", error);
            }
        }

        if (coverFile && coverFile.size > 0 && coverFile.type.startsWith('image/')) {
            if (coverFile.size > 2 * 1024 * 1024) {
                return { success: false, error: 'Aesthetic photo must be under 2MB' };
            }
            try {
                const arrayBuffer = await coverFile.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);
                const base64 = buffer.toString('base64');
                coverImageUrl = `data:${coverFile.type};base64,${base64}`;
            } catch (error) {
                console.error("Error processing cover image", error);
            }
        }

        const res = await apiFetch('/api/v1/restaurant/profile', {
            method: 'PUT',
            body: JSON.stringify({
                name,
                upiId,
                upiPayeeName,
                merchantCode,
                appId,
                themeColor,
                accentSource,
                fontFamily,
                colorScheme,
                gstNumber,
                fssaiNumber,
                gstPercentage,
                sgstPercentage,
                packagingCharge,
                logoUrl,
                coverImageUrl,
                phone,
                address: address.trim(),
                enableAestheticDownloads,
                instagramHandle: instagramHandleInput,
                googleReviewUrl,
            }),
        });

        if (!res.ok) {
            const errData = await res.json();
            return { success: false, error: errData.error || 'Failed to update restaurant' };
        }

        const backendRestaurant = await res.json();
        // The profile page and customer table page read restaurant settings from
        // the Next.js Mongo connection. Persist these public links there as well
        // as through the backend API so both readers use the same Mongo record.
        const session = await auth();
        const restaurantId = session?.user?.restaurantId;
        if (!restaurantId) {
            return { success: false, error: 'Your restaurant session has expired. Please sign in again.' };
        }
        await dbConnect();
        const restaurant = await Restaurant.findByIdAndUpdate(
            restaurantId,
            { $set: { instagramHandle: instagramHandleInput, googleReviewUrl } },
            { new: true }
        ).lean();
        if (!restaurant) {
            return { success: false, error: 'Restaurant not found while saving social links' };
        }

        revalidatePath('/dashboard/profile');
        revalidatePath('/table/[restaurantId]/[tableId]/order-status', 'page');
        if (restaurant._id) revalidateTag(`restaurant-${restaurant._id}`, 'max');
        return {
            success: true,
            restaurant: {
                ...backendRestaurant,
                instagramHandle: restaurant.instagramHandle,
                googleReviewUrl: restaurant.googleReviewUrl,
            },
        };
    } catch (error: any) {
        console.error('Error updating restaurant:', error);
        return { success: false, error: error?.message || 'Failed to update restaurant' };
    }
}

export async function getPublicRestaurantInfo(restaurantId: string) {
    try {
        await dbConnect();
        const restaurant = await Restaurant.findById(restaurantId)
            .select('name address phone upiId upiPayeeName merchantCode appId gstPercentage sgstPercentage packagingCharge fssaiNumber themeColor logoAccentColor accentSource fontFamily colorScheme logoUrl coverImageUrl enableAestheticDownloads instagramHandle googleReviewUrl')
            .lean();
        if (!restaurant) return null;
        return JSON.parse(JSON.stringify(restaurant));
    } catch (error) {
        console.error('Error fetching public restaurant info:', error);
        return null;
    }
}
