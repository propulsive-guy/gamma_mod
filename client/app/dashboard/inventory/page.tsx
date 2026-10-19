import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import dbConnect from '@/lib/db';
import InventoryItem from '@/models/InventoryItem';
import MenuItem from '@/models/MenuItem';
import KitchenDepartment from '@/models/KitchenDepartment';
import KitchenStock from '@/models/KitchenStock';
import { processKitchenStockExpiry } from '@/lib/kitchenStockLots';
import ProcurementDocument from '@/models/ProcurementDocument';
import { InventoryManager } from '@/components/dashboard/InventoryManager';
import KitchenInventoryWorkflow from '@/components/dashboard/KitchenInventoryWorkflow';

export const maxDuration = 60;

export default async function InventoryPage() {
    const session = await auth();
    if (!session?.user.restaurantId) redirect('/auth/signin');
    await dbConnect();
    const restaurantId = session.user.restaurantId;
    await processKitchenStockExpiry(restaurantId);
    const [items, menuItems, departments, kitchenStocks, requisitions] = await Promise.all([
        InventoryItem.find({ restaurantId, isActive: true })
            .select('name sku category unit currentStock reorderLevel costPerUnit supplier notes wasteBehavior isActive')
            .sort({ category: 1, name: 1 })
            .lean(),
        MenuItem.find({ restaurantId }).select('name recipe').lean(),
        KitchenDepartment.find({ restaurantId, isActive: true }).sort({ name: 1 }).lean(),
        KitchenStock.find({ restaurantId }).lean(),
        ProcurementDocument.find({ restaurantId, type: 'requisition' }).sort({ createdAt: -1 }).limit(30).select('reference status departmentId createdAt').lean(),
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
    return <div className="space-y-6">
        <KitchenInventoryWorkflow
            items={JSON.parse(JSON.stringify(items.map(({ _id, name, unit, currentStock }) => ({ _id, name, unit, storeAvailableStock: currentStock }))))}
            departments={JSON.parse(JSON.stringify(departments.map((department) => ({ _id: String(department._id), name: department.name }))))}
            stocks={JSON.parse(JSON.stringify(kitchenStocks.map((stock) => ({
                _id: String(stock._id), departmentId: String(stock.departmentId),
                inventoryItemId: String(stock.inventoryItemId), currentStock: Number(stock.currentStock),
            }))))}
            requests={JSON.parse(JSON.stringify(requisitions))}
        />
        <InventoryManager
        initialItems={JSON.parse(JSON.stringify(items))}
        usageByInventoryItem={usageByInventoryItem}
        menuSetup={menuSetup}
        />
    </div>;
}
