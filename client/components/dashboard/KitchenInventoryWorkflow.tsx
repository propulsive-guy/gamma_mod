'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'react-hot-toast';
import { createKitchenDepartment, createKitchenRequisition, editIssuedKitchenRequisition, issueKitchenRequisition, recordKitchenWastage, updateKitchenRequisition, updateRequisitionDate } from '@/app/actions/store';

type Item = { _id: string; name: string; unit: string; storeAvailableStock: number };
type Department = { _id: string; name: string };
type Stock = { _id: string; departmentId: string; inventoryItemId: string; currentStock: number };
type Request = { _id: string; reference: string; status: string; departmentId?: string; documentDate?: string; createdAt: string; notes?: string; lines?: { inventoryItemId: string; itemName: string; unit: string; requestedQuantity: number; orderedQuantity?: number; approvedQuantity?: number }[] };
type Line = { inventoryItemId: string; quantity: string };
type LowIngredient = { departmentId: string; departmentName: string; inventoryItemId: string; itemName: string; unit: string; storeAvailableStock: number };
type Prefill = { departmentId: string; inventoryItemId: string; nonce: number } | null;
const input = 'min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800';
const todayIndia = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const dateValue = (value?: string) => value ? new Date(value).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) : todayIndia();

export default function KitchenInventoryWorkflow({ items, departments, stocks, requests, lowIngredients = [], prefill = null, onPrefillHandled, onOpenPurchasing }: {
    items: Item[]; departments: Department[]; stocks: Stock[]; requests: Request[];
    lowIngredients?: LowIngredient[]; prefill?: Prefill; onPrefillHandled?: () => void; onOpenPurchasing?: () => void;
}) {
    const router = useRouter();
    const itemById = useMemo(() => new Map(items.map((item) => [String(item._id), item])), [items]);
    const departmentsById = useMemo(() => new Map(departments.map((department) => [String(department._id), department])), [departments]);
    const stocksByDepartment = useMemo(() => {
        const grouped = new Map<string, Stock[]>();
        for (const stock of stocks) {
            if (Number(stock.currentStock) <= 0) continue;
            const departmentId = String(stock.departmentId);
            const rows = grouped.get(departmentId);
            if (rows) rows.push(stock);
            else grouped.set(departmentId, [stock]);
        }
        return grouped;
    }, [stocks]);
    const requestFormRef = useRef<HTMLDivElement>(null);
    const [departmentName, setDepartmentName] = useState('');
    const [departmentId, setDepartmentId] = useState(departments[0]?._id || '');
    const [lines, setLines] = useState<Line[]>([{ inventoryItemId: '', quantity: '' }]);
    const [note, setNote] = useState('');
    const [requestDate, setRequestDate] = useState(todayIndia);
    const [editingRequest, setEditingRequest] = useState<Request | null>(null);
    const [dateFor, setDateFor] = useState<Request | null>(null);
    const [dateCorrection, setDateCorrection] = useState('');
    const [saving, setSaving] = useState(false);
    const [issuingRequestId, setIssuingRequestId] = useState<string | null>(null);
    const [wasteFor, setWasteFor] = useState<{ departmentId: string; departmentName: string; inventoryItemId: string; itemName: string; unit: string; available: number } | null>(null);
    const [wasteQuantity, setWasteQuantity] = useState('');
    const [wasteNote, setWasteNote] = useState('');
    const requestedAmounts = useMemo(() => {
        const totals = new Map<string, number>();
        for (const line of lines) {
            if (!line.inventoryItemId) continue;
            totals.set(line.inventoryItemId, (totals.get(line.inventoryItemId) || 0) + Number(line.quantity || 0));
        }
        return [...totals].map(([inventoryItemId, quantity]) => ({ inventoryItemId, quantity, item: itemById.get(inventoryItemId) }));
    }, [lines, itemById]);
    const storeShortfalls = !editingRequest ? requestedAmounts.filter(({ quantity, item }) => item && quantity > Number(item.storeAvailableStock)) : [];

    useEffect(() => {
        if (!prefill) return;
        setEditingRequest(null);
        setDepartmentId(prefill.departmentId);
        setLines([{ inventoryItemId: prefill.inventoryItemId, quantity: '' }]);
        setNote('');
        setRequestDate(todayIndia());
        onPrefillHandled?.();
        window.requestAnimationFrame(() => requestFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    }, [prefill, onPrefillHandled]);

    function startRequisition(ingredient: LowIngredient) {
        if (ingredient.storeAvailableStock <= 0) {
            onOpenPurchasing?.();
            return;
        }
        setEditingRequest(null);
        setDepartmentId(ingredient.departmentId);
        setLines([{ inventoryItemId: ingredient.inventoryItemId, quantity: '' }]);
        setNote('');
        setRequestDate(todayIndia());
        window.requestAnimationFrame(() => requestFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    }
    const kitchenStockPanel = <section className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-bold text-slate-900">Kitchen stock on hand</h3><p className="mt-1 text-xs text-slate-600">Stock already issued from Store, shown separately for each department.</p></div><span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-emerald-800">Store balance is separate</span></div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{departments.map((department) => {
            const rows = stocksByDepartment.get(String(department._id)) || [];
            return <article key={department._id} className="rounded-lg border border-emerald-100 bg-white p-3"><h4 className="text-sm font-bold text-emerald-900">{department.name}</h4>
                {rows.length ? <ul className="mt-2 space-y-2">{rows.map((row) => {
                    const item = itemById.get(String(row.inventoryItemId));
                    return <li key={row._id} className="flex items-center justify-between gap-2 text-sm text-slate-700"><span className="min-w-0 truncate">{item?.name || 'Inventory item'}</span><span className="flex shrink-0 items-center gap-2"><b>{row.currentStock.toFixed(2)} {item?.unit}</b><button type="button" onClick={() => { setWasteFor({ departmentId: department._id, departmentName: department.name, inventoryItemId: String(row.inventoryItemId), itemName: item?.name || 'Inventory item', unit: item?.unit || '', available: row.currentStock }); setWasteQuantity(''); setWasteNote(''); }} className="rounded-lg bg-amber-50 px-2 py-1 text-xs font-bold text-amber-800">Log waste</button></span></li>;
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

    function editRequest(request: Request) {
        setEditingRequest(request);
        setDepartmentId(request.departmentId || departments[0]?._id || '');
        setRequestDate(dateValue(request.documentDate || request.createdAt));
        setNote(request.notes || '');
        setLines((request.lines || []).map((line) => ({ inventoryItemId: line.inventoryItemId, quantity: String(line.approvedQuantity ?? line.orderedQuantity ?? line.requestedQuantity) })));
        if (!request.lines?.length) setLines([{ inventoryItemId: '', quantity: '' }]);
        window.requestAnimationFrame(() => requestFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    }

    async function submitRequest(event: React.FormEvent) {
        event.preventDefault();
        if (storeShortfalls.length) {
            toast.error(`Not enough Store stock for ${storeShortfalls.map(({ item }) => item?.name).join(', ')}.`);
            return;
        }
        setSaving(true);
        const payload = {
            departmentId, documentDate: requestDate, notes: note,
            lines: lines.map((line) => ({ inventoryItemId: line.inventoryItemId, quantity: Number(line.quantity) })),
        };
        const result = editingRequest?.status === 'approved'
            ? await editIssuedKitchenRequisition({ requisitionId: editingRequest._id, documentDate: requestDate, notes: note, lines: payload.lines })
            : editingRequest
                ? await updateKitchenRequisition({ requisitionId: editingRequest._id, ...payload })
            : await createKitchenRequisition(payload);
        setSaving(false);
        if (!result.success) return toast.error(result.error || 'Could not send requisition');
        toast.success(editingRequest?.status === 'approved' ? `${editingRequest.reference} updated and stock balances adjusted` : `${'reference' in result ? result.reference : 'Requisition'} issued to kitchen and added to the log`);
        setEditingRequest(null);
        setLines([{ inventoryItemId: '', quantity: '' }]);
        setNote('');
        setRequestDate(todayIndia());
        router.refresh();
    }

    async function issueLegacyRequest(request: Request) {
        setIssuingRequestId(request._id);
        const result = await issueKitchenRequisition(request._id);
        setIssuingRequestId(null);
        if (!result.success) return toast.error(result.error || 'Could not issue requisition');
        toast.success(`${request.reference} issued to kitchen`);
        router.refresh();
    }

    async function saveRequisitionDate(event: React.FormEvent) {
        event.preventDefault();
        if (!dateFor) return;
        setSaving(true);
        const result = await updateRequisitionDate({ requisitionId: dateFor._id, documentDate: dateCorrection });
        setSaving(false);
        if (!result.success) return toast.error(result.error || 'Could not update requisition date');
        toast.success('Requisition date updated');
        setDateFor(null);
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
        <div><p className="text-xs font-bold uppercase tracking-wider text-violet-700">Kitchen operations</p><h2 className="mt-1 text-lg font-bold text-slate-900">Departments, stock and requests</h2><p className="mt-1 text-sm text-slate-600">Create kitchen departments here. Submitting a request immediately moves the listed quantities from Store stock into that department.</p></div>
        {lowIngredients.length > 0 && <section className="overflow-hidden rounded-xl border border-rose-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rose-100 bg-rose-50 p-4"><div><h3 className="font-bold text-rose-950">Menu ingredients with no kitchen stock</h3><p className="mt-1 text-xs text-rose-800">These ingredients are mapped to menu recipes. Replenish the right department before accepting more orders.</p></div><span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-rose-800">{lowIngredients.length} need stock</span></div>
            <div className="divide-y divide-slate-100">{lowIngredients.map((ingredient) => <article key={`${ingredient.departmentId}:${ingredient.inventoryItemId}`} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between sm:px-4"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{ingredient.itemName}</p><p className="mt-0.5 text-xs text-slate-500">{ingredient.departmentName} · Store available: {ingredient.storeAvailableStock.toFixed(2)} {ingredient.unit}</p></div><button type="button" onClick={() => startRequisition(ingredient)} className={`min-h-10 shrink-0 rounded-lg px-3 text-xs font-bold ${ingredient.storeAvailableStock > 0 ? 'bg-violet-700 text-white hover:bg-violet-800' : 'border border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'}`}>{ingredient.storeAvailableStock > 0 ? 'Prepare requisition' : 'Open vendor purchasing'}</button></article>)}</div>
        </section>}
        {kitchenStockPanel}
        <div className="grid gap-4 lg:grid-cols-[0.8fr_1.2fr]">
            <div className="rounded-xl border border-slate-200 bg-white p-4"><h3 className="font-bold text-slate-900">Kitchen departments</h3>
                <div className="mt-3 flex flex-wrap gap-2">{departments.map((department) => <span key={department._id} className="rounded-full bg-violet-50 px-3 py-1.5 text-xs font-semibold text-violet-800">{department.name}</span>)}{!departments.length && <p className="text-xs text-slate-500">Create the first department below.</p>}</div>
                <form onSubmit={addDepartment} className="mt-4 flex gap-2"><input required minLength={2} maxLength={80} value={departmentName} onChange={(event) => setDepartmentName(event.target.value)} placeholder="e.g. Indian, Tandoor" className={input} /><button disabled={saving} className="min-h-11 shrink-0 rounded-xl bg-slate-900 px-4 text-xs font-bold text-white disabled:opacity-50">Add</button></form>
            </div>
            <div ref={requestFormRef} className="rounded-xl border border-slate-200 bg-white p-4"><h3 className="font-bold text-slate-900">{editingRequest ? `Edit requisition ${editingRequest.reference}` : 'Issue stock from Store'}</h3><p className="mt-1 text-xs text-slate-500">{editingRequest?.status === 'approved' ? 'Update item lines or quantities. Stock reductions can only be returned if the kitchen still has enough on hand.' : 'Submitting transfers these quantities immediately. Check the department and quantities before submitting.'}</p>
                {editingRequest && <button type="button" onClick={() => { setEditingRequest(null); setLines([{ inventoryItemId: '', quantity: '' }]); setNote(''); setRequestDate(todayIndia()); }} className="mt-2 text-xs font-bold text-slate-600">Cancel edit</button>}
                <form onSubmit={submitRequest} className="mt-3 space-y-2">
                    <select required disabled={editingRequest?.status === 'approved'} value={departmentId} onChange={(event) => setDepartmentId(event.target.value)} className={`${input} disabled:bg-slate-100`}><option value="">Choose kitchen department</option>{departments.map((department) => <option key={department._id} value={department._id}>{department.name}</option>)}</select>
                    <label className="block text-xs font-semibold text-slate-600">Requisition date<input required type="date" value={requestDate} onChange={(event) => setRequestDate(event.target.value)} className={input} /></label>
                    {lines.map((line, index) => <div key={index} className="grid grid-cols-[minmax(0,1fr)_6.5rem_auto] gap-2"><select required value={line.inventoryItemId} onChange={(event) => setLines(lines.map((row, i) => i === index ? { ...row, inventoryItemId: event.target.value } : row))} className={input}><option value="">Choose ingredient</option>{items.map((item) => <option key={item._id} value={item._id}>{item.name} · {item.storeAvailableStock.toFixed(2)} {item.unit} available in Store</option>)}</select><input required type="number" min="0.0001" step="0.0001" value={line.quantity} onChange={(event) => setLines(lines.map((row, i) => i === index ? { ...row, quantity: event.target.value } : row))} placeholder="Qty" className={input} /><button type="button" onClick={() => setLines(lines.filter((_, i) => i !== index))} className="px-2 text-xs font-semibold text-rose-600">Remove</button></div>)}
                    <button type="button" onClick={() => setLines([...lines, { inventoryItemId: '', quantity: '' }])} className="text-xs font-bold text-violet-700">+ Add ingredient</button>
                    {storeShortfalls.length > 0 && <p role="alert" className="rounded-lg bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-800">Store stock is short for {storeShortfalls.map(({ item }) => item?.name).join(', ')}. Receive stock before issuing this requisition.</p>}
                    <div className="flex flex-col gap-2 sm:flex-row"><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Note (optional)" className={input} /><button type="button" onClick={() => { setEditingRequest(null); setLines([{ inventoryItemId: '', quantity: '' }]); setNote(''); setRequestDate(todayIndia()); }} className="min-h-11 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-600">Clear</button><button disabled={saving || !departments.length || !lines.length || storeShortfalls.length > 0} className="min-h-11 shrink-0 rounded-xl bg-violet-700 px-4 text-sm font-bold text-white disabled:opacity-50">{saving ? 'Saving…' : editingRequest?.status === 'approved' ? 'Save requisition' : editingRequest ? 'Save and issue changes' : 'Submit & issue stock'}</button></div>
                </form>
            </div>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-slate-200 bg-white p-4"><h3 className="font-bold text-slate-900">Requisition log</h3><div className="mt-3 space-y-2">{requests.slice(0, 12).map((request) => <div key={request._id} className="rounded-lg bg-slate-50 px-3 py-2"><div className="flex items-start justify-between gap-3"><div><p className="text-xs font-bold text-slate-800">{request.reference} · {departmentsById.get(String(request.departmentId))?.name || 'Department'}</p><p className="text-[10px] text-slate-500">{new Date(request.documentDate || request.createdAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}</p></div><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${request.status === 'approved' ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'}`}>{request.status === 'approved' ? 'Stock issued' : 'Older request · not issued'}</span></div><ul className="mt-2 space-y-1">{(request.lines || []).map((line) => <li key={line.inventoryItemId} className="text-[11px] text-slate-600">{line.itemName}: {Number(request.status === 'approved' ? line.approvedQuantity ?? line.orderedQuantity ?? line.requestedQuantity : line.requestedQuantity).toFixed(2)} {line.unit}{request.status === 'approved' ? ' issued' : ' requested'}</li>)}</ul>{request.notes && <p className="mt-2 text-[11px] text-slate-500">{request.notes}</p>}<div className="mt-2 flex flex-wrap gap-3">{request.status === 'submitted' && <><button type="button" onClick={() => editRequest(request)} className="text-[11px] font-bold text-sky-700">Edit older request</button><button type="button" disabled={issuingRequestId === request._id} onClick={() => void issueLegacyRequest(request)} className="text-[11px] font-bold text-emerald-700 disabled:opacity-50">{issuingRequestId === request._id ? 'Issuing…' : 'Issue requested stock'}</button></>}{request.status === 'approved' && <button type="button" onClick={() => editRequest(request)} className="text-[11px] font-bold text-sky-700">Edit items & quantities</button>}<button type="button" onClick={() => { setDateFor(request); setDateCorrection(dateValue(request.documentDate || request.createdAt)); }} className="text-[11px] font-bold text-slate-600">Change date</button></div></div>)}{!requests.length && <p className="text-xs text-slate-500">Issued requisitions will appear here automatically.</p>}</div></div>
        </div>
        {wasteFor && <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4"><form onSubmit={submitWaste} className="w-full max-w-md rounded-t-3xl bg-white p-5 shadow-xl sm:rounded-3xl"><div className="flex items-start justify-between gap-3"><div><h3 className="font-bold text-slate-900">Record kitchen waste</h3><p className="mt-1 text-xs text-slate-500">{wasteFor.itemName} · {wasteFor.departmentName} · available {wasteFor.available} {wasteFor.unit}</p></div><button type="button" onClick={() => setWasteFor(null)} className="text-sm font-semibold text-slate-500">Close</button></div><label className="mt-4 block text-xs font-semibold text-slate-600">Quantity wasted<input required type="number" min="0.0001" max={wasteFor.available} step="0.0001" value={wasteQuantity} onChange={(event) => setWasteQuantity(event.target.value)} className={`mt-1 ${input}`} /></label><label className="mt-3 block text-xs font-semibold text-slate-600">Reason<input required value={wasteNote} onChange={(event) => setWasteNote(event.target.value)} placeholder="Expired, spoiled, preparation loss…" className={`mt-1 ${input}`} /></label><button disabled={saving} className="mt-4 min-h-11 w-full rounded-xl bg-amber-600 px-4 text-sm font-bold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Record waste and reduce kitchen stock'}</button></form></div>}
        {dateFor && <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4"><form onSubmit={saveRequisitionDate} className="w-full max-w-md rounded-t-3xl bg-white p-5 shadow-xl sm:rounded-3xl"><div className="flex items-start justify-between gap-3"><div><h3 className="font-bold text-slate-900">Correct requisition date</h3><p className="mt-1 text-xs text-slate-500">This changes the requisition record date. Stock transfer dates remain in the movement history.</p></div><button type="button" onClick={() => setDateFor(null)} className="text-sm font-semibold text-slate-500">Close</button></div><label className="mt-4 block text-xs font-semibold text-slate-600">Requisition date<input required type="date" value={dateCorrection} onChange={(event) => setDateCorrection(event.target.value)} className={`mt-1 ${input}`} /></label><button disabled={saving} className="mt-4 min-h-11 w-full rounded-xl bg-slate-900 px-4 text-sm font-bold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save date'}</button></form></div>}
    </section>;
}
