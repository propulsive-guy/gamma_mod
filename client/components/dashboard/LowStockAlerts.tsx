'use client';

import { useCallback, useEffect, useRef } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { toast } from 'react-hot-toast';
import { ExclamationTriangleIcon } from '@heroicons/react/24/outline';
import { getLowStockItems } from '@/app/actions/inventory';
import { useSocket } from '@/hooks/useSocket';

export default function LowStockAlerts({ restaurantId }: { restaurantId?: string }) {
    const socket = useSocket(restaurantId);
    const pathname = usePathname();
    const router = useRouter();
    const previousLevels = useRef<Map<string, 'low' | 'out'> | null>(null);
    const fetching = useRef(false);

    const refresh = useCallback(async () => {
        if (!restaurantId || fetching.current) return;
        fetching.current = true;
        try {
            const result = await getLowStockItems();
            if (!result.success) return;
            const newlyCritical = result.items.filter((item) => {
                const previous = previousLevels.current?.get(item._id);
                return !previous || (previous === 'low' && item.currentStock === 0);
            });
            previousLevels.current = new Map(result.items.map((item) => [item._id, item.currentStock === 0 ? 'out' : 'low']));
            if (!newlyCritical.length) return;

            const names = newlyCritical.slice(0, 3).map((item) => `${item.name} (${item.currentStock} ${item.unit})`).join(', ');
            const extra = newlyCritical.length > 3 ? ` and ${newlyCritical.length - 3} more` : '';
            toast.custom((t) => (
                <div role="alert" className="flex w-[min(420px,calc(100vw-2rem))] items-start gap-3 rounded-2xl border border-amber-200 bg-white p-4 shadow-xl">
                    <ExclamationTriangleIcon className="h-6 w-6 shrink-0 text-amber-600" />
                    <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-slate-900">{newlyCritical.some((item) => item.currentStock === 0) ? 'Stock alert' : 'Low stock alert'}</p>
                        <p className="mt-1 text-sm text-slate-600">{names}{extra} {newlyCritical.length === 1 ? 'needs' : 'need'} restocking.</p>
                        <Link href="/dashboard/store" onClick={() => toast.dismiss(t.id)} className="mt-2 inline-block text-xs font-bold text-amber-700 hover:underline">Review suggested vendor order</Link>
                    </div>
                    <button type="button" onClick={() => toast.dismiss(t.id)} aria-label="Dismiss low stock alert" className="text-sm text-slate-400 hover:text-slate-700">✕</button>
                </div>
            ), { id: 'inventory-low-stock', duration: 10000 });
        } catch (error) {
            console.error('[LowStockAlerts] Could not refresh stock:', error);
        } finally {
            fetching.current = false;
        }
    }, [restaurantId]);

    useEffect(() => {
        void refresh();
        const timer = window.setInterval(() => void refresh(), 30000);
        const onStockChanged = () => void refresh();
        window.addEventListener('inventory-stock-changed', onStockChanged);
        return () => {
            window.clearInterval(timer);
            window.removeEventListener('inventory-stock-changed', onStockChanged);
        };
    }, [refresh]);

    useEffect(() => {
        if (!socket) return;
        const onNewOrder = () => {
            void refresh();
            if (pathname === '/dashboard/inventory') router.refresh();
        };
        socket.on('new-order', onNewOrder);
        return () => { socket.off('new-order', onNewOrder); };
    }, [socket, refresh, pathname, router]);

    return null;
}
