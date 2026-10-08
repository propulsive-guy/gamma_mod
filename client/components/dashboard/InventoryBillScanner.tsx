'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CameraIcon, CheckCircleIcon, PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';
import { applyInventoryBillPurchase } from '@/app/actions/inventory';
import { parseInventoryBillText, type ParsedBillLine } from '@/lib/inventoryBillOcr';

type InventoryItem = { _id: string; name: string; unit: string; currentStock: number; costPerUnit: number };
type ReviewLine = ParsedBillLine & { id: string; inventoryItemId: string };
const units = ['kg', 'g', 'l', 'ml', 'piece', 'pack', 'box', 'bottle', 'can'];
const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const normalizedName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

async function prepareOcrImage(file: File): Promise<Blob> {
    if (typeof createImageBitmap !== 'function') return file;
    const bitmap = await createImageBitmap(file);
    try {
        const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));
        const context = canvas.getContext('2d');
        if (!context) return file;
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        return await new Promise((resolve) => canvas.toBlob((blob) => resolve(blob || file), 'image/jpeg', 0.82));
    } finally { bitmap.close(); }
}

export function InventoryBillScanner({ items }: { items: InventoryItem[] }) {
    const router = useRouter();
    const inputRef = useRef<HTMLInputElement>(null);
    const [photo, setPhoto] = useState<File | null>(null);
    const [preview, setPreview] = useState('');
    const [rows, setRows] = useState<ReviewLine[]>([]);
    const [reference, setReference] = useState('');
    const [scanning, setScanning] = useState(false);
    const [progress, setProgress] = useState(0);
    const [saving, setSaving] = useState(false);

    useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

    const selectPhoto = (file?: File) => {
        if (!file) return;
        if (!file.type.startsWith('image/')) return toast.error('Choose an image from your camera or gallery');
        if (file.size > 8 * 1024 * 1024) return toast.error('Bill photo must be 8MB or smaller');
        setPhoto(file);
        setRows([]);
        setPreview(URL.createObjectURL(file));
    };

    const scan = async () => {
        if (!photo || scanning) return;
        setScanning(true);
        try {
            const { createWorker } = await import('tesseract.js');
            const image = await prepareOcrImage(photo);
            const worker = await createWorker('eng', 1, {
                logger: (message) => { if (message.status === 'recognizing text') setProgress(Math.round((message.progress || 0) * 100)); },
            });
            let text = '';
            try { text = (await worker.recognize(image)).data.text; }
            finally { await worker.terminate(); }
            const parsed = parseInventoryBillText(text);
            if (!parsed.length) return toast.error('No item rows found. Use a clear, straight photo or add rows manually.');
            setRows(parsed.map((row) => {
                const match = items.find((item) => normalizedName(item.name) === normalizedName(row.name));
                return { ...row, id: newId(), inventoryItemId: match?._id || '' };
            }));
            toast.success(`Found ${parsed.length} lines. Review each line before updating stock.`);
        } catch (error) {
            console.error('Inventory bill OCR error:', error);
            toast.error('Could not read this photo. Try a brighter, sharper image.');
        } finally { setScanning(false); setProgress(0); }
    };

    const updateRow = (id: string, patch: Partial<ReviewLine>) => setRows((current) => current.map((row) => row.id === id ? { ...row, ...patch } : row));
    const addRow = () => setRows((current) => [...current, { id: newId(), name: '', quantity: 1, unit: '', unitCost: 0, sourceText: 'Manually added', inventoryItemId: '' }]);
    const selectedItem = (row: ReviewLine) => items.find((item) => item._id === row.inventoryItemId);
    const invalidRow = (row: ReviewLine) => !row.inventoryItemId || !row.name.trim() || !Number.isFinite(row.quantity) || row.quantity <= 0 || !Number.isFinite(row.unitCost) || row.unitCost < 0 || (row.unit && selectedItem(row)?.unit !== row.unit);

    const apply = async () => {
        if (!rows.length || rows.some(invalidRow)) return toast.error('Select an inventory item and check each quantity, unit, and cost');
        setSaving(true);
        const result = await applyInventoryBillPurchase({
            billReference: reference.trim(),
            lines: rows.map((row) => ({ inventoryItemId: row.inventoryItemId, quantity: row.quantity, unit: row.unit, unitCost: row.unitCost })),
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
            <div><h2 className="font-bold text-slate-900">Update stock from a bill</h2><p className="mt-1 text-sm text-slate-600">Scan with your phone. OCR runs on this device; stock changes only after you review and confirm.</p></div>
            <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-3 text-sm font-bold text-white hover:bg-sky-700"><CameraIcon className="h-5 w-5" />{photo ? 'Choose another bill' : 'Take or upload bill'}<input ref={inputRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="sr-only" onChange={(event) => selectPhoto(event.target.files?.[0])} /></label>
        </div>
        {photo && <div className="flex flex-col gap-4 border-t border-slate-100 bg-slate-50 p-5 sm:flex-row sm:items-center"><img src={preview} alt="Selected inventory bill" className="h-28 w-full rounded-xl border border-slate-200 object-cover sm:w-32" /><p className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700">{photo.name}</p><button type="button" disabled={scanning} onClick={scan} className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white disabled:opacity-50">{scanning ? `Reading… ${progress}%` : 'Read bill'}</button></div>}
        {rows.length > 0 && <div className="border-t border-slate-100 p-5">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h3 className="font-bold text-slate-900">Review stock changes</h3><p className="text-xs text-slate-500">OCR suggestions can be wrong. Confirm the item and unit on every line.</p></div><button type="button" onClick={addRow} className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700"><PlusIcon className="h-4 w-4" /> Add row</button></div>
            <label className="mb-4 block max-w-sm text-xs font-semibold text-slate-600">Bill / invoice reference<input value={reference} maxLength={80} onChange={(event) => setReference(event.target.value)} placeholder="Optional" className={`${inputClass} mt-1`} /></label>
            <div className="max-h-[28rem] space-y-3 overflow-y-auto pr-1">{rows.map((row) => <div key={row.id} className="grid gap-2 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:grid-cols-[1.3fr_1.5fr_0.65fr_0.7fr_auto] sm:items-end">
                <label className="text-[11px] font-semibold text-slate-500">Read as<input value={row.name} onChange={(event) => updateRow(row.id, { name: event.target.value })} className={`${inputClass} mt-1`} /></label>
                <label className="text-[11px] font-semibold text-slate-500">Inventory item<select value={row.inventoryItemId} onChange={(event) => { const item = items.find((candidate) => candidate._id === event.target.value); updateRow(row.id, { inventoryItemId: event.target.value, unit: row.unit || item?.unit || '' }); }} className={`${inputClass} mt-1`}><option value="">Choose item</option>{items.map((item) => <option key={item._id} value={item._id}>{item.name} · {item.unit}</option>)}</select></label>
                <label className="text-[11px] font-semibold text-slate-500">Quantity<input type="number" min="0.0001" step="0.0001" value={row.quantity} onChange={(event) => updateRow(row.id, { quantity: Number(event.target.value) })} className={`${inputClass} mt-1`} /></label>
                <label className="text-[11px] font-semibold text-slate-500">Cost / unit (₹)<input type="number" min="0" step="0.01" value={row.unitCost} onChange={(event) => updateRow(row.id, { unitCost: Number(event.target.value) })} className={`${inputClass} mt-1`} /></label>
                <button type="button" onClick={() => setRows((current) => current.filter((item) => item.id !== row.id))} aria-label="Remove bill line" className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"><TrashIcon className="h-5 w-5" /></button>
                {row.inventoryItemId && row.unit !== selectedItem(row)?.unit && <p className="text-xs font-medium text-amber-700 sm:col-span-5">Bill unit ({row.unit}) differs from inventory unit ({selectedItem(row)?.unit}). Convert the quantity before applying.</p>}
            </div>)}</div>
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => setRows([])} className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-600">Clear</button><button type="button" disabled={saving || rows.some(invalidRow)} onClick={apply} className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-600 px-5 py-3 text-sm font-bold text-white disabled:opacity-50"><CheckCircleIcon className="h-5 w-5" />{saving ? 'Updating stock…' : `Confirm ${rows.length} stock updates`}</button></div>
        </div>}
        {!rows.length && items.length === 0 && <p className="border-t border-slate-100 px-5 py-4 text-sm text-slate-500">Add inventory items before scanning a bill.</p>}
    </section>;
}
