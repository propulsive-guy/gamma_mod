'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CameraIcon, CheckCircleIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';
import { applyInventoryBillPurchase } from '@/app/actions/inventory';
import { extractInventoryBill } from '@/app/actions/geminiOcr';
import { prepareScanImage } from '@/lib/prepareScanImage';

type InventoryItem = { _id: string; name: string; unit: string; currentStock: number; costPerUnit: number };
type ParsedBillLine = { name: string; quantity: number; unit: string; unitCost: number; sourceText: string };
type ReviewLine = ParsedBillLine & { id: string; inventoryItemId: string; createNew: boolean; newItemName: string };
const units = ['kg', 'g', 'l', 'ml', 'piece', 'pack', 'box', 'bottle', 'can'];
const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const normalizedName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');
const inferredUnit = (name: string, unit: string) => {
    if (units.includes(unit)) return unit;
    if (/\b(?:bottle|drink|juice|water|soft drink)\b|\d+\s?ml\b/i.test(name)) return 'bottle';
    if (/\bkg\b/i.test(name)) return 'kg';
    if (/\bg\b/i.test(name)) return 'g';
    if (/\bl\b/i.test(name)) return 'l';
    return 'piece';
};

export function InventoryBillScanner({ items }: { items: InventoryItem[] }) {
    const router = useRouter();
    const inputRef = useRef<HTMLInputElement>(null);
    const [photo, setPhoto] = useState<File | null>(null);
    const [preview, setPreview] = useState('');
    const [rows, setRows] = useState<ReviewLine[]>([]);
    const [reference, setReference] = useState('');
    const [scanning, setScanning] = useState(false);
    const [saving, setSaving] = useState(false);

    useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

    const selectPhoto = (file?: File) => {
        if (!file) return;
        if (!file.type.startsWith('image/')) return toast.error('Choose an image from your camera or gallery');
        if (file.size > 30 * 1024 * 1024) return toast.error('Bill photo is too large. Crop it to the bill or take a screenshot, then try again.');
        setPhoto(file);
        setRows([]);
        setPreview(URL.createObjectURL(file));
    };

    const scan = async () => {
        if (!photo || scanning) return;
        setScanning(true);
        try {
            const formData = new FormData();
            formData.set('image', await prepareScanImage(photo));
            const result = await extractInventoryBill(formData);
            if (!result.success) return toast.error(result.error || 'Gemini could not find inventory rows.');
            if (!result.lines?.length) return toast.error('Gemini could not find inventory rows.');
            setRows(result.lines.map((row) => {
                const match = items.find((item) => normalizedName(item.name) === normalizedName(row.name));
                return {
                    ...row,
                    id: newId(),
                    inventoryItemId: match?._id || '',
                    createNew: !match,
                    newItemName: row.name,
                    unit: match?.unit || inferredUnit(row.name, row.unit),
                };
            }));
            toast.success(`Found ${result.lines.length} lines. Review each line before updating stock.`);
        } catch (error) {
            console.error('Gemini inventory image reading error:', error);
            const details = error instanceof Error ? error.message : '';
            const lowerDetails = details.toLowerCase();
            if (lowerDetails.includes('413') || lowerDetails.includes('too large') || lowerDetails.includes('payload')) {
                toast.error('This photo is too large to upload. Crop it to the bill or take a screenshot, then try again.');
            } else if (lowerDetails.includes('server action') || lowerDetails.includes('deployment')) {
                toast.error('The bill reader deployment is out of date. Reload the app and try again.');
            } else if (details) {
                toast.error(`Bill scan failed: ${details.slice(0, 150)}`);
            } else {
                toast.error('The bill scan request failed before Gemini could read the image. Check your connection and retry.');
            }
        } finally { setScanning(false); }
    };

    const updateRow = (id: string, patch: Partial<ReviewLine>) => setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
    const addRow = () => setRows((current) => [...current, { id: newId(), name: '', quantity: 1, unit: 'piece', unitCost: 0, sourceText: 'Manually added', inventoryItemId: '', createNew: true, newItemName: '' }]);
    const selectedItem = (row: ReviewLine) => items.find((item) => item._id === row.inventoryItemId);
    const invalidRow = (row: ReviewLine) => (!row.inventoryItemId && !row.createNew) || !row.name.trim() || (row.createNew && (!row.newItemName.trim() || row.newItemName.trim().length > 120 || !units.includes(row.unit))) || !Number.isFinite(row.quantity) || row.quantity <= 0 || !Number.isFinite(row.unitCost) || row.unitCost < 0 || (row.inventoryItemId && selectedItem(row)?.unit !== row.unit);

    const apply = async () => {
        if (!rows.length || rows.some(invalidRow)) return toast.error('Select an inventory item and check each quantity, unit, and cost');
        setSaving(true);
        const result = await applyInventoryBillPurchase({
            billReference: reference.trim(),
            lines: rows.map((row) => ({
                inventoryItemId: row.inventoryItemId,
                ...(row.createNew ? { newItemName: row.newItemName.trim() } : {}),
                quantity: row.quantity, unit: row.unit, unitCost: row.unitCost,
            })),
        });
        setSaving(false);
        if (!result.success) return toast.error(result.error || 'Could not update inventory');
        toast.success(`Inventory updated for ${result.updated} bill lines`);
        setRows([]); setPhoto(null); setReference('');
        if (inputRef.current) inputRef.current.value = '';
        window.dispatchEvent(new Event('inventory-stock-changed'));
        router.refresh();
    };

    const inputClass = 'h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800';
    return <section className="overflow-hidden rounded-2xl border border-sky-100 bg-white shadow-sm">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div><h2 className="font-bold text-slate-900">Update stock from a bill</h2><p className="mt-1 text-sm text-slate-600">Send a bill photo to Gemini for reading. Review every suggested line before confirming stock changes.</p></div>
            <label className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-3 text-sm font-bold text-white hover:bg-sky-700"><CameraIcon className="h-5 w-5" />{photo ? 'Choose another bill' : 'Take or upload bill'}<input ref={inputRef} type="file" accept="image/*" className="sr-only" onChange={(event) => selectPhoto(event.target.files?.[0])} /></label>
        </div>
        {photo && <div className="flex flex-col gap-4 border-t border-slate-100 bg-slate-50 p-5 sm:flex-row sm:items-center"><img src={preview} alt="Selected inventory bill" className="h-28 w-full rounded-xl border border-slate-200 object-cover sm:w-32" /><p className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700">{photo.name}</p><button type="button" disabled={scanning} onClick={scan} className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white disabled:opacity-50">{scanning ? 'Adding your bill…' : 'Read bill'}</button></div>}
        {rows.length > 0 && <div className="border-t border-slate-100 p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-bold text-slate-900">Review stock changes</h3><p className="text-xs text-slate-500">OCR suggestions can be wrong. Confirm the item and unit on every line.</p></div><button type="button" onClick={addRow} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700"><PlusIcon className="h-4 w-4" /> Add row</button></div>
            <label className="mb-4 block max-w-sm text-xs font-semibold text-slate-600">Bill / invoice reference<input value={reference} maxLength={80} onChange={(event) => setReference(event.target.value)} placeholder="Optional" className={`${inputClass} mt-1`} /></label>
            <div className="max-h-[28rem] space-y-3 overflow-y-auto pr-1">{rows.map((row) => <div key={row.id} className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-[1.3fr_1.5fr_0.65fr_0.7fr_auto] sm:items-end">
                <label className="text-[11px] font-semibold text-slate-500">Read as<input value={row.name} onChange={(event) => updateRow(row.id, { name: event.target.value, ...(row.createNew ? { newItemName: event.target.value } : {}) })} className={`${inputClass} mt-1`} /></label>
                <label className="text-[11px] font-semibold text-slate-500">Inventory item<select value={row.createNew ? '__new__' : row.inventoryItemId} onChange={(event) => {
                    if (event.target.value === '__new__') updateRow(row.id, { inventoryItemId: '', createNew: true, newItemName: row.newItemName || row.name, unit: inferredUnit(row.name, row.unit) });
                    else { const item = items.find((candidate) => candidate._id === event.target.value); updateRow(row.id, { inventoryItemId: item?._id || '', createNew: false, unit: item?.unit || row.unit }); }
                }} className={`${inputClass} mt-1`}><option value="">Choose existing item</option>{items.map((item) => <option key={item._id} value={item._id}>{item.name} · {item.unit}</option>)}<option value="__new__">＋ Add as a new inventory item</option></select></label>
                <label className="text-[11px] font-semibold text-slate-500">Quantity<input type="number" min="0.0001" step="0.0001" value={row.quantity} onChange={(event) => updateRow(row.id, { quantity: Number(event.target.value) })} className={`${inputClass} mt-1`} /></label>
                <label className="text-[11px] font-semibold text-slate-500">Cost / unit (₹)<input type="number" min="0" step="0.01" value={row.unitCost} onChange={(event) => updateRow(row.id, { unitCost: Number(event.target.value) })} className={`${inputClass} mt-1`} /></label>
                <button type="button" onClick={() => setRows((current) => current.filter((item) => item.id !== row.id))} aria-label="Remove bill line" className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"><TrashIcon className="h-5 w-5" /></button>
                {row.createNew && <div className="grid gap-2 rounded-lg border border-sky-200 bg-sky-50 p-3 sm:col-span-5 sm:grid-cols-[1fr_10rem] sm:items-end"><label className="text-[11px] font-semibold text-sky-800">New inventory item name<input value={row.newItemName} maxLength={120} onChange={(event) => updateRow(row.id, { newItemName: event.target.value })} placeholder="Name to add to inventory" className={`${inputClass} mt-1`} /></label><label className="text-[11px] font-semibold text-sky-800">Stock unit<select value={row.unit} onChange={(event) => updateRow(row.id, { unit: event.target.value })} className={`${inputClass} mt-1`}>{units.map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select></label><p className="text-xs text-sky-800 sm:col-span-2">This item will be created and its stock added after you confirm this reviewed bill.</p></div>}
                {((row.quantity <= 0 || row.unitCost < 0) && <p className="text-xs font-medium text-amber-700 sm:col-span-5">Quantity or unit cost could not be read clearly. Enter it before confirming.</p>)}
                {row.inventoryItemId && row.unit !== selectedItem(row)?.unit && <p className="text-xs font-medium text-amber-700 sm:col-span-5">Bill unit ({row.unit}) differs from inventory unit ({selectedItem(row)?.unit}). Convert the quantity before applying.</p>}
            </div>)}</div>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => setRows([])} className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-600">Clear</button><button type="button" disabled={saving || rows.some(invalidRow)} onClick={apply} className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-600 px-5 py-3 text-sm font-bold text-white disabled:opacity-50"><CheckCircleIcon className="h-5 w-5" />{saving ? 'Updating stock…' : `Confirm ${rows.length} stock updates`}</button></div>
        </div>}
        {!rows.length && items.length === 0 && <p className="border-t border-slate-100 px-5 py-4 text-sm text-slate-500">Add inventory items before scanning a bill.</p>}
    </section>;
}
