import { Request, Response } from 'express';
import Restaurant from '../models/Restaurant';
import mongoose from 'mongoose';
import { colorFromLogo } from '../lib/logoColor';

export class RestaurantController {
    /**
     * Get details of the restaurant owned by current user
     */
    static async getProfile(req: Request, res: Response) {
        try {
            const user = req.user;
            if (!user || !user.restaurantId) {
                return res.status(401).json({ error: 'Unauthorized: No restaurant associated' });
            }

            const restaurant = await Restaurant.findById(user.restaurantId);
            if (!restaurant) {
                return res.status(404).json({ error: 'Restaurant not found' });
            }

            res.json(restaurant);
        } catch (error: any) {
            console.error('Get restaurant profile error:', error);
            res.status(500).json({ error: 'Failed to fetch profile' });
        }
    }

    /**
     * Update restaurant details
     */
    static async updateProfile(req: Request, res: Response) {
        try {
            const user = req.user;
            if (!user || !user.restaurantId) {
                return res.status(401).json({ error: 'Unauthorized: No restaurant associated' });
            }

            const {
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
                address,
                enableAestheticDownloads,
                instagramHandle,
                googleReviewUrl,
            } = req.body;

            if (!name) {
                return res.status(400).json({ error: 'Restaurant name is required' });
            }
            if (typeof address !== 'string' || !address.trim()) {
                return res.status(400).json({ error: 'Restaurant address is required' });
            }
            const parsedPackagingCharge = Number(packagingCharge ?? 0);
            if (!Number.isFinite(parsedPackagingCharge) || parsedPackagingCharge < 0 || parsedPackagingCharge > 10000 ||
                Math.abs(Math.round(parsedPackagingCharge * 100) - parsedPackagingCharge * 100) > 1e-8) {
                return res.status(400).json({ error: 'Packaging charge must be between ₹0 and ₹10,000 with at most two decimal places' });
            }
            const normalizedInstagramHandle = typeof instagramHandle === 'string' ? instagramHandle.trim().replace(/^@/, '') : '';
            if (normalizedInstagramHandle && !/^[A-Za-z0-9._]{1,30}$/.test(normalizedInstagramHandle)) {
                return res.status(400).json({ error: 'Enter a valid Instagram username' });
            }
            const normalizedGoogleReviewUrl = typeof googleReviewUrl === 'string' ? googleReviewUrl.trim() : '';
            if (normalizedGoogleReviewUrl) {
                try {
                    if (new URL(normalizedGoogleReviewUrl).protocol !== 'https:') throw new Error();
                } catch {
                    return res.status(400).json({ error: 'Google review link must be a valid HTTPS URL' });
                }
            }

            const existing = await Restaurant.findById(user.restaurantId).select('logoUrl logoAccentColor fssaiNumber');
            if (!existing) {
                return res.status(404).json({ error: 'Restaurant not found' });
            }
            const nextLogoUrl = typeof logoUrl === 'string' ? logoUrl : existing.logoUrl || '';
            const logoAccentColor = nextLogoUrl === existing.logoUrl && existing.logoAccentColor
                ? existing.logoAccentColor
                : nextLogoUrl ? (await colorFromLogo(nextLogoUrl)) || '' : '';

            const restaurant = await Restaurant.findByIdAndUpdate(
                user.restaurantId,
                {
                    name,
                    upiId,
                    upiPayeeName,
                    merchantCode,
                    appId,
                    themeColor: themeColor || '#38bdf8',
                    accentSource: accentSource === 'custom' ? 'custom' : 'logo',
                    fontFamily: fontFamily || 'inter',
                    colorScheme: colorScheme || 'light',
                    gstNumber,
                    fssaiNumber: typeof fssaiNumber === 'string' ? fssaiNumber.trim().slice(0, 30) : existing.fssaiNumber || '',
                    gstPercentage: parseFloat(gstPercentage) || 0,
                    sgstPercentage: parseFloat(sgstPercentage) || 0,
                    packagingCharge: parsedPackagingCharge,
                    logoUrl: nextLogoUrl,
                    logoAccentColor,
                    coverImageUrl,
                    phone,
                    address: address.trim().slice(0, 300),
                    enableAestheticDownloads: !!enableAestheticDownloads,
                    instagramHandle: normalizedInstagramHandle,
                    googleReviewUrl: normalizedGoogleReviewUrl,
                },
                { new: true }
            );

            if (!restaurant) {
                return res.status(404).json({ error: 'Restaurant not found' });
            }

            res.json(restaurant);
        } catch (error: any) {
            console.error('Update restaurant profile error:', error);
            res.status(500).json({ error: 'Failed to update profile' });
        }
    }

    /**
     * Get public details of a restaurant by ID
     */
    static async getPublicInfo(req: Request, res: Response) {
        try {
            const { id } = req.params;

            if (!mongoose.Types.ObjectId.isValid(id as string)) {
                return res.status(400).json({ error: 'Invalid restaurant ID' });
            }

            const restaurant = await Restaurant.findById(id)
                .select('name description address phone upiId upiPayeeName merchantCode appId gstPercentage sgstPercentage packagingCharge fssaiNumber themeColor logoAccentColor accentSource fontFamily colorScheme logoUrl coverImageUrl enableAestheticDownloads instagramHandle googleReviewUrl')
                .lean();

            if (!restaurant) {
                return res.status(404).json({ error: 'Restaurant not found' });
            }

            res.json(restaurant);
        } catch (error: any) {
            console.error('Get public restaurant info error:', error);
            res.status(500).json({ error: 'Failed to fetch restaurant info' });
        }
    }
}
