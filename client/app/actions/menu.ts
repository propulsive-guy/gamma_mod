'use server';

import mongoose from 'mongoose';
import { revalidatePath, updateTag } from 'next/cache';
import { auth } from '@/lib/auth';
import dbConnect from '@/lib/db';
import InventoryItem from '@/models/InventoryItem';
import KitchenDepartment from '@/models/KitchenDepartment';
import MenuItem from '@/models/MenuItem';
import Restaurant from '@/models/Restaurant';

export type ScannedMenuItem = {
    name: string;
    description: string;
    price: number;
    category: string;
};

const ORDER_ONLY_INGREDIENT = 'Demo Order Ingredient';
const dietaryTypes = new Set(['veg', 'non-veg', 'vegan', 'egg', 'unknown']);
const itemTypes = new Set(['food', 'beverage', 'water', 'other']);

async function menuContext() {
    const session = await auth();
    const rawRestaurantId = String(session?.user?.restaurantId || '');
    if (!mongoose.Types.ObjectId.isValid(rawRestaurantId)) {
        throw new Error('Your session has expired. Please sign in again.');
    }

    await dbConnect();
    const restaurantId = new mongoose.Types.ObjectId(rawRestaurantId);
    const restaurant = await Restaurant.findById(restaurantId).select('inventoryTrackingEnabled').lean();
    if (!restaurant) throw new Error('Restaurant not found for this account.');
    return { restaurantId, inventoryTrackingEnabled: restaurant.inventoryTrackingEnabled !== false };
}

function normalizeCategory(value: string) {
    return value.trim().replace(/\s+/g, ' ').split(' ')
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
}

function cleanScannedItem(item: any): ScannedMenuItem | null {
    const name = typeof item?.name === 'string' ? item.name.trim().slice(0, 120) : '';
    const description = typeof item?.description === 'string' ? item.description.trim().slice(0, 500) : '';
    const category = typeof item?.category === 'string' ? item.category.trim().slice(0, 80) : '';
    const price = Number(item?.price);
    if (!name || !category || !Number.isFinite(price) || price < 0 || price > 100000) return null;
    return { name, description, category, price: Math.round(price * 100) / 100 };
}

async function ensureOrderOnlyIngredient(restaurantId: mongoose.Types.ObjectId) {
    try {
        return await InventoryItem.findOneAndUpdate(
            { restaurantId, name: ORDER_ONLY_INGREDIENT },
            {
                $set: { isActive: true },
                $setOnInsert: {
                    restaurantId,
                    name: ORDER_ONLY_INGREDIENT,
                    category: 'General',
                    unit: 'piece',
                    currentStock: 0,
                    reorderLevel: 0,
                    costPerUnit: 0,
                    supplier: 'System setup',
                    notes: 'Compatibility link for order-only menu items. Inventory tracking is disabled for this restaurant.',
                },
            },
            { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true },
        ).select('_id');
    } catch (error: any) {
        if (error?.code === 11000) {
            const existing = await InventoryItem.findOne({ restaurantId, name: ORDER_ONLY_INGREDIENT }).select('_id');
            if (existing) return existing;
        }
        throw error;
    }
}

async function normalizeMenuData(
    data: any,
    restaurantId: mongoose.Types.ObjectId,
    inventoryTrackingEnabled: boolean,
) {
    const name = typeof data?.name === 'string' ? data.name.trim().replace(/\s+/g, ' ') : '';
    const description = typeof data?.description === 'string' ? data.description.trim() : '';
    const category = normalizeCategory(typeof data?.category === 'string' ? data.category : '');
    const price = Number(data?.price);
    if (!name || name.length > 120) throw new Error('Enter an item name (up to 120 characters).');
    if (!category || category.length > 80) throw new Error('Enter a category (up to 80 characters).');
    if (description.length > 500) throw new Error('Description must be 500 characters or fewer.');
    if (!Number.isFinite(price) || price < 0 || price > 100000) {
        throw new Error('Enter a valid price between ₹0 and ₹100,000.');
    }

    const imageUrl = typeof data?.imageUrl === 'string' ? data.imageUrl : '';
    const aestheticImageUrl = typeof data?.aestheticImageUrl === 'string' ? data.aestheticImageUrl : '';
    if (imageUrl.length > 2_000_000 || aestheticImageUrl.length > 2_000_000) {
        throw new Error('Item image is too large. Upload an image under 5 MB.');
    }

    const common = {
        name,
        description,
        category,
        price: Math.round(price * 100) / 100,
        imageUrl,
        aestheticImageUrl,
        dietaryType: dietaryTypes.has(data?.dietaryType) ? data.dietaryType : 'unknown',
        itemType: itemTypes.has(data?.itemType) ? data.itemType : 'food',
    };

    // Delhi6 is an order-only account. Keep its menu/order data independent of
    // kitchen setup while retaining the compatibility recipe expected by older orders.
    if (!inventoryTrackingEnabled) {
        const demoIngredient = await ensureOrderOnlyIngredient(restaurantId);
        return {
            ...common,
            departmentId: null,
            recipe: [{ inventoryItemId: demoIngredient!._id, quantity: 1 }],
        };
    }

    const departmentId = typeof data?.departmentId === 'string' && data.departmentId.trim()
        ? data.departmentId.trim()
        : '';
    if (departmentId && (!mongoose.Types.ObjectId.isValid(departmentId) ||
        !await KitchenDepartment.exists({ _id: departmentId, restaurantId, isActive: true }))) {
        throw new Error('Choose an active kitchen department for this menu item.');
    }

    const rawRecipe = data?.recipe === undefined ? [] : data.recipe;
    if (!Array.isArray(rawRecipe)) throw new Error('Check the ingredient list and try again.');
    const seen = new Set<string>();
    const recipe = rawRecipe.map((part: any) => {
        const inventoryItemId = String(part?.inventoryItemId || '');
        const quantity = Number(part?.quantity);
        if (!mongoose.Types.ObjectId.isValid(inventoryItemId) || seen.has(inventoryItemId) ||
            !Number.isFinite(quantity) || quantity < 0.0001 || quantity > 100000) {
            throw new Error('Choose each ingredient once and enter a quantity greater than zero.');
        }
        seen.add(inventoryItemId);
        return { inventoryItemId, quantity: Math.round(quantity * 10000) / 10000 };
    });
    if (recipe.length && !departmentId) {
        throw new Error('Select the preparing department for these ingredients.');
    }
    if (recipe.length) {
        const availableCount = await InventoryItem.countDocuments({
            _id: { $in: [...seen] }, restaurantId, isActive: true,
        });
        if (availableCount !== recipe.length) throw new Error('One of the selected ingredients is no longer available.');
    }

    return { ...common, departmentId: departmentId || null, recipe };
}

function refreshMenu(restaurantId: mongoose.Types.ObjectId) {
    revalidatePath('/dashboard/menu');
    revalidatePath('/table/[restaurantId]/[tableId]', 'page');
    updateTag(`menu-${restaurantId}`);
}

function actionError(error: unknown, fallback: string) {
    console.error(fallback, error);
    return error instanceof Error ? error.message : fallback;
}

export async function importScannedMenuItems(items: ScannedMenuItem[]) {
    try {
        const { restaurantId, inventoryTrackingEnabled } = await menuContext();
        if (!Array.isArray(items) || items.length < 1 || items.length > 100) {
            return { success: false, error: 'Select between 1 and 100 valid items.' };
        }
        const cleaned = items.map(cleanScannedItem).filter(Boolean) as ScannedMenuItem[];
        if (cleaned.length !== items.length) {
            return { success: false, error: 'Check every selected item name, category, and price.' };
        }

        const existingItems = await MenuItem.find({ restaurantId }).select('name category').lean();
        const existing = new Set(existingItems.map((item) =>
            `${item.name.trim().toLowerCase()}::${item.category.trim().toLowerCase()}`));
        const unique = cleaned.filter((item) => {
            const key = `${item.name.toLowerCase()}::${item.category.toLowerCase()}`;
            if (existing.has(key)) return false;
            existing.add(key);
            return true;
        });
        if (!unique.length) return { success: true, imported: 0, skipped: cleaned.length };

        const demoIngredient = inventoryTrackingEnabled ? null : await ensureOrderOnlyIngredient(restaurantId);
        const documents = unique.map((item) => ({
            ...item,
            category: normalizeCategory(item.category),
            restaurantId,
            imageUrl: '',
            aestheticImageUrl: '',
            isAvailable: true,
            dietaryType: 'unknown' as const,
            itemType: 'food' as const,
            departmentId: null,
            recipe: demoIngredient ? [{ inventoryItemId: demoIngredient._id, quantity: 1 }] : [],
        }));
        await MenuItem.insertMany(documents, { ordered: true });
        refreshMenu(restaurantId);
        return { success: true, imported: documents.length, skipped: cleaned.length - unique.length };
    } catch (error) {
        return { success: false, error: actionError(error, 'Could not import the scanned menu.') };
    }
}

export async function createMenuItem(data: any) {
    try {
        const { restaurantId, inventoryTrackingEnabled } = await menuContext();
        const menuData = await normalizeMenuData(data, restaurantId, inventoryTrackingEnabled);
        const menuItem = await MenuItem.create({
            ...menuData,
            restaurantId,
            isAvailable: data?.isAvailable !== false,
        } as any);
        refreshMenu(restaurantId);
        return { success: true, data: JSON.parse(JSON.stringify(menuItem)) };
    } catch (error) {
        return { success: false, error: actionError(error, 'Could not save this menu item.') };
    }
}

export async function updateMenuItem(id: string, data: any) {
    try {
        const { restaurantId, inventoryTrackingEnabled } = await menuContext();
        if (!mongoose.Types.ObjectId.isValid(id)) return { success: false, error: 'Invalid menu item.' };
        const menuData = await normalizeMenuData(data, restaurantId, inventoryTrackingEnabled);
        const menuItem = await MenuItem.findOneAndUpdate(
            { _id: id, restaurantId },
            { $set: menuData },
            { new: true, runValidators: true },
        );
        if (!menuItem) return { success: false, error: 'Menu item not found for this restaurant.' };
        refreshMenu(restaurantId);
        return { success: true, data: JSON.parse(JSON.stringify(menuItem)) };
    } catch (error) {
        return { success: false, error: actionError(error, 'Could not update this menu item.') };
    }
}

export async function deleteMenuItem(id: string) {
    try {
        const { restaurantId } = await menuContext();
        if (!mongoose.Types.ObjectId.isValid(id)) return { success: false, error: 'Invalid menu item.' };
        const deleted = await MenuItem.findOneAndDelete({ _id: id, restaurantId }).select('_id');
        if (!deleted) return { success: false, error: 'Menu item not found for this restaurant.' };
        refreshMenu(restaurantId);
        return { success: true };
    } catch (error) {
        return { success: false, error: actionError(error, 'Could not delete this menu item.') };
    }
}

export async function toggleMenuItemAvailability(id: string) {
    try {
        const { restaurantId } = await menuContext();
        if (!mongoose.Types.ObjectId.isValid(id)) return { success: false, error: 'Invalid menu item.' };
        const menuItem = await MenuItem.findOne({ _id: id, restaurantId });
        if (!menuItem) return { success: false, error: 'Menu item not found for this restaurant.' };
        menuItem.isAvailable = !menuItem.isAvailable;
        await menuItem.save();
        refreshMenu(restaurantId);
        return { success: true, isAvailable: menuItem.isAvailable };
    } catch (error) {
        return { success: false, error: actionError(error, 'Could not update menu availability.') };
    }
}

export async function getPublicMenu(restaurantId: string) {
    try {
        if (!mongoose.Types.ObjectId.isValid(restaurantId)) return [];
        await dbConnect();
        const items = await MenuItem.find({ restaurantId, isAvailable: true })
            .select('-recipe')
            .sort({ category: 1, name: 1 })
            .lean();
        return JSON.parse(JSON.stringify(items));
    } catch (error) {
        console.error('Error fetching public menu:', error);
        return [];
    }
}
