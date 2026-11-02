'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'react-hot-toast';
import { ArchiveBoxIcon, CheckCircleIcon, ChevronDownIcon, ClipboardDocumentListIcon, MagnifyingGlassIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { createKitchenDepartment, createKitchenRequisition, editIssuedKitchenRequisition, issueKitchenRequisition, recordKitchenWastage, updateKitchenRequisition, updateRequisitionDate } from '@/app/actions/store';

type Item = { _id: string; name: string; unit: string; storeAvailableStock: number };
type Department = { _id: string; name: string };
type Stock = { _id: string; departmentId: string; inventoryItemId: string; currentStock: number };
type Request = { _id: string; reference: string; status: string; departmentId?: string; documentDate?: string; createdAt: string; notes?: string; lines?: { inventoryItemId: string; itemName: string; unit: string; requestedQuantity: number; orderedQuantity?: number; approvedQuantity?: number }[] };
type Line = { id: string; inventoryItemId: string; quantity: string };
type LowIngredient = { departmentId: string; departmentName: string; inventoryItemId: string; itemName: string; unit: string; storeAvailableStock: number };
type Prefill = { departmentId: string; inventoryItemId: string; nonce: number } | null;
const input = 'min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-800';
const todayIndia = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const dateValue = (value?: string) => value ? new Date(value).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }) : todayIndia();

function IngredientPicker({ items, value, onChange }: { items: Item[]; value: string; onChange: (itemId: string) => void }) {
    const [search, setSearch] = useState('');
    const [open, setOpen] = useState(false);
    const selected = items.find((item) => item._id === value);
    const matches = useMemo(() => {
        const query = search.trim().toLowerCase();
        return items.filter((item) => !query || item.name.toLowerCase().includes(query));
    }, [items, search]);

    return <div className="relative mt-1 min-w-0" onBlur={(event) => {
        const nextFocus = event.relatedTarget as Node | null;
        if (!nextFocus || !event.currentTarget.contains(nextFocus)) setOpen(false);
    }}>
        <MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 z-10 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input aria-label="Search and choose ingredient" aria-expanded={open} value={open ? search : selected?.name || ''} onFocus={() => { setSearch(''); setOpen(true); }} onChange={(event) => { setSearch(event.target.value); setOpen(true); }} onKeyDown={(event) => { if (event.key === 'Escape') setOpen(false); }} placeholder="Search ingredients…" className={`${input} pl-9`} />
        {open && <div role="listbox" aria-label="Available ingredients" className="absolute inset-x-0 top-full z-30 mt-1 max-h-56 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
            {matches.length ? matches.map((item) => {
                const available = Number(item.storeAvailableStock || 0);
                const unavailable = available <= 0 && item._id !== value;
                return <button key={item._id} type="button" role="option" aria-selected={item._id === value} disabled={unavailable} onMouseDown={(event) => event.preventDefault()} onClick={() => { onChange(item._id); setOpen(false); setSearch(''); }} className="flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left hover:bg-slate-50 focus:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-45">
                    <span className="min-w-0"><span className="block truncate text-sm font-semibold text-slate-800">{item.name}</span><span className="block text-[11px] text-slate-500">Store available: {available.toFixed(2)} {item.unit}</span></span>
                    {item._id === value ? <CheckCircleIcon className="h-4 w-4 shrink-0 text-emerald-600" /> : unavailable ? <span className="shrink-0 text-[10px] font-bold uppercase text-rose-600">Out of stock</span> : null}
                </button>;
            }) : <p className="px-3 py-4 text-center text-xs text-slate-500">No matching ingredients.</p>}
        </div>}
    </div>;
}

export default function KitchenInventoryWorkflow({ items, departments, stocks, requests, lowIngredients = [], prefill = null, onPrefillHandled, onOpenPurchasing }: {
    items: Item[]; departments: Department[]; stocks: Stock[]; requests: Request[];
    lowIngredients?: LowIngredient[]; prefill?: Prefill; onPrefillHandled?: () => void; onOpenPurchasing?: () => void;
}) {
    const router = useRouter();
    const itemById = useMemo(() => new Map(items.map((item) => [String(item._id), item])), [items]);
    const departmentsById = useMemo(() => new Map(departments.map((department) => [String(department._id), department])), [departments]);
    const lineIdSequence = useRef(0);
    const emptyLine = useCallback((): Line => ({ id: `line-${++lineIdSequence.current}`, inventoryItemId: '', quantity: '' }), []);
    const stocksByDepartment = useMemo(() => {
        const grouped = new Map<string, Stock[]>();
        for (const stock of stocks) {
            if (!itemById.has(String(stock.inventoryItemId))) continue;
            const departmentId = String(stock.departmentId);
            const rows = grouped.get(departmentId);
            if (rows) rows.push(stock);
            else grouped.set(departmentId, [stock]);
        }
        for (const ingredient of lowIngredients) {
            const rows = grouped.get(ingredient.departmentId) || [];
            if (rows.some((row) => String(row.inventoryItemId) === ingredient.inventoryItemId)) continue;
            rows.push({ _id: `mapped-${ingredient.departmentId}-${ingredient.inventoryItemId}`, departmentId: ingredient.departmentId, inventoryItemId: ingredient.inventoryItemId, currentStock: 0 });
            grouped.set(ingredient.departmentId, rows);
        }
        for (const rows of grouped.values()) rows.sort((a, b) => (itemById.get(String(a.inventoryItemId))?.name || '').localeCompare(itemById.get(String(b.inventoryItemId))?.name || ''));
        return grouped;
    }, [stocks, lowIngredients, itemById]);
    const requestFormRef = useRef<HTMLElement | null>(null);
    const [departmentName, setDepartmentName] = useState('');
    const [departmentId, setDepartmentId] = useState(departments[0]?._id || '');
    const [lines, setLines] = useState<Line[]>(() => [emptyLine()]);
    const [selectedStockDepartmentId, setSelectedStockDepartmentId] = useState(departments[0]?._id || '');
    const [kitchenStockSearch, setKitchenStockSearch] = useState('');
    const [requestSearch, setRequestSearch] = useState('');
    const [requestFilter, setRequestFilter] = useState<'all' | 'issued' | 'legacy'>('all');
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
    const selectedStockDepartment = departments.find((department) => department._id === selectedStockDepartmentId) || departments[0];
    const selectedStockRows = useMemo(() => {
        if (!selectedStockDepartment) return [];
        return (stocksByDepartment.get(String(selectedStockDepartment._id)) || []).filter((row) => {
            const item = itemById.get(String(row.inventoryItemId));
            return item && item.name.toLowerCase().includes(kitchenStockSearch.trim().toLowerCase());
        });
    }, [selectedStockDepartment, stocksByDepartment, itemById, kitchenStockSearch]);
    useEffect(() => {
        if (!departments.some((department) => department._id === selectedStockDepartmentId)) {
            setSelectedStockDepartmentId(departments[0]?._id || '');
        }
    }, [departments, selectedStockDepartmentId]);
    const requestedAmounts = useMemo(() => {
        const totals = new Map<string, number>();
        for (const line of lines) {
            if (!line.inventoryItemId) continue;
            totals.set(line.inventoryItemId, (totals.get(line.inventoryItemId) || 0) + Number(line.quantity || 0));
        }
        return [...totals].map(([inventoryItemId, quantity]) => ({ inventoryItemId, quantity, item: itemById.get(inventoryItemId) }));
    }, [lines, itemById]);
    const storeShortfalls = !editingRequest ? requestedAmounts.filter(({ quantity, item }) => item && quantity > Number(item.storeAvailableStock)) : [];
    const filteredRequests = useMemo(() => {
        const query = requestSearch.trim().toLowerCase();
        return requests.filter((request) => {
            if (requestFilter === 'issued' && request.status !== 'approved') return false;
            if (requestFilter === 'legacy' && request.status !== 'submitted') return false;
            if (!query) return true;
            const department = departmentsById.get(String(request.departmentId))?.name || '';
            return [request.reference, department, request.notes || '', ...(request.lines || []).map((line) => line.itemName)]
                .some((value) => value.toLowerCase().includes(query));
        }).sort((a, b) => new Date(b.documentDate || b.createdAt).getTime() - new Date(a.documentDate || a.createdAt).getTime());
    }, [requests, requestSearch, requestFilter, departmentsById]);

    useEffect(() => {
        if (!prefill) return;
        setEditingRequest(null);
        setDepartmentId(prefill.departmentId);
        setLines([{ ...emptyLine(), inventoryItemId: prefill.inventoryItemId }]);
        setNote('');
        setRequestDate(todayIndia());
        onPrefillHandled?.();
        window.requestAnimationFrame(() => requestFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    }, [prefill, onPrefillHandled, emptyLine]);

    function startRequisition(ingredient: LowIngredient) {
        if (ingredient.storeAvailableStock <= 0) {
            onOpenPurchasing?.();
            return;
        }
        setEditingRequest(null);
        setDepartmentId(ingredient.departmentId);
        setLines([{ ...emptyLine(), inventoryItemId: ingredient.inventoryItemId }]);
        setNote('');
        setRequestDate(todayIndia());
        window.requestAnimationFrame(() => requestFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    }
    const kitchenStockPanel = <section className="overflow-hidden rounded-2xl border border-emerald-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-emerald-100 bg-emerald-50/70 p-4 sm:p-5"><div className="flex items-start gap-3"><span className="rounded-xl bg-emerald-100 p-2 text-emerald-800"><ArchiveBoxIcon className="h-5 w-5" /></span><div><h3 className="font-bold text-slate-950">Kitchen live stock</h3><p className="mt-1 text-xs text-slate-600">Stock issued from Store and available to each kitchen department.</p></div></div><span className="rounded-full bg-white px-3 py-1.5 text-xs font-bold text-emerald-800">{departments.length} departments</span></div>
        <div className="border-b border-slate-100 p-3 sm:p-4"><div className="flex gap-2 overflow-x-auto pb-1">{departments.map((department) => {
            const rows = stocksByDepartment.get(String(department._id)) || [];
            const outCount = rows.filter((row) => Number(row.currentStock) <= 0).length;
            const active = selectedStockDepartment?._id === department._id;
            return <button key={department._id} type="button" onClick={() => { setSelectedStockDepartmentId(department._id); setKitchenStockSearch(''); }} className={`min-w-40 shrink-0 rounded-xl border p-3 text-left transition-colors ${active ? 'border-emerald-700 bg-emerald-700 text-white shadow-sm' : 'border-slate-200 bg-white text-slate-800 hover:border-emerald-300 hover:bg-emerald-50'}`}><span className="block truncate text-sm font-bold">{department.name}</span><span className={`mt-1 block text-xs ${active ? 'text-emerald-50' : 'text-slate-500'}`}>{rows.length} ingredients · {outCount} at zero</span></button>;
        })}{!departments.length && <p className="px-2 py-3 text-sm text-slate-500">Add a kitchen department to start tracking its stock.</p>}</div></div>
        {selectedStockDepartment && <>
            <div className="flex flex-col gap-3 border-b border-slate-100 bg-slate-50/60 p-3 sm:flex-row sm:items-center sm:justify-between sm:px-4"><div><h4 className="text-sm font-bold text-slate-900">{selectedStockDepartment.name} stock</h4><p className="mt-0.5 text-xs text-slate-500">{selectedStockRows.length} ingredients · Store stock is shown separately</p></div><label className="relative block w-full sm:max-w-xs"><MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={kitchenStockSearch} onChange={(event) => setKitchenStockSearch(event.target.value)} placeholder="Search department stock" aria-label="Search department stock" className="min-h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm text-slate-800" /></label></div>
            <div className="max-h-64 overflow-y-auto overscroll-contain">{selectedStockRows.length ? <ul className="divide-y divide-slate-100">{selectedStockRows.map((row) => {
                const item = itemById.get(String(row.inventoryItemId));
                if (!item) return null;
                const onHand = Number(row.currentStock || 0);
                return <li key={row._id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{item.name}</p><p className="mt-0.5 text-xs text-slate-500">Store balance {item.storeAvailableStock.toFixed(2)} {item.unit}</p></div><div className="flex shrink-0 items-center gap-3"><span className={`text-sm font-bold ${onHand > 0 ? 'text-emerald-800' : 'text-rose-700'}`}>{onHand.toFixed(2)} {item.unit}{onHand <= 0 && <span className="ml-2 rounded-full bg-rose-50 px-2 py-1 text-[10px] uppercase text-rose-700">Out</span>}</span>{onHand > 0 && <button type="button" onClick={() => { setWasteFor({ departmentId: selectedStockDepartment._id, departmentName: selectedStockDepartment.name, inventoryItemId: String(row.inventoryItemId), itemName: item.name, unit: item.unit, available: onHand }); setWasteQuantity(''); setWasteNote(''); }} className="min-h-9 rounded-lg border border-amber-200 bg-amber-50 px-3 text-xs font-bold text-amber-900 hover:bg-amber-100">Log waste</button>}</div></li>;
            })}</ul> : <p className="px-4 py-8 text-center text-sm text-slate-500">{kitchenStockSearch ? 'No ingredient matches this search.' : 'No stock has been issued to this department yet.'}</p>}</div>
        </>}
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
        setLines((request.lines || []).map((line, index) => ({ id: `edit-${request._id}-${index}`, inventoryItemId: line.inventoryItemId, quantity: String(line.approvedQuantity ?? line.orderedQuantity ?? line.requestedQuantity) })));
        if (!request.lines?.length) setLines([emptyLine()]);
        window.requestAnimationFrame(() => requestFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
    }

    async function submitRequest(event: React.FormEvent) {
        event.preventDefault();
        if (!departmentId || lines.some((line) => !line.inventoryItemId || !Number.isFinite(Number(line.quantity)) || Number(line.quantity) <= 0)) {
            toast.error('Choose an ingredient and enter a quantity for every line.');
            return;
        }
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
        setLines([emptyLine()]);
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

    return <section className="space-y-5">
        <header className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between sm:p-5"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-violet-700">Kitchen operations</p><h2 className="mt-1 text-xl font-bold tracking-tight text-slate-950">Kitchen requests</h2><p className="mt-1 max-w-3xl text-sm text-slate-600">Review department balances and issue ingredients from Store. Menu orders consume kitchen stock; each issue is recorded in the requisition log.</p></div><div className="flex shrink-0 gap-2"><span className="rounded-xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800">{departments.length} departments</span><span className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-700">{requests.filter((request) => request.status === 'approved').length} issued logs</span></div></header>
        {lowIngredients.length > 0 && <section className="overflow-hidden rounded-xl border border-rose-200 bg-white">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-rose-100 bg-rose-50 p-4"><div><h3 className="font-bold text-rose-950">Menu ingredients with no kitchen stock</h3><p className="mt-1 text-xs text-rose-800">These ingredients are mapped to menu recipes. Replenish the right department before accepting more orders.</p></div><span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-rose-800">{lowIngredients.length} need stock</span></div>
            <div className="max-h-64 divide-y divide-slate-100 overflow-y-auto overscroll-contain">{lowIngredients.map((ingredient) => <article key={`${ingredient.departmentId}:${ingredient.inventoryItemId}`} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between sm:px-4"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{ingredient.itemName}</p><p className="mt-0.5 text-xs text-slate-500">{ingredient.departmentName} · Store available: {ingredient.storeAvailableStock.toFixed(2)} {ingredient.unit}</p></div><button type="button" onClick={() => startRequisition(ingredient)} className={`min-h-10 shrink-0 rounded-lg px-3 text-xs font-bold ${ingredient.storeAvailableStock > 0 ? 'bg-violet-700 text-white hover:bg-violet-800' : 'border border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'}`}>{ingredient.storeAvailableStock > 0 ? 'Prepare requisition' : 'Open vendor purchasing'}</button></article>)}</div>
        </section>}
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(17rem,0.8fr)]">
            {kitchenStockPanel}
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"><div className="flex items-start gap-3"><span className="rounded-xl bg-violet-100 p-2 text-violet-800"><ClipboardDocumentListIcon className="h-5 w-5" /></span><div><h3 className="font-bold text-slate-950">Kitchen departments</h3><p className="mt-1 text-xs leading-5 text-slate-600">Create a department for each kitchen section. Switch departments in the live stock panel above.</p></div></div><form onSubmit={addDepartment} className="mt-4 border-t border-slate-100 pt-4"><label className="mb-1.5 block text-xs font-semibold text-slate-600" htmlFor="new-kitchen-department">Add department</label><div className="flex gap-2"><input id="new-kitchen-department" required minLength={2} maxLength={80} value={departmentName} onChange={(event) => setDepartmentName(event.target.value)} placeholder="e.g. Indian, Tandoor" className={input} /><button disabled={saving} aria-label="Add kitchen department" className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1 rounded-xl bg-slate-950 px-4 text-sm font-bold text-white disabled:opacity-50"><PlusIcon className="h-4 w-4" /> Add</button></div></form></section>
        </div>

        <section ref={requestFormRef} className="overflow-visible rounded-2xl border border-violet-200 bg-white shadow-sm">
            <div className="flex flex-col gap-3 border-b border-violet-100 bg-violet-50/70 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"><div className="flex items-start gap-3"><span className="rounded-xl bg-violet-100 p-2 text-violet-800"><ClipboardDocumentListIcon className="h-5 w-5" /></span><div><p className="text-xs font-bold uppercase tracking-[0.14em] text-violet-700">Stock transfer</p><h3 className="mt-1 font-bold text-slate-950">{editingRequest ? `Edit requisition ${editingRequest.reference}` : 'Issue stock from Store'}</h3><p className="mt-1 text-xs text-slate-600">{editingRequest?.status === 'approved' ? 'Changes adjust both Store and kitchen stock. Stock already consumed cannot be returned.' : 'Submitting transfers stock immediately and creates a permanent log entry.'}</p></div></div>{editingRequest && <button type="button" onClick={() => { setEditingRequest(null); setLines([emptyLine()]); setNote(''); setRequestDate(todayIndia()); }} className="min-h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-bold text-slate-600 hover:bg-slate-50">Cancel edit</button>}</div>
            <form onSubmit={submitRequest} className="space-y-4 p-4 sm:p-5">
                <div className="grid gap-3 sm:grid-cols-2"><label className="block text-xs font-semibold text-slate-600">Kitchen department<select required disabled={editingRequest?.status === 'approved'} value={departmentId} onChange={(event) => setDepartmentId(event.target.value)} className={`${input} mt-1 disabled:bg-slate-100`}><option value="">Choose department</option>{departments.map((department) => <option key={department._id} value={department._id}>{department.name}</option>)}</select></label><label className="block text-xs font-semibold text-slate-600">Issue date<input required type="date" value={requestDate} onChange={(event) => setRequestDate(event.target.value)} className={`${input} mt-1`} /></label></div>
                <div className="space-y-2">{lines.map((line) => <div key={line.id} className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50/70 p-3 sm:grid-cols-[minmax(0,1fr)_9rem_auto] sm:items-end"><div className="min-w-0 text-xs font-semibold text-slate-600"><span>Ingredient</span><IngredientPicker items={items} value={line.inventoryItemId} onChange={(inventoryItemId) => setLines(lines.map((row) => row.id === line.id ? { ...row, inventoryItemId } : row))} /></div><label className="block text-xs font-semibold text-slate-600">Issue quantity<input required type="number" min="0.0001" step="0.0001" value={line.quantity} onChange={(event) => setLines(lines.map((row) => row.id === line.id ? { ...row, quantity: event.target.value } : row))} placeholder="0.00" className={`${input} mt-1`} /></label><button type="button" aria-label="Remove ingredient line" onClick={() => setLines(lines.filter((row) => row.id !== line.id))} className="inline-flex min-h-11 items-center justify-center gap-1 rounded-xl border border-rose-200 bg-white px-3 text-xs font-bold text-rose-700 hover:bg-rose-50"><TrashIcon className="h-4 w-4" /><span className="sm:hidden">Remove line</span></button></div>)}</div>
                <button type="button" onClick={() => setLines([...lines, emptyLine()])} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-violet-200 bg-white px-3 text-xs font-bold text-violet-800 hover:bg-violet-50"><PlusIcon className="h-4 w-4" />Add ingredient</button>
                {storeShortfalls.length > 0 && <p role="alert" className="rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-800">Not enough Store stock for {storeShortfalls.map(({ item }) => item?.name).join(', ')}. Reduce the quantity or receive more stock before issuing.</p>}
                <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-end"><label className="block flex-1 text-xs font-semibold text-slate-600">Note <span className="font-normal text-slate-400">(optional)</span><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Shift, production plan, or other context" className={`${input} mt-1`} /></label><div className="flex gap-2"><button type="button" onClick={() => { setEditingRequest(null); setLines([emptyLine()]); setNote(''); setRequestDate(todayIndia()); }} className="min-h-11 rounded-xl border border-slate-200 px-4 text-sm font-semibold text-slate-600 hover:bg-slate-50">Clear</button><button disabled={saving || !departments.length || !lines.length || lines.some((line) => !line.inventoryItemId || !line.quantity || Number(line.quantity) <= 0) || storeShortfalls.length > 0} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-violet-700 px-4 text-sm font-bold text-white hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-50">{saving ? 'Saving…' : <><CheckCircleIcon className="h-4 w-4" />{editingRequest?.status === 'approved' ? 'Save changes' : editingRequest ? 'Save and issue changes' : 'Submit & issue stock'}</>}</button></div></div>
            </form>
        </section>

        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="flex flex-col gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center sm:justify-between sm:p-5"><div><div className="flex items-center gap-2"><h3 className="font-bold text-slate-950">Requisition log</h3><span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">{requests.length}</span></div><p className="mt-1 text-xs text-slate-500">Review stock issues, correct lines, or update dates.</p></div><label className="relative block w-full sm:max-w-xs"><MagnifyingGlassIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input aria-label="Search requisition log" value={requestSearch} onChange={(event) => setRequestSearch(event.target.value)} placeholder="Search reference, department, item" className="min-h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm" /></label></div>
            <div className="flex gap-2 border-b border-slate-100 px-4 py-3">{([{ id: 'all', label: `All (${requests.length})` }, { id: 'issued', label: `Issued (${requests.filter((request) => request.status === 'approved').length})` }, { id: 'legacy', label: `Older requests (${requests.filter((request) => request.status === 'submitted').length})` }] as const).map((filter) => <button key={filter.id} type="button" aria-pressed={requestFilter === filter.id} onClick={() => setRequestFilter(filter.id)} className={`min-h-9 rounded-lg px-3 text-xs font-bold ${requestFilter === filter.id ? 'bg-slate-950 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{filter.label}</button>)}</div>
            <div className="max-h-[32rem] overflow-y-auto overscroll-contain divide-y divide-slate-100">{filteredRequests.map((request) => {
                const isIssued = request.status === 'approved';
                const requestLines = request.lines || [];
                const issuedQuantity = (line: NonNullable<Request['lines']>[number]) => Number(isIssued ? line.approvedQuantity ?? line.orderedQuantity ?? line.requestedQuantity : line.requestedQuantity);
                return <article key={request._id} className="p-4 sm:p-5"><div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between"><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h4 className="font-bold text-slate-900">{request.reference}</h4><span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide ${isIssued ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-800'}`}>{isIssued ? 'Stock issued' : 'Needs issue'}</span><span className="text-xs text-slate-500">{departmentsById.get(String(request.departmentId))?.name || 'Department'} · {new Date(request.documentDate || request.createdAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })}</span></div><p className="mt-2 text-sm text-slate-700">{requestLines.slice(0, 3).map((line) => `${line.itemName} · ${issuedQuantity(line).toFixed(2)} ${line.unit}`).join('  /  ')}{requestLines.length > 3 ? `  + ${requestLines.length - 3} more` : ''}{!requestLines.length ? 'No items recorded' : ''}</p>{request.notes && <p className="mt-1 text-xs text-slate-500">{request.notes}</p>}{requestLines.length > 3 && <details className="mt-2"><summary className="inline-flex cursor-pointer items-center gap-1 text-xs font-bold text-violet-700">View all {requestLines.length} items<ChevronDownIcon className="h-3.5 w-3.5" /></summary><ul className="mt-2 grid gap-1 rounded-lg bg-slate-50 p-3 sm:grid-cols-2">{requestLines.map((line, index) => <li key={`${line.inventoryItemId}-${index}`} className="text-xs text-slate-600">{line.itemName} · {issuedQuantity(line).toFixed(2)} {line.unit}{isIssued ? ' issued' : ' requested'}</li>)}</ul></details>}</div><div className="flex flex-wrap gap-2 lg:justify-end">{request.status === 'submitted' && <button type="button" onClick={() => editRequest(request)} className="min-h-9 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-700 hover:bg-slate-50">Edit request</button>}{request.status === 'approved' && <button type="button" onClick={() => editRequest(request)} className="min-h-9 rounded-lg border border-slate-200 px-3 text-xs font-bold text-sky-800 hover:bg-sky-50">Edit items</button>}{request.status === 'submitted' && <button type="button" disabled={issuingRequestId === request._id} onClick={() => void issueLegacyRequest(request)} className="min-h-9 rounded-lg bg-emerald-700 px-3 text-xs font-bold text-white disabled:opacity-50">{issuingRequestId === request._id ? 'Issuing…' : 'Issue stock'}</button>}<button type="button" onClick={() => { setDateFor(request); setDateCorrection(dateValue(request.documentDate || request.createdAt)); }} className="min-h-9 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-600 hover:bg-slate-50">Change date</button></div></div></article>;
            })}{!filteredRequests.length && <div className="px-4 py-12 text-center"><p className="text-sm font-semibold text-slate-700">{requests.length ? 'No requisitions match this search.' : 'No requisitions recorded yet.'}</p><p className="mt-1 text-xs text-slate-500">New stock issues will appear here automatically.</p></div>}</div>
        </section>
        {wasteFor && <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4"><form onSubmit={submitWaste} className="w-full max-w-md rounded-t-3xl bg-white p-5 shadow-xl sm:rounded-3xl"><div className="flex items-start justify-between gap-3"><div><h3 className="font-bold text-slate-900">Record kitchen waste</h3><p className="mt-1 text-xs text-slate-500">{wasteFor.itemName} · {wasteFor.departmentName} · available {wasteFor.available} {wasteFor.unit}</p></div><button type="button" onClick={() => setWasteFor(null)} className="text-sm font-semibold text-slate-500">Close</button></div><label className="mt-4 block text-xs font-semibold text-slate-600">Quantity wasted<input required type="number" min="0.0001" max={wasteFor.available} step="0.0001" value={wasteQuantity} onChange={(event) => setWasteQuantity(event.target.value)} className={`mt-1 ${input}`} /></label><label className="mt-3 block text-xs font-semibold text-slate-600">Reason<input required value={wasteNote} onChange={(event) => setWasteNote(event.target.value)} placeholder="Expired, spoiled, preparation loss…" className={`mt-1 ${input}`} /></label><button disabled={saving} className="mt-4 min-h-11 w-full rounded-xl bg-amber-600 px-4 text-sm font-bold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Record waste and reduce kitchen stock'}</button></form></div>}
        {dateFor && <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4"><form onSubmit={saveRequisitionDate} className="w-full max-w-md rounded-t-3xl bg-white p-5 shadow-xl sm:rounded-3xl"><div className="flex items-start justify-between gap-3"><div><h3 className="font-bold text-slate-900">Correct requisition date</h3><p className="mt-1 text-xs text-slate-500">This changes the requisition record date. Stock transfer dates remain in the movement history.</p></div><button type="button" onClick={() => setDateFor(null)} className="text-sm font-semibold text-slate-500">Close</button></div><label className="mt-4 block text-xs font-semibold text-slate-600">Requisition date<input required type="date" value={dateCorrection} onChange={(event) => setDateCorrection(event.target.value)} className={`mt-1 ${input}`} /></label><button disabled={saving} className="mt-4 min-h-11 w-full rounded-xl bg-slate-900 px-4 text-sm font-bold text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save date'}</button></form></div>}
    </section>;
}
