'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'react-hot-toast';
import { MagnifyingGlassIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { archiveInventoryItem, createInventoryItem, updateInventoryItem, type InventoryInput } from '@/app/actions/inventory';

type InventoryItem = InventoryInput & { _id: string; isActive: boolean };
const emptyForm: InventoryInput = {
    name: '', sku: '', category: 'General', unit: 'kg', currentStock: 0,
    reorderLevel: 0, costPerUnit: 0, supplier: '', notes: '', wasteBehavior: 'carry_forward',
};
const units = ['kg', 'g', 'l', 'ml', 'piece', 'pack', 'box', 'bottle', 'can'];
const inputClass = 'min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100';

export function InventoryManager({ initialItems, usageByInventoryItem, menuSetup }: {
    initialItems: InventoryItem[];
    usageByInventoryItem: Record<string, string[]>;
    menuSetup: { total: number; linked: number };
}) {
    const router = useRouter();
    const [showForm, setShowForm] = useState(false);
    const [editing, setEditing] = useState<InventoryItem | null>(null);
    const [form, setForm] = useState<InventoryInput>(emptyForm);
    const [saving, setSaving] = useState(false);
    const [query, setQuery] = useState('');
    const filtered = useMemo(() => initialItems.filter((item) =>
        `${item.name} ${item.sku} ${item.category}`.toLowerCase().includes(query.trim().toLowerCase()),
    ), [initialItems, query]);

    const openNew = () => { setEditing(null); setForm(emptyForm); setShowForm(true); };
    const openEdit = (item: InventoryItem) => {
        setEditing(item);
        setForm({
            name: item.name, sku: item.sku || '', category: item.category, unit: item.unit,
            currentStock: 0, reorderLevel: item.reorderLevel, costPerUnit: item.costPerUnit,
            supplier: item.supplier || '', notes: item.notes || '', wasteBehavior: item.wasteBehavior || 'carry_forward',
        });
        setShowForm(true);
    };
    const save = async (event: React.FormEvent) => {
        event.preventDefault();
        if (!form.name.trim() || form.costPerUnit < 0) return toast.error('Enter an ingredient name and a valid cost');
        setSaving(true);
        const result = editing ? await updateInventoryItem(editing._id, form) : await createInventoryItem(form);
        setSaving(false);
        if (!result.success) return toast.error(result.error || 'Could not save ingredient');
        toast.success(editing ? 'Ingredient updated' : 'Ingredient added');
        setShowForm(false);
        router.refresh();
    };
    const archive = async (item: InventoryItem) => {
        if (!window.confirm(`Archive ${item.name}?`)) return;
        const result = await archiveInventoryItem(item._id);
        if (!result.success) return toast.error(result.error || 'Could not archive ingredient');
        toast.success('Ingredient archived');
        router.refresh();
    };

    return <section className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div><h2 className="text-lg font-bold text-slate-900">Ingredient catalog</h2><p className="mt-1 text-sm text-slate-500">Kitchen stock is shown above by department. This list is only the shared ingredient and recipe catalog.</p></div>
            <button onClick={openNew} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 text-sm font-bold text-white"><PlusIcon className="h-5 w-5" /> Add ingredient</button>
        </header>

        <section className="flex flex-col gap-3 rounded-xl border border-sky-100 bg-sky-50 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div><h3 className="font-bold text-slate-900">Menu recipe setup</h3><p className="mt-1 text-sm text-slate-600">Link menu dishes to ingredients and quantities per serving. Served orders deduct from that kitchen department.</p><p className="mt-1 text-xs font-semibold text-slate-700">{menuSetup.linked} of {menuSetup.total} menu items linked</p></div>
            <a href="/dashboard/menu" className="inline-flex min-h-10 shrink-0 items-center justify-center rounded-lg bg-sky-700 px-4 text-sm font-bold text-white">Set up menu recipes</a>
        </section>

        {showForm && <form onSubmit={save} className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="flex items-center justify-between sm:col-span-2 lg:col-span-3"><h3 className="font-bold text-slate-900">{editing ? 'Edit ingredient' : 'Add ingredient'}</h3><button type="button" onClick={() => setShowForm(false)} className="px-2 py-1 text-sm font-semibold text-slate-500">Close</button></div>
            <label className="text-xs font-semibold text-slate-600">Ingredient name<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className={`mt-1 ${inputClass}`} /></label>
            <label className="text-xs font-semibold text-slate-600">Category<input value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} className={`mt-1 ${inputClass}`} /></label>
            <label className="text-xs font-semibold text-slate-600">Code (optional)<input value={form.sku} onChange={(event) => setForm({ ...form, sku: event.target.value })} className={`mt-1 ${inputClass}`} /></label>
            <label className="text-xs font-semibold text-slate-600">Stock unit<select disabled={!!editing && !!usageByInventoryItem[editing._id]?.length} value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value })} className={`mt-1 ${inputClass} disabled:bg-slate-100`}>{units.map((unit) => <option key={unit}>{unit}</option>)}</select></label>
            <label className="text-xs font-semibold text-slate-600">Cost per unit (₹)<input type="number" min="0" step="0.01" value={form.costPerUnit} onChange={(event) => setForm({ ...form, costPerUnit: Number(event.target.value) })} className={`mt-1 ${inputClass}`} /></label>
            <label className="text-xs font-semibold text-slate-600">Unused stock behavior<select value={form.wasteBehavior} onChange={(event) => setForm({ ...form, wasteBehavior: event.target.value as InventoryInput['wasteBehavior'] })} className={`mt-1 ${inputClass}`}><option value="carry_forward">Can carry over</option><option value="perishable">Perishable</option></select></label>
            <button disabled={saving} className="min-h-11 rounded-xl bg-slate-900 px-4 text-sm font-bold text-white disabled:opacity-50 sm:col-span-2 lg:col-span-3">{saving ? 'Saving…' : editing ? 'Save ingredient' : 'Add ingredient'}</button>
        </form>}

        <div className="relative"><MagnifyingGlassIcon className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search ingredients" className="min-h-10 w-full rounded-xl border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-sky-400" /></div>
        {!filtered.length ? <p className="rounded-xl bg-slate-50 p-8 text-center text-sm text-slate-500">{initialItems.length ? 'No ingredients match this search.' : 'No ingredients yet. Add the ingredients used by your menu.'}</p> : <div className="divide-y divide-slate-100">{filtered.map((item) => <article key={item._id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-slate-900">{item.name}</h3><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-600">{item.category}</span><span className="text-xs text-slate-500">{item.unit}</span></div><p className="mt-1 text-xs text-slate-500">{usageByInventoryItem[item._id]?.length ? `Used in: ${usageByInventoryItem[item._id].join(', ')}` : 'Not linked to a menu recipe yet'}</p></div><div className="flex shrink-0 gap-2"><button onClick={() => openEdit(item)} className="min-h-9 rounded-lg bg-slate-100 px-3 text-xs font-bold text-slate-700">Edit</button><button onClick={() => archive(item)} aria-label={`Archive ${item.name}`} className="flex min-h-9 min-w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"><TrashIcon className="h-4 w-4" /></button></div></article>)}</div>}
    </section>;
}
