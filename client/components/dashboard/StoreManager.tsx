'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'react-hot-toast';
import { ArchiveBoxIcon, BanknotesIcon, ClipboardDocumentListIcon, PlusIcon, TruckIcon } from '@heroicons/react/24/outline';
import { InventoryBillScanner } from '@/components/dashboard/InventoryBillScanner';
import {
    approveKitchenRequisition, createVendorPurchaseOrder, approveLowStockPurchaseOrder, createFinancialEntry,
    receivePurchaseOrder, recordPurchasePayment, saveOpeningBalances, updateMinimumStockThreshold,
} from '@/app/actions/store';

type StoreItem = { _id: string; name: string; unit: string; currentStock: number; reorderLevel: number; costPerUnit: number; supplier?: string };
type StoreLine = { inventoryItemId: string; itemName: string; unit: string; requestedQuantity: number; orderedQuantity: number; receivedQuantity: number; unitCost: number; approvedQuantity?: number };
type StoreDocument = { _id: string; type: 'requisition' | 'purchase_order'; status: string; reference: string; supplier: string; departmentId?: string; notes?: string; lines: StoreLine[]; payments: { amount: number; paidAt: string; reference?: string }[]; createdAt: string };
type Department = { _id: string; name: string };
type KitchenStockRow = { _id: string; departmentId: string; inventoryItemId: string; currentStock: number };
type StoreEntry = { _id: string; type: string; category: string; amount: number; entryDate: string; reference?: string; note?: string };
type Settings = { openingDate: string; openingCash: number; openingInventoryValue: number; otherAssets: number; openingPayables: number; openingLoans: number; otherLiabilities: number } | null;
type DraftLine = { inventoryItemId: string; quantity: string };

const money = (amount: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(amount || 0);
const dateLabel = (date: string) => new Date(date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const inputClass = 'min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100';
const initialEntryDate = () => new Date().toISOString().slice(0, 10);

export default function StoreManager({ initialItems, initialDocuments, initialEntries, initialSettings, initialDepartments, initialKitchenStocks }: {
    initialItems: StoreItem[]; initialDocuments: StoreDocument[]; initialEntries: StoreEntry[]; initialSettings: Settings; initialDepartments: Department[]; initialKitchenStocks: KitchenStockRow[];
}) {
    const router = useRouter();
    const storeInventoryValue = initialItems.reduce((sum, item) => sum + item.currentStock * item.costPerUnit, 0);
    const startingInventoryValue = storeInventoryValue;
    const [tab, setTab] = useState<'buying' | 'expenses' | 'balances'>('buying');
    const [buyingView, setBuyingView] = useState<'kitchen' | 'vendors'>('kitchen');
    const [orderFor, setOrderFor] = useState<StoreDocument | null>(null);
    const [orderLines, setOrderLines] = useState<{ inventoryItemId: string; requestedQuantity: string; quantity: string }[]>([]);
    const [orderDepartmentId, setOrderDepartmentId] = useState('');
    const [orderNotes, setOrderNotes] = useState('');
    const [showVendorOrder, setShowVendorOrder] = useState(false);
    const [vendorSupplier, setVendorSupplier] = useState('');
    const [vendorNotes, setVendorNotes] = useState('');
    const [vendorLines, setVendorLines] = useState<{ inventoryItemId: string; quantity: string; unitCost: string }[]>([]);
    const [reviewFor, setReviewFor] = useState<StoreDocument | null>(null);
    const [reviewSupplier, setReviewSupplier] = useState('');
    const [reviewLines, setReviewLines] = useState<{ inventoryItemId: string; quantity: string; unitCost: string }[]>([]);
    const [receivingFor, setReceivingFor] = useState<string | null>(null);
    const [receiveLines, setReceiveLines] = useState<Record<string, string>>({});
    const [paymentAmounts, setPaymentAmounts] = useState<Record<string, string>>({});
    const [paymentRefs, setPaymentRefs] = useState<Record<string, string>>({});
    const [expenseType, setExpenseType] = useState<'expense' | 'capital_contribution' | 'owner_draw' | 'loan_received' | 'loan_repayment'>('expense');
    const [entry, setEntry] = useState({ category: '', amount: '', entryDate: initialEntryDate(), reference: '', note: '' });
    const [balances, setBalances] = useState({
        openingDate: initialSettings?.openingDate ? new Date(initialSettings.openingDate).toISOString().slice(0, 10) : initialEntryDate(),
        openingCash: String(initialSettings?.openingCash ?? 0), openingInventoryValue: String(initialSettings?.openingInventoryValue ?? startingInventoryValue),
        otherAssets: String(initialSettings?.otherAssets ?? 0), openingPayables: String(initialSettings?.openingPayables ?? 0),
        openingLoans: String(initialSettings?.openingLoans ?? 0), otherLiabilities: String(initialSettings?.otherLiabilities ?? 0),
    });
    const [saving, setSaving] = useState(false);
    const [minimumStockValues, setMinimumStockValues] = useState<Record<string, string>>(() => Object.fromEntries(initialItems.map((item) => [item._id, String(item.reorderLevel)])));
    const [savingThresholdFor, setSavingThresholdFor] = useState<string | null>(null);
    const lowStock = useMemo(() => initialItems.filter((item) => item.reorderLevel > 0 && item.currentStock <= item.reorderLevel), [initialItems]);
    const requisitions = initialDocuments.filter((doc) => doc.type === 'requisition');
    const purchaseOrders = initialDocuments.filter((doc) => doc.type === 'purchase_order');
    const openRequests = requisitions.filter((doc) => doc.status === 'submitted').length;
    const openOrders = purchaseOrders.filter((doc) => ['ordered', 'partially_received'].includes(doc.status)).length;
    const reviewOrders = purchaseOrders.filter((doc) => doc.status === 'review_required');
    const suggestedSpend = reviewOrders.reduce((sum, po) => sum + po.lines.reduce((lineSum, line) => lineSum + line.orderedQuantity * line.unitCost, 0), 0);

    function kitchenOnHand(departmentId: string, inventoryItemId: string) {
        return Number(initialKitchenStocks.find((stock) => String(stock.departmentId) === String(departmentId) && String(stock.inventoryItemId) === String(inventoryItemId))?.currentStock || 0);
    }

    function openPurchaseOrder(req: StoreDocument) {
        setOrderFor(req);
        const selectedDepartmentId = initialDepartments.some((department) => department._id === req.departmentId) ? req.departmentId! : initialDepartments[0]?._id || '';
        setOrderDepartmentId(selectedDepartmentId);
        setOrderNotes(req.notes || '');
        setOrderLines(req.lines.map((line) => {
            const kitchenBalance = kitchenOnHand(selectedDepartmentId, line.inventoryItemId);
            return { inventoryItemId: line.inventoryItemId, requestedQuantity: String(line.requestedQuantity), quantity: String(Math.max(0, Number(line.requestedQuantity) - kitchenBalance)) };
        }));
    }

    async function submitPurchaseOrder(event: React.FormEvent) {
        event.preventDefault();
        if (!orderFor) return;
        setSaving(true);
        const result = await approveKitchenRequisition({
            requisitionId: orderFor._id, departmentId: orderDepartmentId, notes: orderNotes,
            lines: orderLines.map((line) => ({ inventoryItemId: line.inventoryItemId, requestedQuantity: Number(line.requestedQuantity), quantity: Number(line.quantity) })),
        });
        setSaving(false);
        if (!result.success) return toast.error(result.error || 'Could not issue stock to kitchen');
        toast.success('Reviewed requisition approved and stock transferred to the kitchen');
        setOrderFor(null);
        router.refresh();
    }

    async function submitVendorOrder(event: React.FormEvent) {
        event.preventDefault();
        setSaving(true);
        const result = await createVendorPurchaseOrder({
            supplier: vendorSupplier, notes: vendorNotes,
            lines: vendorLines.map((line) => ({ inventoryItemId: line.inventoryItemId, quantity: Number(line.quantity), unitCost: Number(line.unitCost) })),
        });
        setSaving(false);
        if (!result.success) return toast.error(result.error || 'Could not create vendor purchase order');
        toast.success(`${result.reference} sent to ${vendorSupplier}`);
        setShowVendorOrder(false);
        router.refresh();
    }

    function openAutoOrderReview(po: StoreDocument) {
        setReviewFor(po);
        setReviewSupplier(po.supplier || '');
        setReviewLines(po.lines.map((line) => ({ inventoryItemId: line.inventoryItemId, quantity: String(line.orderedQuantity), unitCost: String(line.unitCost) })));
    }

    async function submitAutoOrderReview(event: React.FormEvent) {
        event.preventDefault();
        if (!reviewFor) return;
        setSaving(true);
        const result = await approveLowStockPurchaseOrder({
            purchaseOrderId: reviewFor._id,
            supplier: reviewSupplier,
            lines: reviewLines.map((line) => ({ inventoryItemId: line.inventoryItemId, quantity: Number(line.quantity), unitCost: Number(line.unitCost) })),
        });
        setSaving(false);
        if (!result.success) return toast.error(result.error || 'Could not approve suggested order');
        toast.success('Reviewed and placed as a vendor order');
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
        { id: 'buying' as const, label: 'Purchasing', icon: ClipboardDocumentListIcon },
        { id: 'expenses' as const, label: 'Expenses & cash entries', icon: BanknotesIcon },
        { id: 'balances' as const, label: 'Opening balances', icon: ArchiveBoxIcon },
    ];

    return <div className="space-y-6">
        <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-sky-600">Procurement & cost control</p><h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900">Store</h1><p className="mt-1 max-w-2xl text-sm text-slate-500">Purchase and receive vendor stock, then review kitchen requisitions and issue stock by department.</p></div>
            <div className="text-xs text-slate-500">Kitchen requests and vendor purchasing are managed in separate sections below.</div>
        </header>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            {[
                ['Store stock value', money(storeInventoryValue), 'Goods not yet issued to kitchens'],
                ['Below minimum', String(lowStock.length), 'Items with a minimum set'],
                ['Needs review', String(reviewOrders.length), `${money(suggestedSpend)} suggested spend`],
                ['Kitchen requests', String(openRequests), 'Waiting for Store review'],
                ['Open purchase orders', String(openOrders), 'Ordered or partly received'],
            ].map(([label, value, detail]) => <section key={label} className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5"><p className="text-xs font-medium text-slate-500">{label}</p><p className="mt-2 text-xl font-bold text-slate-900">{value}</p><p className="mt-1 text-[11px] text-slate-400">{detail}</p></section>)}
        </div>

        {lowStock.length > 0 && <section className="flex flex-col gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-start gap-3"><span className="rounded-xl bg-white p-2 text-amber-600"><ArchiveBoxIcon className="h-5 w-5" /></span><div><h2 className="font-bold text-amber-950">{lowStock.length} items at or below minimum stock</h2><p className="mt-0.5 text-sm text-amber-800">Suggested vendor orders are created for review. They are never sent automatically.</p></div></div><button onClick={() => { setBuyingView('vendors'); setTab('buying'); }} className="min-h-10 rounded-xl border border-amber-300 bg-white px-4 text-sm font-bold text-amber-900 hover:bg-amber-100">Review vendor suggestions</button></section>}

        <nav className="flex gap-2 overflow-x-auto rounded-2xl border border-slate-200 bg-white p-2" aria-label="Store management">
            {tabs.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => setTab(id)} className={`inline-flex min-h-10 shrink-0 items-center gap-2 rounded-xl px-3 text-xs font-bold sm:px-4 sm:text-sm ${tab === id ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}><Icon className="h-4 w-4" />{label}</button>)}
        </nav>

        {tab === 'buying' && <div className="space-y-5">
            <nav className="flex gap-2 rounded-2xl border border-slate-200 bg-white p-2" aria-label="Purchasing workflow">
                <button onClick={() => setBuyingView('kitchen')} className={`min-h-10 flex-1 rounded-xl px-3 text-sm font-bold ${buyingView === 'kitchen' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>Kitchen requests <span className="ml-1 opacity-75">({openRequests})</span></button>
                <button onClick={() => setBuyingView('vendors')} className={`min-h-10 flex-1 rounded-xl px-3 text-sm font-bold ${buyingView === 'vendors' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100'}`}>Vendor purchasing <span className="ml-1 opacity-75">({openOrders})</span></button>
            </nav>
                        {buyingView === 'vendors' && <div className="flex justify-end"><button onClick={() => { setVendorSupplier(''); setVendorNotes(''); setVendorLines([{ inventoryItemId: '', quantity: '', unitCost: '' }]); setShowVendorOrder(true); }} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-sky-600 px-4 text-sm font-bold text-white"><TruckIcon className="h-4 w-4" /> Buy from vendor</button></div>}
            {buyingView === 'vendors' && <InventoryBillScanner items={initialItems.map(({ _id, name, unit, currentStock, costPerUnit }) => ({ _id, name, unit, currentStock, costPerUnit }))} />}
            {buyingView === 'kitchen' && <>
            <section className="rounded-2xl border border-slate-200 bg-white">
                <div className="border-b border-slate-100 p-4 sm:p-5"><h2 className="font-bold text-slate-900">Kitchen requisitions</h2><p className="mt-1 text-xs text-slate-500">The review shows each department’s current stock and suggests issuing only what is still needed.</p></div>
                {!requisitions.length ? <p className="p-8 text-center text-sm text-slate-400">No kitchen requisitions yet.</p> : <div className="divide-y divide-slate-100">{requisitions.map((doc) => <article key={doc._id} className="p-4 sm:p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><h3 className="font-bold text-slate-900">{doc.reference}</h3><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${doc.status === 'submitted' ? 'bg-amber-100 text-amber-800' : doc.status === 'approved' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{doc.status === 'approved' ? 'issued to kitchen' : doc.status}</span><span className="rounded-full bg-sky-50 px-2.5 py-1 text-[10px] font-bold text-sky-700">{initialDepartments.find((dept) => dept._id === doc.departmentId)?.name || 'Department'}</span><span className="text-xs text-slate-400">{dateLabel(doc.createdAt)}</span></div><ul className="mt-3 grid gap-1 text-sm text-slate-600 sm:grid-cols-2">{doc.lines.map((line) => <li key={line.inventoryItemId}>{line.itemName} · {doc.status === 'approved' ? line.approvedQuantity ?? line.orderedQuantity : line.requestedQuantity} {line.unit}{doc.status === 'approved' ? ' issued' : ' requested'}</li>)}</ul>{doc.notes && <p className="mt-2 text-xs text-slate-500">{doc.notes}</p>}</div>{doc.status === 'submitted' && <button onClick={() => openPurchaseOrder(doc)} className="min-h-10 rounded-xl bg-sky-600 px-4 text-sm font-bold text-white hover:bg-sky-700">Review & issue stock</button>}</div></article>)}</div>}
            </section>
            </>}
            {buyingView === 'vendors' && <>
            <details open className="rounded-2xl border border-slate-200 bg-white">
                <summary className="cursor-pointer list-none p-4 sm:p-5"><span className="flex items-center justify-between gap-3"><span><span className="block font-bold text-slate-900">Store stock and minimum levels</span><span className="mt-1 block text-xs text-slate-500">These are quantities held in Store. Kitchen stock is tracked separately by department. Set a minimum to request a human-reviewed vendor order.</span></span><span className="shrink-0 rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">{lowStock.length} need attention</span></span></summary>
                <div className="max-h-[34rem] space-y-2 overflow-y-auto border-t border-slate-100 p-3 sm:p-4">
                    {[...initialItems].sort((a, b) => Number(b.reorderLevel > 0 && b.currentStock <= b.reorderLevel) - Number(a.reorderLevel > 0 && a.currentStock <= a.reorderLevel) || a.name.localeCompare(b.name)).map((item) => {
                        const isLow = item.reorderLevel > 0 && item.currentStock <= item.reorderLevel;
                        return <div key={item._id} className="grid gap-3 rounded-xl border border-slate-100 p-3 sm:grid-cols-[minmax(0,1fr)_8rem_auto] sm:items-center">
                            <div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-800">{item.name}</p><p className="mt-0.5 text-xs text-slate-500">Store stock: <strong className={isLow ? 'text-amber-700' : 'text-slate-700'}>{item.currentStock} {item.unit}</strong>{item.supplier ? ` · Vendor: ${item.supplier}` : ' · Vendor not set'}</p></div>
                            <label className="text-xs font-semibold text-slate-500">Minimum ({item.unit})<input aria-label={`Minimum stock for ${item.name}`} type="number" min="0" step="0.0001" value={minimumStockValues[item._id] ?? String(item.reorderLevel)} onChange={(event) => setMinimumStockValues({ ...minimumStockValues, [item._id]: event.target.value })} className={`mt-1 ${inputClass}`} /></label>
                            <button disabled={savingThresholdFor === item._id || Number(minimumStockValues[item._id]) === item.reorderLevel} onClick={() => void saveMinimumStock(item)} className="min-h-10 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-700 disabled:cursor-default disabled:opacity-45">{savingThresholdFor === item._id ? 'Saving…' : 'Save minimum'}</button>
                        </div>;
                    })}
                    {!initialItems.length && <p className="p-5 text-center text-sm text-slate-400">Add inventory items first to configure minimum levels.</p>}
                </div>
            </details>
            <section className="rounded-2xl border border-amber-200 bg-white">
                <div className="border-b border-amber-100 bg-amber-50 p-4 sm:p-5"><h2 className="font-bold text-amber-950">Needs your review</h2><p className="mt-1 text-xs text-amber-800">Minimum stock alerts create suggestions here. Confirm the vendor, quantity and price before an order is placed.</p></div>
                {reviewOrders.length === 0 ? <p className="p-7 text-center text-sm text-slate-400">No vendor suggestions need review. New suggestions appear when an item reaches its minimum stock.</p> : <div className="divide-y divide-slate-100">{reviewOrders.map((po) => <article key={po._id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-bold text-slate-900">{po.lines.map((line) => line.itemName).join(', ')}</h3><span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-bold uppercase text-amber-800">Review required</span></div><div className="mt-2 space-y-1">{po.lines.map((line) => { const item = initialItems.find((candidate) => candidate._id === line.inventoryItemId); return <p key={line.inventoryItemId} className="text-sm text-slate-600">Suggested {line.orderedQuantity} {line.unit} · estimated {money(line.orderedQuantity * line.unitCost)}{item ? ` · Store has ${item.currentStock} / minimum ${item.reorderLevel} ${item.unit}` : ''}</p>; })}</div><p className="mt-1 text-xs text-slate-500">Vendor: {po.supplier || 'choose vendor during review'} · {po.notes}</p></div><button onClick={() => openAutoOrderReview(po)} className="min-h-10 shrink-0 rounded-xl bg-amber-600 px-4 text-sm font-bold text-white hover:bg-amber-700">Review suggestion</button></article>)}</div>}
            </section>
            <section className="rounded-2xl border border-slate-200 bg-white">
                <div className="border-b border-slate-100 p-4 sm:p-5"><h2 className="font-bold text-slate-900">Supplier purchase orders</h2><p className="mt-1 text-xs text-slate-500">Receive partial deliveries and record payments against received goods.</p></div>
                {!purchaseOrders.some((po) => po.status !== 'review_required') ? <p className="p-8 text-center text-sm text-slate-400">No vendor orders yet. Create one directly or approve a suggested order above.</p> : <div className="divide-y divide-slate-100">{purchaseOrders.filter((po) => po.status !== 'review_required').map((po) => {
                    const receivedValue = po.lines.reduce((sum, line) => sum + line.receivedQuantity * line.unitCost, 0);
                    const paidValue = po.payments.reduce((sum, payment) => sum + payment.amount, 0);
                    const due = Math.max(0, receivedValue - paidValue);
                    const orderedValue = po.lines.reduce((sum, line) => sum + line.orderedQuantity * line.unitCost, 0);
                    return <article key={po._id} className="p-4 sm:p-5"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><TruckIcon className="h-4 w-4 text-sky-600" /><h3 className="font-bold text-slate-900">{po.reference}</h3><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ${po.status === 'received' ? 'bg-emerald-100 text-emerald-700' : 'bg-blue-50 text-blue-700'}`}>{po.status.replace('_', ' ')}</span></div><p className="mt-1 text-sm text-slate-600">{po.supplier} · {dateLabel(po.createdAt)}</p><ul className="mt-3 grid gap-1 text-sm text-slate-600 sm:grid-cols-2">{po.lines.map((line) => <li key={line.inventoryItemId}>{line.itemName} · {line.receivedQuantity}/{line.orderedQuantity} {line.unit} · {money(line.unitCost)}/{line.unit}</li>)}</ul><p className="mt-3 text-xs text-slate-500">Ordered {money(orderedValue)} · Received {money(receivedValue)} · Due {money(due)}</p></div>{['ordered', 'partially_received'].includes(po.status) && <button onClick={() => startReceiving(po)} className="min-h-10 rounded-xl bg-sky-600 px-4 text-sm font-bold text-white hover:bg-sky-700">Receive goods</button>}</div>
                        {receivingFor === po._id && <form onSubmit={(event) => submitReceipt(event, po)} className="mt-4 rounded-xl border border-sky-100 bg-sky-50/70 p-3 sm:p-4"><h4 className="text-sm font-bold text-slate-800">Confirm delivered quantities</h4><p className="mt-1 text-xs text-slate-500">Only received quantities will be added to stock. Enter zero for items not delivered.</p><div className="mt-3 space-y-2">{po.lines.filter((line) => line.orderedQuantity > line.receivedQuantity).map((line) => <label key={line.inventoryItemId} className="grid grid-cols-[1fr_6.5rem] items-center gap-3 text-sm"><span className="min-w-0 truncate text-slate-700">{line.itemName}<small className="block text-xs text-slate-400">{line.orderedQuantity - line.receivedQuantity} {line.unit} remaining</small></span><input type="number" min="0" max={line.orderedQuantity - line.receivedQuantity} step="0.0001" value={receiveLines[line.inventoryItemId] ?? ''} onChange={(event) => setReceiveLines({ ...receiveLines, [line.inventoryItemId]: event.target.value })} className={inputClass} /></label>)}</div><div className="mt-3 flex justify-end gap-2"><button type="button" onClick={() => setReceivingFor(null)} className="min-h-10 rounded-lg px-3 text-sm font-semibold text-slate-600">Cancel</button><button disabled={saving} className="min-h-10 rounded-lg bg-sky-600 px-4 text-sm font-bold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Add received stock'}</button></div></form>}
                        {due > 0 && receivedValue > 0 && <form onSubmit={(event) => submitPayment(event, po)} className="mt-3 grid gap-2 rounded-xl border border-slate-100 bg-slate-50 p-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"><label className="text-xs font-semibold text-slate-600">Payment amount<input required type="number" min="0.01" max={due} step="0.01" value={paymentAmounts[po._id] || ''} onChange={(event) => setPaymentAmounts({ ...paymentAmounts, [po._id]: event.target.value })} placeholder={`Balance ${money(due)}`} className={`mt-1 ${inputClass}`} /></label><label className="text-xs font-semibold text-slate-600">Payment reference<input value={paymentRefs[po._id] || ''} onChange={(event) => setPaymentRefs({ ...paymentRefs, [po._id]: event.target.value })} placeholder="Optional" className={`mt-1 ${inputClass}`} /></label><button disabled={saving} className="min-h-11 rounded-xl bg-slate-900 px-4 text-sm font-bold text-white disabled:opacity-50">Record payment</button></form>}
                    </article>;
                })}</div>}
            </section>
            </>}
        </div>}


        {tab === 'expenses' && <div className="grid gap-5 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
            <form onSubmit={submitEntry} className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5"><div><h2 className="font-bold text-slate-900">Record a financial entry</h2><p className="mt-1 text-xs text-slate-500">Capture expenses and owner or loan cash movements used in the reports.</p></div><label className="block text-xs font-semibold text-slate-600">Entry type<select value={expenseType} onChange={(event) => setExpenseType(event.target.value as typeof expenseType)} className={`mt-1 ${inputClass}`}><option value="expense">Operating expense</option><option value="capital_contribution">Owner capital added</option><option value="owner_draw">Owner withdrawal</option><option value="loan_received">Loan received</option><option value="loan_repayment">Loan repayment</option></select></label><label className="block text-xs font-semibold text-slate-600">Category<input required value={entry.category} onChange={(event) => setEntry({ ...entry, category: event.target.value })} placeholder={expenseType === 'expense' ? 'Rent, utilities, wages…' : 'General'} className={`mt-1 ${inputClass}`} /></label><div className="grid grid-cols-2 gap-3"><label className="text-xs font-semibold text-slate-600">Amount (₹)<input required type="number" min="0.01" step="0.01" value={entry.amount} onChange={(event) => setEntry({ ...entry, amount: event.target.value })} className={`mt-1 ${inputClass}`} /></label><label className="text-xs font-semibold text-slate-600">Date<input required type="date" value={entry.entryDate} onChange={(event) => setEntry({ ...entry, entryDate: event.target.value })} className={`mt-1 ${inputClass}`} /></label></div><label className="block text-xs font-semibold text-slate-600">Reference / note<input value={entry.reference} onChange={(event) => setEntry({ ...entry, reference: event.target.value })} placeholder="Invoice or payment reference" className={`mt-1 ${inputClass}`} /></label><button disabled={saving} className="min-h-11 w-full rounded-xl bg-sky-600 px-4 text-sm font-bold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save entry'}</button></form>
            <section className="rounded-2xl border border-slate-200 bg-white"><div className="border-b border-slate-100 p-4 sm:p-5"><h2 className="font-bold text-slate-900">Recent entries</h2><p className="mt-1 text-xs text-slate-500">Newest expenses and cash movements</p></div>{!initialEntries.length ? <p className="p-8 text-center text-sm text-slate-400">No financial entries recorded yet.</p> : <div className="divide-y divide-slate-100">{initialEntries.map((row) => <div key={row._id} className="flex items-center justify-between gap-3 p-4"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-800">{row.category}</p><p className="mt-0.5 text-xs text-slate-400">{row.type.replaceAll('_', ' ')} · {dateLabel(row.entryDate)}{row.reference ? ` · ${row.reference}` : ''}</p></div><span className="shrink-0 text-sm font-bold text-slate-800">{money(row.amount)}</span></div>)}</div>}</section>
        </div>}

        {tab === 'balances' && <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-6"><div className="max-w-3xl"><p className="text-xs font-bold uppercase tracking-[0.16em] text-sky-600">One-time setup</p><h2 className="mt-1 text-lg font-bold text-slate-900">Opening balances for your management balance sheet</h2><p className="mt-2 text-sm leading-6 text-slate-600">Enter your balances on the date you begin using this tracker. The report uses these as its starting point, then adds recorded sales, received purchases, expenses and cash entries. You can update these numbers if you need to correct your starting position.</p></div><form onSubmit={submitBalances} className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{[
            ['openingCash', 'Cash / bank balance (₹)'], ['openingInventoryValue', 'Inventory on hand (₹)'], ['otherAssets', 'Other assets (₹)'],
            ['openingPayables', 'Supplier balances already due (₹)'], ['openingLoans', 'Existing loans (₹)'], ['otherLiabilities', 'Other liabilities (₹)'],
        ].map(([key, label]) => <label key={key} className="text-xs font-semibold text-slate-600">{label}<input type="number" min="0" step="0.01" value={balances[key as keyof typeof balances]} onChange={(event) => setBalances({ ...balances, [key]: event.target.value })} className={`mt-1 ${inputClass}`} /></label>)}<label className="text-xs font-semibold text-slate-600">Balances as of<input required type="date" value={balances.openingDate} onChange={(event) => setBalances({ ...balances, openingDate: event.target.value })} className={`mt-1 ${inputClass}`} /></label><div className="flex items-end"><button disabled={saving} className="min-h-11 w-full rounded-xl bg-slate-900 px-4 text-sm font-bold text-white disabled:opacity-50">{saving ? 'Saving…' : initialSettings ? 'Update opening balances' : 'Save opening balances'}</button></div></form><p className="mt-4 text-xs text-slate-400">Store figures are for day-to-day management and depend on accurate opening balances and recorded transactions.</p></section>}

        {reviewFor && <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4"><section role="dialog" aria-modal="true" aria-labelledby="review-order-title" className="max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white p-4 shadow-2xl sm:rounded-3xl sm:p-6"><div className="flex items-start justify-between"><div><h2 id="review-order-title" className="text-lg font-bold text-slate-900">Review low-stock order</h2><p className="mt-1 text-sm text-slate-500">Check the suggested quantities and price, choose the vendor, then approve to place the order.</p></div><button type="button" onClick={() => setReviewFor(null)} className="px-3 py-2 text-sm font-semibold text-slate-500">Close</button></div><form onSubmit={submitAutoOrderReview} className="mt-5 space-y-3"><label className="block text-xs font-semibold text-slate-600">Vendor / supplier<input required maxLength={120} value={reviewSupplier} onChange={(event) => setReviewSupplier(event.target.value)} placeholder="Choose or type vendor name" className={`mt-1 ${inputClass}`} /></label>{reviewFor.lines.map((line, index) => <div key={line.inventoryItemId} className="rounded-xl border border-slate-100 p-3"><p className="mb-2 text-sm font-bold text-slate-800">{line.itemName} · {line.unit}</p><div className="grid grid-cols-2 gap-3"><label className="text-xs font-semibold text-slate-600">Order quantity<input required type="number" min="0.0001" step="0.0001" value={reviewLines[index]?.quantity ?? ''} onChange={(event) => setReviewLines(reviewLines.map((row, rowIndex) => rowIndex === index ? { ...row, quantity: event.target.value } : row))} className={`mt-1 ${inputClass}`} /></label><label className="text-xs font-semibold text-slate-600">Cost per {line.unit} (₹)<input required type="number" min="0" step="0.01" value={reviewLines[index]?.unitCost ?? ''} onChange={(event) => setReviewLines(reviewLines.map((row, rowIndex) => rowIndex === index ? { ...row, unitCost: event.target.value } : row))} className={`mt-1 ${inputClass}`} /></label></div></div>)}<div className="rounded-xl bg-amber-50 p-3 text-xs text-amber-900">This suggestion is still a draft. Stock and supplier balances change only after approval and goods receipt.</div><button disabled={saving} className="min-h-11 w-full rounded-xl bg-amber-600 px-4 font-bold text-white disabled:opacity-50">{saving ? 'Approving…' : 'Approve and place vendor order'}</button></form></section></div>}

        {showVendorOrder && <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4"><section role="dialog" aria-modal="true" aria-labelledby="vendor-order-title" className="max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white p-4 shadow-2xl sm:rounded-3xl sm:p-6"><div className="flex items-start justify-between"><div><h2 id="vendor-order-title" className="text-lg font-bold text-slate-900">Buy directly from a vendor</h2><p className="mt-1 text-sm text-slate-500">Create a purchase order without a kitchen requisition. Stock changes only after you receive the goods.</p></div><button type="button" onClick={() => setShowVendorOrder(false)} className="px-3 py-2 text-sm font-semibold text-slate-500">Close</button></div><form onSubmit={submitVendorOrder} className="mt-5 space-y-3"><label className="block text-xs font-semibold text-slate-600">Vendor / supplier<input required maxLength={120} value={vendorSupplier} onChange={(event) => setVendorSupplier(event.target.value)} placeholder="Supplier name" className={`mt-1 ${inputClass}`} /></label>{vendorLines.map((line, index) => { const item = initialItems.find((candidate) => candidate._id === line.inventoryItemId); return <div key={index} className="rounded-xl border border-slate-100 p-3"><div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2"><select required value={line.inventoryItemId} onChange={(event) => { const selected = initialItems.find((candidate) => candidate._id === event.target.value); setVendorLines(vendorLines.map((row, rowIndex) => rowIndex === index ? { ...row, inventoryItemId: event.target.value, unitCost: selected ? String(selected.costPerUnit) : '' } : row)); }} className={inputClass}><option value="">Select inventory item</option>{initialItems.map((option) => <option key={option._id} value={option._id}>{option.name} · {option.currentStock} {option.unit}</option>)}</select><button type="button" onClick={() => setVendorLines(vendorLines.filter((_, rowIndex) => rowIndex !== index))} className="px-2 text-xs font-bold text-red-500">Remove</button></div><div className="mt-2 grid grid-cols-2 gap-3"><label className="text-xs font-semibold text-slate-600">Order quantity {item && `(${item.unit})`}<input required type="number" min="0.0001" step="0.0001" value={line.quantity} onChange={(event) => setVendorLines(vendorLines.map((row, rowIndex) => rowIndex === index ? { ...row, quantity: event.target.value } : row))} className={`mt-1 ${inputClass}`} /></label><label className="text-xs font-semibold text-slate-600">Unit cost (₹){item && ` / ${item.unit}`}<input required type="number" min="0" step="0.01" value={line.unitCost} onChange={(event) => setVendorLines(vendorLines.map((row, rowIndex) => rowIndex === index ? { ...row, unitCost: event.target.value } : row))} className={`mt-1 ${inputClass}`} /></label></div></div>; })}<button type="button" onClick={() => setVendorLines([...vendorLines, { inventoryItemId: '', quantity: '', unitCost: '' }])} className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-sm font-semibold text-sky-700"><PlusIcon className="h-4 w-4" /> Add inventory item</button><label className="block text-xs font-semibold text-slate-600">Note<input value={vendorNotes} onChange={(event) => setVendorNotes(event.target.value)} placeholder="Delivery date, quote or purchase reference" className={`mt-1 ${inputClass}`} /></label><button disabled={saving} className="min-h-11 w-full rounded-xl bg-sky-600 px-4 font-bold text-white disabled:opacity-50">{saving ? 'Creating…' : 'Create vendor purchase order'}</button></form></section></div>}

        {orderFor && <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4"><section role="dialog" aria-modal="true" aria-labelledby="issue-request-title" className="max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white p-4 shadow-2xl sm:rounded-3xl sm:p-6"><div className="flex items-start justify-between"><div><h2 id="issue-request-title" className="text-lg font-bold text-slate-900">Review and edit kitchen requisition</h2><p className="mt-1 text-sm text-slate-500">Edit the request before approval. Store stock moves only for the issue quantities you approve.</p></div><button type="button" onClick={() => setOrderFor(null)} className="px-3 py-2 text-sm font-semibold text-slate-500">Close</button></div><form onSubmit={submitPurchaseOrder} className="mt-5 space-y-3"><label className="block text-xs font-semibold text-slate-600">Kitchen department<select required value={orderDepartmentId} onChange={(event) => { const id = event.target.value; setOrderDepartmentId(id); setOrderLines(orderLines.map((line) => ({ ...line, quantity: String(Math.max(0, Number(line.requestedQuantity) - kitchenOnHand(id, line.inventoryItemId))) }))); }} className={`mt-1 ${inputClass}`}><option value="">Choose active department</option>{initialDepartments.map((department) => <option key={department._id} value={department._id}>{department.name}</option>)}</select></label>{orderLines.map((line, index) => <div key={index} className="rounded-xl border border-slate-100 p-3"><div className="grid gap-2 sm:grid-cols-[minmax(0,1.4fr)_0.8fr_0.8fr_auto]"><label className="text-xs font-semibold text-slate-600">Ingredient<select required value={line.inventoryItemId} onChange={(event) => setOrderLines(orderLines.map((row, rowIndex) => rowIndex === index ? { ...row, inventoryItemId: event.target.value } : row))} className={`mt-1 ${inputClass}`}><option value="">Choose item</option>{initialItems.map((item) => <option key={item._id} value={item._id}>{item.name} · store {item.currentStock} {item.unit}</option>)}</select></label><label className="text-xs font-semibold text-slate-600">Requested<input required type="number" min="0.0001" step="0.0001" value={line.requestedQuantity} onChange={(event) => setOrderLines(orderLines.map((row, rowIndex) => rowIndex === index ? { ...row, requestedQuantity: event.target.value } : row))} className={`mt-1 ${inputClass}`} /></label><label className="text-xs font-semibold text-slate-600">Issue<input required type="number" min="0" max={line.requestedQuantity} step="0.0001" value={line.quantity} onChange={(event) => setOrderLines(orderLines.map((row, rowIndex) => rowIndex === index ? { ...row, quantity: event.target.value } : row))} className={`mt-1 ${inputClass}`} /><span className="mt-1 block text-[10px] font-normal text-slate-500">Kitchen has {kitchenOnHand(orderDepartmentId, line.inventoryItemId)} {initialItems.find((item) => item._id === line.inventoryItemId)?.unit || ""}. Suggested issue: {Math.max(0, Number(line.requestedQuantity) - kitchenOnHand(orderDepartmentId, line.inventoryItemId))}.</span></label><button type="button" onClick={() => setOrderLines(orderLines.filter((_, rowIndex) => rowIndex !== index))} className="self-end px-2 py-3 text-xs font-bold text-rose-600">Remove</button></div></div>)}<button type="button" onClick={() => setOrderLines([...orderLines, { inventoryItemId: '', requestedQuantity: '', quantity: '' }])} className="text-sm font-bold text-sky-700">+ Add item</button><label className="block text-xs font-semibold text-slate-600">Note<input value={orderNotes} onChange={(event) => setOrderNotes(event.target.value)} className={`mt-1 ${inputClass}`} /></label><div className="rounded-xl bg-sky-50 p-3 text-xs leading-5 text-sky-900">You can change items and requested quantities, or set an issue quantity to 0. All approved lines transfer together; unavailable stock is never deducted.</div><button disabled={saving || !initialDepartments.length || !orderLines.length} className="min-h-11 w-full rounded-xl bg-sky-600 px-4 font-bold text-white disabled:opacity-50">{saving ? 'Saving…' : orderLines.some((line) => Number(line.quantity) > 0) ? 'Approve and issue stock' : 'Approve with no stock issue'}</button></form></section></div>}
    </div>;
}
