'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PlusIcon, TrashIcon, TruckIcon } from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';
import { createVendorPurchaseOrder, updateVendorPurchaseOrder } from '@/app/actions/store';

type StoreItem = { _id: string; name: string; category: string; unit: string; currentStock: number; reorderLevel: number; costPerUnit: number; supplier?: string };
type DraftLine = { id: string; inventoryItemId: string; quantity: string; unitCost: string };
type ExistingPurchaseOrder = {
    _id: string; reference: string; supplier: string; notes?: string; documentDate?: string; createdAt: string;
    lines: { inventoryItemId: string; orderedQuantity: number; unitCost: number }[];
};

const money = (amount: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(amount || 0);
const newLine = (): DraftLine => ({ id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, inventoryItemId: '', quantity: '', unitCost: '' });
const todayIndia = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const dateValue = (value?: string) => value ? new Date(value).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) : todayIndia();

function InventoryPicker({ items, value, excludedIds, onSelect }: {
    items: StoreItem[]; value: string; excludedIds: string[]; onSelect: (item: StoreItem | null) => void;
}) {
    const [query, setQuery] = useState('');
    const [open, setOpen] = useState(false);
    const selected = items.find((item) => item._id === value);
    const available = items.filter((item) => !excludedIds.includes(item._id) || item._id === value);
    const filtered = available.filter((item) => item.name.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 12);

    return <div>
        <input
            role="combobox"
            aria-expanded={open}
            aria-autocomplete="list"
            value={open ? query : selected?.name || ''}
            onFocus={() => { setQuery(''); setOpen(true); }}
            onChange={(event) => { setQuery(event.target.value); setOpen(true); if (selected) onSelect(null); }}
            onBlur={() => setOpen(false)}
            placeholder="Search Store items"
            className="min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100"
        />
        {open && <div role="listbox" className="mt-1 max-h-48 overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            {filtered.length ? filtered.map((item) => <button
                key={item._id}
                type="button"
                role="option"
                aria-selected={item._id === value}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => { onSelect(item); setQuery(''); setOpen(false); }}
                className="flex min-h-12 w-full items-center justify-between gap-3 border-b border-slate-100 px-3 py-2 text-left last:border-0 hover:bg-sky-50"
            ><span className="min-w-0"><span className="block truncate text-sm font-semibold text-slate-800">{item.name}</span><span className="block text-[10px] text-slate-500">Store has {item.currentStock.toFixed(2)} {item.unit}{item.reorderLevel > 0 ? ` · minimum ${item.reorderLevel.toFixed(2)}` : ''}</span></span><span className="shrink-0 text-[10px] text-slate-400">{item.unit}</span></button>) : <p className="px-3 py-3 text-xs text-slate-500">No matching available items.</p>}
            {available.length > 12 && !query.trim() && <p className="sticky bottom-0 bg-slate-50 px-3 py-2 text-[10px] text-slate-500">Type to search all {available.length} items.</p>}
        </div>}
    </div>;
}

export default function VendorPurchaseOrderDialog({ items, suppliers, lowStockItems, onClose, purchaseOrder }: {
    items: StoreItem[]; suppliers: string[]; lowStockItems: StoreItem[]; onClose: () => void; purchaseOrder?: ExistingPurchaseOrder;
}) {
    const router = useRouter();
    const [supplier, setSupplier] = useState(purchaseOrder?.supplier || '');
    const [note, setNote] = useState(purchaseOrder?.notes || '');
    const [documentDate, setDocumentDate] = useState(dateValue(purchaseOrder?.documentDate || purchaseOrder?.createdAt));
    const [lines, setLines] = useState<DraftLine[]>(purchaseOrder?.lines.map((line) => ({ id: newLine().id, inventoryItemId: line.inventoryItemId, quantity: String(line.orderedQuantity), unitCost: String(line.unitCost) })) || [newLine()]);
    const [saving, setSaving] = useState(false);
    const [step, setStep] = useState<1 | 2 | 3>(1);
    const selectedIds = lines.map((line) => line.inventoryItemId).filter(Boolean);
    const orderTotal = useMemo(() => lines.reduce((total, line) => total + (Number(line.quantity) || 0) * (Number(line.unitCost) || 0), 0), [lines]);
    const validLines = lines.length > 0 && lines.length <= 60 && lines.every((line) => line.inventoryItemId && line.quantity.trim() !== '' && line.unitCost.trim() !== '' && Number.isFinite(Number(line.quantity)) && Number(line.quantity) > 0 && Number.isFinite(Number(line.unitCost)) && Number(line.unitCost) >= 0);
    const uniqueItems = new Set(selectedIds).size === selectedIds.length;
    const lowStockToAdd = lowStockItems.filter((item) => !selectedIds.includes(item._id)).slice(0, Math.max(0, 60 - lines.length));

    function updateLine(id: string, patch: Partial<DraftLine>) {
        setLines((current) => current.map((line) => line.id === id ? { ...line, ...patch } : line));
    }

    function chooseItem(lineId: string, item: StoreItem | null) {
        updateLine(lineId, item
            ? { inventoryItemId: item._id, unitCost: String(item.costPerUnit) }
            : { inventoryItemId: '', unitCost: '' });
    }

    function addLowStockItems() {
        if (!lowStockToAdd.length) return;
        const suggested = lowStockToAdd.map((item) => {
            const gap = Math.max(0, item.reorderLevel - item.currentStock);
            const quantity = Math.max(gap, Math.min(item.reorderLevel, 1));
            return { ...newLine(), inventoryItemId: item._id, quantity: String(quantity), unitCost: String(item.costPerUnit) };
        });
        setLines((current) => [...current.filter((line) => line.inventoryItemId || line.quantity || line.unitCost).slice(0, 60 - suggested.length), ...suggested]);
    }

    function continueToItems() {
        if (!supplier.trim()) return toast.error('Enter or choose a supplier first.');
        setStep(2);
    }

    function continueToReview() {
        if (!validLines || !uniqueItems) return toast.error('Choose an item on every row and check its quantity and cost.');
        setStep(3);
    }

    async function submit(event: React.FormEvent) {
        event.preventDefault();
        if (!supplier.trim()) return toast.error('Enter the supplier name.');
        if (!validLines || !uniqueItems) return toast.error('Choose a different item on each line and check quantities and costs.');
        setSaving(true);
        try {
            const orderData = {
                supplier: supplier.trim(), documentDate, notes: note,
                lines: lines.map((line) => ({ inventoryItemId: line.inventoryItemId, quantity: Number(line.quantity), unitCost: Number(line.unitCost) })),
            };
            const result = purchaseOrder
                ? await updateVendorPurchaseOrder({ purchaseOrderId: purchaseOrder._id, ...orderData })
                : await createVendorPurchaseOrder(orderData);
            if (!result.success) return toast.error(result.error || 'Could not save this purchase order.');
            toast.success(purchaseOrder ? `${purchaseOrder.reference} updated` : `${'reference' in result ? result.reference : 'Purchase order'} saved · ${supplier.trim()}`);
            onClose();
            router.refresh();
        } catch (error) {
            console.error('Saving vendor purchase order failed:', error);
            toast.error(error instanceof Error ? `Could not save order: ${error.message.slice(0, 140)}` : 'Could not save this order. Please retry.');
        } finally {
            setSaving(false);
        }
    }

    return <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4">
        <section role="dialog" aria-modal="true" aria-labelledby="vendor-order-title" className="max-h-[94dvh] w-full max-w-3xl overflow-y-auto rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl">
            <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-100 bg-white p-4 sm:p-6">
                <div className="flex items-start gap-3"><span className="rounded-xl bg-sky-50 p-2 text-sky-700"><TruckIcon className="h-5 w-5" /></span><div><h2 id="vendor-order-title" className="text-lg font-bold text-slate-900">{purchaseOrder ? `Edit ${purchaseOrder.reference}` : 'Create vendor purchase order'}</h2><p className="mt-1 text-sm text-slate-500">{purchaseOrder ? 'Update supplier, order date, items, quantities or unit costs.' : 'Enter supplier and item details, check the total, then save.'}</p></div></div>
                <button type="button" disabled={saving} onClick={onClose} className="shrink-0 rounded-lg px-3 py-2 text-sm font-semibold text-slate-500 hover:bg-slate-100 disabled:opacity-50">Close</button>
            </header>

            <div className="grid grid-cols-3 border-b border-slate-100 bg-slate-50 px-4 py-3 sm:px-6">
                {(['Supplier', 'Items', 'Review'] as const).map((label, index) => {
                    const stepNumber = (index + 1) as 1 | 2 | 3;
                    return <div key={label} className={`flex items-center gap-2 text-xs font-bold ${step === stepNumber ? 'text-sky-700' : step > stepNumber ? 'text-emerald-700' : 'text-slate-400'}`}><span className={`grid h-6 w-6 place-items-center rounded-full ${step === stepNumber ? 'bg-sky-100' : step > stepNumber ? 'bg-emerald-100' : 'bg-slate-200'}`}>{step > stepNumber ? '✓' : stepNumber}</span>{label}</div>;
                })}
            </div>

            <form onSubmit={(event) => { if (step !== 3) { event.preventDefault(); return; } void submit(event); }} className="space-y-5 p-4 sm:p-6">
                {step === 1 && <section className="space-y-4">
                    <div><h3 className="font-bold text-slate-900">Who are you ordering from?</h3><p className="mt-1 text-sm text-slate-500">Choose a saved supplier or type a new supplier name.</p></div>
                    <label className="block text-xs font-semibold text-slate-600">Supplier<input required autoFocus list="vendor-po-suppliers" maxLength={120} value={supplier} onChange={(event) => setSupplier(event.target.value)} placeholder="Type or choose a supplier" className="mt-1 min-h-12 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100" /><datalist id="vendor-po-suppliers">{suppliers.map((name) => <option key={name} value={name} />)}</datalist></label>
                    <label className="block text-xs font-semibold text-slate-600">Purchase order date<input required type="date" value={documentDate} onChange={(event) => setDocumentDate(event.target.value)} className="mt-1 min-h-12 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100" /></label>
                    <p className="rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-600">This order is saved for your team to track. The app does not send it to the supplier.</p>
                </section>}

                {step === 2 && <>
                <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                    <div><h3 className="font-bold text-slate-900">What are you ordering?</h3><p className="mt-1 text-sm text-slate-500">Supplier: <strong className="text-slate-700">{supplier}</strong></p></div>
                    {lowStockToAdd.length > 0 && <button type="button" onClick={addLowStockItems} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 text-xs font-bold text-amber-900 hover:bg-amber-100"><PlusIcon className="h-4 w-4" /> Add {lowStockToAdd.length} low-stock item{lowStockToAdd.length === 1 ? '' : 's'}</button>}
                </div>

                {!items.length && <p className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">Add stock items in Store → Stock & menu setup before creating a vendor purchase order.</p>}
                <section className="overflow-hidden rounded-2xl border border-slate-200">
                    <div className="hidden grid-cols-[minmax(0,1fr)_7rem_8.5rem_7rem_2.5rem] gap-3 bg-slate-50 px-4 py-3 text-[10px] font-bold uppercase tracking-wide text-slate-500 sm:grid"><span>Item · Store on hand</span><span>Order qty</span><span>Cost / unit</span><span className="text-right">Line total</span><span /></div>
                    <div className="divide-y divide-slate-100">{lines.map((line, index) => {
                        const item = items.find((candidate) => candidate._id === line.inventoryItemId);
                        const lineTotal = (Number(line.quantity) || 0) * (Number(line.unitCost) || 0);
                        const excludedIds = selectedIds.filter((id) => id !== line.inventoryItemId);
                        return <article key={line.id} className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_7rem_8.5rem_7rem_2.5rem] sm:items-center sm:px-4">
                            <label className="block min-w-0 text-[10px] font-bold uppercase tracking-wide text-slate-500"><span className="mb-1 flex items-center justify-between">Item {index + 1}<span className="sm:hidden">{item && `${item.currentStock.toFixed(2)} ${item.unit} in Store`}</span></span><InventoryPicker items={items} value={line.inventoryItemId} excludedIds={excludedIds} onSelect={(selected) => chooseItem(line.id, selected)} />{item && <span className="mt-1 block text-[10px] font-normal normal-case text-slate-500">Store has {item.currentStock.toFixed(2)} {item.unit}{item.reorderLevel > 0 ? ` · minimum ${item.reorderLevel.toFixed(2)} ${item.unit}` : ''}</span>}</label>
                            <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-500">Quantity{item && <span className="ml-1 normal-case">({item.unit})</span>}<input required type="number" min="0.0001" max="1000000" step="0.0001" value={line.quantity} onChange={(event) => updateLine(line.id, { quantity: event.target.value })} placeholder="0" className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-800 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100" /></label>
                            <label className="block text-[10px] font-bold uppercase tracking-wide text-slate-500">Cost / unit{item && <span className="ml-1 normal-case">(₹ / {item.unit})</span>}<input required type="number" min="0" max="10000000" step="0.0001" value={line.unitCost} onChange={(event) => updateLine(line.id, { unitCost: event.target.value })} placeholder="0.00" className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-800 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100" /></label>
                            <div className="flex items-center justify-between text-sm font-bold text-slate-800 sm:justify-end">{money(lineTotal)}<button type="button" aria-label={`Remove item ${index + 1}`} onClick={() => setLines((current) => current.filter((candidate) => candidate.id !== line.id))} className="rounded-lg p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600 sm:ml-2"><TrashIcon className="h-4 w-4" /></button></div>
                        </article>;
                    })}</div>
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 p-3 sm:px-4"><button type="button" disabled={lines.length >= 60} onClick={() => setLines((current) => [...current, newLine()])} className="inline-flex min-h-10 items-center gap-2 rounded-lg px-2 text-sm font-bold text-sky-700 hover:bg-sky-50 disabled:opacity-45"><PlusIcon className="h-4 w-4" /> Add another item</button><span className="text-xs text-slate-500">{lines.filter((line) => line.inventoryItemId).length} item{lines.filter((line) => line.inventoryItemId).length === 1 ? '' : 's'} selected · max 60</span></div>
                </section>

                </>}

                {step === 3 && <section className="space-y-4">
                    <div><h3 className="font-bold text-slate-900">Check before saving</h3><p className="mt-1 text-sm text-slate-500">Confirm the supplier, quantities, and estimated amount.</p></div>
                    <div className="rounded-xl border border-slate-200 bg-white">
                        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 p-3"><span className="text-xs text-slate-500">Supplier</span><strong className="text-sm text-slate-800">{supplier}</strong></div>
                        <ul className="divide-y divide-slate-100">{lines.map((line) => {
                            const item = items.find((candidate) => candidate._id === line.inventoryItemId);
                            return <li key={line.id} className="flex items-start justify-between gap-3 p-3"><span className="min-w-0"><strong className="block truncate text-sm text-slate-800">{item?.name || 'Choose item'}</strong><span className="text-xs text-slate-500">{line.quantity || '0'} {item?.unit || ''} × {money(Number(line.unitCost) || 0)} / {item?.unit || 'unit'}</span></span><strong className="shrink-0 text-sm text-slate-800">{money((Number(line.quantity) || 0) * (Number(line.unitCost) || 0))}</strong></li>;
                        })}</ul>
                        <div className="flex items-center justify-between gap-3 border-t border-slate-100 bg-slate-50 p-3"><span className="text-sm font-bold text-slate-700">Estimated total</span><strong className="text-lg text-slate-900">{money(orderTotal)}</strong></div>
                    </div>
                    <label className="block text-xs font-semibold text-slate-600">Delivery note / reference <span className="font-normal text-slate-400">(optional)</span><input maxLength={500} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Expected date or quote number" className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100" /></label>
                    <div className="rounded-xl border border-sky-100 bg-sky-50 p-3 text-xs leading-5 text-sky-900">{purchaseOrder ? 'Saving updates the order record. It does not contact the supplier or change stock.' : 'Saving records the order only; it does not contact the supplier or change Store stock. When delivery arrives, open this order and record the quantity received.'}</div>
                </section>}

                <footer className="flex flex-col-reverse gap-2 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
                    <button type="button" disabled={saving} onClick={step === 1 ? onClose : () => setStep((current) => (current === 3 ? 2 : 1))} className="min-h-11 rounded-xl border border-slate-200 px-4 text-sm font-bold text-slate-600 disabled:opacity-50">{step === 1 ? 'Cancel' : 'Back'}</button>
                    {step === 1 && <button type="button" onClick={continueToItems} disabled={!supplier.trim()} className="min-h-11 rounded-xl bg-sky-600 px-5 text-sm font-bold text-white disabled:opacity-45">Continue to items</button>}
                    {step === 2 && <button type="button" onClick={continueToReview} disabled={!validLines || !uniqueItems} className="min-h-11 rounded-xl bg-sky-600 px-5 text-sm font-bold text-white disabled:opacity-45">Review {lines.filter((line) => line.inventoryItemId).length} items</button>}
                    {step === 3 && <button disabled={saving || !supplier.trim() || !validLines || !uniqueItems} className="min-h-11 rounded-xl bg-sky-600 px-5 text-sm font-bold text-white disabled:opacity-45">{saving ? 'Saving order…' : `${purchaseOrder ? 'Save order changes' : 'Save vendor order'} · ${money(orderTotal)}`}</button>}
                </footer>
            </form>
        </section>
    </div>;
}
