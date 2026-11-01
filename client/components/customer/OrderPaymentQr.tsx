'use client';

import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import { CheckCircleIcon, QrCodeIcon } from '@heroicons/react/24/outline';
import { formatCurrency } from '@/lib/utils';

interface PaymentRestaurant {
    name: string;
    upiId?: string;
    upiPayeeName?: string;
    merchantCode?: string;
}

export function OrderPaymentQr({ restaurant, amount, orderId, paymentReceived = false }: { restaurant: PaymentRestaurant; amount: number; orderId: string; paymentReceived?: boolean }) {
    const [qr, setQr] = useState('');
    const [failed, setFailed] = useState(false);
    const upiId = restaurant.upiId?.trim() || '';
    const query = useMemo(() => {
        if (!upiId || !Number.isFinite(amount) || amount <= 0) return '';
        const params = new URLSearchParams({
            pa: upiId,
            pn: restaurant.upiPayeeName?.trim() || restaurant.name,
            tr: orderId,
            tn: `Order ${orderId.slice(-6).toUpperCase()}`,
            am: amount.toFixed(2),
            cu: 'INR',
        });
        const merchantCode = restaurant.merchantCode?.trim();
        if (merchantCode && /^\d{4}$/.test(merchantCode) && merchantCode !== '0000') params.set('mc', merchantCode);
        return `upi://pay?${params.toString()}`;
    }, [amount, orderId, restaurant.merchantCode, restaurant.name, restaurant.upiPayeeName, upiId]);

    useEffect(() => {
        let active = true;
        setQr('');
        setFailed(false);
        if (!query) return;
        void QRCode.toDataURL(query, { errorCorrectionLevel: 'M', margin: 2, width: 300 })
            .then((value) => { if (active) setQr(value); })
            .catch((error) => {
                console.error('Could not generate waiter payment QR:', error);
                if (active) setFailed(true);
            });
        return () => { active = false; };
    }, [query]);

    if (!upiId) {
        return <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">UPI is not configured yet. Add the restaurant UPI ID in Profile to show a payment QR.</div>;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
        return <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm font-semibold text-emerald-900">No payment is due for this order.</div>;
    }

    return (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-center sm:flex-row sm:text-left">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white text-emerald-700"><QrCodeIcon className="h-6 w-6" /></div>
            <div className="min-w-0 flex-1">
                <p className="inline-flex items-center gap-1 text-sm font-bold text-emerald-950"><CheckCircleIcon className="h-4 w-4" /> {paymentReceived ? 'Payment recorded · QR available' : 'Order complete · scan to pay'}</p>
                <p className="mt-1 text-lg font-extrabold text-slate-950">{formatCurrency(amount)}</p>
                <p className="text-xs text-slate-600">{paymentReceived ? 'Payment is marked received. Reopening this QR could result in a duplicate payment.' : 'Ask the customer to scan with any UPI app. After checking that payment arrived, tap Payment received.'}</p>
            </div>
            <div className="grid h-40 w-40 shrink-0 place-items-center rounded-xl border border-emerald-100 bg-white p-2">
                {qr ? <img src={qr} alt={`UPI payment QR for ${formatCurrency(amount)}`} className="h-full w-full object-contain" />
                    : failed ? <span className="text-center text-xs text-red-600">Could not create QR. Retry the page.</span>
                        : <span className="text-xs text-slate-400">Creating QR…</span>}
            </div>
        </div>
    );
}
