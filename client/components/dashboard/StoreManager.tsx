'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'react-hot-toast';
import { ArchiveBoxIcon, ArrowDownTrayIcon, ArrowPathIcon, BanknotesIcon, BuildingStorefrontIcon, ChartBarIcon, ClipboardDocumentListIcon, ExclamationTriangleIcon, PencilSquareIcon, ShoppingCartIcon, TruckIcon } from '@heroicons/react/24/outline';
import { InventoryBillScanner } from '@/components/dashboard/InventoryBillScanner';
import EditSupplierBillDialog from '@/components/dashboard/EditSupplierBillDialog';
import VendorPurchaseOrderDialog from '@/components/dashboard/VendorPurchaseOrderDialog';
import KitchenInventoryWorkflow from '@/components/dashboard/KitchenInventoryWorkflow';
import { MIS_EXPENSE_CATEGORIES, MIS_EXTERNAL_SALES_CHANNELS } from '@/lib/managementMis';
import {
    approveLowStockPurchaseOrder, createFinancialEntry,
    getStoreStockSnapshot, receivePurchaseOrder, recordPurchasePayment, saveOpeningBalances, updateMinimumStockThreshold,
} from '@/app/actions/store';
import { INVENTORY_MIS_CATEGORIES } from '@/lib/inventoryCategories';

type StoreItem = { _id: string; name: string; category: string; unit: string; currentStock: number; reorderLevel: number; costPerUnit: number; supplier?: string };
type StoreLine = { inventoryItemId: string; itemName: string; unit: string; category?: string; requestedQuantity: number; orderedQuantity: number; receivedQuantity: number; unitCost: number; approvedQuantity?: number };
type StoreDocument = { _id: string; type: 'requisition' | 'purchase_order'; status: string; reference: string; supplier: string; vendorBillNumber?: string; invoiceDate?: string; documentDate?: string; entrySource?: 'supplier_bill' | 'purchase_order' | 'demo'; departmentId?: string; notes?: string; lines: StoreLine[]; payments: { amount: number; paidAt: string; reference?: string }[]; createdAt: string };
type Department = { _id: string; name: string };
type KitchenStockRow = { _id: string; departmentId: string; inventoryItemId: string; currentStock: number };
type StoreEntry = { _id: string; type: string; category: string; amount: number; entryDate: string; reference?: string; note?: string };
type Settings = { openingDate: string; openingCash: number; openingInventoryValue: number; otherAssets: number; openingPayables: number; openingLoans: number; otherLiabilities: number } | null;
type MenuStatus = { trackingEnabled: boolean; activeMenuItems: number; readyMenuItems: number; mappedIngredients: { departmentId: string; inventoryItemId: string }[] };
const quantity = (value: number) => Number(value || 0).toFixed(2);
const money = (amount: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(amount || 0);
const dateLabel = (date: string) => new Date(date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const inputClass = 'min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100';
const initialEntryDate = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const dateInputValue = (value?: string) => value ? new Date(value).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) : initialEntryDate();
type StoreSection = 'overview' | 'requisitions' | 'purchasing' | 'stock' | 'expenses' | 'balances';

export default function StoreManager({ initialSection = 'overview', initialItems, initialCategories, initialDocuments, initialEntries, initialSettings, initialDepartments, initialKitchenStocks, initialMenuStatus }: {
    initialSection?: StoreSection;
    initialItems: StoreItem[];
    initialCategories: string[]; initialDocuments: StoreDocument[]; initialEntries: StoreEntry[]; initialSettings: Settings; initialDepartments: Department[]; initialKitchenStocks: KitchenStockRow[];
    initialMenuStatus: MenuStatus;
}) {
    const router = useRouter();
    const [storeItems, setStoreItems] = useState(initialItems);
    const [kitchenStocks, setKitchenStocks] = useState(initialKitchenStocks);
    const previousLowStockIds = useRef(new Set(initialItems.filter((item) => item.reorderLevel > 0 && item.currentStock <= item.reorderLevel).map((item) => item._id)));
    const [minimumStockValues, setMinimumStockValues] = useState<Record<string, string>>(() => Object.fromEntries(initialItems.map((item) => [item._id, String(item.reorderLevel)])));
    const [categories, setCategories] = useState(() => [...new Set([...INVENTORY_MIS_CATEGORIES, ...initialCategories])]);
    const [refreshingStock, setRefreshingStock] = useState(false);
    const refreshInProgress = useRef(false);
    const [stockQuery, setStockQuery] = useState('');
    const [stockFilter, setStockFilter] = useState<'all' | 'low'>('all');
    const [exportMonth, setExportMonth] = useState(() => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }).slice(0, 7));
    const refreshStock = useCallback(async () => {
        if (document.visibilityState !== 'visible' || refreshInProgress.current) return;
        refreshInProgress.current = true;
        setRefreshingStock(true);
        try {
            const result = await getStoreStockSnapshot();
            if (result.success) {
                const nextLowStockIds = new Set(result.items.filter((item) => item.reorderLevel > 0 && item.currentStock <= item.reorderLevel).map((item) => item._id));
                const newlyLow = [...nextLowStockIds].some((id) => !previousLowStockIds.current.has(id));
                previousLowStockIds.current = nextLowStockIds;
                setStoreItems(result.items);
                setKitchenStocks(result.kitchenStocks);
                setMinimumStockValues((current) => {
                    const next = { ...current };
                    for (const item of result.items) if (!(item._id in next)) next[item._id] = String(item.reorderLevel);
                    return next;
                });
                // The server page creates idempotent, review-only purchase drafts.
                // Refresh once when stock first crosses a minimum so those suggestions appear without a manual reload.
                if (newlyLow) router.refresh();
            }
        } catch (error) {
            console.error('Refreshing Store stock failed:', error);
        } finally {
            refreshInProgress.current = false;
            setRefreshingStock(false);
        }
    }, [router]);
    useEffect(() => {
        setStoreItems(initialItems);
        setMinimumStockValues((current) => {
            const next = { ...current };
            for (const item of initialItems) if (!(item._id in next)) next[item._id] = String(item.reorderLevel);
            return next;
        });
    }, [initialItems]);
    useEffect(() => setKitchenStocks(initialKitchenStocks), [initialKitchenStocks]);
    useEffect(() => {
        const interval = window.setInterval(() => { void refreshStock(); }, 15_000);
        const refreshWhenVisible = () => { if (document.visibilityState === 'visible') void refreshStock(); };
        document.addEventListener('visibilitychange', refreshWhenVisible);
        const refreshOnStockChange = () => { void refreshStock(); };
        window.addEventListener('inventory-stock-changed', refreshOnStockChange);
        return () => { window.clearInterval(interval); document.removeEventListener('visibilitychange', refreshWhenVisible); window.removeEventListener('inventory-stock-changed', refreshOnStockChange); };
    }, [refreshStock]);
    useEffect(() => {
        setCategories((current) => [...new Set([...current, ...initialCategories])]);
    }, [initialCategories]);
    const itemById = useMemo(() => new Map(storeItems.map((item) => [String(item._id), item])), [storeItems]);
    const kitchenStockByLocation = useMemo(() => new Map(
        kitchenStocks.map((stock) => [`${stock.departmentId}:${stock.inventoryItemId}`, Number(stock.currentStock || 0)]),
    ), [kitchenStocks]);
    const storeInventoryValue = useMemo(() => storeItems.reduce((sum, item) => sum + item.currentStock * item.costPerUnit, 0), [storeItems]);
    const kitchenInventoryValue = useMemo(() => kitchenStocks.reduce((sum, stock) => (
        sum + Number(stock.currentStock || 0) * Number(itemById.get(String(stock.inventoryItemId))?.costPerUnit || 0)
    ), 0), [kitchenStocks, itemById]);
    const startingInventoryValue = storeInventoryValue + kitchenInventoryValue;
    const [tab, setTab] = useState<StoreSection>(initialSection);
    const [requisitionPrefill, setRequisitionPrefill] = useState<{ departmentId: string; inventoryItemId: string; nonce: number } | null>(null);
    const clearRequisitionPrefill = useCallback(() => setRequisitionPrefill(null), []);
    const [showVendorOrder, setShowVendorOrder] = useState(false);
    const [showAdditionalPurchasingTools, setShowAdditionalPurchasingTools] = useState(false);
    const [billSearch, setBillSearch] = useState('');
    const [expandedBillId, setExpandedBillId] = useState<string | null>(null);
    const [reviewFor, setReviewFor] = useState<StoreDocument | null>(null);
    const [reviewSupplier, setReviewSupplier] = useState('');
    const [reviewDate, setReviewDate] = useState(initialEntryDate);
    const [reviewLines, setReviewLines] = useState<{ inventoryItemId: string; quantity: string; unitCost: string }[]>([]);
    const [receivingFor, setReceivingFor] = useState<string | null>(null);
    const [receiveLines, setReceiveLines] = useState<Record<string, string>>({});
    const [paymentAmounts, setPaymentAmounts] = useState<Record<string, string>>({});
    const [paymentRefs, setPaymentRefs] = useState<Record<string, string>>({});
    const [editOrderFor, setEditOrderFor] = useState<StoreDocument | null>(null);
    const [editBillFor, setEditBillFor] = useState<StoreDocument | null>(null);
    const [expenseType, setExpenseType] = useState<'expense' | 'revenue' | 'capital_contribution' | 'owner_draw' | 'loan_received' | 'loan_repayment'>('expense');
    const [entry, setEntry] = useState({ category: '', amount: '', entryDate: initialEntryDate(), reference: '', note: '' });
    const [balances, setBalances] = useState({
        openingDate: initialSettings?.openingDate ? dateInputValue(initialSettings.openingDate) : initialEntryDate(),
        openingCash: String(initialSettings?.openingCash ?? 0), openingInventoryValue: String(initialSettings?.openingInventoryValue ?? startingInventoryValue),
        otherAssets: String(initialSettings?.otherAssets ?? 0), openingPayables: String(initialSettings?.openingPayables ?? 0),
        openingLoans: String(initialSettings?.openingLoans ?? 0), otherLiabilities: String(initialSettings?.otherLiabilities ?? 0),
    });
    const [saving, setSaving] = useState(false);
    const [savingThresholdFor, setSavingThresholdFor] = useState<string | null>(null);
    const lowStock = useMemo(() => storeItems.filter((item) => item.reorderLevel > 0 && item.currentStock <= item.reorderLevel), [storeItems]);
    const minimumNotSet = useMemo(() => storeItems.filter((item) => item.reorderLevel <= 0), [storeItems]);
    const visibleStoreItems = useMemo(() => [...storeItems]
        .filter((item) => `${item.name} ${item.category} ${item.supplier || ''}`.toLowerCase().includes(stockQuery.trim().toLowerCase()))
        .filter((item) => stockFilter === 'all' || (item.reorderLevel > 0 && item.currentStock <= item.reorderLevel))
        .sort((a, b) => Number(b.reorderLevel > 0 && b.currentStock <= b.reorderLevel) - Number(a.reorderLevel > 0 && a.currentStock <= a.reorderLevel) || a.name.localeCompare(b.name)),
    [storeItems, stockQuery, stockFilter]);
    const requisitions = useMemo(() => initialDocuments.filter((doc) => doc.type === 'requisition'), [initialDocuments]);
    const purchaseOrders = useMemo(() => initialDocuments.filter((doc) => doc.type === 'purchase_order'), [initialDocuments]);
    const supplierBills = useMemo(() => purchaseOrders.filter((doc) => doc.status === 'received' && (
        doc.entrySource === 'supplier_bill' || doc.reference.startsWith('BILL-') || String(doc.notes || '').toLowerCase().includes('supplier bill entry')
    )), [purchaseOrders]);
    const vendorOrders = useMemo(() => {
        const billIds = new Set(supplierBills.map((bill) => bill._id));
        return purchaseOrders.filter((doc) => !billIds.has(doc._id));
    }, [purchaseOrders, supplierBills]);
    const visibleSupplierBills = useMemo(() => {
        const query = billSearch.trim().toLowerCase();
        return [...supplierBills]
            .filter((bill) => !query || [bill.supplier, bill.reference, bill.vendorBillNumber, bill.notes, ...bill.lines.map((line) => line.itemName)]
                .some((value) => String(value || '').toLowerCase().includes(query)))
            .sort((a, b) => new Date(b.invoiceDate || b.documentDate || b.createdAt).getTime() - new Date(a.invoiceDate || a.documentDate || a.createdAt).getTime());
    }, [supplierBills, billSearch]);
    const knownSuppliers = useMemo(() => [...new Set([
        ...purchaseOrders.map((doc) => doc.supplier.trim()),
        ...storeItems.map((item) => item.supplier?.trim() || ''),
    ].filter(Boolean))].sort((a, b) => a.localeCompare(b)), [purchaseOrders, storeItems]);
    const pendingLegacyRequests = useMemo(() => requisitions.filter((doc) => doc.status === 'submitted').length, [requisitions]);
    const openOrders = useMemo(() => purchaseOrders.filter((doc) => ['ordered', 'partially_received'].includes(doc.status)).length, [purchaseOrders]);
    const reviewOrders = useMemo(() => purchaseOrders.filter((doc) => doc.status === 'review_required'), [purchaseOrders]);
    const suggestedSpend = useMemo(() => reviewOrders.reduce((sum, po) => sum + po.lines.reduce((lineSum, line) => lineSum + line.orderedQuantity * line.unitCost, 0), 0), [reviewOrders]);
    const hasUnpricedSuggestions = useMemo(() => reviewOrders.some((po) => po.lines.some((line) => line.unitCost <= 0)), [reviewOrders]);
    const menuTrackingReadyCount = initialMenuStatus.readyMenuItems;
    const menuSetupNeeded = initialMenuStatus.trackingEnabled ? Math.max(0, initialMenuStatus.activeMenuItems - menuTrackingReadyCount) : 0;
    const depletedMenuIngredients = useMemo(() => {
        if (!initialMenuStatus.trackingEnabled) return [];
        const seen = new Set<string>();
        return initialMenuStatus.mappedIngredients.flatMap((mapping) => {
            const key = `${mapping.departmentId}:${mapping.inventoryItemId}`;
            const item = itemById.get(mapping.inventoryItemId);
            const department = initialDepartments.find((entry) => entry._id === mapping.departmentId);
            if (!item || !department || seen.has(key) || Number(kitchenStockByLocation.get(key) || 0) > 0) return [];
            seen.add(key);
            return [{ departmentId: department._id, departmentName: department.name, inventoryItemId: item._id, itemName: item.name, unit: item.unit, storeAvailableStock: item.currentStock }];
        }).sort((a, b) => a.itemName.localeCompare(b.itemName));
    }, [initialMenuStatus, initialDepartments, itemById, kitchenStockByLocation]);

    function startRequisitionFor(departmentId: string, inventoryItemId: string) {
        setRequisitionPrefill({ departmentId, inventoryItemId, nonce: Date.now() });
        setTab('requisitions');
    }

    function downloadStoreExport(type: 'inventory-balance' | 'purchase-orders') {
        if (type === 'inventory-balance' && !/^\d{4}-(0[1-9]|1[0-2])$/.test(exportMonth)) {
            toast.error('Choose a month for the inventory balance export');
            return;
        }
        const query = new URLSearchParams({ type });
        if (type === 'inventory-balance') query.set('month', exportMonth);
        window.location.assign(`/api/store/export?${query.toString()}`);
    }

    function kitchenOnHand(departmentId: string, inventoryItemId: string) {
        return kitchenStockByLocation.get(`${departmentId}:${inventoryItemId}`) || 0;
    }

    function openAutoOrderReview(po: StoreDocument) {
        setReviewFor(po);
        setReviewSupplier(po.supplier || '');
        setReviewDate(dateInputValue(po.documentDate));
        setReviewLines(po.lines.map((line) => ({ inventoryItemId: line.inventoryItemId, quantity: String(line.orderedQuantity), unitCost: String(line.unitCost) })));
    }

    async function submitAutoOrderReview(event: React.FormEvent) {
        event.preventDefault();
        if (!reviewFor) return;
        setSaving(true);
        const result = await approveLowStockPurchaseOrder({
            purchaseOrderId: reviewFor._id,
            supplier: reviewSupplier,
            documentDate: reviewDate,
            lines: reviewLines.map((line) => ({ inventoryItemId: line.inventoryItemId, quantity: Number(line.quantity), unitCost: Number(line.unitCost) })),
        });
        setSaving(false);
        if (!result.success) return toast.error(result.error || 'Could not approve suggested order');
        toast.success('Vendor order saved. Send it to the supplier separately.');
        setReviewFor(null);
        router.refresh();
    }

    async function saveMinimumStock(item: StoreItem) {
        setSavingThresholdFor(item._id);
        const result = await updateMinimumStockThreshold({ inventoryItemId: item._id, minimumStock: Number(minimumStockValues[item._id]) });
        setSavingThresholdFor(null);
        if (!result.success) return toast.error(result.error || 'Could not save minimum stock');
        toast.success(`Minimum stock saved for ${item.name}`);
        router.refresh();
    }

    function startReceiving(po: StoreDocument) {
        setReceivingFor(po._id);
        setReceiveLines(Object.fromEntries(po.lines.map((line) => [line.inventoryItemId, String(Math.max(0, line.orderedQuantity - line.receivedQuantity))])));
    }

    async function submitReceipt(event: React.FormEvent, po: StoreDocument) {
        event.preventDefault();
        setSaving(true);
        const result = await receivePurchaseOrder({ purchaseOrderId: po._id, lines: po.lines.map((line) => ({ inventoryItemId: line.inventoryItemId, quantity: Number(receiveLines[line.inventoryItemId] || 0) })) });
        setSaving(false);
        if (!result.success) return toast.error(result.error || 'Could not receive goods');
        toast.success('Received quantities added to inventory');
        setReceivingFor(null);
        router.refresh();
    }

    async function submitPayment(event: React.FormEvent, po: StoreDocument) {
        event.preventDefault();
        setSaving(true);
        const result = await recordPurchasePayment({ purchaseOrderId: po._id, amount: Number(paymentAmounts[po._id]), reference: paymentRefs[po._id] });
        setSaving(false);
        if (!result.success) return toast.error(result.error || 'Could not record payment');
        toast.success('Supplier payment recorded');
        router.refresh();
    }

    async function submitEntry(event: React.FormEvent) {
        event.preventDefault();
        setSaving(true);
        const result = await createFinancialEntry({ ...entry, type: expenseType, amount: Number(entry.amount) });
        setSaving(false);
        if (!result.success) return toast.error(result.error || 'Could not save entry');
        toast.success('Entry saved');
        setEntry({ category: '', amount: '', entryDate: initialEntryDate(), reference: '', note: '' });
        router.refresh();
    }

    async function submitBalances(event: React.FormEvent) {
        event.preventDefault();
        setSaving(true);
        const result = await saveOpeningBalances({ ...balances, openingCash: Number(balances.openingCash), openingInventoryValue: Number(balances.openingInventoryValue), otherAssets: Number(balances.otherAssets), openingPayables: Number(balances.openingPayables), openingLoans: Number(balances.openingLoans), otherLiabilities: Number(balances.otherLiabilities) });
        setSaving(false);
        if (!result.success) return toast.error(result.error || 'Could not save opening balances');
        toast.success('Opening balances saved');
        router.refresh();
    }

    const tabs = [
        { id: 'overview' as const, label: 'Overview', icon: ChartBarIcon },
        { id: 'stock' as const, label: 'Live stock', icon: ArchiveBoxIcon },
        { id: 'requisitions' as const, label: 'Kitchen requests', icon: ClipboardDocumentListIcon, badge: depletedMenuIngredients.length },
        { id: 'purchasing' as const, label: 'Bill entry', icon: TruckIcon, badge: lowStock.length },
        { id: 'expenses' as const, label: 'Expenses & sales', icon: BanknotesIcon },
        { id: 'balances' as const, label: 'Opening balances', icon: BuildingStorefrontIcon },
    ];

    return <div className="space-y-6">
        <header className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
            <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-sky-600">Inventory operations</p><h1 className="mt-1 text-3xl font-bold tracking-tight text-slate-950">Store</h1><p className="mt-1 max-w-2xl text-sm text-slate-500">One workspace for stock, kitchen issues, vendor purchasing, and financial records.</p></div>
            <div className="flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-3 sm:flex-row sm:items-end">
                <label className="text-[11px] font-semibold text-slate-600">Balance month<input aria-label="Month for inventory balance export" type="month" value={exportMonth} onChange={(event) => setExportMonth(event.target.value)} className="mt-1 min-h-10 w-full rounded-lg border border-slate-200 px-2 text-sm text-slate-800 sm:w-40" /></label>
                <button type="button" onClick={() => downloadStoreExport('inventory-balance')} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl bg-slate-900 px-3 text-xs font-bold text-white hover:bg-slate-800"><ArrowDownTrayIcon className="h-4 w-4" />Monthly balance</button>
                <button type="button" onClick={() => downloadStoreExport('purchase-orders')} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 text-xs font-bold text-slate-700 hover:bg-slate-50"><ArrowDownTrayIcon className="h-4 w-4" />All purchase orders</button>
            </div>
        </header>

        <nav className="flex gap-1 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm" aria-label="Store management">
            {tabs.map(({ id, label, icon: Icon, badge }) => <button key={id} onClick={() => setTab(id)} aria-current={tab === id ? 'page' : undefined} className={`inline-flex min-h-11 shrink-0 items-center gap-2 rounded-xl px-3 text-xs font-bold transition-colors sm:px-4 sm:text-sm ${tab === id ? 'bg-slate-950 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}><Icon className="h-4 w-4" />{label}{badge ? <span className={`rounded-full px-2 py-0.5 text-[10px] ${tab === id ? 'bg-white/15 text-white' : 'bg-amber-100 text-amber-800'}`}>{badge}</span> : null}</button>)}
        </nav>

        {!initialMenuStatus.trackingEnabled && initialMenuStatus.activeMenuItems > 0 && <section className="flex flex-col gap-3 rounded-2xl border border-rose-200 bg-rose-50 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex gap-3"><ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" /><div><h2 className="font-bold text-rose-950">Menu stock deduction is turned off</h2><p className="mt-1 text-sm text-rose-800">Orders will not reduce kitchen stock until inventory tracking is enabled in the restaurant settings.</p></div></div><a href="/dashboard/menu" className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-xl bg-rose-700 px-4 text-sm font-bold text-white hover:bg-rose-800">Review menu setup</a></section>}

        {lowStock.length > 0 && <section className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex gap-3"><ExclamationTriangleIcon className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" /><div><h2 className="font-bold text-amber-950">{lowStock.length} Store {lowStock.length === 1 ? 'item is' : 'items are'} at or below minimum stock</h2><p className="mt-1 text-sm text-amber-900">{reviewOrders.length ? `${reviewOrders.length} vendor suggestion${reviewOrders.length === 1 ? '' : 's'} ready for human review.` : 'Record the supplier bill when you receive the replenishment. Goods are added to Store stock after you save it.'} Orders are never sent automatically.</p></div></div><button type="button" onClick={() => { setTab('purchasing'); setShowAdditionalPurchasingTools(reviewOrders.length > 0); }} className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl border border-amber-300 bg-white px-4 text-sm font-bold text-amber-950 hover:bg-amber-100"><ShoppingCartIcon className="h-4 w-4" />{reviewOrders.length ? 'Review suggestions' : 'Record a bill'}</button></section>}

        {tab === 'overview' && <div className="space-y-5">
            <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                {[
                    { label: 'Store stock value', value: money(storeInventoryValue), detail: `${storeItems.length} active inventory items`, icon: BuildingStorefrontIcon, tone: 'sky' },
                    { label: 'Kitchen stock value', value: money(kitchenInventoryValue), detail: `Across ${initialDepartments.length} kitchen departments`, icon: ArchiveBoxIcon, tone: 'emerald' },
                    { label: 'Below minimum', value: String(lowStock.length), detail: lowStock.length ? 'Needs a vendor order review' : 'Store levels are healthy', icon: ExclamationTriangleIcon, tone: lowStock.length ? 'amber' : 'slate' },
                    { label: 'Orders to follow up', value: String(reviewOrders.length + openOrders), detail: `${reviewOrders.length} to review · ${openOrders} awaiting delivery`, icon: TruckIcon, tone: 'violet' },
                    { label: 'Minimums not set', value: String(minimumNotSet.length), detail: 'Set levels to get low-stock alerts', icon: ExclamationTriangleIcon, tone: minimumNotSet.length ? 'amber' : 'slate' },
                ].map(({ label, value, detail, icon: Icon, tone }) => <article key={label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-semibold text-slate-500">{label}</p><p className="mt-2 text-2xl font-bold tracking-tight text-slate-950">{value}</p><p className="mt-1 text-xs text-slate-500">{detail}</p></div><span className={`rounded-xl p-2 ${tone === 'amber' ? 'bg-amber-100 text-amber-800' : tone === 'emerald' ? 'bg-emerald-100 text-emerald-800' : tone === 'violet' ? 'bg-violet-100 text-violet-800' : tone === 'sky' ? 'bg-sky-100 text-sky-800' : 'bg-slate-100 text-slate-600'}`}><Icon className="h-5 w-5" /></span></div></article>)}
            </section>

            {minimumNotSet.length > 0 && <section className="flex flex-col gap-3 rounded-2xl border border-sky-200 bg-sky-50 p-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-bold text-sky-950">Set Store minimums</h2><p className="mt-1 text-sm text-sky-900">{minimumNotSet.length} stock {minimumNotSet.length === 1 ? 'item has' : 'items have'} no minimum level, so it cannot trigger a replenishment alert.</p></div><button type="button" onClick={() => setTab('stock')} className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-xl bg-sky-700 px-4 text-sm font-bold text-white hover:bg-sky-800">Set stock levels</button></section>}

            <div className="grid gap-4 xl:grid-cols-2">
                <section className="rounded-2xl border border-amber-200 bg-white shadow-sm">
                    <div className="flex items-start justify-between gap-3 border-b border-amber-100 bg-amber-50/70 p-4"><div><h2 className="font-bold text-slate-950">Store replenishment</h2><p className="mt-1 text-xs text-slate-600">Items at or below the minimum balance</p></div><span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-bold text-amber-900">{lowStock.length} items</span></div>
                    {lowStock.length ? <div className="divide-y divide-slate-100">{lowStock.slice(0, 6).map((item) => <div key={item._id} className="flex items-center justify-between gap-3 px-4 py-3"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{item.name}</p><p className="mt-0.5 text-xs text-slate-500">{item.supplier || 'Supplier not set'} · Minimum {quantity(item.reorderLevel)} {item.unit}</p></div><p className="shrink-0 text-sm font-bold text-amber-800">{quantity(item.currentStock)} {item.unit}</p></div>)}</div> : <p className="p-5 text-sm text-slate-500">No Store items are below their minimum balance.</p>}
                    <div className="border-t border-slate-100 p-3"><button type="button" onClick={() => { setTab('stock'); setStockFilter('low'); }} className="text-sm font-bold text-sky-700 hover:text-sky-900">Review stock levels →</button>{lowStock.length > 6 && <span className="ml-2 text-xs text-slate-500">Showing 6 of {lowStock.length}</span>}</div>
                </section>

                <section className="rounded-2xl border border-rose-200 bg-white shadow-sm">
                    <div className="flex items-start justify-between gap-3 border-b border-rose-100 bg-rose-50/70 p-4"><div><h2 className="font-bold text-slate-950">Kitchen items to restock</h2><p className="mt-1 text-xs text-slate-600">Menu-linked ingredients currently at zero in their kitchen department</p></div><span className="rounded-full bg-rose-100 px-2.5 py-1 text-xs font-bold text-rose-900">{depletedMenuIngredients.length} items</span></div>
                    {depletedMenuIngredients.length ? <div className="divide-y divide-slate-100">{depletedMenuIngredients.slice(0, 6).map((row) => <div key={`${row.departmentId}:${row.inventoryItemId}`} className="flex items-center justify-between gap-3 px-4 py-3"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{row.itemName}</p><p className="mt-0.5 text-xs text-slate-500">{row.departmentName} · Store has {quantity(row.storeAvailableStock)} {row.unit}</p></div><button type="button" onClick={() => row.storeAvailableStock > 0 ? startRequisitionFor(row.departmentId, row.inventoryItemId) : setTab('purchasing')} className={`min-h-9 shrink-0 rounded-lg px-3 text-xs font-bold ${row.storeAvailableStock > 0 ? 'bg-violet-700 text-white hover:bg-violet-800' : 'border border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'}`}>{row.storeAvailableStock > 0 ? 'Request stock' : 'Purchase stock'}</button></div>)}</div> : <p className="p-5 text-sm text-slate-500">No mapped menu ingredients are out of stock in the kitchen.</p>}
                    {depletedMenuIngredients.length > 6 && <div className="border-t border-slate-100 p-3"><button type="button" onClick={() => setTab('requisitions')} className="text-sm font-bold text-violet-700">See all kitchen stock and requests →</button><span className="ml-2 text-xs text-slate-500">Showing 6 of {depletedMenuIngredients.length}</span></div>}
                </section>
            </div>

            {menuSetupNeeded > 0 && <section className="flex flex-col gap-3 rounded-2xl border border-sky-200 bg-sky-50 p-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-bold text-sky-950">Finish menu stock mapping</h2><p className="mt-1 text-sm text-sky-900">{menuTrackingReadyCount} of {initialMenuStatus.activeMenuItems} available menu items have a complete recipe and kitchen department. Unmapped items will not deduct kitchen stock.</p></div><a href="/dashboard/menu" className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-xl bg-sky-700 px-4 text-sm font-bold text-white hover:bg-sky-800">Map ingredients</a></section>}

            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-bold text-slate-950">Daily operations</h2><p className="mt-1 text-xs text-slate-500">Pick up where you need to work</p></div></div><div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><button type="button" onClick={() => setTab('requisitions')} className="flex min-h-20 items-center gap-3 rounded-xl border border-slate-200 p-3 text-left hover:border-violet-300 hover:bg-violet-50"><ClipboardDocumentListIcon className="h-5 w-5 shrink-0 text-violet-700" /><span><b className="block text-sm text-slate-900">Issue kitchen stock</b><small className="text-xs text-slate-500">Create or edit a department requisition</small></span></button><button type="button" onClick={() => setTab('purchasing')} className="flex min-h-20 items-center gap-3 rounded-xl border border-slate-200 p-3 text-left hover:border-sky-300 hover:bg-sky-50"><TruckIcon className="h-5 w-5 shrink-0 text-sky-700" /><span><b className="block text-sm text-slate-900">Buy from vendors</b><small className="text-xs text-slate-500">Create orders, receive goods, record bills</small></span></button><button type="button" onClick={() => setTab('stock')} className="flex min-h-20 items-center gap-3 rounded-xl border border-slate-200 p-3 text-left hover:border-emerald-300 hover:bg-emerald-50"><ArchiveBoxIcon className="h-5 w-5 shrink-0 text-emerald-700" /><span><b className="block text-sm text-slate-900">View live stock</b><small className="text-xs text-slate-500">Compare Store and kitchen balances</small></span></button><button type="button" onClick={() => setTab('expenses')} className="flex min-h-20 items-center gap-3 rounded-xl border border-slate-200 p-3 text-left hover:border-amber-300 hover:bg-amber-50"><BanknotesIcon className="h-5 w-5 shrink-0 text-amber-700" /><span><b className="block text-sm text-slate-900">Expenses & sales</b><small className="text-xs text-slate-500">Record financial entries</small></span></button></div></section>
        </div>}

        {lowStock.length > 0 && tab === 'stock' && <div className="-mt-1 flex justify-end"><button type="button" onClick={() => setTab('purchasing')} className="text-sm font-bold text-amber-800 hover:text-amber-950">Review {reviewOrders.length} vendor suggestion{reviewOrders.length === 1 ? '' : 's'} →</button></div>}

        {tab === 'stock' && <div className="space-y-5">
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                    <div><div className="flex flex-wrap items-center gap-2"><h2 className="text-lg font-bold text-slate-900">Live stock by location</h2><span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700">Auto refresh · 15 sec</span></div><p className="mt-1 text-xs text-slate-500">See Store and kitchen quantities. Scroll within the list for more items; swipe sideways for all columns.</p></div>
                    <button type="button" onClick={() => void refreshStock()} disabled={refreshingStock} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50"><ArrowPathIcon className={`h-4 w-4 ${refreshingStock ? 'animate-spin' : ''}`} />{refreshingStock ? 'Refreshing…' : 'Refresh stock'}</button>
                </div>
                <div className="flex flex-col gap-3 border-b border-slate-100 bg-slate-50/70 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <input aria-label="Search stock" value={stockQuery} onChange={(event) => setStockQuery(event.target.value)} placeholder="Search stock items" className={`${inputClass} max-w-md`} />
                    <div className="flex shrink-0 gap-2"><button type="button" onClick={() => setStockFilter('all')} className={`min-h-10 rounded-lg px-3 text-xs font-bold ${stockFilter === 'all' ? 'bg-slate-900 text-white' : 'border border-slate-200 bg-white text-slate-600'}`}>All items ({storeItems.length})</button><button type="button" onClick={() => setStockFilter('low')} className={`min-h-10 rounded-lg px-3 text-xs font-bold ${stockFilter === 'low' ? 'bg-amber-600 text-white' : 'border border-slate-200 bg-white text-amber-800'}`}>At / below minimum ({lowStock.length})</button></div>
                </div>
                <div role="region" aria-label="Live stock by location" tabIndex={0} className="max-h-[28rem] overflow-auto overscroll-contain focus:outline-none focus:ring-2 focus:ring-inset focus:ring-emerald-300">
                    <table className="w-full min-w-[980px] text-left text-xs">
                        <thead className="sticky top-0 z-10 bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500 shadow-sm"><tr><th className="px-4 py-3">Stock item</th><th className="px-3 py-3">Store</th><th className="px-3 py-3">Kitchen total</th><th className="px-4 py-3">By department</th><th className="px-4 py-3">Minimum in Store</th></tr></thead>
                        <tbody className="divide-y divide-slate-100">{visibleStoreItems.map((item) => {
                            const kitchenTotal = initialDepartments.reduce((sum, department) => sum + kitchenOnHand(department._id, item._id), 0);
                            const departmentStocks = initialDepartments.map((department) => ({ department, amount: kitchenOnHand(department._id, item._id) })).filter(({ amount }) => amount > 0);
                            const isLow = item.reorderLevel > 0 && item.currentStock <= item.reorderLevel;
                            return <tr key={item._id} className="align-top">
                                <td className="max-w-56 whitespace-normal break-words px-4 py-3"><div className="flex flex-wrap items-center gap-1.5"><span className="font-semibold text-slate-800">{item.name}</span>{isLow && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">Low</span>}</div></td>
                                <td className={`whitespace-nowrap px-3 py-3 font-bold ${isLow ? 'text-amber-700' : 'text-slate-800'}`}>{quantity(item.currentStock)} {item.unit}</td>
                                <td className="whitespace-nowrap px-3 py-3 font-bold text-emerald-800">{quantity(kitchenTotal)} {item.unit}</td>
                                <td className="min-w-64 whitespace-normal px-4 py-3 text-slate-600">{departmentStocks.length ? <div className="flex flex-wrap gap-1.5">{departmentStocks.map(({ department, amount }) => <span key={department._id} className="max-w-full break-words rounded-lg bg-emerald-50 px-2 py-1 text-[11px] text-emerald-900"><span className="font-semibold">{department.name}</span>: {quantity(amount)} {item.unit}</span>)}</div> : <span className="text-slate-400">No stock issued</span>}</td>
                                <td className="px-4 py-3"><label className="sr-only" htmlFor={`min-stock-${item._id}`}>Minimum Store stock for {item.name}</label><div className="flex items-center gap-2"><input id={`min-stock-${item._id}`} type="number" min="0" step="0.0001" value={minimumStockValues[item._id] ?? String(item.reorderLevel)} onChange={(event) => setMinimumStockValues({ ...minimumStockValues, [item._id]: event.target.value })} className="h-9 w-24 rounded-lg border border-slate-200 px-2 text-sm text-slate-800" /><span className="text-[10px] text-slate-500">{item.unit}</span><button disabled={savingThresholdFor === item._id || Number(minimumStockValues[item._id]) === item.reorderLevel} onClick={() => void saveMinimumStock(item)} className="min-h-9 rounded-lg border border-slate-200 px-3 text-[10px] font-bold text-slate-700 disabled:cursor-default disabled:opacity-45">{savingThresholdFor === item._id ? 'Saving…' : 'Save'}</button></div></td>
                            </tr>;
                        })}{!visibleStoreItems.length && <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">{storeItems.length ? 'No stock items match this search.' : 'No stock items yet. Add ingredients from Menu or record a supplier bill.'}</td></tr>}</tbody>
                    </table>
                </div>
            </section>
        </div>}

        {tab === 'requisitions' && <div className="space-y-5">
            <div className="rounded-2xl border border-violet-100 bg-violet-50/70 p-4"><p className="text-xs font-bold uppercase tracking-[0.14em] text-violet-700">Kitchen supply</p><h2 className="mt-1 text-lg font-bold text-slate-950">Issue Store stock to a kitchen department</h2><p className="mt-1 max-w-3xl text-sm text-slate-600">Choose the department and quantities. Submitting a requisition moves stock immediately, records the issue, and updates both balances. Menu orders then consume the department’s kitchen stock.</p></div>
            <KitchenInventoryWorkflow
                items={storeItems.map(({ _id, name, unit, currentStock }) => ({ _id, name, unit, storeAvailableStock: currentStock }))}
                departments={initialDepartments}
                stocks={kitchenStocks}
                lowIngredients={depletedMenuIngredients}
                prefill={requisitionPrefill}
                onPrefillHandled={clearRequisitionPrefill}
                onOpenPurchasing={() => setTab('purchasing')}
                requests={requisitions.map((request) => ({ _id: request._id, reference: request.reference, status: request.status, departmentId: request.departmentId, documentDate: request.documentDate, createdAt: request.createdAt, notes: request.notes, lines: request.lines.map((line) => ({ inventoryItemId: line.inventoryItemId, itemName: line.itemName, unit: line.unit, requestedQuantity: line.requestedQuantity, orderedQuantity: line.orderedQuantity, approvedQuantity: line.approvedQuantity })) }))}
            />
        </div>}

        {tab === 'purchasing' && <div className="space-y-5">
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="max-w-2xl">
                        <p className="text-xs font-bold uppercase tracking-[0.16em] text-sky-700">Supplier purchasing</p>
                        <h2 className="mt-1 text-xl font-bold tracking-tight text-slate-950">Bill entry</h2>
                        <p className="mt-1 text-sm leading-6 text-slate-600">Enter or scan the supplier bill for goods received. Review the items, then save once to record the bill and add the received quantities to Store stock.</p>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center text-[11px] font-semibold text-slate-600 lg:min-w-[26rem]">
                        <div className="rounded-xl bg-slate-50 px-2 py-3"><span className="mx-auto mb-1 flex h-6 w-6 items-center justify-center rounded-full bg-sky-100 text-xs font-bold text-sky-800">1</span>Enter bill</div>
                        <div className="rounded-xl bg-slate-50 px-2 py-3"><span className="mx-auto mb-1 flex h-6 w-6 items-center justify-center rounded-full bg-sky-100 text-xs font-bold text-sky-800">2</span>Review items</div>
                        <div className="rounded-xl bg-slate-50 px-2 py-3"><span className="mx-auto mb-1 flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-800">3</span>Add to Store</div>
                    </div>
                </div>
            </section>

            <InventoryBillScanner items={storeItems.map(({ _id, name, category, unit, currentStock, costPerUnit }) => ({ _id, name, category, unit, currentStock, costPerUnit }))} suppliers={knownSuppliers} categories={categories} />

            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                    <div>
                        <div className="flex flex-wrap items-center gap-2"><h2 className="font-bold text-slate-950">Supplier bill history</h2><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">{supplierBills.length}</span></div>
                        <p className="mt-1 text-xs text-slate-500">Open a bill to review its item lines or payment details. Use Edit bill to correct items, amounts, or invoice date.</p>
                    </div>
                    {supplierBills.length > 0 && <label className="block w-full sm:max-w-xs"><span className="sr-only">Search supplier bills</span><input value={billSearch} onChange={(event) => setBillSearch(event.target.value)} placeholder="Search supplier, bill number, or item" className="min-h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100" /></label>}
                </div>
                {!supplierBills.length
                    ? <div className="px-5 py-10 text-center"><p className="font-semibold text-slate-800">No supplier bills yet</p><p className="mt-1 text-sm text-slate-500">Choose Add bill above to enter or scan your first invoice.</p></div>
                    : !visibleSupplierBills.length
                        ? <p className="p-8 text-center text-sm text-slate-500">No bills match “{billSearch}”. Try another supplier, bill number, or item.</p>
                        : <div className="divide-y divide-slate-100">{visibleSupplierBills.map((bill) => {
                            const billTotal = bill.lines.reduce((sum, line) => sum + Number(line.receivedQuantity || 0) * Number(line.unitCost || 0), 0);
                            const paidValue = bill.payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
                            const due = Math.max(0, billTotal - paidValue);
                            const isExpanded = expandedBillId === bill._id;
                            const paymentStatus = due <= 0 ? 'Paid' : paidValue > 0 ? 'Part paid' : 'Payment due';
                            return <article key={bill._id} className="p-4 sm:px-5">
                                <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto_auto] lg:items-center">
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-center gap-2"><h3 className="truncate font-bold text-slate-900">{bill.supplier}</h3><span className={due <= 0 ? 'rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-emerald-700' : 'rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-amber-800'}>{paymentStatus}</span></div>
                                        <p className="mt-1 text-xs text-slate-500">Invoice {bill.vendorBillNumber || '—'} <span className="mx-1 text-slate-300">·</span> {dateLabel(bill.invoiceDate || bill.documentDate || bill.createdAt)} <span className="mx-1 text-slate-300">·</span> {bill.lines.length} {bill.lines.length === 1 ? 'item' : 'items'} <span className="mx-1 text-slate-300">·</span> {bill.reference}</p>
                                    </div>
                                    <div className="flex items-center gap-5 lg:justify-end">
                                        <div><p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Bill total</p><p className="mt-0.5 text-sm font-bold text-slate-900">{money(billTotal)}</p></div>
                                        <div><p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Due</p><p className="mt-0.5 text-sm font-bold text-slate-700">{money(due)}</p></div>
                                    </div>
                                    <div className="flex flex-wrap gap-2 lg:justify-end">
                                        <button type="button" onClick={() => setEditBillFor(bill)} className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-700 hover:border-sky-200 hover:bg-sky-50 hover:text-sky-800"><PencilSquareIcon className="h-4 w-4" /> Edit bill</button>
                                        <button type="button" aria-expanded={isExpanded} onClick={() => setExpandedBillId(isExpanded ? null : bill._id)} className="min-h-9 rounded-lg bg-slate-100 px-3 text-xs font-bold text-slate-700 hover:bg-slate-200">{isExpanded ? 'Hide details' : 'View details'}</button>
                                    </div>
                                </div>
                                {isExpanded && <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-3 sm:p-4">
                                    <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{bill.lines.map((line, index) => <div key={bill._id + ':' + line.inventoryItemId + ':' + index} className="flex items-center justify-between gap-3 rounded-lg bg-white px-3 py-2.5"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-800">{line.itemName}</p><p className="mt-0.5 text-xs text-slate-500">{line.category || 'Other'} · {quantity(line.receivedQuantity)} {line.unit} × {money(line.unitCost)}</p></div><p className="shrink-0 text-xs font-bold text-slate-700">{money(Number(line.receivedQuantity || 0) * Number(line.unitCost || 0))}</p></div>)}</div>
                                    {bill.notes && <p className="mt-3 text-xs text-slate-500">{bill.notes}</p>}
                                    {due > 0 && billTotal > 0 && <form onSubmit={(event) => submitPayment(event, bill)} className="mt-4 grid gap-2 border-t border-slate-200 pt-4 sm:grid-cols-[1fr_1fr_auto] sm:items-end"><label className="text-xs font-semibold text-slate-600">Record payment<input required type="number" min="0.01" max={due} step="0.01" value={paymentAmounts[bill._id] || ''} onChange={(event) => setPaymentAmounts({ ...paymentAmounts, [bill._id]: event.target.value })} placeholder={'Balance ' + money(due)} className={'mt-1 ' + inputClass} /></label><label className="text-xs font-semibold text-slate-600">Payment reference<input value={paymentRefs[bill._id] || ''} onChange={(event) => setPaymentRefs({ ...paymentRefs, [bill._id]: event.target.value })} placeholder="Optional" className={'mt-1 ' + inputClass} /></label><button disabled={saving} className="min-h-10 rounded-xl bg-slate-900 px-4 text-xs font-bold text-white disabled:opacity-50">Record payment</button></form>}
                                </div>}
                            </article>;
                        })}</div>}
            </section>

            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5">
                    <div><h2 className="font-bold text-slate-900">Additional purchasing tools</h2><p className="mt-1 text-xs leading-5 text-slate-500">Optional order planning for teams that track vendor orders before delivery. Bill entry above remains the fastest way to add received goods to Store.</p></div>
                    <div className="flex items-center gap-2">
                        <span className="hidden rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-600 sm:inline-flex">{reviewOrders.length} suggestions · {openOrders} open</span>
                        <button type="button" aria-expanded={showAdditionalPurchasingTools} onClick={() => setShowAdditionalPurchasingTools((current) => !current)} className="min-h-10 shrink-0 rounded-xl border border-slate-200 px-3 text-xs font-bold text-slate-700 hover:bg-slate-50">{showAdditionalPurchasingTools ? 'Hide tools' : 'Show tools'}</button>
                    </div>
                </div>
                {showAdditionalPurchasingTools && <div className="space-y-4 border-t border-slate-100 bg-slate-50/50 p-3 sm:p-4">
                    <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:flex-row sm:items-center sm:justify-between"><div><h3 className="text-sm font-bold text-slate-900">Planned vendor orders</h3><p className="mt-1 text-xs text-slate-500">Orders here do not change stock until goods are received. Use bill entry when you want to post the actual invoice directly.</p></div><button disabled={!storeItems.length} onClick={() => { setEditOrderFor(null); setShowVendorOrder(true); }} className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 text-xs font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-45"><TruckIcon className="h-4 w-4" /> Create planned order</button></div>
                    {reviewOrders.length > 0 && <section className="rounded-2xl border border-amber-200 bg-white shadow-sm">
                <div className="border-b border-amber-100 bg-amber-50 p-4 sm:p-5"><h2 className="font-bold text-amber-950">Low-stock suggestions to review ({reviewOrders.length})</h2><p className="mt-1 text-xs text-amber-800">Check the quantity, supplier and price. Approval saves an order record; send it to the supplier separately.</p></div>
                <div className="divide-y divide-slate-100">{reviewOrders.map((po) => <article key={po._id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-bold text-slate-900">{po.lines.map((line) => line.itemName).join(', ')}</h3><span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-bold uppercase text-amber-800">Review required</span></div><div className="mt-2 space-y-1">{po.lines.map((line) => { const item = itemById.get(String(line.inventoryItemId)); return <p key={line.inventoryItemId} className="text-sm text-slate-600">Suggested {quantity(line.orderedQuantity)} {line.unit} · {line.unitCost > 0 ? `estimated ${money(line.orderedQuantity * line.unitCost)}` : 'price needed'}{item ? ` · Store has ${quantity(item.currentStock)} / minimum ${quantity(item.reorderLevel)} ${item.unit}` : ''}</p>; })}</div><p className="mt-1 text-xs text-slate-500">Supplier: {po.supplier || 'Choose during review'}{po.notes ? ` · ${po.notes}` : ''}</p></div><button onClick={() => openAutoOrderReview(po)} className="min-h-10 shrink-0 rounded-xl bg-amber-600 px-4 text-sm font-bold text-white hover:bg-amber-700">Review suggestion</button></article>)}</div>
            </section>}
                    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                <div className="border-b border-slate-100 p-4 sm:p-5"><div className="flex flex-wrap items-center justify-between gap-2"><div><h2 className="font-bold text-slate-900">Vendor orders</h2><p className="mt-1 text-xs text-slate-500">Planned supplier orders stay separate from actual bills. Receive goods here only when an order was entered in advance.</p></div><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">{vendorOrders.filter((po) => po.status !== 'review_required').length} orders</span></div></div>
                {!vendorOrders.some((po) => po.status !== 'review_required') ? <p className="p-8 text-center text-sm text-slate-500">No planned vendor orders. You can enter the actual bill directly when goods arrive.</p> : <div className="divide-y divide-slate-100">{vendorOrders.filter((po) => po.status !== 'review_required').map((po) => {
                    const receivedValue = po.lines.reduce((sum, line) => sum + line.receivedQuantity * line.unitCost, 0);
                    const paidValue = po.payments.reduce((sum, payment) => sum + payment.amount, 0);
                    const due = Math.max(0, receivedValue - paidValue);
                    const orderedValue = po.lines.reduce((sum, line) => sum + line.orderedQuantity * line.unitCost, 0);
                    return <article key={po._id} className="p-4 sm:p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><TruckIcon className="h-4 w-4 text-sky-600" /><h3 className="font-bold text-slate-900">{po.reference}</h3><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${po.status === 'received' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-50 text-blue-700'}`}>{po.status.replace('_', ' ')}</span></div><p className="mt-1 text-sm text-slate-600">{po.supplier} · Order date {dateLabel(po.documentDate || po.createdAt)}</p><ul className="mt-3 grid gap-1 text-sm text-slate-600 sm:grid-cols-2">{po.lines.map((line, index) => <li key={`${line.inventoryItemId}-${index}`}>{line.itemName} · {quantity(line.receivedQuantity)}/{quantity(line.orderedQuantity)} {line.unit} · {money(line.unitCost)}/{line.unit}</li>)}</ul><p className="mt-3 text-xs text-slate-500">Ordered {money(orderedValue)} · Received {money(receivedValue)} · Due {money(due)}</p></div><div className="flex shrink-0 flex-wrap gap-2">{po.status === 'ordered' && po.lines.every((line) => Number(line.receivedQuantity) === 0) && <button type="button" onClick={() => setEditOrderFor(po)} className="min-h-10 rounded-xl border border-slate-200 px-3 text-sm font-bold text-slate-700 hover:bg-slate-50">Edit order</button>}{['ordered', 'partially_received'].includes(po.status) && <button onClick={() => startReceiving(po)} className="min-h-10 rounded-xl bg-sky-600 px-4 text-sm font-bold text-white hover:bg-sky-700">Receive goods</button>}</div></div>
                        {receivingFor === po._id && <form onSubmit={(event) => submitReceipt(event, po)} className="mt-4 rounded-xl border border-sky-100 bg-sky-50/70 p-3 sm:p-4"><h4 className="text-sm font-bold text-slate-800">Confirm delivered quantities</h4><p className="mt-1 text-xs text-slate-500">Only received quantities will be added to stock. Enter zero for items not delivered.</p><div className="mt-3 space-y-2">{po.lines.filter((line) => line.orderedQuantity > line.receivedQuantity).map((line) => <label key={line.inventoryItemId} className="grid grid-cols-[1fr_6.5rem] items-center gap-3 text-sm"><span className="min-w-0 truncate text-slate-700">{line.itemName}<small className="block text-xs text-slate-400">{line.orderedQuantity - line.receivedQuantity} {line.unit} remaining</small></span><input type="number" min="0" max={line.orderedQuantity - line.receivedQuantity} step="0.0001" value={receiveLines[line.inventoryItemId] ?? ''} onChange={(event) => setReceiveLines({ ...receiveLines, [line.inventoryItemId]: event.target.value })} className={inputClass} /></label>)}</div><div className="mt-3 flex justify-end gap-2"><button type="button" onClick={() => setReceivingFor(null)} className="min-h-10 rounded-lg px-3 text-sm font-semibold text-slate-600">Cancel</button><button disabled={saving} className="min-h-10 rounded-lg bg-sky-600 px-4 text-sm font-bold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Add received stock'}</button></div></form>}
                        {due > 0 && receivedValue > 0 && <form onSubmit={(event) => submitPayment(event, po)} className="mt-3 grid gap-2 rounded-xl border border-slate-100 bg-slate-50 p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"><label className="text-xs font-semibold text-slate-600">Payment amount<input required type="number" min="0.01" max={due} step="0.01" value={paymentAmounts[po._id] || ''} onChange={(event) => setPaymentAmounts({ ...paymentAmounts, [po._id]: event.target.value })} placeholder={`Balance ${money(due)}`} className={`mt-1 ${inputClass}`} /></label><label className="text-xs font-semibold text-slate-600">Payment reference<input value={paymentRefs[po._id] || ''} onChange={(event) => setPaymentRefs({ ...paymentRefs, [po._id]: event.target.value })} placeholder="Optional" className={`mt-1 ${inputClass}`} /></label><button disabled={saving} className="min-h-11 rounded-xl bg-slate-900 px-4 text-sm font-bold text-white disabled:opacity-50">Record payment</button></form>}
                    </article>;
                })}</div>}
            </section>
                </div>}
            </section>
        </div>}


        {tab === 'expenses' && <div className="grid gap-5 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
            <form onSubmit={submitEntry} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                <div><h2 className="font-bold text-slate-900">Record a financial entry</h2><p className="mt-1 text-xs text-slate-500">Add expenses, sales outside the app, or owner and loan cash movements.</p></div>
                <label className="block text-xs font-semibold text-slate-600">Entry type<select value={expenseType} onChange={(event) => {
                    const nextType = event.target.value as typeof expenseType;
                    setExpenseType(nextType);
                    setEntry({ ...entry, category: '' });
                }} className={`mt-1 ${inputClass}`}>
                    <option value="expense">Operating expense</option><option value="revenue">External sale (Party / Zomato)</option>
                    <option value="capital_contribution">Owner capital added</option><option value="owner_draw">Owner withdrawal</option>
                    <option value="loan_received">Loan received</option><option value="loan_repayment">Loan repayment</option>
                </select></label>
                <label className="block text-xs font-semibold text-slate-600">{expenseType === 'revenue' ? 'Sales channel' : expenseType === 'expense' ? 'MIS category' : 'Category'}
                    {expenseType === 'revenue' ? <select required value={entry.category} onChange={(event) => setEntry({ ...entry, category: event.target.value })} className={`mt-1 ${inputClass}`}><option value="">Choose channel</option>{MIS_EXTERNAL_SALES_CHANNELS.map((channel) => <option key={channel}>{channel}</option>)}</select>
                        : expenseType === 'expense' ? <select required value={entry.category} onChange={(event) => setEntry({ ...entry, category: event.target.value })} className={`mt-1 ${inputClass}`}><option value="">Choose category</option>{MIS_EXPENSE_CATEGORIES.map((category) => <option key={category}>{category}</option>)}</select>
                            : <input required value={entry.category} onChange={(event) => setEntry({ ...entry, category: event.target.value })} placeholder="General" className={`mt-1 ${inputClass}`} />}
                </label>
                <div className="grid grid-cols-2 gap-3"><label className="text-xs font-semibold text-slate-600">Amount (₹)<input required type="number" min="0.01" step="0.01" value={entry.amount} onChange={(event) => setEntry({ ...entry, amount: event.target.value })} className={`mt-1 ${inputClass}`} /></label><label className="text-xs font-semibold text-slate-600">Date<input required type="date" value={entry.entryDate} onChange={(event) => setEntry({ ...entry, entryDate: event.target.value })} className={`mt-1 ${inputClass}`} /></label></div>
                <label className="block text-xs font-semibold text-slate-600">Reference / note<input value={entry.reference} onChange={(event) => setEntry({ ...entry, reference: event.target.value })} placeholder="Invoice or payment reference" className={`mt-1 ${inputClass}`} /></label>
                <p className="text-[11px] leading-4 text-slate-500">Restaurant sales come from served orders. Enter Party and Zomato sales here. Record supplier bills through bill entry only, so they are not counted twice.</p>
                <button disabled={saving} className="min-h-11 w-full rounded-xl bg-sky-600 px-4 text-sm font-bold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save entry'}</button>
            </form>
            <section className="rounded-2xl border border-slate-200 bg-white"><div className="border-b border-slate-100 p-4 sm:p-5"><h2 className="font-bold text-slate-900">Recent entries</h2><p className="mt-1 text-xs text-slate-500">Newest expenses and cash movements</p></div>{!initialEntries.length ? <p className="p-8 text-center text-sm text-slate-400">No financial entries recorded yet.</p> : <div className="divide-y divide-slate-100">{initialEntries.map((row) => <div key={row._id} className="flex items-center justify-between gap-3 p-4"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-800">{row.category}</p><p className="mt-0.5 text-xs text-slate-400">{row.type.replaceAll('_', ' ')} · {dateLabel(row.entryDate)}{row.reference ? ` · ${row.reference}` : ''}</p></div><span className="shrink-0 text-sm font-bold text-slate-800">{money(row.amount)}</span></div>)}</div>}</section>
        </div>}

        {tab === 'balances' && <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6"><div className="max-w-3xl"><p className="text-xs font-bold uppercase tracking-[0.16em] text-sky-600">One-time setup</p><h2 className="mt-1 text-lg font-bold text-slate-900">Opening balances for your management balance sheet</h2><p className="mt-2 text-sm leading-6 text-slate-600">Enter your balances on the date you begin using this tracker. The report uses these as its starting point, then adds recorded sales, received purchases, expenses and cash entries. You can update these numbers if you need to correct your starting position.</p></div><form onSubmit={submitBalances} className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[
            ['openingCash', 'Cash / bank balance (₹)'], ['openingInventoryValue', 'Inventory on hand (₹)'], ['otherAssets', 'Other assets (₹)'],
            ['openingPayables', 'Supplier balances already due (₹)'], ['openingLoans', 'Existing loans (₹)'], ['otherLiabilities', 'Other liabilities (₹)'],
        ].map(([key, label]) => <label key={key} className="text-xs font-semibold text-slate-600">{label}<input type="number" min="0" step="0.01" value={balances[key as keyof typeof balances]} onChange={(event) => setBalances({ ...balances, [key]: event.target.value })} className={`mt-1 ${inputClass}`} /></label>)}<label className="text-xs font-semibold text-slate-600">Balances as of<input required type="date" value={balances.openingDate} onChange={(event) => setBalances({ ...balances, openingDate: event.target.value })} className={`mt-1 ${inputClass}`} /></label><div className="flex items-end"><button disabled={saving} className="min-h-11 w-full rounded-xl bg-slate-900 px-4 text-sm font-bold text-white disabled:opacity-50">{saving ? 'Saving…' : initialSettings ? 'Update opening balances' : 'Save opening balances'}</button></div></form><p className="mt-4 text-xs text-slate-400">Store figures are for day-to-day management and depend on accurate opening balances and recorded transactions.</p></section>}

        {reviewFor && <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4"><section role="dialog" aria-modal="true" aria-labelledby="review-order-title" className="max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white p-4 shadow-2xl sm:rounded-3xl sm:p-6"><div className="flex items-start justify-between"><div><h2 id="review-order-title" className="text-lg font-bold text-slate-900">Review low-stock suggestion</h2><p className="mt-1 text-sm text-slate-500">Check the quantity and price, choose a supplier, then save this as a vendor order. Send it to the supplier separately.</p></div><button type="button" onClick={() => setReviewFor(null)} className="px-3 py-2 text-sm font-semibold text-slate-500">Close</button></div><form onSubmit={submitAutoOrderReview} className="mt-5 space-y-3"><label className="block text-xs font-semibold text-slate-600">Vendor / supplier<input required maxLength={120} value={reviewSupplier} onChange={(event) => setReviewSupplier(event.target.value)} placeholder="Choose or type vendor name" className={`mt-1 ${inputClass}`} /></label><label className="block text-xs font-semibold text-slate-600">Purchase order date<input required type="date" value={reviewDate} onChange={(event) => setReviewDate(event.target.value)} className={`mt-1 ${inputClass}`} /></label>{reviewFor.lines.map((line, index) => <div key={line.inventoryItemId} className="rounded-xl border border-slate-100 p-3"><p className="mb-2 text-sm font-bold text-slate-800">{line.itemName} · {line.unit}</p><div className="grid grid-cols-2 gap-3"><label className="text-xs font-semibold text-slate-600">Order quantity<input required type="number" min="0.0001" step="0.0001" value={reviewLines[index]?.quantity ?? ''} onChange={(event) => setReviewLines(reviewLines.map((row, rowIndex) => rowIndex === index ? { ...row, quantity: event.target.value } : row))} className={`mt-1 ${inputClass}`} /></label><label className="text-xs font-semibold text-slate-600">Cost per {line.unit} (₹)<input required type="number" min="0" step="0.01" value={reviewLines[index]?.unitCost ?? ''} onChange={(event) => setReviewLines(reviewLines.map((row, rowIndex) => rowIndex === index ? { ...row, unitCost: event.target.value } : row))} className={`mt-1 ${inputClass}`} /></label></div></div>)}<div className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900">This saves the order record but does not contact the supplier or change Store stock. Record the delivery when goods arrive.</div><button disabled={saving} className="min-h-11 w-full rounded-xl bg-amber-600 px-4 font-bold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Approve vendor order'}</button></form></section></div>}

        {(showVendorOrder || editOrderFor) && <VendorPurchaseOrderDialog key={editOrderFor?._id || 'new-vendor-order'} items={storeItems} suppliers={knownSuppliers} lowStockItems={lowStock} purchaseOrder={editOrderFor ? { _id: editOrderFor._id, reference: editOrderFor.reference, supplier: editOrderFor.supplier, notes: editOrderFor.notes, documentDate: editOrderFor.documentDate, createdAt: editOrderFor.createdAt, lines: editOrderFor.lines } : undefined} onClose={() => { setShowVendorOrder(false); setEditOrderFor(null); }} />}

        {editBillFor && <EditSupplierBillDialog key={editBillFor._id} bill={editBillFor} items={storeItems} categories={categories} onClose={() => setEditBillFor(null)} />}

    </div>;
}
