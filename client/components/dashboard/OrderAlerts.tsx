'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { toast } from 'react-hot-toast';
import { ArrowRightIcon, BellAlertIcon, BellSlashIcon, SpeakerWaveIcon } from '@heroicons/react/24/outline';
import { getOrderAlertFeed } from '@/app/actions/order';
import { useSocket } from '@/hooks/useSocket';
import { formatCurrency } from '@/lib/utils';

type IncomingOrder = {
    _id: string;
    createdAt: string;
    status?: 'pending' | 'preparing' | 'served' | 'completed' | 'cancelled';
    orderType?: 'dine-in' | 'takeaway';
    tableId?: { tableNumber?: string };
    items: { name: string; quantity: number }[];
    total: number;
};

function playServiceBell(context: AudioContext, buffer: AudioBuffer) {
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(context.destination);
    source.start();
    return source;
}

export default function OrderAlerts({ restaurantId, baselineTime }: { restaurantId?: string; baselineTime: number }) {
    const router = useRouter();
    const pathname = usePathname();
    const socket = useSocket(restaurantId);
    const [bellEnabled, setBellEnabled] = useState(true);
    const [bellReady, setBellReady] = useState(false);
    const audioContext = useRef<AudioContext | null>(null);
    const bellBuffer = useRef<AudioBuffer | null>(null);
    const bellBufferPromise = useRef<Promise<AudioBuffer> | null>(null);
    const bellEnabledRef = useRef(true);
    const pendingOrderIds = useRef(new Set<string>());
    const activeBellSources = useRef(new Set<AudioBufferSourceNode>());
    const secondRingTimer = useRef<number | null>(null);
    const ringing = useRef(false);
    const lastSocketChangeAt = useRef(0);
    const knownOrderIds = useRef(new Set<string>());
    const mountedAt = useRef(baselineTime);

    useEffect(() => {
        if (!restaurantId) return;
        try {
            const enabled = localStorage.getItem('orders-bell-enabled') !== 'false';
            bellEnabledRef.current = enabled;
            setBellEnabled(enabled);
        } catch { /* Keep the current tab setting when storage is unavailable. */ }

        const context = new AudioContext();
        const abort = new AbortController();
        let active = true;
        audioContext.current = context;
        bellBufferPromise.current = fetch('/service-bell.wav', { signal: abort.signal })
            .then(response => {
                if (!response.ok) throw new Error(`Service bell could not load: ${response.status}`);
                return response.arrayBuffer();
            })
            .then(data => context.decodeAudioData(data));
        void bellBufferPromise.current.then(buffer => {
            if (!active) return;
            bellBuffer.current = buffer;
            if (context.state === 'running') setBellReady(true);
        }).catch(error => {
            if (active) console.error('[OrderAlerts] Service bell could not load:', error);
        });

        const unlock = () => {
            void context.resume().then(() => setBellReady(Boolean(bellBuffer.current)))
                .catch(() => setBellReady(false));
        };
        window.addEventListener('pointerdown', unlock, { once: true });
        window.addEventListener('keydown', unlock, { once: true });
        return () => {
            active = false;
            abort.abort();
            if (secondRingTimer.current !== null) window.clearTimeout(secondRingTimer.current);
            for (const source of activeBellSources.current) {
                try { source.stop(); } catch { /* Already ended. */ }
            }
            activeBellSources.current.clear();
            pendingOrderIds.current.clear();
            ringing.current = false;
            window.removeEventListener('pointerdown', unlock);
            window.removeEventListener('keydown', unlock);
            void context.close();
            audioContext.current = null;
            bellBuffer.current = null;
            bellBufferPromise.current = null;
        };
    }, [restaurantId]);

    const stopRinging = useCallback(() => {
        if (secondRingTimer.current !== null) window.clearTimeout(secondRingTimer.current);
        secondRingTimer.current = null;
        ringing.current = false;
        for (const source of activeBellSources.current) {
            try { source.stop(); } catch { /* Already ended. */ }
        }
        activeBellSources.current.clear();
    }, []);

    const ringAutomatically = useCallback(async () => {
        if (!bellEnabledRef.current || !pendingOrderIds.current.size || ringing.current) return;
        ringing.current = true;
        const context = audioContext.current;
        if (!context) { ringing.current = false; return; }
        try {
            const buffer = bellBuffer.current ?? await bellBufferPromise.current;
            if (!buffer || !bellEnabledRef.current || !pendingOrderIds.current.size) { ringing.current = false; return; }
            await context.resume();
            if (context.state !== 'running' || !bellEnabledRef.current || !pendingOrderIds.current.size) { ringing.current = false; return; }
            setBellReady(true);
            const first = playServiceBell(context, buffer);
            activeBellSources.current.add(first);
            first.onended = () => activeBellSources.current.delete(first);
            secondRingTimer.current = window.setTimeout(() => {
                secondRingTimer.current = null;
                if (bellEnabledRef.current && pendingOrderIds.current.size && context.state === 'running') {
                    const second = playServiceBell(context, buffer);
                    activeBellSources.current.add(second);
                    second.onended = () => activeBellSources.current.delete(second);
                }
                ringing.current = false;
            }, Math.ceil(buffer.duration * 1000) + 200);
        } catch {
            ringing.current = false;
            setBellReady(false);
        }
    }, []);

    const notifyNewOrder = useCallback((order: IncomingOrder) => {
        if (knownOrderIds.current.has(order._id)) return;
        knownOrderIds.current.add(order._id);
        if (order.status && order.status !== 'pending') return;
        pendingOrderIds.current.add(order._id);
        void ringAutomatically();

        const isTakeaway = order.orderType === 'takeaway';
        const title = isTakeaway ? 'New takeaway order' : `New order · Table ${order.tableId?.tableNumber || 'N/A'}`;
        const quantity = order.items.reduce((sum, item) => sum + item.quantity, 0);
        const itemPreview = order.items.slice(0, 2).map(item => `${item.quantity}× ${item.name}`).join(' · ');
        const more = order.items.length > 2 ? ` +${order.items.length - 2} more` : '';

        toast.custom((t) => (
            <div role="alert" className={`w-[min(420px,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-violet-200 bg-white shadow-2xl shadow-violet-900/20 transition-all duration-300 ${t.visible ? 'translate-y-0 opacity-100' : '-translate-y-3 opacity-0'}`}>
                <div className="h-1 bg-gradient-to-r from-violet-600 via-fuchsia-500 to-amber-400" />
                <div className="flex gap-3 p-4">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700">
                        <BellAlertIcon className="h-6 w-6" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-violet-600">Just received</p>
                        <p className="mt-0.5 text-base font-bold text-slate-900">{title}</p>
                        <p className="mt-1 truncate text-sm text-slate-600" title={itemPreview + more}>{itemPreview}{more}</p>
                        <div className="mt-3 flex items-center justify-between gap-3">
                            <span className="text-xs font-semibold text-slate-500">{quantity} {quantity === 1 ? 'item' : 'items'} · {formatCurrency(order.total)}</span>
                            <button type="button" onClick={() => {
                                if (pathname === '/dashboard/orders') {
                                    window.dispatchEvent(new CustomEvent('focus-new-order', { detail: { id: order._id, isTakeaway } }));
                                } else {
                                    router.push(`/dashboard/orders?focus=${encodeURIComponent(order._id)}&type=${isTakeaway ? 'takeaway' : 'dine-in'}`);
                                }
                                toast.dismiss(t.id);
                            }} className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-violet-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600">
                                View order <ArrowRightIcon className="h-3.5 w-3.5" />
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        ), { id: `new-order-${order._id}`, duration: 10000 });
    }, [pathname, ringAutomatically, router]);

    useEffect(() => {
        if (!socket) return;
        const onNewOrder = (order: IncomingOrder) => {
            lastSocketChangeAt.current = Date.now();
            notifyNewOrder(order);
        };
        const onOrderUpdated = (order: IncomingOrder) => {
            lastSocketChangeAt.current = Date.now();
            if (order.status === 'pending') pendingOrderIds.current.add(order._id);
            else pendingOrderIds.current.delete(order._id);
            if (!pendingOrderIds.current.size) stopRinging();
        };
        socket.on('new-order', onNewOrder);
        socket.on('order-updated', onOrderUpdated);
        return () => {
            socket.off('new-order', onNewOrder);
            socket.off('order-updated', onOrderUpdated);
        };
    }, [socket, notifyNewOrder, stopRinging]);

    useEffect(() => {
        if (!restaurantId) return;
        let active = true;
        let fetching = false;
        const refresh = async (force = false) => {
            if (!force && socket?.connected) return;
            if (fetching) return;
            fetching = true;
            const refreshStartedAt = Date.now();
            try {
                const result = await getOrderAlertFeed();
                if (!active || !result.success || !result.data) return;
                if (lastSocketChangeAt.current >= refreshStartedAt) return;
                const orders = result.data as IncomingOrder[];
                const hadPendingOrders = pendingOrderIds.current.size > 0;
                pendingOrderIds.current = new Set(orders.filter(order => order.status === 'pending').map(order => order._id));
                if (!pendingOrderIds.current.size) stopRinging();
                orders.forEach(order => {
                    if (knownOrderIds.current.has(order._id)) return;
                    if (order.status === 'pending' && new Date(order.createdAt).getTime() >= mountedAt.current) notifyNewOrder(order);
                    else knownOrderIds.current.add(order._id);
                });
                if (!hadPendingOrders && pendingOrderIds.current.size) void ringAutomatically();
            } catch (error) {
                console.error('[OrderAlerts] Could not refresh orders:', error);
            } finally {
                fetching = false;
            }
        };
        void refresh(true);
        const handleReconnect = () => { void refresh(true); };
        socket?.on('connect', handleReconnect);
        const interval = window.setInterval(() => { void refresh(); }, 10000);
        return () => {
            active = false;
            window.clearInterval(interval);
            socket?.off('connect', handleReconnect);
        };
    }, [restaurantId, notifyNewOrder, ringAutomatically, stopRinging, socket]);

    useEffect(() => {
        if (!restaurantId) return;
        const interval = window.setInterval(() => { void ringAutomatically(); }, 12000);
        return () => window.clearInterval(interval);
    }, [restaurantId, ringAutomatically]);

    const playPreview = async () => {
        try {
            const context = audioContext.current;
            if (!context) return;
            await context.resume();
            const buffer = await bellBufferPromise.current;
            if (!buffer) throw new Error('Service bell is unavailable');
            bellEnabledRef.current = true;
            setBellEnabled(true);
            try { localStorage.setItem('orders-bell-enabled', 'true'); } catch { /* Keep the current tab setting. */ }
            setBellReady(true);
            playServiceBell(context, buffer);
        } catch {
            setBellReady(false);
            toast.error('Could not play the service bell');
        }
    };

    const toggleBell = async () => {
        const next = !bellEnabled || !bellReady;
        bellEnabledRef.current = next;
        setBellEnabled(next);
        try { localStorage.setItem('orders-bell-enabled', String(next)); } catch { /* Keep the current tab setting. */ }
        if (!next) stopRinging();
        if (next) await playPreview();
    };

    if (!restaurantId || pathname !== '/dashboard/orders') return null;
    return (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-violet-100 bg-gradient-to-r from-violet-50 via-white to-amber-50 px-4 py-3">
            <div className="flex items-center gap-3">
                <div className="rounded-xl bg-violet-100 p-2 text-violet-700"><BellAlertIcon className="h-5 w-5" /></div>
                <div>
                    <p className="text-sm font-bold text-slate-900">Automatic new order alerts</p>
                    <p className="text-xs text-slate-500">New orders ring twice, then repeat until preparation starts</p>
                </div>
            </div>
            <div className="flex items-center gap-2">
                <button type="button" onClick={playPreview} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600">
                    <SpeakerWaveIcon className="h-4 w-4" /> Test service bell
                </button>
                <button type="button" onClick={toggleBell} aria-pressed={bellEnabled && bellReady} className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-violet-600 ${bellEnabled && bellReady ? 'border-violet-200 bg-white text-violet-700 hover:bg-violet-50' : 'border-amber-200 bg-amber-50 text-amber-800 hover:bg-amber-100'}`}>
                    {bellEnabled && bellReady ? <BellAlertIcon className="h-4 w-4" /> : <BellSlashIcon className="h-4 w-4" />}
                    {bellEnabled && bellReady ? 'Bell on' : bellEnabled ? 'Enable bell' : 'Bell off'}
                </button>
            </div>
        </div>
    );
}
