import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import dbConnect from '@/lib/db';
import MenuItem from '@/models/MenuItem';
import InventoryItem from '@/models/InventoryItem';
import KitchenDepartment from '@/models/KitchenDepartment';
import Restaurant from '@/models/Restaurant';
import { MenuList } from '@/components/dashboard/MenuList';

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
    const [menuItems, inventoryItems, departments] = await Promise.all([
        MenuItem.find({ restaurantId: session.user.restaurantId })
            .sort({ category: 1, createdAt: -1 }).lean(),
        inventoryTrackingEnabled
            ? InventoryItem.find({ restaurantId, isActive: true }).select('name unit currentStock').sort({ name: 1 }).lean()
            : Promise.resolve([]),
        inventoryTrackingEnabled
            ? KitchenDepartment.find({ restaurantId, isActive: true }).select('name').sort({ name: 1 }).lean()
            : Promise.resolve([]),
    ]);

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold text-gray-900 font-display">
                    Menu Management
                </h1>
                <p className="text-gray-600 mt-1">
                    {inventoryTrackingEnabled
                        ? 'Manage dishes, prices, and ingredients used per serving.'
                        : 'Manage dishes and prices. Inventory tracking is disabled for this account.'}
                </p>
            </div>

            <MenuList
                initialMenuItems={JSON.parse(JSON.stringify(menuItems))}
                inventoryItems={JSON.parse(JSON.stringify(inventoryItems))}
                departments={JSON.parse(JSON.stringify(departments))}
                inventoryTrackingEnabled={inventoryTrackingEnabled}
            />
        </div>
    );
}
