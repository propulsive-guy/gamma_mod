'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'react-hot-toast';
import { MagnifyingGlassIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { archiveInventoryItem, createInventoryItem, updateInventoryItem, type InventoryInput } from '@/app/actions/inventory';
import { createInventoryCategory } from '@/app/actions/store';
import { INVENTORY_MIS_CATEGORIES } from '@/lib/inventoryCategories';
import { effectiveExpiryDays } from '../../../shared/kitchenStockLots';

type InventoryItem = InventoryInput & { _id: string; isActive: boolean; wasteBehavior?: 'carry_forward' | 'perishable' };
const emptyForm: InventoryInput = {
    name: '', sku: '', category: 'Grocery', unit: 'kg', currentStock: 0,
    reorderLevel: 0, costPerUnit: 0, supplier: '', notes: '', expiryDays: 2,
};
const units = ['kg', 'g', 'l', 'ml', 'piece', 'pack', 'box', 'bottle', 'can'];
const inputClass = 'min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100';

export function InventoryManager({ initialItems, categories = [], usageByInventoryItem }: {
    initialItems: InventoryItem[];
    categories?: string[];
    usageByInventoryItem: Record<string, string[]>;
}) {
    const router = useRouter();
    const [showForm, setShowForm] = useState(false);
    const [editing, setEditing] = useState<InventoryItem | null>(null);
    const [form, setForm] = useState<InventoryInput>(emptyForm);
    const [saving, setSaving] = useState(false);
    const [query, setQuery] = useState('');
    const [newCategory, setNewCategory] = useState('');
    const [savingCategory, setSavingCategory] = useState(false);
    const [addedCategories, setAddedCategories] = useState<string[]>([]);
    const categoryOptions = [...new Set([...INVENTORY_MIS_CATEGORIES, ...categories, ...addedCategories, ...initialItems.map((item) => item.category)].filter(Boolean))];
    const filtered = useMemo(() => initialItems.filter((item) =>
        `${item.name} ${item.sku} ${item.category}`.toLowerCase().includes(query.trim().toLowerCase()),
    ), [initialItems, query]);

    const openNew = () => { setEditing(null); setForm(emptyForm); setShowForm(true); };
    const openEdit = (item: InventoryItem) => {
        setEditing(item);
        setForm({
            name: item.name, sku: item.sku || '', category: item.category, unit: item.unit,
            currentStock: 0, reorderLevel: item.reorderLevel, costPerUnit: item.costPerUnit,
            supplier: item.supplier || '', notes: item.notes || '', expiryDays: effectiveExpiryDays(item),
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
    const saveCategory = async (event: React.FormEvent) => {
        event.preventDefault();
        setSavingCategory(true);
        const result = await createInventoryCategory(newCategory);
        setSavingCategory(false);
        if (!result.success) return toast.error(result.error || 'Could not save category');
        const category = result.category || newCategory.trim();
        setAddedCategories((current) => [...new Set([...current, category])]);
        setNewCategory('');
        toast.success('Stock category saved');
        router.refresh();
    };
    const archive = async (item: InventoryItem) => {
        if (!window.confirm(`Archive ${item.name}?`)) return;
        const result = await archiveInventoryItem(item._id);
        if (!result.success) return toast.error(result.error || 'Could not archive ingredient');
        toast.success('Ingredient archived');
        router.refresh();
    };

    return <section id="ingredient-catalog" className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div><h2 className="text-lg font-bold text-slate-900">Ingredients for menu recipes</h2><p className="mt-1 text-sm text-slate-500">Add each ingredient once, then select it on a menu item and set the amount per serving.</p></div>
            <button onClick={openNew} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 text-sm font-bold text-white"><PlusIcon className="h-5 w-5" /> Add ingredient</button>
        </header>

        <form onSubmit={saveCategory} className="flex flex-col gap-2 rounded-xl bg-slate-50 p-3 sm:flex-row">
            <input aria-label="New stock category" required minLength={2} maxLength={80} value={newCategory} onChange={(event) => setNewCategory(event.target.value)} placeholder="Add a category, e.g. Dairy" className={inputClass} />
            <button disabled={savingCategory || !newCategory.trim()} className="min-h-11 shrink-0 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 disabled:opacity-50">{savingCategory ? 'Saving…' : 'Add category'}</button>
        </form>

        {showForm && <form onSubmit={save} className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-4 sm:grid-cols-2 lg:grid-cols-3">
            <div className="flex items-center justify-between sm:col-span-2 lg:col-span-3"><h3 className="font-bold text-slate-900">{editing ? 'Edit ingredient' : 'Add ingredient'}</h3><button type="button" onClick={() => setShowForm(false)} className="px-2 py-1 text-sm font-semibold text-slate-500">Close</button></div>
            <label className="text-xs font-semibold text-slate-600">Ingredient name<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} className={`mt-1 ${inputClass}`} /></label>
            <label className="text-xs font-semibold text-slate-600">Stock category<input list="inventory-mis-categories" value={form.category} onChange={(event) => setForm({ ...form, category: event.target.value })} placeholder="Choose or enter a category" className={`mt-1 ${inputClass}`} /><datalist id="inventory-mis-categories">{categoryOptions.map((category) => <option key={category} value={category} />)}</datalist></label>
            <label className="text-xs font-semibold text-slate-600">Code (optional)<input value={form.sku} onChange={(event) => setForm({ ...form, sku: event.target.value })} className={`mt-1 ${inputClass}`} /></label>
            <label className="text-xs font-semibold text-slate-600">Stock unit<select disabled={!!editing && !!usageByInventoryItem[editing._id]?.length} value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value })} className={`mt-1 ${inputClass} disabled:bg-slate-100`}>{units.map((unit) => <option key={unit}>{unit}</option>)}</select></label>
            <label className="text-xs font-semibold text-slate-600">Cost per unit (₹)<input type="number" min="0" step="0.01" value={form.costPerUnit} onChange={(event) => setForm({ ...form, costPerUnit: Number(event.target.value) })} className={`mt-1 ${inputClass}`} /></label>
            <label className="text-xs font-semibold text-slate-600">Expires after (days)<input type="number" required min="1" max="3650" step="1" value={form.expiryDays} onChange={(event) => setForm({ ...form, expiryDays: Number(event.target.value) })} className={`mt-1 ${inputClass}`} /><span className="mt-1 block font-normal text-slate-500">The timer starts when Store issues it to Kitchen. For example, milk: 1 day; raw rice: 60 days.</span></label>
            <button disabled={saving} className="min-h-11 rounded-xl bg-slate-900 px-4 text-sm font-bold text-white disabled:opacity-50 sm:col-span-2 lg:col-span-3">{saving ? 'Saving…' : editing ? 'Save ingredient' : 'Add ingredient'}</button>
        </form>}

        <div className="relative"><MagnifyingGlassIcon className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search ingredients" className="min-h-10 w-full rounded-xl border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-sky-400" /></div>
        {!filtered.length ? <p className="rounded-xl bg-slate-50 p-8 text-center text-sm text-slate-500">{initialItems.length ? 'No ingredients match this search.' : 'No ingredients yet. Add the ingredients used by your menu.'}</p> : <div className="max-h-80 divide-y divide-slate-100 overflow-y-auto overscroll-contain rounded-xl border border-slate-100 px-3" role="region" aria-label="Ingredient catalog" tabIndex={0}>{filtered.map((item) => <article key={item._id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold text-slate-900">{item.name}</h3><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] font-semibold text-slate-600">{item.category}</span><span className="text-xs text-slate-500">{item.unit}</span></div><p className="mt-1 text-xs text-slate-500">{usageByInventoryItem[item._id]?.length ? `Used in: ${usageByInventoryItem[item._id].join(', ')}` : 'Not linked to a menu recipe yet'}</p></div><div className="flex shrink-0 gap-2"><button onClick={() => openEdit(item)} className="min-h-9 rounded-lg bg-slate-100 px-3 text-xs font-bold text-slate-700">Edit</button><button onClick={() => archive(item)} aria-label={`Archive ${item.name}`} className="flex min-h-9 min-w-9 items-center justify-center rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"><TrashIcon className="h-4 w-4" /></button></div></article>)}</div>}
    </section>;
}
