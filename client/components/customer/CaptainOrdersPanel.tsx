'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowPathIcon, ArrowRightIcon, CheckCircleIcon, PencilSquareIcon, PrinterIcon, TableCellsIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { toast } from 'react-hot-toast';
import { completeCaptainOrder, editCaptainOrder, getCaptainTableOrders, transferCaptainOrder } from '@/app/actions/order';
import { formatCurrency, formatDate } from '@/lib/utils';
import BillModal from '@/components/dashboard/BillModal';
import { OrderPaymentQr } from './OrderPaymentQr';

interface MenuItem {
    _id: string;
    name: string;
    price: number;
    category: string;
}

interface TableOption {
    _id: string;
    tableNumber: string;
}

interface Order {
    _id: string;
    tableId: string | { _id?: string; tableNumber?: string };
    orderType?: 'dine-in' | 'takeaway';
    orderChannel?: 'customer' | 'waiter';
    items: Array<{ menuItemId?: string; name: string; price: number; quantity: number }>;
    total: number;
    status: 'pending' | 'preparing' | 'served' | 'completed' | 'cancelled';
    paymentStatus?: 'pending' | 'paid';
    paymentMethod?: 'upi' | 'cash';
    checkout?: { payableAmount?: number; discountAmount?: number; tipAmount?: number; gstRate?: number; sgstRate?: number; gstAmount?: number; sgstAmount?: number; packagingCharge?: number; couponCode?: string };
    customerName?: string;
    notes?: string;
    createdAt: string;
    updatedAt?: string;
}

interface Restaurant {
    _id: string;
    name: string;
    address?: string;
    phone?: string;
    gstNumber?: string;
    fssaiNumber?: string;
    gstPercentage?: number;
    sgstPercentage?: number;
    upiId?: string;
    upiPayeeName?: string;
    merchantCode?: string;
}

type DraftLine = { menuItemId: string; quantity: number };

const orderAmount = (order: Order) => Number(order.checkout?.payableAmount ?? order.total);
const tableIdOf = (order: Order) => typeof order.tableId === 'string' ? order.tableId : order.tableId?._id || '';

export function CaptainOrdersPanel({
    captainKey,
    table,
    tables,
    menuItems,
    restaurant,
}: {
    captainKey: string;
    table: TableOption;
    tables: TableOption[];
    menuItems: MenuItem[];
    restaurant: Restaurant;
}) {
    const [orders, setOrders] = useState<Order[]>([]);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [busyOrderId, setBusyOrderId] = useState('');
    const [transferTargets, setTransferTargets] = useState<Record<string, string>>({});
    const [editingOrder, setEditingOrder] = useState<Order | null>(null);
    const [draftLines, setDraftLines] = useState<DraftLine[]>([]);
    const [draftNotes, setDraftNotes] = useState('');
    const [newMenuItemId, setNewMenuItemId] = useState('');
    const [savingEdit, setSavingEdit] = useState(false);
    const [billOrder, setBillOrder] = useState<Order | null>(null);

    const refresh = useCallback(async (showSpinner = false) => {
        if (showSpinner) setRefreshing(true);
        try {
            const result = await getCaptainTableOrders(captainKey, table._id);
            if (!result.success) throw new Error(result.error || 'Could not load table orders.');
            setOrders((result.orders || []) as Order[]);
        } catch (error) {
            if (showSpinner) toast.error(error instanceof Error ? error.message : 'Could not load table orders.');
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, [captainKey, table._id]);

    useEffect(() => {
        setOrders([]);
        setLoading(true);
        void refresh();
        const interval = window.setInterval(() => { void refresh(); }, 7000);
        return () => window.clearInterval(interval);
    }, [refresh]);

    const editableMenu = useMemo(() => menuItems.filter((item) => Number.isFinite(item.price)), [menuItems]);

    const openEditor = (order: Order) => {
        setEditingOrder(order);
        setDraftLines(order.items.map((item) => ({ menuItemId: String(item.menuItemId || ''), quantity: item.quantity })));
        setDraftNotes(order.notes || '');
        setNewMenuItemId('');
    };

    const changeQuantity = (index: number, quantity: number) => {
        setDraftLines((current) => quantity < 1
            ? current.filter((_, lineIndex) => lineIndex !== index)
            : current.map((line, lineIndex) => lineIndex === index ? { ...line, quantity: Math.min(99, quantity) } : line));
    };

    const addDraftItem = () => {
        if (!newMenuItemId) return;
        setDraftLines((current) => {
            const existing = current.findIndex((line) => line.menuItemId === newMenuItemId);
            if (existing >= 0) return current.map((line, index) => index === existing ? { ...line, quantity: Math.min(99, line.quantity + 1) } : line);
            return [...current, { menuItemId: newMenuItemId, quantity: 1 }];
        });
        setNewMenuItemId('');
    };

    const saveEdit = async () => {
        if (!editingOrder || savingEdit) return;
        if (draftLines.length === 0 || draftLines.some((line) => !line.menuItemId)) {
            toast.error('Keep at least one available menu item in the order.');
            return;
        }
        setSavingEdit(true);
        try {
            const result = await editCaptainOrder(captainKey, table._id, editingOrder._id, draftLines, draftNotes);
            if (!result.success) throw new Error(result.error || 'Could not update this order.');
            setOrders((current) => current.map((order) => order._id === editingOrder._id ? result.data as Order : order));
            setEditingOrder(null);
            toast.success('Order and bill updated.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Could not update this order.');
        } finally {
            setSavingEdit(false);
        }
    };

    const transferOrder = async (order: Order) => {
        const targetTableId = transferTargets[order._id];
        if (!targetTableId) { toast.error('Choose the destination table first.'); return; }
        setBusyOrderId(order._id);
        try {
            const result = await transferCaptainOrder(captainKey, table._id, order._id, targetTableId);
            if (!result.success) throw new Error(result.error || 'Could not transfer this order.');
            setOrders((current) => current.filter((currentOrder) => currentOrder._id !== order._id));
            toast.success(`Order moved to Table ${tables.find((item) => item._id === targetTableId)?.tableNumber || ''}.`);
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Could not transfer this order.');
        } finally {
            setBusyOrderId('');
        }
    };

    const completeOrder = async (order: Order) => {
        setBusyOrderId(order._id);
        try {
            const result = await completeCaptainOrder(captainKey, table._id, order._id);
            if (!result.success) throw new Error(result.error || 'Could not complete this order.');
            setOrders((current) => current.map((currentOrder) => currentOrder._id === order._id ? result.data as Order : currentOrder));
            toast.success('Order completed. Show the QR to collect payment.');
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Could not complete this order.');
        } finally {
            setBusyOrderId('');
        }
    };

    return (
        <section className="mx-auto min-h-[70vh] max-w-6xl space-y-4 bg-slate-50 px-4 py-5 sm:px-6 sm:py-7">
            <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                    <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">Table {table.tableNumber}</p>
                    <h1 className="mt-1 text-2xl font-extrabold tracking-tight text-slate-950 sm:text-3xl">Waiter orders</h1>
                    <p className="mt-1 text-sm text-slate-600">Review, update, move, and close orders for this table.</p>
                </div>
                <button type="button" onClick={() => void refresh(true)} disabled={refreshing} className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 shadow-sm disabled:opacity-60">
                    <ArrowPathIcon className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
                </button>
            </div>

            {loading ? (
                <div className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-500">Loading orders for Table {table.tableNumber}…</div>
            ) : orders.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
                    <TableCellsIcon className="mx-auto h-9 w-9 text-slate-300" />
                    <h2 className="mt-3 text-lg font-bold text-slate-900">No waiter orders for this table</h2>
                    <p className="mt-1 text-sm text-slate-500">Orders sent from the waiter page will appear here automatically.</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {orders.map((order) => {
                        const closed = order.status === 'completed' || order.status === 'cancelled';
                        const payable = orderAmount(order);
                        return (
                            <article key={order._id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 px-4 py-4 sm:px-5">
                                    <div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <h2 className="text-base font-extrabold text-slate-950">Order #{order._id.slice(-6).toUpperCase()}</h2>
                                            <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold capitalize ${order.status === 'completed' ? 'bg-emerald-100 text-emerald-800' : order.status === 'cancelled' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-800'}`}>{order.status}</span>
                                            {order.orderChannel && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600">{order.orderChannel === 'waiter' ? 'Waiter' : 'Customer QR'}</span>}
                                            {order.paymentStatus === 'paid' && <span className="rounded-full bg-sky-100 px-2.5 py-1 text-[11px] font-bold text-sky-800">Paid{order.paymentMethod ? ` · ${order.paymentMethod.toUpperCase()}` : ''}</span>}
                                        </div>
                                        <p className="mt-1 text-xs text-slate-500">{formatDate(order.createdAt)}{order.customerName ? ` · ${order.customerName}` : ''}</p>
                                    </div>
                                    <p className="text-xl font-extrabold text-slate-950">{formatCurrency(payable)}</p>
                                </div>

                                <div className="space-y-2 px-4 py-4 sm:px-5">
                                    {order.items.map((item, index) => (
                                        <div key={`${item.menuItemId || item.name}-${index}`} className="flex justify-between gap-3 text-sm">
                                            <span className="min-w-0 font-semibold text-slate-800">{item.quantity} × {item.name}</span>
                                            <span className="shrink-0 text-slate-600">{formatCurrency(item.quantity * item.price)}</span>
                                        </div>
                                    ))}
                                    {order.notes && <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-600"><span className="font-bold text-slate-700">Kitchen note: </span>{order.notes}</p>}
                                </div>

                                <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 px-4 py-3 sm:px-5">
                                    {!closed && order.paymentStatus !== 'paid' && <button type="button" onClick={() => openEditor(order)} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-700 hover:bg-slate-50"><PencilSquareIcon className="h-4 w-4" /> Edit order</button>}
                                    <button type="button" onClick={() => setBillOrder(order)} className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-700 hover:bg-slate-50"><PrinterIcon className="h-4 w-4" /> Print bill</button>
                                    {!closed && order.paymentStatus !== 'paid' && (
                                        <div className="flex min-h-10 w-full gap-2 sm:ml-auto sm:w-auto">
                                            <select aria-label="Move order to table" value={transferTargets[order._id] || ''} onChange={(event) => setTransferTargets((current) => ({ ...current, [order._id]: event.target.value }))} className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 sm:w-40 sm:flex-none">
                                                <option value="">Move to table…</option>
                                                {tables.filter((candidate) => candidate._id !== table._id).map((candidate) => <option key={candidate._id} value={candidate._id}>Table {candidate.tableNumber}</option>)}
                                            </select>
                                            <button type="button" disabled={busyOrderId === order._id || !transferTargets[order._id]} onClick={() => void transferOrder(order)} className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-slate-100 px-3 text-xs font-bold text-slate-700 disabled:opacity-40"><ArrowRightIcon className="h-4 w-4" /> Move</button>
                                        </div>
                                    )}
                                    {!closed && order.paymentStatus !== 'paid' && <button type="button" disabled={busyOrderId === order._id} onClick={() => void completeOrder(order)} className="inline-flex min-h-10 w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-700 px-4 text-xs font-bold text-white hover:bg-emerald-800 disabled:opacity-60 sm:ml-auto sm:w-auto"><CheckCircleIcon className="h-4 w-4" /> {busyOrderId === order._id ? 'Completing…' : 'Complete order'}</button>}
                                </div>

                                {order.status === 'completed' && order.paymentStatus !== 'paid' && (
                                    <div className="px-4 pb-4 sm:px-5 sm:pb-5">
                                        <OrderPaymentQr restaurant={restaurant} amount={payable} orderId={order._id} />
                                    </div>
                                )}
                            </article>
                        );
                    })}
                </div>
            )}

            {editingOrder && (
                <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-4" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !savingEdit) setEditingOrder(null); }}>
                    <section role="dialog" aria-modal="true" aria-labelledby="edit-waiter-order-title" className="max-h-[92dvh] w-full max-w-2xl overflow-y-auto rounded-t-3xl bg-white p-4 shadow-2xl sm:rounded-3xl sm:p-6">
                        <div className="flex items-start justify-between gap-3">
                            <div><h2 id="edit-waiter-order-title" className="text-xl font-extrabold text-slate-950">Edit order #{editingOrder._id.slice(-6).toUpperCase()}</h2><p className="mt-1 text-sm text-slate-500">Changing items will update the bill and kitchen stock.</p></div>
                            <button type="button" onClick={() => setEditingOrder(null)} aria-label="Close edit order" className="rounded-xl p-2 text-slate-500 hover:bg-slate-100"><XMarkIcon className="h-5 w-5" /></button>
                        </div>
                        <div className="mt-5 space-y-2">
                            {draftLines.map((line, index) => {
                                const item = editableMenu.find((candidate) => candidate._id === line.menuItemId);
                                return (
                                    <div key={`${line.menuItemId}-${index}`} className="flex items-center gap-2 rounded-xl border border-slate-200 p-3">
                                        <div className="min-w-0 flex-1"><p className="truncate text-sm font-bold text-slate-900">{item?.name || editingOrder.items[index]?.name || 'Unavailable dish'}</p><p className="text-xs text-slate-500">{item ? formatCurrency(item.price) : 'Refresh menu item before editing'}</p></div>
                                        <button type="button" onClick={() => changeQuantity(index, line.quantity - 1)} aria-label="Remove one" className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 font-bold text-slate-700">−</button>
                                        <span className="w-7 text-center text-sm font-bold">{line.quantity}</span>
                                        <button type="button" onClick={() => changeQuantity(index, line.quantity + 1)} aria-label="Add one" className="grid h-9 w-9 place-items-center rounded-lg border border-slate-200 font-bold text-slate-700">+</button>
                                    </div>
                                );
                            })}
                        </div>
                        <div className="mt-4 flex gap-2">
                            <select aria-label="Add a menu item" value={newMenuItemId} onChange={(event) => setNewMenuItemId(event.target.value)} className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-700">
                                <option value="">Add a dish…</option>
                                {editableMenu.map((item) => <option key={item._id} value={item._id}>{item.name} · {formatCurrency(item.price)}</option>)}
                            </select>
                            <button type="button" onClick={addDraftItem} disabled={!newMenuItemId} className="min-h-11 rounded-xl bg-slate-900 px-4 text-sm font-bold text-white disabled:opacity-40">Add item</button>
                        </div>
                        <label className="mt-4 block text-sm font-bold text-slate-700">Kitchen note
                            <textarea value={draftNotes} onChange={(event) => setDraftNotes(event.target.value)} maxLength={500} rows={3} className="mt-2 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-normal text-slate-800 outline-none focus:border-emerald-500" placeholder="Optional instructions" />
                        </label>
                        <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                            <button type="button" onClick={() => setEditingOrder(null)} disabled={savingEdit} className="min-h-11 rounded-xl border border-slate-200 px-5 text-sm font-bold text-slate-700">Cancel</button>
                            <button type="button" onClick={() => void saveEdit()} disabled={savingEdit || draftLines.length === 0} className="min-h-11 rounded-xl bg-emerald-700 px-5 text-sm font-bold text-white disabled:opacity-50">{savingEdit ? 'Saving…' : 'Save order changes'}</button>
                        </div>
                    </section>
                </div>
            )}

            <BillModal isOpen={Boolean(billOrder)} onClose={() => setBillOrder(null)} order={billOrder} restaurant={restaurant} />
        </section>
    );
}
