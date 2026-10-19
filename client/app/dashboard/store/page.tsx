import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import dbConnect from '@/lib/db';
import InventoryItem from '@/models/InventoryItem';
import ProcurementDocument from '@/models/ProcurementDocument';
import FinancialEntry from '@/models/FinancialEntry';
import FinancialSettings from '@/models/FinancialSettings';
import StoreManager from '@/components/dashboard/StoreManager';
import { ensureLowStockPurchaseDrafts } from '@/lib/lowStockProcurement';
import KitchenDepartment from '@/models/KitchenDepartment';
import KitchenStock from '@/models/KitchenStock';
import { processKitchenStockExpiry } from '@/lib/kitchenStockLots';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export default async function StorePage() {
    const session = await auth();
    if (!session?.user?.restaurantId) redirect('/auth/signin');
    await dbConnect();
    const restaurantId = session.user.restaurantId;
    await processKitchenStockExpiry(restaurantId);
    try {
        await ensureLowStockPurchaseDrafts(restaurantId);
    } catch (error) {
        console.error('Could not prepare low-stock review orders:', error);
    }
    const [items, documents, entries, settings, departments, kitchenStocks] = await Promise.all([
        InventoryItem.find({ restaurantId, isActive: true }).select('name unit currentStock reorderLevel costPerUnit supplier').sort({ name: 1 }).lean(),
        ProcurementDocument.find({ restaurantId }).sort({ createdAt: -1 }).limit(60).lean(),
        FinancialEntry.find({ restaurantId }).sort({ entryDate: -1 }).limit(30).lean(),
        FinancialSettings.findOne({ restaurantId }).lean(),
        KitchenDepartment.find({ restaurantId, isActive: true }).sort({ name: 1 }).lean(),
        KitchenStock.find({ restaurantId }).lean(),
    ]);
    return <StoreManager
        initialItems={JSON.parse(JSON.stringify(items))}
        initialDocuments={JSON.parse(JSON.stringify(documents))}
        initialEntries={JSON.parse(JSON.stringify(entries))}
        initialSettings={settings ? JSON.parse(JSON.stringify(settings)) : null}
        initialDepartments={JSON.parse(JSON.stringify(departments))}
        initialKitchenStocks={JSON.parse(JSON.stringify(kitchenStocks))}
    />;
}
