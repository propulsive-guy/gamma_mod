'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CameraIcon, CheckCircleIcon, SparklesIcon, TrashIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';
import { importScannedMenuItems, type ScannedMenuItem } from '@/app/actions/menu';
import { extractMenuPhoto } from '@/app/actions/geminiOcr';
import { prepareScanImage } from '@/lib/prepareScanImage';

type ReviewItem = ScannedMenuItem & { selected: boolean };

export function MenuPhotoImporter() {
    const router = useRouter();
    const inputRef = useRef<HTMLInputElement>(null);
    const [photo, setPhoto] = useState<File | null>(null);
    const [preview, setPreview] = useState('');
    const [items, setItems] = useState<ReviewItem[]>([]);
    const [scanning, setScanning] = useState(false);
    const [importing, setImporting] = useState(false);

    const selectPhoto = (file?: File) => {
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            toast.error('Choose a menu image from your camera or gallery');
            return;
        }
        if (file.size > 30 * 1024 * 1024) {
            toast.error('Menu photo is too large. Crop it to the menu or take a screenshot, then try again.');
            return;
        }
        if (preview) URL.revokeObjectURL(preview);
        setPhoto(file);
        setPreview(URL.createObjectURL(file));
        setItems([]);
    };

    const scan = async () => {
        if (!photo || scanning) return;
        setScanning(true);
        try {
            const formData = new FormData();
            formData.set('image', await prepareScanImage(photo));
            const result = await extractMenuPhoto(formData);
            if (!result.success || !result.items) return toast.error(result.error || 'Gemini could not find menu items.');
            setItems(result.items.map((item) => ({ ...item, selected: true })));
            toast.success(`Found ${result.items.length} menu items. Please review them.`);
        } catch (error) {
            console.error('Gemini menu image reading error:', error);
            toast.error(error instanceof Error ? error.message : 'The menu scan request failed. Check your connection and try again.');
        } finally {
            setScanning(false);
        }
    };

    const update = (index: number, patch: Partial<ReviewItem>) => {
        setItems((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
    };

    const remove = (index: number) => setItems((current) => current.filter((_, itemIndex) => itemIndex !== index));

    const importItems = async () => {
        const selected = items.filter((item) => item.selected).map(({ selected: _selected, ...item }) => item);
        if (!selected.length) {
            toast.error('Select at least one item');
            return;
        }
        if (selected.some((item) => !item.name.trim() || !item.category.trim() || !Number.isFinite(Number(item.price)) || Number(item.price) < 0)) {
            toast.error('Check the name, category, and price for each selected item');
            return;
        }
        setImporting(true);
        const result = await importScannedMenuItems(selected);
        setImporting(false);
        if (!result.success) {
            toast.error(result.error || 'Could not import menu items');
            return;
        }
        toast.success(`Imported ${result.imported} items${result.skipped ? `; skipped ${result.skipped} duplicates` : ''}.`);
        setItems([]);
        setPhoto(null);
        if (preview) URL.revokeObjectURL(preview);
        setPreview('');
        if (inputRef.current) inputRef.current.value = '';
        router.refresh();
    };

    return (
        <section className="overflow-hidden rounded-2xl border border-violet-100 bg-gradient-to-br from-violet-50 via-white to-sky-50 shadow-sm">
            <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-start gap-3">
                    <div className="rounded-2xl bg-violet-100 p-3 text-violet-700"><SparklesIcon className="h-6 w-6" /></div>
                    <div>
                        <h2 className="font-bold text-slate-900">Add menu from a photo</h2>
                        <p className="mt-1 max-w-xl text-sm text-slate-600">Send a photo of your printed menu to Gemini, then review each suggested item before importing.</p>
                    </div>
                </div>
                <label className="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-3 text-sm font-bold text-white shadow-sm transition hover:bg-violet-700">
                    <CameraIcon className="h-5 w-5" />
                    {photo ? 'Choose another photo' : 'Upload menu photo'}
                    <input ref={inputRef} type="file" accept="image/*" className="sr-only" onChange={(event) => selectPhoto(event.target.files?.[0])} />
                </label>
            </div>

            {photo && (
                <div className="border-t border-violet-100 bg-white/75 p-5">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                        <img src={preview} alt="Selected printed menu" className="h-32 w-full rounded-xl border border-slate-200 object-cover sm:w-28" />
                        <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-slate-800">{photo.name}</p>
                            <p className="mt-1 text-xs text-slate-500">For best results, use a straight, well-lit photo with readable prices.</p>
                        </div>
                        <button type="button" disabled={scanning} onClick={scan} className="rounded-xl bg-slate-900 px-5 py-3 text-sm font-bold text-white disabled:opacity-50">
                            {scanning ? 'Reading menu with Gemini…' : 'Scan menu'}
                        </button>
                    </div>
                </div>
            )}

            {items.length > 0 && (
                <div className="border-t border-violet-100 bg-white p-5">
                    <div className="mb-4 flex items-center justify-between gap-3">
                        <div>
                            <h3 className="font-bold text-slate-900">Review before importing</h3>
                            <p className="text-xs text-slate-500">Correct anything the photo reader misunderstood.</p>
                        </div>
                        <span className="rounded-full bg-violet-50 px-3 py-1 text-xs font-bold text-violet-700">{items.filter((item) => item.selected).length} selected</span>
                    </div>
                    <div className="max-h-[32rem] space-y-3 overflow-y-auto pr-1">
                        {items.map((item, index) => (
                            <div key={index} className={`rounded-xl border p-3 ${item.selected ? 'border-violet-200 bg-violet-50/30' : 'border-slate-200 bg-slate-50 opacity-60'}`}>
                                <div className="grid gap-3 md:grid-cols-[auto_1.4fr_0.8fr_0.55fr_auto] md:items-center">
                                    <input type="checkbox" checked={item.selected} onChange={(event) => update(index, { selected: event.target.checked })} aria-label={`Select ${item.name}`} className="h-4 w-4 accent-violet-600" />
                                    <input value={item.name} onChange={(event) => update(index, { name: event.target.value })} aria-label="Item name" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-900" />
                                    <input value={item.category} onChange={(event) => update(index, { category: event.target.value })} aria-label="Category" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700" />
                                    <input type="number" min="0" step="0.01" value={item.price} onChange={(event) => update(index, { price: Number(event.target.value) })} aria-label="Price in rupees" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-900" />
                                    <button type="button" onClick={() => remove(index)} aria-label={`Remove ${item.name}`} className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"><TrashIcon className="h-5 w-5" /></button>
                                </div>
                                <input value={item.description} onChange={(event) => update(index, { description: event.target.value })} aria-label="Description" placeholder="Description (optional)" className="mt-2 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600" />
                            </div>
                        ))}
                    </div>
                    <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                        <button type="button" onClick={() => setItems([])} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-600"><XMarkIcon className="h-4 w-4" /> Clear results</button>
                        <button type="button" disabled={importing} onClick={importItems} className="inline-flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-5 py-3 text-sm font-bold text-white disabled:opacity-50"><CheckCircleIcon className="h-5 w-5" /> {importing ? 'Adding items…' : 'Import selected items'}</button>
                    </div>
                </div>
            )}
        </section>
    );
}
