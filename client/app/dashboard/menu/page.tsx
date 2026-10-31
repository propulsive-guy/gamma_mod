import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import dbConnect from '@/lib/db';
import MenuItem from '@/models/MenuItem';
import InventoryItem from '@/models/InventoryItem';
import InventoryCategory from '@/models/InventoryCategory';
import KitchenDepartment from '@/models/KitchenDepartment';
import Restaurant from '@/models/Restaurant';
import { MenuList } from '@/components/dashboard/MenuList';
import { InventoryManager } from '@/components/dashboard/InventoryManager';
import { INVENTORY_MIS_CATEGORIES } from '@/lib/inventoryCategories';
import { effectiveExpiryDays } from '../../../../shared/kitchenStockLots';

export const maxDuration = 60;

export default async function MenuPage() {
    const session = await auth();

    if (!session || !session.user.restaurantId) {
        redirect('/auth/signin');
    }

    await dbConnect();

    const restaurantId = session.user.restaurantId;
    const restaurant = await Restaurant.findById(restaurantId).select('inventoryTrackingEnabled').lean();
    const inventoryTrackingEnabled = restaurant?.inventoryTrackingEnabled !== false;
    const [menuItems, inventoryItems, departments, savedCategories] = await Promise.all([
        MenuItem.find({ restaurantId: session.user.restaurantId })
            .sort({ category: 1, createdAt: -1 }).lean(),
        inventoryTrackingEnabled
            ? InventoryItem.find({ restaurantId, isActive: true })
                .select('name sku category unit currentStock reorderLevel costPerUnit supplier notes expiryDays wasteBehavior isActive').sort({ name: 1 }).lean()
            : Promise.resolve([]),
        inventoryTrackingEnabled
            ? KitchenDepartment.find({ restaurantId, isActive: true }).select('name').sort({ name: 1 }).lean()
            : Promise.resolve([]),
        inventoryTrackingEnabled
            ? InventoryCategory.find({ restaurantId }).select('name').sort({ name: 1 }).lean()
            : Promise.resolve([]),
    ]);

    const inventoryItemsWithExpiry = inventoryItems.map((item) => ({ ...item, expiryDays: effectiveExpiryDays(item) }));
    const inventoryIds = new Set(inventoryItemsWithExpiry.map((item) => String(item._id)));
    const inventoryUnits = new Map(inventoryItemsWithExpiry.map((item) => [String(item._id), item.unit]));
    const usageByInventoryItem: Record<string, string[]> = {};
    for (const menuItem of menuItems) {
        for (const ingredient of menuItem.recipe || []) {
            const id = String(ingredient.inventoryItemId);
            if (!inventoryIds.has(id)) continue;
            const stockUnit = inventoryUnits.get(id) || '';
            const conversion = stockUnit === 'kg' || stockUnit === 'l' ? 1000 : 1;
            const recipeUnit = stockUnit === 'kg' ? 'g' : stockUnit === 'l' ? 'ml' : stockUnit;
            const amount = ingredient.quantity * conversion;
            const displayAmount = Number.isInteger(amount) ? String(amount) : String(Number(amount.toFixed(3)));
            usageByInventoryItem[id] ||= [];
            usageByInventoryItem[id].push(`${menuItem.name} (${displayAmount} ${recipeUnit}/serving)`);
        }
    }
    const categories = [...new Map(
        [...INVENTORY_MIS_CATEGORIES, ...inventoryItemsWithExpiry.map((item) => item.category), ...savedCategories.map((category) => category.name)]
            .map((name) => [String(name || '').trim().toLocaleLowerCase(), String(name || '').trim()] as const)
            .filter(([key, name]) => key && name),
    ).values()];

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold text-gray-900 font-display">
                    Menu Management
                </h1>
                <p className="text-gray-600 mt-1">
                    {inventoryTrackingEnabled
                        ? 'Manage dishes, prices, and ingredients used per serving.'
                        : 'Manage dishes and prices. This account is set up for order management without stock tracking.'}
                </p>
            </div>

            {inventoryTrackingEnabled && <InventoryManager initialItems={JSON.parse(JSON.stringify(inventoryItemsWithExpiry))} categories={JSON.parse(JSON.stringify(categories))} usageByInventoryItem={usageByInventoryItem} />}
            <MenuList initialMenuItems={JSON.parse(JSON.stringify(menuItems))} inventoryItems={JSON.parse(JSON.stringify(inventoryItemsWithExpiry))} departments={JSON.parse(JSON.stringify(departments))} inventoryTrackingEnabled={inventoryTrackingEnabled} />
        </div>
    );
}
