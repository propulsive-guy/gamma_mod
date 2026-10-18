'use server';

import { apiFetch } from '@/client-lib/api';
import { revalidatePath, revalidateTag } from 'next/cache';
import dbConnect from '@/lib/db';
import Restaurant from '@/models/Restaurant';
import { auth } from '@/lib/auth';

function normalizeInstagramInput(value: string): { handle: string; url: string } | null {
    const input = value.trim();
    if (!input) return { handle: '', url: '' };
    let handle = input.replace(/^@/, '');
    if (/^(https?:\/\/)?(www\.)?(m\.)?instagram\.com\//i.test(input)) {
        try {
            const url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
            if (!['instagram.com', 'www.instagram.com', 'm.instagram.com'].includes(url.hostname.toLowerCase())) return null;
            handle = url.pathname.split('/').filter(Boolean)[0] || '';
        } catch {
            return null;
        }
    }
    if (!/^[A-Za-z0-9._]{1,30}$/.test(handle)) return null;
    return { handle, url: `https://www.instagram.com/${handle}/` };
}

function normalizeHttpsUrl(value: string): string | null {
    const input = value.trim();
    if (!input) return '';
    try {
        const normalized = /^https?:\/\//i.test(input) ? input : `https://${input}`;
        const url = new URL(normalized);
        if (url.protocol === 'http:') url.protocol = 'https:';
        if (url.protocol !== 'https:') return null;
        return url.toString();
    } catch {
        return null;
    }
}


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
        const instagram = normalizeInstagramInput(String(formData.get('instagramUrl') ?? formData.get('instagramHandle') ?? ''));
        const googleReviewUrl = normalizeHttpsUrl(String(formData.get('googleReviewUrl') ?? ''));
        if (!instagram) return { success: false, error: 'Enter an Instagram username or an instagram.com profile URL' };
        if (googleReviewUrl === null) return { success: false, error: 'Enter a valid Google Maps or review URL' };

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

        // Persist the links to the Mongo database read by the table page before
        // calling the separate Express API. This keeps the customer page current
        // even if the backend deployment is on an older build.
        const session = await auth();
        const restaurantId = session?.user?.restaurantId;
        if (!restaurantId) {
            return { success: false, error: 'Your restaurant session has expired. Please sign in again.' };
        }
        await dbConnect();
        const savedRestaurant = await Restaurant.findByIdAndUpdate(
            restaurantId,
            { $set: { instagramHandle: instagram.handle, instagramUrl: instagram.url, googleReviewUrl } },
            { new: true }
        ).select('_id instagramHandle googleReviewUrl').lean();
        if (!savedRestaurant) {
            return { success: false, error: 'Restaurant not found while saving social links' };
        }

        let res: Response | null = null;
        let warning = '';
        try {
            res = await apiFetch('/api/v1/restaurant/profile', {
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
                instagramHandle: instagram.handle,
                instagramUrl: instagram.url,
                googleReviewUrl,
                }),
            });
        } catch (error) {
            console.error('Backend profile update failed after social links were saved:', error);
            warning = 'Social links were saved, but other profile settings could not sync to the backend.';
        }

        revalidatePath('/dashboard/profile');
        revalidatePath('/table/[restaurantId]/[tableId]/order-status', 'page');
        revalidateTag(`restaurant-${savedRestaurant._id}`, 'max');
        let backendRestaurant: Record<string, unknown> = {};
        if (res?.ok) {
            backendRestaurant = await res.json().catch(() => ({}));
        } else if (res) {
            const errData = await res.json().catch(() => ({}));
            warning = `Social links were saved. Other profile settings did not sync: ${errData.error || 'backend update failed'}`;
        }
        return {
            success: true,
            warning,
            restaurant: {
                ...backendRestaurant,
                instagramHandle: instagram.handle,
                instagramUrl: instagram.url,
                googleReviewUrl,
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
            .select('name address phone upiId upiPayeeName merchantCode appId gstPercentage sgstPercentage packagingCharge fssaiNumber themeColor logoAccentColor accentSource fontFamily colorScheme logoUrl coverImageUrl enableAestheticDownloads instagramHandle instagramUrl googleReviewUrl')
            .lean();
        if (restaurant?.instagramHandle || restaurant?.instagramUrl || restaurant?.googleReviewUrl) {
            return JSON.parse(JSON.stringify(restaurant));
        }

        // The legacy Express deployment may be connected to the production
        // Mongo database while the Next.js app uses a separate read connection.
        // Fall back to the backend's public restaurant endpoint for these links.
        const response = await apiFetch(`/api/v1/restaurant/public/${encodeURIComponent(restaurantId)}`);
        if (!response.ok) return restaurant ? JSON.parse(JSON.stringify(restaurant)) : null;
        const backendRestaurant = await response.json();
        return JSON.parse(JSON.stringify({
            ...restaurant,
            ...backendRestaurant,
            instagramHandle: backendRestaurant.instagramHandle || restaurant?.instagramHandle || '',
            instagramUrl: backendRestaurant.instagramUrl || restaurant?.instagramUrl || '',
            googleReviewUrl: backendRestaurant.googleReviewUrl || restaurant?.googleReviewUrl || '',
        }));
    } catch (error) {
        console.error('Error fetching public restaurant info:', error);
        return null;
    }
}
