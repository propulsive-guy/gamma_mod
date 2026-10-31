import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import dbConnect from '@/lib/db';
import InventoryItem from '@/models/InventoryItem';
import InventoryCategory from '@/models/InventoryCategory';
import ProcurementDocument from '@/models/ProcurementDocument';
import FinancialEntry from '@/models/FinancialEntry';
import FinancialSettings from '@/models/FinancialSettings';
import StoreManager from '@/components/dashboard/StoreManager';
import { ensureLowStockPurchaseDrafts } from '@/lib/lowStockProcurement';
import KitchenDepartment from '@/models/KitchenDepartment';
import KitchenStock from '@/models/KitchenStock';
import { processKitchenStockExpiry } from '@/lib/kitchenStockLots';
import { INVENTORY_MIS_CATEGORIES } from '@/lib/inventoryCategories';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const sections = ['overview', 'requisitions', 'purchasing', 'stock', 'expenses', 'balances'] as const;

export default async function StorePage({ searchParams }: { searchParams: Promise<{ section?: string }> }) {
    const session = await auth();
    if (!session?.user?.restaurantId) redirect('/auth/signin');
    await dbConnect();
    const restaurantId = session.user.restaurantId;
    const setupPromise = Promise.all([
        processKitchenStockExpiry(restaurantId),
        ensureLowStockPurchaseDrafts(restaurantId).catch((error) => {
            console.error('Could not prepare low-stock review orders:', error);
        }),
    ]);
    const [query] = await Promise.all([searchParams, setupPromise]);
    const initialSection = sections.includes(query.section as typeof sections[number]) ? query.section as typeof sections[number] : 'overview';
    const [items, categories, documents, entries, settings, departments, kitchenStocks] = await Promise.all([
        InventoryItem.find({ restaurantId, isActive: true })
            .select('name sku category unit currentStock reorderLevel costPerUnit supplier')
            .sort({ category: 1, name: 1 }).lean(),
        InventoryCategory.find({ restaurantId }).select('name').sort({ name: 1 }).lean(),
        ProcurementDocument.find({ restaurantId })
            .select('type status reference supplier vendorBillNumber invoiceDate documentDate entrySource departmentId notes lines payments createdAt')
            .sort({ createdAt: -1 }).limit(120).lean(),
        FinancialEntry.find({ restaurantId })
            .select('type category amount entryDate reference note createdAt')
            .sort({ entryDate: -1 }).limit(30).lean(),
        FinancialSettings.findOne({ restaurantId })
            .select('openingDate openingCash openingInventoryValue otherAssets openingPayables openingLoans otherLiabilities').lean(),
        KitchenDepartment.find({ restaurantId, isActive: true }).select('name').sort({ name: 1 }).lean(),
        KitchenStock.find({ restaurantId }).select('departmentId inventoryItemId currentStock').lean(),
    ]);

    const categoryNames = [...new Map(
        [...INVENTORY_MIS_CATEGORIES, ...items.map((item) => item.category), ...categories.map((category) => category.name)]
            .map((name) => [String(name || '').trim().toLocaleLowerCase(), String(name || '').trim()] as const)
            .filter(([key, name]) => key && name),
    ).values()];

    return <StoreManager
        initialSection={initialSection}
        initialItems={JSON.parse(JSON.stringify(items))}
        initialCategories={JSON.parse(JSON.stringify(categoryNames))}
        initialDocuments={JSON.parse(JSON.stringify(documents))}
        initialEntries={JSON.parse(JSON.stringify(entries))}
        initialSettings={settings ? JSON.parse(JSON.stringify(settings)) : null}
        initialDepartments={JSON.parse(JSON.stringify(departments))}
        initialKitchenStocks={JSON.parse(JSON.stringify(kitchenStocks))}
    />;
}
