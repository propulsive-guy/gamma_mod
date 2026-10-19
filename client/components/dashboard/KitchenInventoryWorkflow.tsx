'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'react-hot-toast';
import { createKitchenDepartment, createKitchenRequisition, recordKitchenWastage } from '@/app/actions/store';

type Item = { _id: string; name: string; unit: string; storeAvailableStock: number };
type Department = { _id: string; name: string };
type Stock = { _id: string; departmentId: string; inventoryItemId: string; currentStock: number };
type Request = { _id: string; reference: string; status: string; departmentId?: string; createdAt: string };
type Line = { inventoryItemId: string; quantity: string };
const input = 'min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800';

export default function KitchenInventoryWorkflow({ items, departments, stocks, requests }: {
    items: Item[]; departments: Department[]; stocks: Stock[]; requests: Request[];
}) {
    const router = useRouter();
    const [departmentName, setDepartmentName] = useState('');
    const [departmentId, setDepartmentId] = useState(departments[0]?._id || '');
    const [lines, setLines] = useState<Line[]>([{ inventoryItemId: '', quantity: '' }]);
    const [note, setNote] = useState('');
    const [saving, setSaving] = useState(false);
    const [wasteFor, setWasteFor] = useState<{ departmentId: string; departmentName: string; inventoryItemId: string; itemName: string; unit: string; available: number } | null>(null);
    const [wasteQuantity, setWasteQuantity] = useState('');
    const [wasteNote, setWasteNote] = useState('');
    const kitchenStockPanel = <section className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-bold text-slate-900">Kitchen stock on hand</h3><p className="mt-1 text-xs text-slate-600">Stock already issued from Store, shown separately for each department.</p></div><span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-emerald-800">Store balance is separate</span></div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{departments.map((department) => {
            const rows = stocks.filter((stock) => String(stock.departmentId) === String(department._id) && Number(stock.currentStock) > 0);
            return <article key={department._id} className="rounded-lg border border-emerald-100 bg-white p-3"><h4 className="text-sm font-bold text-emerald-900">{department.name}</h4>
                {rows.length ? <ul className="mt-2 space-y-2">{rows.map((row) => {
                    const item = items.find((candidate) => String(candidate._id) === String(row.inventoryItemId));
                    return <li key={row._id} className="flex items-center justify-between gap-2 text-sm text-slate-700"><span className="min-w-0 truncate">{item?.name || 'Inventory item'}</span><span className="flex shrink-0 items-center gap-2"><b>{row.currentStock} {item?.unit}</b><button type="button" onClick={() => { setWasteFor({ departmentId: department._id, departmentName: department.name, inventoryItemId: String(row.inventoryItemId), itemName: item?.name || 'Inventory item', unit: item?.unit || '', available: row.currentStock }); setWasteQuantity(''); setWasteNote(''); }} className="rounded-lg bg-amber-50 px-2 py-1 text-xs font-bold text-amber-800">Log waste</button></span></li>;
                })}</ul> : <p className="mt-2 text-xs text-slate-500">0 stock on hand</p>}
            </article>;
        })}{!departments.length && <p className="text-sm text-slate-500">Add a kitchen department to start tracking its stock.</p>}</div>
    </section>;

    async function addDepartment(event: React.FormEvent) {
        event.preventDefault();
        setSaving(true);
        const result = await createKitchenDepartment(departmentName);
        setSaving(false);
        if (!result.success) return toast.error(result.error || 'Could not add department');
        toast.success('Kitchen department created');
        if (result.department?._id) setDepartmentId(result.department._id);
        setDepartmentName('');
        router.refresh();
    }

    async function submitRequest(event: React.FormEvent) {
        event.preventDefault();
        setSaving(true);
        const result = await createKitchenRequisition({
            departmentId, notes: note,
            lines: lines.map((line) => ({ inventoryItemId: line.inventoryItemId, quantity: Number(line.quantity) })),
        });
        setSaving(false);
        if (!result.success) return toast.error(result.error || 'Could not send requisition');
        toast.success(`${result.reference} sent to Store for review`);
        setLines([{ inventoryItemId: '', quantity: '' }]);
        setNote('');
        router.refresh();
    }


    async function submitWaste(event: React.FormEvent) {
        event.preventDefault();
        if (!wasteFor) return;
        setSaving(true);
        const result = await recordKitchenWastage({ departmentId: wasteFor.departmentId, inventoryItemId: wasteFor.inventoryItemId, quantity: Number(wasteQuantity), note: wasteNote });
        setSaving(false);
        if (!result.success) return toast.error(result.error || 'Could not record waste');
        toast.success('Kitchen waste recorded and stock adjusted');
        setWasteFor(null); setWasteQuantity(''); setWasteNote('');
        router.refresh();
    }

    return <section className="space-y-5 rounded-2xl border border-violet-100 bg-violet-50/50 p-4 sm:p-5">
        <div><p className="text-xs font-bold uppercase tracking-wider text-violet-700">Kitchen operations</p><h2 className="mt-1 text-lg font-bold text-slate-900">Departments, stock and requests</h2><p className="mt-1 text-sm text-slate-600">Create your kitchen departments here. Request Store stock by department; it stays in Store until Store reviews and approves the request.</p></div>
        {kitchenStockPanel}
        <div className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
            <div className="rounded-xl border border-slate-200 bg-white p-4"><h3 className="font-bold text-slate-900">Kitchen departments</h3>
                <div className="mt-3 flex flex-wrap gap-2">{departments.map((department) => <span key={department._id} className="rounded-full bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-800">{department.name}</span>)}{!departments.length && <p className="text-xs text-slate-500">Create the first department below.</p>}</div>
                <form onSubmit={addDepartment} className="mt-4 flex gap-2"><input required minLength={2} maxLength={80} value={departmentName} onChange={(event) => setDepartmentName(event.target.value)} placeholder="e.g. Indian, Tandoor" className={input} /><button disabled={saving} className="min-h-11 shrink-0 rounded-xl bg-slate-900 px-4 text-xs font-bold text-white disabled:opacity-50">Add</button></form>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-4"><h3 className="font-bold text-slate-900">Request stock from Store</h3><p className="mt-1 text-xs text-slate-500">Available quantities shown here are Store stock. Issued amounts appear in the department stock above.</p>
                <form onSubmit={submitRequest} className="mt-3 space-y-2">
                    <select required value={departmentId} onChange={(event) => setDepartmentId(event.target.value)} className={input}><option value="">Choose kitchen department</option>{departments.map((department) => <option key={department._id} value={department._id}>{department.name}</option>)}</select>
                    {lines.map((line, index) => <div key={index} className="grid grid-cols-[minmax(0,1fr)_6.5rem_auto] gap-2"><select required value={line.inventoryItemId} onChange={(event) => setLines(lines.map((row, i) => i === index ? { ...row, inventoryItemId: event.target.value } : row))} className={input}><option value="">Choose ingredient</option>{items.map((item) => <option key={item._id} value={item._id}>{item.name} · {item.storeAvailableStock} {item.unit} available in Store</option>)}</select><input required type="number" min="0.0001" step="0.0001" value={line.quantity} onChange={(event) => setLines(lines.map((row, i) => i === index ? { ...row, quantity: event.target.value } : row))} placeholder="Qty" className={input} /><button type="button" onClick={() => setLines(lines.filter((_, i) => i !== index))} className="px-2 text-xs font-semibold text-rose-600">Remove</button></div>)}
                    <button type="button" onClick={() => setLines([...lines, { inventoryItemId: '', quantity: '' }])} className="text-xs font-bold text-violet-700">+ Add ingredient</button>
                    <div className="flex flex-col gap-2 sm:flex-row"><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Note for Store (optional)" className={input} /><button disabled={saving || !departments.length} className="min-h-11 shrink-0 rounded-xl bg-violet-700 px-4 text-sm font-bold text-white disabled:opacity-50">{saving ? 'Sending…' : 'Send requisition'}</button></div>
                </form>
            </div>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-4"><h3 className="font-bold text-slate-900">Recent requisitions</h3><div className="mt-3 space-y-2">{requests.slice(0, 8).map((request) => <div key={request._id} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2"><div><p className="text-xs font-bold text-slate-800">{request.reference} · {departments.find((department) => department._id === request.departmentId)?.name || 'Department'}</p><p className="text-[10px] text-slate-500">{new Date(request.createdAt).toLocaleDateString('en-IN')}</p></div><span className="rounded-full bg-white px-2 py-1 text-[10px] font-bold capitalize text-slate-600">{request.status === 'approved' ? 'issued' : request.status}</span></div>)}{!requests.length && <p className="text-xs text-slate-500">Your requests will appear here.</p>}</div></div>
        </div>
        {wasteFor && <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4"><form onSubmit={submitWaste} className="w-full max-w-md rounded-t-3xl bg-white p-5 shadow-xl sm:rounded-3xl"><div className="flex items-start justify-between gap-3"><div><h3 className="font-bold text-slate-900">Record kitchen waste</h3><p className="mt-1 text-xs text-slate-500">{wasteFor.itemName} · {wasteFor.departmentName} · available {wasteFor.available} {wasteFor.unit}</p></div><button type="button" onClick={() => setWasteFor(null)} className="text-sm font-semibold text-slate-500">Close</button></div><label className="mt-4 block text-xs font-semibold text-slate-600">Quantity wasted<input required type="number" min="0.0001" max={wasteFor.available} step="0.0001" value={wasteQuantity} onChange={(event) => setWasteQuantity(event.target.value)} className={`mt-1 ${input}`} /></label><label className="mt-3 block text-xs font-semibold text-slate-600">Reason<input required value={wasteNote} onChange={(event) => setWasteNote(event.target.value)} placeholder="Expired, spoiled, preparation loss…" className={`mt-1 ${input}`} /></label><button disabled={saving} className="mt-4 min-h-11 w-full rounded-xl bg-amber-600 px-4 text-sm font-bold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Record waste and reduce kitchen stock'}</button></form></div>}
    </section>;
}
