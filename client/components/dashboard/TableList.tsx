'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import QRCode from 'qrcode';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import { createTable, createTables, deleteTable } from '@/app/actions/table';
import { toast } from 'react-hot-toast';
import { PlusIcon, TrashIcon, QrCodeIcon, ArrowTopRightOnSquareIcon, UserGroupIcon, ClipboardDocumentIcon } from '@heroicons/react/24/outline';
import Image from 'next/image';

interface Table {
    _id: string;
    tableNumber: string;
    qrCodeDataUrl?: string;
    isActive: boolean;
    isTakeaway?: boolean;
}

function tableColors(index: number) {
    const hue = (205 + index * 137.508) % 360;
    return {
        accent: `hsl(${hue} 65% 34%)`,
        border: `hsl(${hue} 65% 78%)`,
        tint: `hsl(${hue} 75% 96%)`,
    };
}

export function TableList({ initialTables, restaurantId, captainToken }: { initialTables: Table[]; restaurantId: string; captainToken: string }) {
    const router = useRouter();
    const [showAddForm, setShowAddForm] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [addMode, setAddMode] = useState<'automatic' | 'custom'>('automatic');
    const [tableCount, setTableCount] = useState('1');
    const [tableNumber, setTableNumber] = useState('');
    const [selectedQR, setSelectedQR] = useState<string | null>(null);
    const [qrBaseUrl, setQrBaseUrl] = useState('');
    const [takeawayQR, setTakeawayQR] = useState('');
    const [tableQRCodes, setTableQRCodes] = useState<Record<string, string>>({});
    const takeawayTable = initialTables.find((table) => table.isTakeaway);
    const dineInTables = initialTables.filter((table) => !table.isTakeaway)
        .sort((a, b) => a.tableNumber.localeCompare(b.tableNumber, undefined, { numeric: true }));
    const tableIds = dineInTables.map((table) => table._id).join(',');
    const nextTableNumber = dineInTables.reduce((highest, table) => {
        const value = Number(table.tableNumber);
        return /^\d+$/.test(table.tableNumber) && Number.isSafeInteger(value) ? Math.max(highest, value) : highest;
    }, dineInTables.length) + 1;
    const takeawayPath = takeawayTable ? `/table/${restaurantId}/${takeawayTable._id}` : '';
    const qrOrigin = (() => {
        try {
            const parsed = new URL(qrBaseUrl.trim());
            return ['http:', 'https:'].includes(parsed.protocol) ? parsed.origin : '';
        } catch { return ''; }
    })();
    const takeawayUrl = qrOrigin + takeawayPath;
    const isLoopbackQr = /^https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::|$)/.test(qrOrigin);

    useEffect(() => { setQrBaseUrl(window.location.origin); }, []);

    useEffect(() => {
        let active = true;
        if (!takeawayTable || !qrOrigin) {
            setTakeawayQR('');
            return;
        }
        try {
            void QRCode.toDataURL(takeawayUrl, { width: 480, margin: 2, errorCorrectionLevel: 'H' })
                .then((qr) => { if (active) setTakeawayQR(qr); })
                .catch(() => { if (active) setTakeawayQR(''); });
        } catch { setTakeawayQR(''); }
        return () => { active = false; };
    }, [qrOrigin, takeawayUrl, takeawayTable]);

    useEffect(() => {
        let active = true;
        setTableQRCodes({});
        if (!qrOrigin || !tableIds) return;
        const ids = tableIds.split(',');
        void Promise.all(ids.map(async (id) => [
            id,
            await QRCode.toDataURL(`${qrOrigin}/table/${restaurantId}/${id}`, { width: 400, margin: 2, errorCorrectionLevel: 'M' }),
        ] as const)).then((entries) => {
            if (active) setTableQRCodes(Object.fromEntries(entries));
        }).catch(() => { if (active) setTableQRCodes({}); });
        return () => { active = false; };
    }, [qrOrigin, restaurantId, tableIds]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setIsSubmitting(true);

        try {
            const count = Number(tableCount);
            if (addMode === 'automatic' && (!Number.isInteger(count) || count < 1 || count > 50)) {
                toast.error('Choose between 1 and 50 tables');
                return;
            }
            const result = addMode === 'automatic' ? await createTables(count) : await createTable(tableNumber.trim());

            if (result.success) {
                toast.success(addMode === 'automatic' ? `${count} ${count === 1 ? 'table' : 'tables'} added` : 'Table created successfully!');
                setTableNumber('');
                setTableCount('1');
                setShowAddForm(false);
                router.refresh();
            } else {
                toast.error(result.error || 'Failed to create table');
            }
        } catch (error) {
            toast.error('An error occurred');
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure you want to delete this table?')) return;

        const result = await deleteTable(id);
        if (result.success) {
            toast.success('Table deleted successfully');
        } else {
            toast.error('Failed to delete table');
        }
    };

    const copyCaptainLink = async () => {
        if (!captainToken || !qrOrigin) return;
        try {
            await navigator.clipboard.writeText(`${qrOrigin}/captain/${captainToken}`);
            toast.success('Captain link copied');
        } catch {
            toast.error('Could not copy the link. Select and copy it manually.');
        }
    };

    const handleDownloadQR = (qrCode: string, tableName: string) => {
        const link = document.createElement('a');
        link.href = qrCode;
        link.download = tableName === 'takeaway' ? 'takeaway-qr.png' : `table-${tableName}-qr.png`;
        link.click();
    };

    return (
        <div className="space-y-8">
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
                    {takeawayTable && <section className="group rounded-2xl border border-gray-100 bg-white p-6 shadow-sm transition-all hover:shadow-lg">
                        <div className="mb-6">
                            <h2 className="text-sm font-medium uppercase tracking-wide text-gray-500">Takeaway</h2>
                            <p className="mt-1 font-display text-3xl font-bold text-gray-900">QR Code</p>
                        </div>
                        {takeawayQR ? (
                            <div className="flex flex-col items-center gap-3 rounded-xl border border-gray-100 bg-gray-50 p-4 transition-colors group-hover:border-sky-100 group-hover:bg-sky-50">
                                <div className="rounded-lg border border-gray-100 bg-white p-2 shadow-sm">
                                    <Image src={takeawayQR} alt="Takeaway ordering QR code" width={120} height={120} className="rounded-md" unoptimized />
                                </div>
                                <Button size="sm" variant="outline" onClick={() => handleDownloadQR(takeawayQR, 'takeaway')} className="w-full justify-center border-sky-200 text-sky-600 hover:border-sky-300 hover:bg-sky-100"><QrCodeIcon className="mr-2 h-4 w-4" /> Download QR</Button>
                            </div>
                        ) : (
                            <div className="flex h-40 items-center justify-center rounded-xl border border-dashed border-gray-200 bg-gray-50 text-gray-400">
                                <p className="text-sm">Preparing QR for this address...</p>
                            </div>
                        )}
                        <a href={takeawayPath} target="_blank" rel="noopener noreferrer" className="mt-4 flex items-center justify-center rounded-xl border border-gray-100 bg-gray-50 p-3 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900">
                            <ArrowTopRightOnSquareIcon className="mr-2 h-4 w-4" />
                            Open Takeaway Menu
                        </a>
                    </section>}
                    <section className="group rounded-2xl border border-emerald-100 bg-white p-6 shadow-sm transition-all hover:shadow-lg">
                        <div className="mb-5 flex items-start justify-between gap-3">
                            <div>
                                <h2 className="text-sm font-medium uppercase tracking-wide text-gray-500">Captain</h2>
                                <p className="mt-1 font-display text-3xl font-bold text-gray-900">Waiter page</p>
                            </div>
                            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-emerald-50 text-emerald-700"><UserGroupIcon className="h-6 w-6" /></div>
                        </div>
                        <p className="mb-5 text-sm leading-relaxed text-gray-600">One link for waiters. Choose a table, add menu items and send its order to the kitchen.</p>
                        {captainToken && qrOrigin ? (
                            <div className="space-y-3 rounded-xl border border-emerald-100 bg-emerald-50 p-3">
                                <p className="text-xs font-bold text-emerald-900">Captain page URL</p>
                                <a href={`/captain/${captainToken}`} target="_blank" rel="noopener noreferrer" className="block break-all text-xs font-medium text-emerald-800 underline underline-offset-2">{qrOrigin}/captain/{captainToken}</a>
                                <div className="grid grid-cols-2 gap-2">
                                    <a href={`/captain/${captainToken}`} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg bg-emerald-700 px-3 text-xs font-bold text-white"><ArrowTopRightOnSquareIcon className="h-4 w-4" /> Open page</a>
                                    <button type="button" onClick={() => void copyCaptainLink()} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border border-emerald-300 bg-white px-3 text-xs font-bold text-emerald-800"><ClipboardDocumentIcon className="h-4 w-4" /> Copy link</button>
                                </div>
                            </div>
                        ) : (
                            <div className="flex min-h-12 items-center justify-center rounded-xl border border-dashed border-emerald-200 bg-emerald-50 px-4 text-center text-sm font-medium text-emerald-800">
                                {captainToken ? 'Preparing the permanent waiter URL…' : 'Could not prepare the waiter URL. Refresh this page to retry.'}
                            </div>
                        )}
                    </section>
            </div>

            <div className="max-w-lg">
                <label htmlFor="takeaway-base-url" className="block text-xs font-semibold text-gray-700">Website address for QR codes</label>
                <input id="takeaway-base-url" type="url" value={qrBaseUrl} onChange={(event) => setQrBaseUrl(event.target.value)} className="mt-2 w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-200" placeholder="https://your-website.com" />
                {isLoopbackQr ? (
                    <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800">A phone cannot open a localhost QR from your Mac. Enter your Mac’s network address here, such as http://192.168.x.x:5001, then download the updated QRs.</p>
                ) : (
                    <p className="mt-2 text-xs text-gray-500">For phone scanning, both the phone and website must be reachable on the same network, or use your public website address.</p>
                )}
            </div>

            <div className="flex items-center justify-between gap-3">
                <h2 className="text-xl font-bold text-gray-900">Dine-in tables</h2>
                <Button
                    onClick={() => setShowAddForm(!showAddForm)}
                    className="flex items-center gap-2 bg-sky-400 hover:bg-sky-500 text-white shadow-lg shadow-sky-400/20 transition-all hover:-translate-y-0.5"
                >
                    <PlusIcon className="h-5 w-5" />
                    Add Table
                </Button>
            </div>

            {showAddForm && (
                <div className="bg-white border border-gray-100 rounded-2xl shadow-xl p-8 animate-in fade-in slide-in-from-top-4">
                    <h2 className="text-xl font-bold mb-6 text-gray-900 font-display">
                        Add Tables
                    </h2>
                    <form onSubmit={handleSubmit} className="space-y-6">
                        <div className="flex gap-2 rounded-xl bg-gray-100 p-1">
                            <button type="button" onClick={() => setAddMode('automatic')} className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold ${addMode === 'automatic' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>Number automatically</button>
                            <button type="button" onClick={() => setAddMode('custom')} className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold ${addMode === 'custom' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>Custom label</button>
                        </div>
                        {addMode === 'automatic' ? (
                            <div>
                                <Input type="number" min="1" max="50" step="1" label="How many tables?" value={tableCount} onChange={(event) => setTableCount(event.target.value)} required className="bg-sky-50 border-sky-100 text-gray-900 focus:ring-sky-500 focus:border-sky-500" />
                                <p className="mt-2 text-sm text-gray-600">{Number(tableCount) > 0 && Number(tableCount) <= 50 && Number.isInteger(Number(tableCount)) ? `This will add tables ${nextTableNumber}${Number(tableCount) > 1 ? `–${nextTableNumber + Number(tableCount) - 1}` : ''}, each with its own QR.` : 'Choose 1 to 50 tables.'}</p>
                            </div>
                        ) : (
                            <Input label="Table Label" placeholder="e.g., A1 or VIP-1" value={tableNumber} onChange={(event) => setTableNumber(event.target.value)} required className="bg-sky-50 border-sky-100 text-gray-900 placeholder:text-gray-400 focus:ring-sky-500 focus:border-sky-500" />
                        )}
                        <div className="flex justify-end gap-3 pt-2">
                            <Button
                                type="button"
                                variant="ghost"
                                onClick={() => setShowAddForm(false)}
                                className="text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                            >
                                Cancel
                            </Button>
                            <Button
                                type="submit"
                                isLoading={isSubmitting}
                                className="bg-sky-400 hover:bg-sky-500 text-white shadow-lg shadow-sky-400/20"
                            >
                                {addMode === 'automatic' && Number(tableCount) > 1 ? `Add ${tableCount} Tables` : 'Add Table'}
                            </Button>
                        </div>
                    </form>
                </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {dineInTables.map((table, index) => {
                    const colors = tableColors(index);
                    return (
                        <div
                            key={table._id}
                            className="group rounded-2xl border-2 bg-white p-6 shadow-sm transition-all hover:shadow-lg"
                            style={{ borderColor: colors.border }}
                        >
                            <div className="flex justify-between items-start mb-6">
                                <div>
                                    <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wide">Table</h3>
                                    <p className="text-3xl font-bold font-display mt-1" style={{ color: colors.accent }}>{table.tableNumber}</p>
                                </div>
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => handleDelete(table._id)}
                                    className="text-red-400 hover:text-red-600 hover:bg-red-50 -mr-2"
                                >
                                    <TrashIcon className="h-5 w-5" />
                                </Button>
                            </div>

                            <div className="flex flex-col gap-4">
                                {tableQRCodes[table._id] ? (
                                    <div className="flex flex-col items-center gap-3 rounded-xl border p-4" style={{ backgroundColor: colors.tint, borderColor: colors.border }}>
                                        <div className="bg-white p-2 rounded-lg border border-gray-100 shadow-sm">
                                            <Image
                                                src={tableQRCodes[table._id]}
                                                alt={`QR Code for Table ${table.tableNumber}`}
                                                width={120}
                                                height={120}
                                                className="rounded-md"
                                            />
                                        </div>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => handleDownloadQR(tableQRCodes[table._id], table.tableNumber)}
                                            className="w-full justify-center bg-white hover:opacity-80"
                                            style={{ color: colors.accent, borderColor: colors.border }}
                                        >
                                            <QrCodeIcon className="h-4 w-4 mr-2" />
                                            Download QR
                                        </Button>
                                    </div>
                                ) : (
                                    <div className="h-40 rounded-xl flex items-center justify-center text-gray-400 border border-dashed" style={{ backgroundColor: colors.tint, borderColor: colors.border }}>
                                        <p className="text-sm">Preparing QR for this address...</p>
                                    </div>
                                )}

                                <a
                                    href={`/table/${restaurantId}/${table._id}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center justify-center p-3 rounded-xl transition-opacity hover:opacity-80 border text-sm font-medium"
                                    style={{ backgroundColor: colors.tint, borderColor: colors.border, color: colors.accent }}
                                >
                                    <ArrowTopRightOnSquareIcon className="h-4 w-4 mr-2" />
                                    Open Table View
                                </a>
                            </div>
                        </div>
                    );
                })}

                {dineInTables.length === 0 && !showAddForm && (
                    <div className="col-span-full text-center py-16 bg-white border border-gray-100 rounded-2xl shadow-sm">
                        <div className="w-16 h-16 bg-sky-50 text-sky-300 rounded-full flex items-center justify-center mx-auto mb-4">
                            <PlusIcon className="w-8 h-8" />
                        </div>
                        <h3 className="text-lg font-medium text-gray-900">No tables yet</h3>
                        <p className="text-gray-500 mt-1 mb-6">
                            Start by adding your first table.
                        </p>
                        <Button
                            onClick={() => setShowAddForm(true)}
                            className="bg-sky-400 hover:bg-sky-500 text-white"
                        >
                            Add Table
                        </Button>
                    </div>
                )}
            </div>

            {
                selectedQR && (
                    <div
                        className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
                        onClick={() => setSelectedQR(null)}
                    >
                        <div className="bg-white rounded-2xl p-8 max-w-md shadow-2xl animate-in fade-in zoom-in duration-200" onClick={(e) => e.stopPropagation()}>
                            <div className="flex justify-between items-center mb-6">
                                <h3 className="text-lg font-bold text-gray-900">QR Code</h3>
                                <Button variant="ghost" size="sm" onClick={() => setSelectedQR(null)} className="text-gray-500 hover:text-gray-900">
                                    <span className="sr-only">Close</span>
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6">
                                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                </Button>
                            </div>
                            <div className="bg-white p-4 rounded-xl border border-gray-100 shadow-inner mb-6">
                                <Image
                                    src={selectedQR}
                                    alt="QR Code"
                                    width={400}
                                    height={400}
                                    className="mx-auto rounded-lg"
                                />
                            </div>
                            <p className="text-center text-sm text-gray-500">
                                Scan this code to view the menu and place an order.
                            </p>
                        </div>
                    </div>
                )
            }
        </div >
    );
}
