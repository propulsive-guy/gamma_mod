import MenuItem, { IMenuItem } from '@/models/MenuItem';
import InventoryItem from '@/models/InventoryItem';
import KitchenDepartment from '@/models/KitchenDepartment';
import mongoose from 'mongoose';

export class MenuService {
    /**
     * Get all menu items for a restaurant, grouped by category
     */
    static async getMenu(restaurantId: string): Promise<IMenuItem[]> {
        if (!mongoose.Types.ObjectId.isValid(restaurantId)) return [];
        return MenuItem.find({ restaurantId, isAvailable: true }).select('-recipe').sort({ category: 1, name: 1 });
    }

    /**
     * Add or update an item
     */
    static async upsertItem(restaurantId: string, data: Partial<IMenuItem>): Promise<IMenuItem> {
        if ((data as any).departmentId === '') (data as any).departmentId = null;
        if (data.departmentId && !await KitchenDepartment.exists({ _id: data.departmentId, restaurantId, isActive: true })) {
            throw new Error('Choose an active kitchen department for this menu item');
        }
        if (Array.isArray(data.recipe) && data.recipe.length && !data.departmentId) {
            throw new Error('Assign a kitchen department before linking ingredients');
        }
        if (data.recipe !== undefined) {
            if (!Array.isArray(data.recipe)) throw new Error('Invalid inventory recipe');
            const ids = new Set<string>();
            for (const entry of data.recipe) {
                if (!entry || typeof entry !== 'object') throw new Error('Invalid inventory recipe');
                const id = String(entry.inventoryItemId).toLowerCase();
                const quantity = Math.round(Number(entry.quantity) * 10000) / 10000;
                if (!mongoose.Types.ObjectId.isValid(id) || ids.has(id) ||
                    !Number.isFinite(Number(entry.quantity)) || quantity < 0.0001 || quantity > 100000) {
                    throw new Error('Choose each inventory item once with a quantity greater than zero');
                }
                ids.add(id);
            }
            if (ids.size) {
                const count = await InventoryItem.countDocuments({ _id: { $in: [...ids] }, restaurantId, isActive: true });
                if (count !== ids.size) throw new Error('Recipe contains an unavailable inventory item');
            }
            data.recipe = data.recipe.map((entry) => ({
                inventoryItemId: entry.inventoryItemId,
                quantity: Math.round(Number(entry.quantity) * 10000) / 10000,
            }));
        }
        if (data.category) {
            data.category = data.category
                .trim()
                .split(/\s+/)
                .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
                .join(' ');
        }
        if (data._id) {
            const item = await MenuItem.findOneAndUpdate(
                { _id: data._id, restaurantId },
                data,
                { new: true, runValidators: true }
            );
            if (!item) throw new Error('Item not found or unauthorized');
            return item;
        }
        const newItem = new MenuItem({ ...data, restaurantId });
        return newItem.save();
    }

    /**
     * Delete an item
     */
    static async deleteItem(restaurantId: string, itemId: string): Promise<boolean> {
        const result = await MenuItem.deleteOne({ _id: itemId, restaurantId });
        return result.deletedCount > 0;
    }
}
