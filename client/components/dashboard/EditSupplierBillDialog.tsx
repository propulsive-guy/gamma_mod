'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';
import { updateInventoryBillPurchase } from '@/app/actions/inventory';
import { INVENTORY_MIS_CATEGORIES } from '@/lib/inventoryCategories';

type StoreItem = { _id: string; name: string; category: string; unit: string; currentStock: number; costPerUnit: number; supplier?: string };
type BillLine = { inventoryItemId: string; itemName: string; unit: string; category?: string; requestedQuantity: number; orderedQuantity: number; receivedQuantity: number; unitCost: number };
type BillPayment = { amount: number; paidAt: string; reference?: string };
export type EditableSupplierBill = {
    _id: string; reference: string; supplier: string; vendorBillNumber?: string; invoiceDate?: string; documentDate?: string;
    notes?: string; createdAt: string; lines: BillLine[]; payments: BillPayment[];
};

type EditRow = {
    id: string; inventoryItemId: string; name: string; newItemName: string; createNew: boolean;
    category: string; quantity: string; unit: string; unitCost: string;
};
type EditPayment = { id: string; amount: string; paidAt: string; reference: string };

const units = ['kg', 'g', 'l', 'ml', 'piece', 'pack', 'box', 'bottle', 'can'];
const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const dateValue = (value?: string) => value ? new Date(value).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) : new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const money = (amount: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(amount || 0);

export default function EditSupplierBillDialog({ bill, items, categories, onClose }: {
    bill: EditableSupplierBill; items: StoreItem[]; categories: string[]; onClose: () => void;
}) {
    const router = useRouter();
    const [supplier, setSupplier] = useState(bill.supplier || '');
    const [billNumber, setBillNumber] = useState(bill.vendorBillNumber || '');
    const [invoiceDate, setInvoiceDate] = useState(dateValue(bill.invoiceDate || bill.documentDate || bill.createdAt));
    const [notes, setNotes] = useState(bill.notes || '');
    const [saving, setSaving] = useState(false);
    const [payments, setPayments] = useState<EditPayment[]>(() => (bill.payments || []).map((payment) => ({
        id: newId(), amount: String(payment.amount), paidAt: dateValue(payment.paidAt), reference: payment.reference || '',
    })));
    const [rows, setRows] = useState<EditRow[]>(() => bill.lines.map((line) => {
        const item = items.find((candidate) => candidate._id === line.inventoryItemId);
        return {
            id: newId(), inventoryItemId: line.inventoryItemId,
            name: line.itemName, newItemName: line.itemName, createNew: !item,
            category: line.category || item?.category || 'Grocery',
            quantity: String(line.receivedQuantity || line.orderedQuantity || line.requestedQuantity),
            unit: item?.unit || line.unit,
            unitCost: String(line.unitCost),
        };
    }));

    const categoryOptions = useMemo(() => [...new Set([
        ...INVENTORY_MIS_CATEGORIES,
        ...categories,
        ...items.map((item) => item.category || ''),
        ...bill.lines.map((line) => line.category || ''),
    ].filter(Boolean))], [bill.lines, categories, items]);
    const total = rows.reduce((sum, row) => sum + Number(row.quantity || 0) * Number(row.unitCost || 0), 0);
    const paidTotal = payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const invalidPayment = payments.some((payment) => !Number.isFinite(Number(payment.amount)) || Number(payment.amount) <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(payment.paidAt) || payment.reference.length > 100);
    const invalid = rows.some((row) => {
        const item = items.find((candidate) => candidate._id === row.inventoryItemId);
        return (!row.createNew && (!row.inventoryItemId || !item))
            || (row.createNew && (!row.newItemName.trim() || !units.includes(row.unit)))
            || !Number.isFinite(Number(row.quantity)) || Number(row.quantity) <= 0
            || !Number.isFinite(Number(row.unitCost)) || Number(row.unitCost) < 0
            || (!row.createNew && item?.unit !== row.unit);
    });

    function patchRow(id: string, patch: Partial<EditRow>) {
        setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
    }

    function addRow() {
        setRows((current) => [...current, { id: newId(), inventoryItemId: '', name: '', newItemName: '', createNew: false, category: categoryOptions[0] || 'Grocery', quantity: '1', unit: 'piece', unitCost: '0' }]);
    }

    async function save(event: React.FormEvent) {
        event.preventDefault();
        if (!supplier.trim()) return toast.error('Enter the supplier name.');
        if (invalid || !rows.length || invalidPayment) return toast.error('Review each bill item and payment amount, date, and reference.');
        setSaving(true);
        try {
            const result = await updateInventoryBillPurchase({
                purchaseDocumentId: bill._id, supplier: supplier.trim(), billReference: billNumber.trim(), invoiceDate, notes,
                payments: payments.map((payment) => ({ amount: Number(payment.amount), paidAt: payment.paidAt, reference: payment.reference.trim() })),
                lines: rows.map((row) => ({
                    inventoryItemId: row.createNew ? '' : row.inventoryItemId,
                    ...(row.createNew ? { newItemName: row.newItemName.trim() } : {}),
                    category: row.category, quantity: Number(row.quantity), unit: row.unit, unitCost: Number(row.unitCost),
                })),
            });
            if (!result.success) return toast.error(result.error || 'Could not update this supplier bill.');
            toast.success('Supplier bill, Store stock, and purchase log updated.');
            window.dispatchEvent(new Event('inventory-stock-changed'));
            router.refresh();
            onClose();
        } catch (error) {
            console.error('Updating supplier bill failed:', error);
            toast.error(error instanceof Error ? error.message : 'Could not update this supplier bill.');
        } finally {
            setSaving(false);
        }
    }

    const inputClass = 'min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-800 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100';

    return <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-4">
        <section role="dialog" aria-modal="true" aria-labelledby="edit-supplier-bill-title" className="flex max-h-[94dvh] w-full max-w-5xl flex-col overflow-hidden rounded-t-3xl bg-white shadow-2xl sm:rounded-3xl">
            <header className="flex items-start justify-between gap-4 border-b border-slate-100 p-4 sm:p-6">
                <div><p className="text-xs font-bold uppercase tracking-wide text-sky-700">Supplier bill · {bill.reference}</p><h2 id="edit-supplier-bill-title" className="mt-1 text-xl font-bold text-slate-900">Edit received bill</h2><p className="mt-1 text-sm text-slate-500">Correct the invoice and its complete item list. Store stock and the MIS purchase entry update together.</p></div>
                <button type="button" onClick={onClose} className="min-h-10 shrink-0 rounded-xl px-3 text-sm font-semibold text-slate-500 hover:bg-slate-100">Close</button>
            </header>
            <form onSubmit={save} className="flex min-h-0 flex-1 flex-col">
                <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-4 sm:p-6">
                    <div className="grid gap-3 sm:grid-cols-3">
                        <label className="text-xs font-semibold text-slate-600">Supplier<input required maxLength={120} value={supplier} onChange={(event) => setSupplier(event.target.value)} className={`mt-1 ${inputClass}`} /></label>
                        <label className="text-xs font-semibold text-slate-600">Invoice / bill number<input maxLength={80} value={billNumber} onChange={(event) => setBillNumber(event.target.value)} placeholder="Optional" className={`mt-1 ${inputClass}`} /></label>
                        <label className="text-xs font-semibold text-slate-600">Invoice date<input required type="date" value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} className={`mt-1 ${inputClass}`} /></label>
                    </div>
                    <label className="block text-xs font-semibold text-slate-600">Bill notes<input maxLength={500} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Optional notes" className={`mt-1 ${inputClass}`} /></label>
                    <section className="overflow-hidden rounded-2xl border border-slate-200">
                        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50 p-3 sm:p-4"><div><h3 className="text-sm font-bold text-slate-900">Bill items</h3><p className="mt-1 text-xs text-slate-500">Change the linked stock item, category, quantity, unit, or unit cost.</p></div><button type="button" onClick={addRow} className="inline-flex min-h-10 items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700"><PlusIcon className="h-4 w-4" /> Add item</button></div>
                        <div className="space-y-3 p-3 sm:p-4">
                            {rows.map((row, index) => {
                                const selected = items.find((item) => item._id === row.inventoryItemId);
                                return <article key={row.id} className="grid gap-3 rounded-xl border border-slate-200 p-3 sm:grid-cols-12 sm:items-end">
                                    <div className="sm:col-span-4"><label className="text-[11px] font-semibold text-slate-500">Inventory item<select value={row.createNew ? '__new__' : row.inventoryItemId} onChange={(event) => {
                                        if (event.target.value === '__new__') patchRow(row.id, { inventoryItemId: '', createNew: true, newItemName: row.name || row.newItemName, name: row.name || row.newItemName });
                                        else { const item = items.find((candidate) => candidate._id === event.target.value); patchRow(row.id, { inventoryItemId: item?._id || '', createNew: false, name: item?.name || '', newItemName: item?.name || '', category: item?.category || row.category, unit: item?.unit || row.unit }); }
                                    }} className={`mt-1 ${inputClass}`}><option value="">Choose stock item</option>{items.map((item) => <option key={item._id} value={item._id}>{item.name} · {item.unit}</option>)}<option value="__new__">＋ Create a new stock item</option></select></label></div>
                                    {row.createNew && <div className="sm:col-span-3"><label className="text-[11px] font-semibold text-slate-500">New item name<input required maxLength={120} value={row.newItemName} onChange={(event) => patchRow(row.id, { newItemName: event.target.value, name: event.target.value })} className={`mt-1 ${inputClass}`} /></label></div>}
                                    <div className={row.createNew ? 'sm:col-span-2' : 'sm:col-span-3'}><label className="text-[11px] font-semibold text-slate-500">Store category<select value={row.category} onChange={(event) => patchRow(row.id, { category: event.target.value })} className={`mt-1 ${inputClass}`}>{categoryOptions.map((category) => <option key={category}>{category}</option>)}</select></label></div>
                                    <div className="sm:col-span-2"><label className="text-[11px] font-semibold text-slate-500">Quantity<input type="number" min="0.0001" step="0.0001" value={row.quantity} onChange={(event) => patchRow(row.id, { quantity: event.target.value })} className={`mt-1 ${inputClass}`} /></label></div>
                                    <div className="sm:col-span-2"><label className="text-[11px] font-semibold text-slate-500">Unit{row.createNew
                                        ? <select aria-label={`Stock unit for item ${index + 1}`} value={row.unit} onChange={(event) => patchRow(row.id, { unit: event.target.value })} className={`mt-1 ${inputClass}`}>{units.map((unit) => <option key={unit}>{unit}</option>)}</select>
                                        : <input readOnly value={row.unit} className={`mt-1 ${inputClass} bg-slate-50`} />}</label></div>
                                    <div className="sm:col-span-2"><label className="text-[11px] font-semibold text-slate-500">Cost / unit (₹)<input type="number" min="0" step="0.01" value={row.unitCost} onChange={(event) => patchRow(row.id, { unitCost: event.target.value })} className={`mt-1 ${inputClass}`} /></label></div>
                                    <div className="flex items-center justify-between gap-2 sm:col-span-12"><span className="text-xs font-semibold text-slate-500">Line total: {money(Number(row.quantity || 0) * Number(row.unitCost || 0))}{selected && <span className="ml-2 font-normal">· Store has {Number(selected.currentStock || 0).toFixed(2)} {selected.unit}</span>}</span><button type="button" onClick={() => setRows((current) => current.filter((item) => item.id !== row.id))} aria-label={`Remove item ${index + 1}`} className="inline-flex min-h-9 items-center gap-1 rounded-lg px-2 text-xs font-semibold text-rose-600 hover:bg-rose-50"><TrashIcon className="h-4 w-4" /> Remove</button></div>
                                </article>;
                            })}
                            {!rows.length && <p className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">No bill items. Add at least one line before saving.</p>}
                        </div>
                    </section>
                    <section className="overflow-hidden rounded-2xl border border-slate-200">
                        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 bg-slate-50 p-3 sm:p-4"><div><h3 className="text-sm font-bold text-slate-900">Payments made</h3><p className="mt-1 text-xs text-slate-500">Edit, add, or remove payments recorded against this supplier bill.</p></div><button type="button" onClick={() => setPayments((current) => [...current, { id: newId(), amount: '', paidAt: dateValue(), reference: '' }])} className="inline-flex min-h-10 items-center gap-1 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700"><PlusIcon className="h-4 w-4" /> Add payment</button></div>
                        <div className="space-y-3 p-3 sm:p-4">{payments.map((payment, index) => <article key={payment.id} className="grid gap-3 rounded-xl border border-slate-200 p-3 sm:grid-cols-12 sm:items-end"><label className="text-[11px] font-semibold text-slate-500 sm:col-span-3">Amount (₹)<input type="number" min="0.01" step="0.01" value={payment.amount} onChange={(event) => setPayments((current) => current.map((row) => row.id === payment.id ? { ...row, amount: event.target.value } : row))} className={`mt-1 ${inputClass}`} /></label><label className="text-[11px] font-semibold text-slate-500 sm:col-span-3">Payment date<input type="date" value={payment.paidAt} onChange={(event) => setPayments((current) => current.map((row) => row.id === payment.id ? { ...row, paidAt: event.target.value } : row))} className={`mt-1 ${inputClass}`} /></label><label className="text-[11px] font-semibold text-slate-500 sm:col-span-5">Payment reference<input maxLength={100} value={payment.reference} onChange={(event) => setPayments((current) => current.map((row) => row.id === payment.id ? { ...row, reference: event.target.value } : row))} className={`mt-1 ${inputClass}`} /></label><button type="button" onClick={() => setPayments((current) => current.filter((row) => row.id !== payment.id))} aria-label={`Remove payment ${index + 1}`} className="inline-flex min-h-10 items-center justify-center gap-1 rounded-lg px-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 sm:col-span-1"><TrashIcon className="h-4 w-4" /> <span className="sm:hidden">Remove payment</span></button></article>)}{!payments.length && <p className="rounded-xl border border-dashed border-slate-300 p-4 text-center text-sm text-slate-500">No payments recorded for this bill.</p>}<p className="text-right text-xs font-semibold text-slate-600">Payments total: {money(paidTotal)}{paidTotal > total && <span className="ml-2 text-rose-600">· Exceeds bill total</span>}</p></div>
                    </section>
                </div>
                <footer className="flex flex-col gap-3 border-t border-slate-100 bg-white p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6"><p className="text-sm font-semibold text-slate-600">Bill {money(total)} <span className="mx-1 text-slate-300">·</span> Paid {money(paidTotal)} <span className="mx-1 text-slate-300">·</span> Due {money(Math.max(0, total - paidTotal))}</p><div className="flex flex-col-reverse gap-2 sm:flex-row"><button type="button" onClick={onClose} className="min-h-11 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-600">Cancel</button><button disabled={saving || invalid || invalidPayment || !rows.length || paidTotal > total + 0.01} className="min-h-11 rounded-xl bg-sky-600 px-5 text-sm font-bold text-white disabled:opacity-50">{saving ? 'Updating bill…' : 'Save bill changes'}</button></div></footer>
            </form>
        </section>
    </div>;
}
