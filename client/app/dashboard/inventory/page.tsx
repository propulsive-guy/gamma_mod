import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import dbConnect from '@/lib/db';
import InventoryItem from '@/models/InventoryItem';
import StockMovement from '@/models/StockMovement';
import { InventoryManager } from '@/components/dashboard/InventoryManager';

export default async function InventoryPage() {
    const session = await auth();
    if (!session?.user.restaurantId) redirect('/auth/signin');
    await dbConnect();
    const restaurantId = session.user.restaurantId;
    const [items, movements] = await Promise.all([
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
    ]);
    return <InventoryManager initialItems={JSON.parse(JSON.stringify(items))} initialMovements={JSON.parse(JSON.stringify(movements))} />;
}
