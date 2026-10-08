'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'react-hot-toast';
import {
    AdjustmentsHorizontalIcon, ArchiveBoxIcon, ArrowDownTrayIcon, ArrowUpTrayIcon,
    BanknotesIcon, ExclamationTriangleIcon, MagnifyingGlassIcon, PlusIcon, TrashIcon,
} from '@heroicons/react/24/outline';
import { adjustInventoryStock, archiveInventoryItem, createInventoryItem, updateInventoryItem, type InventoryInput } from '@/app/actions/inventory';
import { formatCurrency, formatDate } from '@/lib/utils';
import { InventoryBillScanner } from '@/components/dashboard/InventoryBillScanner';

type InventoryItem = InventoryInput & {
    _id: string;
    currentStock: number;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
};
type Movement = {
    _id: string;
    inventoryItemId: { _id: string; name: string; unit: string } | string;
    type: string;
    quantity: number;
    stockBefore: number;
    stockAfter: number;
    note?: string;
    createdAt: string;
};

const emptyForm: InventoryInput = {
    name: '', sku: '', category: 'General', unit: 'kg', currentStock: 0,
    reorderLevel: 0, costPerUnit: 0, supplier: '', notes: '',
};
const units = ['kg', 'g', 'l', 'ml', 'piece', 'pack', 'box', 'bottle', 'can'];

export function InventoryManager({ initialItems, initialMovements }: { initialItems: InventoryItem[]; initialMovements: Movement[] }) {
    const router = useRouter();
    const [showForm, setShowForm] = useState(false);
    const [editing, setEditing] = useState<InventoryItem | null>(null);
    const [form, setForm] = useState<InventoryInput>(emptyForm);
    const [saving, setSaving] = useState(false);
    const [query, setQuery] = useState('');
    const [stockFilter, setStockFilter] = useState<'all' | 'low' | 'out'>('all');
    const [adjusting, setAdjusting] = useState<InventoryItem | null>(null);
    const [adjustment, setAdjustment] = useState({ type: 'purchase', quantity: '', note: '', unitCost: '' });

    const inventoryValue = initialItems.reduce((sum, item) => sum + item.currentStock * item.costPerUnit, 0);
    const lowStock = initialItems.filter((item) => item.currentStock > 0 && item.currentStock <= item.reorderLevel);
    const outOfStock = initialItems.filter((item) => item.currentStock === 0);
    const needsRestock = initialItems.filter((item) => item.currentStock <= item.reorderLevel);
    const filtered = useMemo(() => initialItems.filter((item) => {
        const matchesQuery = `${item.name} ${item.sku} ${item.category} ${item.supplier}`.toLowerCase().includes(query.toLowerCase());
        const matchesStock = stockFilter === 'all' || (stockFilter === 'out' ? item.currentStock === 0 : item.currentStock > 0 && item.currentStock <= item.reorderLevel);
        return matchesQuery && matchesStock;
    }), [initialItems, query, stockFilter]);

    const openNew = () => { setEditing(null); setForm(emptyForm); setShowForm(true); };
    const openEdit = (item: InventoryItem) => {
        setEditing(item);
        setForm({ name: item.name, sku: item.sku || '', category: item.category, unit: item.unit, reorderLevel: item.reorderLevel, costPerUnit: item.costPerUnit, supplier: item.supplier || '', notes: item.notes || '' });
        setShowForm(true);
    };
    const save = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!form.name.trim() || form.reorderLevel < 0 || form.costPerUnit < 0 || (!editing && Number(form.currentStock) < 0)) {
            toast.error('Check the name, stock, reorder level, and cost');
            return;
        }
        setSaving(true);
        const result = editing ? await updateInventoryItem(editing._id, form) : await createInventoryItem(form);
        setSaving(false);
        if (!result.success) return toast.error(result.error || 'Could not save item');
        toast.success(editing ? 'Inventory item updated' : 'Inventory item added');
        window.dispatchEvent(new Event('inventory-stock-changed'));
        setShowForm(false);
        router.refresh();
    };
    const saveAdjustment = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!adjusting || !Number(adjustment.quantity)) return toast.error('Enter a quantity');
        setSaving(true);
        const result = await adjustInventoryStock(adjusting._id, {
            type: adjustment.type, quantity: Number(adjustment.quantity), note: adjustment.note,
            ...(adjustment.type === 'purchase' && adjustment.unitCost !== '' ? { unitCost: Number(adjustment.unitCost) } : {}),
        });
        setSaving(false);
        if (!result.success) return toast.error(result.error || 'Could not adjust stock');
        toast.success('Stock updated');
        window.dispatchEvent(new Event('inventory-stock-changed'));
        setAdjusting(null);
        setAdjustment({ type: 'purchase', quantity: '', note: '', unitCost: '' });
        router.refresh();
    };
    const archive = async (item: InventoryItem) => {
        if (!window.confirm(`Archive ${item.name}? Its movement history will be preserved.`)) return;
        const result = await archiveInventoryItem(item._id);
        if (!result.success) return toast.error(result.error || 'Could not archive item');
        toast.success('Inventory item archived');
        window.dispatchEvent(new Event('inventory-stock-changed'));
        router.refresh();
    };
    const inputClass = 'h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100';
    const summaryCards = [
        { label: 'Active items', value: initialItems.length, icon: ArchiveBoxIcon, tone: 'bg-sky-50 text-sky-600' },
        { label: 'Low stock', value: lowStock.length, icon: ExclamationTriangleIcon, tone: 'bg-amber-50 text-amber-600' },
        { label: 'Out of stock', value: outOfStock.length, icon: ArrowDownTrayIcon, tone: 'bg-red-50 text-red-600' },
        { label: 'Stock value', value: formatCurrency(inventoryValue), icon: BanknotesIcon, tone: 'bg-emerald-50 text-emerald-600' },
    ];

    return (
        <div className="space-y-6">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                <div><h1 className="text-2xl font-bold tracking-tight text-slate-900">Inventory Management</h1><p className="mt-1 text-sm text-slate-500">Track ingredients, supplies, costs, purchasing, usage, and wastage.</p></div>
                <button onClick={openNew} className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-500 px-4 py-3 text-sm font-bold text-white shadow-sm hover:bg-sky-600"><PlusIcon className="h-5 w-5" /> Add inventory item</button>
            </div>

            <InventoryBillScanner items={initialItems.map(({ _id, name, unit, currentStock, costPerUnit }) => ({ _id, name, unit, currentStock, costPerUnit }))} />

            <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                {summaryCards.map((card) => <div key={card.label} className="rounded-2xl border border-slate-200/70 bg-white p-5"><div className={`inline-flex rounded-xl p-2 ${card.tone}`}><card.icon className="h-5 w-5" /></div><p className="mt-3 text-2xl font-bold text-slate-900">{card.value}</p><p className="text-xs text-slate-500">{card.label}</p></div>)}
            </div>

            {needsRestock.length > 0 && (
                <div role="alert" className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-amber-900">
                    <ExclamationTriangleIcon className="h-5 w-5 shrink-0" />
                    <div>
                        <p className="text-sm font-bold">Low stock alert</p>
                        <p className="mt-1 text-sm">{needsRestock.slice(0, 6).map((item) => `${item.name}: ${item.currentStock} ${item.unit}`).join(' · ')}{needsRestock.length > 6 ? ` · and ${needsRestock.length - 6} more` : ''}</p>
                        <p className="mt-1 text-xs text-amber-800">These items are at or below their reorder level.</p>
                    </div>
                </div>
            )}

            {showForm && (
                <section className="rounded-2xl border border-sky-200 bg-white p-5 shadow-sm">
                    <div className="mb-5 flex justify-between"><div><h2 className="font-bold text-slate-900">{editing ? 'Edit inventory item' : 'Add inventory item'}</h2><p className="text-xs text-slate-500">Stock changes after creation are recorded through Adjust Stock.</p></div><button onClick={() => setShowForm(false)} className="text-sm font-semibold text-slate-500">Close</button></div>
                    <form onSubmit={save} className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                        <label className="text-xs font-semibold text-slate-600">Item name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={`mt-1.5 ${inputClass}`} /></label>
                        <label className="text-xs font-semibold text-slate-600">SKU / Code<input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} className={`mt-1.5 ${inputClass}`} /></label>
                        <label className="text-xs font-semibold text-slate-600">Category<input value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} className={`mt-1.5 ${inputClass}`} /></label>
                        <label className="text-xs font-semibold text-slate-600">Unit<select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} className={`mt-1.5 ${inputClass}`}>{units.map((unit) => <option key={unit}>{unit}</option>)}</select></label>
                        {!editing && <label className="text-xs font-semibold text-slate-600">Opening stock<input type="number" min="0" step="0.0001" value={form.currentStock} onChange={(e) => setForm({ ...form, currentStock: Number(e.target.value) })} className={`mt-1.5 ${inputClass}`} /></label>}
                        <label className="text-xs font-semibold text-slate-600">Reorder at<input type="number" min="0" step="0.0001" value={form.reorderLevel} onChange={(e) => setForm({ ...form, reorderLevel: Number(e.target.value) })} className={`mt-1.5 ${inputClass}`} /></label>
                        <label className="text-xs font-semibold text-slate-600">Cost per unit (₹)<input type="number" min="0" step="0.01" value={form.costPerUnit} onChange={(e) => setForm({ ...form, costPerUnit: Number(e.target.value) })} className={`mt-1.5 ${inputClass}`} /></label>
                        <label className="text-xs font-semibold text-slate-600">Supplier<input value={form.supplier} onChange={(e) => setForm({ ...form, supplier: e.target.value })} className={`mt-1.5 ${inputClass}`} /></label>
                        <label className="text-xs font-semibold text-slate-600 md:col-span-2 lg:col-span-3">Notes<input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={`mt-1.5 ${inputClass}`} /></label>
                        <div className="flex items-end"><button disabled={saving} className="h-11 w-full rounded-xl bg-slate-900 px-5 text-sm font-bold text-white disabled:opacity-50">{saving ? 'Saving…' : editing ? 'Save changes' : 'Add item'}</button></div>
                    </form>
                </section>
            )}

            <section className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white">
                <div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row">
                    <div className="relative flex-1"><MagnifyingGlassIcon className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search item, SKU, category, or supplier" className="h-10 w-full rounded-xl border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-sky-400" /></div>
                    <div className="flex gap-2">{(['all', 'low', 'out'] as const).map((filter) => <button key={filter} onClick={() => setStockFilter(filter)} className={`rounded-xl px-3 py-2 text-xs font-bold capitalize ${stockFilter === filter ? 'bg-sky-100 text-sky-700' : 'bg-slate-50 text-slate-500'}`}>{filter === 'all' ? 'All stock' : filter === 'low' ? 'Low stock' : 'Out of stock'}</button>)}</div>
                </div>
                {!filtered.length ? <p className="p-12 text-center text-sm text-slate-400">No inventory items match this view.</p> : (
                    <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-left text-sm"><thead className="bg-slate-50 text-[11px] uppercase tracking-wider text-slate-500"><tr><th className="px-5 py-3">Item</th><th className="px-4 py-3">Stock</th><th className="px-4 py-3">Reorder level</th><th className="px-4 py-3">Cost</th><th className="px-4 py-3">Value</th><th className="px-4 py-3">Supplier</th><th className="px-5 py-3 text-right">Actions</th></tr></thead><tbody className="divide-y divide-slate-100">{filtered.map((item) => {
                        const status = item.currentStock === 0 ? 'out' : item.currentStock <= item.reorderLevel ? 'low' : 'ok';
                        return <tr key={item._id} className="hover:bg-slate-50/60"><td className="px-5 py-4"><p className="font-semibold text-slate-900">{item.name}</p><p className="text-[11px] text-slate-400">{item.category}{item.sku ? ` · ${item.sku}` : ''}</p></td><td className="px-4 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-bold ${status === 'out' ? 'bg-red-50 text-red-700' : status === 'low' ? 'bg-amber-50 text-amber-700' : 'bg-emerald-50 text-emerald-700'}`}>{item.currentStock} {item.unit}</span></td><td className="px-4 py-4 text-slate-600">{item.reorderLevel} {item.unit}</td><td className="px-4 py-4 text-slate-600">{formatCurrency(item.costPerUnit)}</td><td className="px-4 py-4 font-semibold text-slate-800">{formatCurrency(item.currentStock * item.costPerUnit)}</td><td className="px-4 py-4 text-slate-500">{item.supplier || '—'}</td><td className="px-5 py-4"><div className="flex justify-end gap-2"><button onClick={() => { setAdjusting(item); setAdjustment({ type: 'purchase', quantity: '', note: '', unitCost: String(item.costPerUnit) }); }} className="rounded-lg bg-sky-50 px-3 py-2 text-xs font-bold text-sky-700">Adjust</button><button onClick={() => openEdit(item)} className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700">Edit</button><button onClick={() => archive(item)} aria-label={`Archive ${item.name}`} className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"><TrashIcon className="h-4 w-4" /></button></div></td></tr>;
                    })}</tbody></table></div>
                )}
            </section>

            <section className="rounded-2xl border border-slate-200/70 bg-white p-5">
                <h2 className="font-bold text-slate-900">Recent stock activity</h2>
                <div className="mt-4 space-y-2">{!initialMovements.length ? <p className="py-7 text-center text-sm text-slate-400">Stock movements will appear here.</p> : initialMovements.slice(0, 20).map((movement) => {
                    const item = typeof movement.inventoryItemId === 'string' ? null : movement.inventoryItemId;
                    return <div key={movement._id} className="flex items-center justify-between gap-4 rounded-xl bg-slate-50 px-4 py-3"><div className="flex min-w-0 items-center gap-3">{movement.quantity >= 0 ? <ArrowUpTrayIcon className="h-4 w-4 text-emerald-600" /> : <ArrowDownTrayIcon className="h-4 w-4 text-red-500" />}<div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-800">{item?.name || 'Archived item'} · <span className="capitalize">{movement.type}</span></p><p className="truncate text-[11px] text-slate-400">{movement.note || 'No note'} · {formatDate(movement.createdAt)}</p></div></div><p className={`shrink-0 text-sm font-bold ${movement.quantity >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{movement.quantity >= 0 ? '+' : ''}{movement.quantity} {item?.unit || ''}<span className="ml-2 text-[10px] font-normal text-slate-400">→ {movement.stockAfter}</span></p></div>;
                })}</div>
            </section>

            {adjusting && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/50 p-4 backdrop-blur-sm"><form onSubmit={saveAdjustment} className="w-full max-w-md rounded-3xl bg-white p-6 shadow-2xl"><div className="flex justify-between"><div><h2 className="text-xl font-bold text-slate-900">Adjust {adjusting.name}</h2><p className="mt-1 text-xs text-slate-500">Current stock: {adjusting.currentStock} {adjusting.unit}</p></div><button type="button" onClick={() => setAdjusting(null)} className="text-sm font-semibold text-slate-500">Close</button></div><div className="mt-5 space-y-4"><label className="block text-xs font-semibold text-slate-600">Movement<select value={adjustment.type} onChange={(e) => setAdjustment({ ...adjustment, type: e.target.value })} className={`mt-1.5 ${inputClass}`}><option value="purchase">Purchase / Stock in</option><option value="usage">Kitchen usage</option><option value="wastage">Wastage</option><option value="return">Return to stock</option><option value="correction">Manual correction (+ or -)</option></select></label><label className="block text-xs font-semibold text-slate-600">Quantity ({adjusting.unit})<input required type="number" step="0.0001" value={adjustment.quantity} onChange={(e) => setAdjustment({ ...adjustment, quantity: e.target.value })} className={`mt-1.5 ${inputClass}`} placeholder={adjustment.type === 'correction' ? 'Use negative to reduce stock' : 'Enter quantity'} /></label>{adjustment.type === 'purchase' && <label className="block text-xs font-semibold text-slate-600">New cost per unit (₹)<input type="number" min="0" step="0.01" value={adjustment.unitCost} onChange={(e) => setAdjustment({ ...adjustment, unitCost: e.target.value })} className={`mt-1.5 ${inputClass}`} /></label>}<label className="block text-xs font-semibold text-slate-600">Note<input value={adjustment.note} onChange={(e) => setAdjustment({ ...adjustment, note: e.target.value })} className={`mt-1.5 ${inputClass}`} placeholder="Invoice, reason, or reference" /></label><button disabled={saving} className="h-12 w-full rounded-xl bg-sky-500 font-bold text-white disabled:opacity-50">{saving ? 'Updating…' : 'Update stock'}</button></div></form></div>}
        </div>
    );
}
