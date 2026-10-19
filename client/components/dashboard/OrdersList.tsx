'use client';

import { useState, useEffect } from 'react';
import Button from '@/components/ui/Button';
import { updateOrderStatus, getOrders, updatePaymentStatus } from '@/app/actions/order';
import { toast } from 'react-hot-toast';
import { formatCurrency, formatDate } from '@/lib/utils';
import { PrinterIcon, CheckCircleIcon, BanknotesIcon, ClipboardDocumentListIcon } from '@heroicons/react/24/outline';
import BillModal from '@/components/dashboard/BillModal';
import KotModal from '@/components/dashboard/KotModal';

import { useSocket } from '@/hooks/useSocket';

interface Order {
    _id: string;
    items: Array<{
        name: string;
        price: number;
        quantity: number;
    }>;
    total: number;
    status: 'pending' | 'preparing' | 'served' | 'completed' | 'cancelled';
    paymentStatus?: 'pending' | 'paid';
    paymentMethod?: 'upi' | 'cash';
    orderType?: 'dine-in' | 'takeaway';
    source?: 'swiggy' | 'zomato' | 'porter';
    checkout?: { payableAmount: number; discountAmount: number; tipAmount: number };
    review?: { foodRating?: number; experienceRating?: number; preparationRating?: number; packagingRating?: number; comment?: string };
    restaurantId: string;
    tableId: {
        tableNumber: string;
    };
    customerName?: string;
    customerPhone?: string;
    notes?: string;
    createdAt: string;
}

interface Restaurant {
    _id: string;
    name: string;
    gstNumber?: string;
    fssaiNumber?: string;
    gstPercentage?: number;
    sgstPercentage?: number;
    address?: string;
    phone?: string;
}

const STATUS_CONFIG = {
    pending: { label: 'Pending', bg: 'bg-amber-50', text: 'text-amber-700', border: 'border-amber-200', bar: 'bg-amber-400' },
    preparing: { label: 'Preparing', bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200', bar: 'bg-blue-400' },
    served: { label: 'Served', bg: 'bg-violet-50', text: 'text-violet-700', border: 'border-violet-200', bar: 'bg-violet-400' },
    completed: { label: 'Completed', bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200', bar: 'bg-emerald-400' },
    cancelled: { label: 'Cancelled', bg: 'bg-red-50', text: 'text-red-700', border: 'border-red-200', bar: 'bg-red-400' },
};

const FILTER_TABS = [
    { key: 'all', label: 'Active' },
    { key: 'takeaway', label: 'Takeaway' },
    { key: 'pending', label: 'Pending' },
    { key: 'preparing', label: 'Preparing' },
    { key: 'served', label: 'Served' },
    { key: 'unpaid', label: 'Unpaid' },
    { key: 'completed', label: 'Completed' },
    { key: 'swiggy', label: 'Swiggy' },
    { key: 'zomato', label: 'Zomato' },
    { key: 'porter', label: 'Porter' },
];

const INTEGRATION_LABELS: Record<string, string> = {
    swiggy: 'Swiggy',
    zomato: 'Zomato',
    porter: 'Porter',
};

const isCompletedUnpaid = (order: Order) => order.status === 'completed' && order.paymentStatus !== 'paid';
const isActiveTakeaway = (order: Order) => order.orderType === 'takeaway' && order.paymentStatus !== 'paid' && order.status !== 'cancelled';

export function OrdersList({ initialOrders, restaurant }: { initialOrders: Order[], restaurant: Restaurant }) {
    const [orders, setOrders] = useState<Order[]>(initialOrders);
    const [filter, setFilter] = useState<string>('all');
    const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
    const [isBillModalOpen, setIsBillModalOpen] = useState(false);
    const [kotOrder, setKotOrder] = useState<Order | null>(null);
    const [paymentOrderId, setPaymentOrderId] = useState<string | null>(null);
    const [savingPaymentOrderId, setSavingPaymentOrderId] = useState<string | null>(null);
    const socket = useSocket(restaurant._id);

    useEffect(() => {
        const focus = (id: string, isTakeaway: boolean) => {
            setFilter(isTakeaway ? 'takeaway' : 'all');
            requestAnimationFrame(() => requestAnimationFrame(() =>
                document.getElementById(`order-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            ));
        };
        const params = new URLSearchParams(window.location.search);
        const id = params.get('focus');
        if (id) focus(id, params.get('type') === 'takeaway');
        const onFocus = (event: Event) => {
            const { id, isTakeaway } = (event as CustomEvent<{ id: string; isTakeaway: boolean }>).detail;
            focus(id, isTakeaway);
        };
        window.addEventListener('focus-new-order', onFocus);
        return () => window.removeEventListener('focus-new-order', onFocus);
    }, []);

    // Socket.IO listener for real-time updates (works when socket connects)
    useEffect(() => {
        if (!socket) return;

        const onNewOrder = (newOrder: Order) => {
            setOrders(prev => prev.some(order => order._id === newOrder._id) ? prev : [newOrder, ...prev]);
        };
        const onOrderUpdated = (updatedOrder: Order) => {
            setOrders(prev => prev.map(o => {
                if (o._id !== updatedOrder._id) return o;
                const tableId = updatedOrder.tableId && typeof updatedOrder.tableId === 'object' && updatedOrder.tableId.tableNumber
                    ? updatedOrder.tableId : o.tableId;
                return { ...updatedOrder, tableId };
            }));
        };
        socket.on('new-order', onNewOrder);

        socket.on('order-updated', onOrderUpdated);

        return () => {
            socket.off('new-order', onNewOrder);
            socket.off('order-updated', onOrderUpdated);
        };
    }, [socket]);

    // Polling fallback: refresh orders every 10 seconds via server action
    // This ensures live updates even when Socket.IO can't connect (HTTPS→HTTP mixed content)
    useEffect(() => {
        const interval = setInterval(async () => {
            try {
                const result = await getOrders();
                if (result.success && result.data) {
                    setOrders(result.data as Order[]);
                }
            } catch (err) {
                console.error('[OrdersList] Polling error:', err);
            }
        }, 10000);

        return () => clearInterval(interval);
    }, []);

    const handleStatusUpdate = async (orderId: string, newStatus: Order['status']) => {
        setOrders(prevOrders => prevOrders.map(order =>
            order._id === orderId ? { ...order, status: newStatus } : order
        ));

        const result = await updateOrderStatus(orderId, newStatus);
        if (result.success) {
            toast.success('Order status updated');
        } else {
            toast.error(result.error || 'Failed to update status');
            const refresh = await getOrders();
            if (refresh.success && refresh.data) {
                setOrders(refresh.data);
            }
        }
    };

    const handlePaymentUpdate = async (orderId: string, paymentMethod: 'upi' | 'cash') => {
        if (savingPaymentOrderId) return;
        setSavingPaymentOrderId(orderId);
        try {
            const result = await updatePaymentStatus(orderId, 'paid', paymentMethod);
            if (result.success) {
                setOrders(previous => previous.map(order => order._id === orderId ? { ...order, paymentStatus: 'paid', paymentMethod } : order));
                setPaymentOrderId(null);
                toast.success(`Payment recorded as ${paymentMethod.toUpperCase()}`);
            } else {
                toast.error(result.error || 'Failed to record payment');
                const refresh = await getOrders();
                if (refresh.success && refresh.data) setOrders(refresh.data);
            }
        } finally {
            setSavingPaymentOrderId(null);
        }
    };

    const handlePrintBill = (order: Order) => {
        setSelectedOrder(order);
        setIsBillModalOpen(true);
    };

    const unpaidCount = orders.filter((order) => order.orderType !== 'takeaway' && isCompletedUnpaid(order)).length;
    const takeawayCount = orders.filter(isActiveTakeaway).length;
    const filteredOrders = orders.filter((order) => {
        if (filter in INTEGRATION_LABELS) return order.source === filter;
        if (filter === 'takeaway') return isActiveTakeaway(order);
        if (filter === 'completed' && order.orderType === 'takeaway') {
            return order.status === 'completed' && order.paymentStatus === 'paid';
        }
        if (order.orderType === 'takeaway') return false;
        if (filter === 'all') {
            return !['completed', 'cancelled'].includes(order.status);
        }
        if (filter === 'unpaid') return isCompletedUnpaid(order);
        return order.status === filter;
    });

    return (
        <div className="space-y-5">
            {/* Filter Tabs */}
            <div className="flex w-fit max-w-full gap-1 overflow-x-auto rounded-xl border border-slate-200/60 bg-white p-1.5">
                {FILTER_TABS.map((tab) => (
                    <button
                        key={tab.key}
                        type="button"
                        onClick={() => setFilter(tab.key)}
                        aria-pressed={filter === tab.key}
                        className={`shrink-0 rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 ${filter === tab.key
                            ? tab.key === 'unpaid' ? 'bg-amber-500 text-white shadow-sm' : 'bg-slate-900 text-white shadow-sm'
                            : 'text-slate-500 hover:text-slate-900 hover:bg-slate-50'
                            }`}
                    >
                        {tab.label}
                        {tab.key === 'unpaid' && <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[11px] font-bold ${filter === 'unpaid' ? 'bg-white/25 text-white' : 'bg-amber-100 text-amber-800'}`}>{unpaidCount}</span>}
                        {tab.key === 'takeaway' && <span className={`ml-2 rounded-full px-1.5 py-0.5 text-[11px] font-bold ${filter === 'takeaway' ? 'bg-white/25 text-white' : 'bg-violet-100 text-violet-700'}`}>{takeawayCount}</span>}
                    </button>
                ))}
            </div>

            {/* Orders Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
                {filteredOrders.map((order) => {
                    const statusConfig = STATUS_CONFIG[order.status];
                    return (
                        <div
                            key={order._id}
                            id={`order-${order._id}`}
                            className="bg-white border border-slate-200/60 rounded-2xl overflow-hidden hover:shadow-md hover:shadow-slate-200/50 transition-all duration-300"
                        >
                            {/* Status Bar */}
                            <div className={`h-1 ${statusConfig.bar}`} />

                            {/* Header */}
                            <div className="px-5 pt-4 pb-3">
                                <div className="flex items-start justify-between">
                                    <div>
                                        <div className="flex items-center gap-2.5">
                                            <h3 className="text-base font-bold text-slate-900">
                                                {order.orderType === 'takeaway' ? 'Takeaway' : `Table ${order.tableId?.tableNumber || 'N/A'}`}
                                            </h3>
                                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold uppercase tracking-wider ${statusConfig.bg} ${statusConfig.text}`}>
                                                {order.orderType === 'takeaway' && order.status === 'served' ? 'Ready for pickup' : statusConfig.label}
                                            </span>
                                        </div>
                                        <div className="mt-1.5 text-xs text-slate-500 space-y-0.5">
                                            <p><span className="font-semibold text-slate-700">{order.customerName || 'Guest'}</span>{order.customerPhone ? <span className="font-semibold text-slate-700"> · {order.customerPhone}</span> : ''}</p>
                                            <p>{formatDate(order.createdAt)}</p>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <p className="text-lg font-bold text-slate-900">{formatCurrency(order.checkout?.payableAmount ?? order.total)}</p>
                                        {order.paymentStatus === 'paid' ? (
                                            <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded-full">
                                                <CheckCircleIcon className="w-3 h-3" />
                                                Paid
                                                {order.paymentMethod && ` · ${order.paymentMethod.toUpperCase()}`}
                                            </span>
                                        ) : (
                                            <span className="text-[10px] font-medium text-amber-600">Unpaid</span>
                                        )}
                                    </div>
                                </div>
                            </div>

                            {/* Items */}
                            <div className="mx-5 mb-4 bg-slate-50 rounded-xl p-3.5 border border-slate-100">
                                <div className="space-y-2">
                                    {order.items.map((item, idx) => (
                                        <div key={idx} className="flex justify-between items-center text-sm">
                                            <div className="flex items-center gap-2.5">
                                                <span className="font-semibold text-slate-900 bg-white border border-slate-200 w-5 h-5 flex items-center justify-center rounded text-[10px] shadow-sm">
                                                    {item.quantity}
                                                </span>
                                                <span className="text-slate-900 font-semibold text-sm">{item.name}</span>
                                            </div>
                                            <span className="text-slate-900 font-medium text-sm">{formatCurrency(item.price * item.quantity)}</span>
                                        </div>
                                    ))}
                                </div>
                                {order.notes && (
                                    <div className="mt-3 pt-3 border-t border-slate-200">
                                        <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Note</p>
                                        <p className="text-xs text-slate-600 italic">&ldquo;{order.notes}&rdquo;</p>
                                    </div>
                                )}
                                {order.review && (
                                    <div className="mt-3 border-t border-slate-200 pt-3 text-xs text-slate-600">
                                        {order.review.preparationRating && order.review.packagingRating ? (
                                            <p className="font-semibold text-slate-800">Fast Preparation {order.review.preparationRating}/5 · Packaging {order.review.packagingRating}/5</p>
                                        ) : order.review.foodRating && order.review.experienceRating ? (
                                            <p className="font-semibold text-slate-800">Food {order.review.foodRating}/5 · Experience {order.review.experienceRating}/5</p>
                                        ) : null}
                                        {order.review.comment && <p className="mt-1">“{order.review.comment}”</p>}
                                    </div>
                                )}
                            </div>

                            {/* Actions */}
                            <div className="px-5 pb-4 flex items-center gap-2 flex-wrap">
                                <button
                                    onClick={() => handlePrintBill(order)}
                                    className="p-2 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
                                    title="Print Bill"
                                >
                                    <PrinterIcon className="w-4 h-4" />
                                </button>
                                <button type="button" onClick={() => setKotOrder(order)} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-slate-600 transition-colors hover:bg-slate-100" title="View and print kitchen order ticket">KOT</button>

                                {isCompletedUnpaid(order) && (
                                    <button
                                        onClick={() => setPaymentOrderId(paymentOrderId === order._id ? null : order._id)}
                                        aria-expanded={paymentOrderId === order._id}
                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-sky-600 bg-sky-50 hover:bg-sky-100 border border-sky-200/60 transition-colors"
                                    >
                                        <BanknotesIcon className="w-3.5 h-3.5" />
                                        Mark Paid
                                    </button>
                                )}

                                {paymentOrderId === order._id && isCompletedUnpaid(order) && (
                                    <div className="w-full rounded-xl border border-sky-200 bg-sky-50 p-3">
                                        <p className="mb-2 text-xs font-semibold text-slate-700">How did the customer pay?</p>
                                        <div className="flex gap-2">
                                            <button type="button" disabled={savingPaymentOrderId !== null} onClick={() => void handlePaymentUpdate(order._id, 'upi')} className="rounded-lg bg-white px-3 py-2 text-xs font-bold text-sky-700 ring-1 ring-sky-200 hover:bg-sky-100 disabled:opacity-50">UPI</button>
                                            <button type="button" disabled={savingPaymentOrderId !== null} onClick={() => void handlePaymentUpdate(order._id, 'cash')} className="rounded-lg bg-white px-3 py-2 text-xs font-bold text-sky-700 ring-1 ring-sky-200 hover:bg-sky-100 disabled:opacity-50">Cash</button>
                                            <button type="button" onClick={() => setPaymentOrderId(null)} className="ml-auto px-2 text-xs font-medium text-slate-500 hover:text-slate-800">Cancel</button>
                                        </div>
                                    </div>
                                )}

                                <div className="flex-1" />

                                {order.status === 'pending' && (
                                    <button
                                        onClick={() => handleStatusUpdate(order._id, 'preparing')}
                                        className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-blue-500 hover:bg-blue-600 shadow-sm transition-all"
                                    >
                                        Start Preparing
                                    </button>
                                )}
                                {order.status === 'preparing' && (
                                    <button
                                        onClick={() => handleStatusUpdate(order._id, 'served')}
                                        className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-violet-500 hover:bg-violet-600 shadow-sm transition-all"
                                    >
                                        {order.orderType === 'takeaway' ? 'Ready for pickup' : 'Mark Served'}
                                    </button>
                                )}
                                {order.status === 'served' && (
                                    <button
                                        onClick={() => handleStatusUpdate(order._id, 'completed')}
                                        className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white bg-emerald-500 hover:bg-emerald-600 shadow-sm transition-all"
                                    >
                                        Complete
                                    </button>
                                )}
                                {order.status !== 'completed' && order.status !== 'cancelled' && (
                                    <button
                                        onClick={() => handleStatusUpdate(order._id, 'cancelled')}
                                        className="px-3 py-1.5 rounded-lg text-xs font-medium text-red-500 hover:text-red-600 hover:bg-red-50 transition-colors"
                                    >
                                        Cancel
                                    </button>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Empty State */}
            {filteredOrders.length === 0 && (
                <div className="text-center py-16 bg-white border border-slate-200/60 rounded-2xl">
                    <ClipboardDocumentListIcon className="w-10 h-10 text-slate-300 mx-auto mb-3" />
                    <h3 className="text-sm font-semibold text-slate-900">{filter in INTEGRATION_LABELS ? `No ${INTEGRATION_LABELS[filter]} orders yet` : filter === 'unpaid' ? 'No completed unpaid orders' : filter === 'takeaway' ? 'No unpaid takeaway orders' : 'No orders found'}</h3>
                    <p className="text-slate-400 mt-1 text-sm">
                        {filter in INTEGRATION_LABELS ? `${INTEGRATION_LABELS[filter]} orders will appear here once connected.` : filter === 'unpaid' ? 'Completed orders awaiting payment will appear here.' : filter === 'takeaway' ? 'Paid takeaway orders move to Completed.' : 'Orders will appear here once customers place them.'}
                    </p>
                </div>
            )}

            <BillModal
                isOpen={isBillModalOpen}
                onClose={() => setIsBillModalOpen(false)}
                order={selectedOrder}
                restaurant={restaurant}
            />
            <KotModal order={kotOrder} restaurant={restaurant} onClose={() => setKotOrder(null)} />
        </div>
    );
}
