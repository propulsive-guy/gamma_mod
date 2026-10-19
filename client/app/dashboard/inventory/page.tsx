import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import dbConnect from '@/lib/db';
import InventoryItem from '@/models/InventoryItem';
import MenuItem from '@/models/MenuItem';
import StockMovement from '@/models/StockMovement';
import { InventoryManager } from '@/components/dashboard/InventoryManager';

export const maxDuration = 60;

export default async function InventoryPage() {
    const session = await auth();
    if (!session?.user.restaurantId) redirect('/auth/signin');
    await dbConnect();
    const restaurantId = session.user.restaurantId;
    const [items, movements, menuItems] = await Promise.all([
        InventoryItem.find({ restaurantId, isActive: true })
            .select('name sku category unit currentStock reorderLevel costPerUnit supplier isActive createdAt updatedAt')
            .sort({ category: 1, name: 1 })
            .lean(),
        StockMovement.find({ restaurantId })
            .select('inventoryItemId type quantity stockBefore stockAfter note createdAt')
            .sort({ createdAt: -1 })
            .limit(60)
            .populate('inventoryItemId', 'name unit')
            .lean(),
        MenuItem.find({ restaurantId }).select('name recipe').lean(),
    ]);
    const activeInventoryIds = new Set(items.map((item) => String(item._id)));
    const inventoryUnits = new Map(items.map((item) => [String(item._id), item.unit]));
    const usageByInventoryItem: Record<string, string[]> = {};
    for (const menuItem of menuItems) {
        for (const ingredient of menuItem.recipe || []) {
            const id = String(ingredient.inventoryItemId);
            if (!activeInventoryIds.has(id)) continue;
            const stockUnit = inventoryUnits.get(id) || '';
            const conversion = stockUnit === 'kg' || stockUnit === 'l' ? 1000 : 1;
            const recipeUnit = stockUnit === 'kg' ? 'g' : stockUnit === 'l' ? 'ml' : stockUnit;
            const amount = ingredient.quantity * conversion;
            const displayAmount = Number.isInteger(amount) ? String(amount) : String(Number(amount.toFixed(3)));
            usageByInventoryItem[id] ||= [];
            usageByInventoryItem[id].push(`${menuItem.name} (${displayAmount} ${recipeUnit}/serving)`);
        }
    }
    const menuSetup = {
        total: menuItems.length,
        linked: menuItems.filter((item) => item.recipe?.length && item.recipe.every((ingredient) => activeInventoryIds.has(String(ingredient.inventoryItemId)))).length,
    };
    return <InventoryManager
        initialItems={JSON.parse(JSON.stringify(items))}
        initialMovements={JSON.parse(JSON.stringify(movements))}
        usageByInventoryItem={usageByInventoryItem}
        menuSetup={menuSetup}
    />;
}
