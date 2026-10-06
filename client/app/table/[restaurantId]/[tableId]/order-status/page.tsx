'use client';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import QRCode from 'qrcode';
import { ArrowLeftIcon, ArrowRightIcon, CheckIcon, ClockIcon, CreditCardIcon, HeartIcon, StarIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { getTableVisit } from '@/lib/session';
import { formatCurrency, formatDate } from '@/lib/utils';
import { getPublicRestaurantInfo } from '@/app/actions/restaurant';
import { getOrdersBySession, prepareCustomerCheckout } from '@/app/actions/order';
import { getPublicMenu } from '@/app/actions/menu';
import { getPublicTable } from '@/app/actions/table';
import { OfferCarousel } from '@/components/customer/OfferCarousel';
import { PaymentThankYou } from '@/components/customer/PaymentThankYou';
import { contrastTextColor } from '@/lib/color';
import { BrandFooter } from '@/components/BrandFooter';

type OrderStatus = 'pending' | 'preparing' | 'served' | 'completed' | 'cancelled';

interface Order {
    _id: string;
    orderType?: 'dine-in' | 'takeaway';
    items: Array<{ name: string; price: number; quantity: number; menuItemId?: string }>;
    total: number;
    status: OrderStatus;
    paymentStatus?: 'pending' | 'paid';
    createdAt: string;
    checkout?: {
        couponCode?: string;
        discountAmount: number;
        tipAmount: number;
        packagingCharge?: number;
        gstRate: number;
        sgstRate: number;
        gstAmount: number;
        sgstAmount: number;
        payableAmount: number;
    };
    review?: { foodRating?: number; experienceRating?: number; preparationRating?: number; packagingRating?: number; comment?: string };
}

interface RestaurantInfo {
    name: string;
    address?: string;
    phone?: string;
    logoUrl?: string;
    coverImageUrl?: string;
    themeColor?: string;
    logoAccentColor?: string;
    accentSource?: 'logo' | 'custom';
    fontFamily?: string;
    colorScheme?: string;
    upiId?: string;
    upiPayeeName?: string;
    fssaiNumber?: string;
    gstPercentage?: number;
    sgstPercentage?: number;
    packagingCharge?: number;
    enableAestheticDownloads?: boolean;
}

interface MenuItem {
    _id: string;
    name: string;
    aestheticImageUrl?: string;
}

const steps = [
    { key: 'pending', label: 'Placed', detail: 'Order received' },
    { key: 'preparing', label: 'Preparing', detail: 'In the kitchen' },
    { key: 'served', label: 'Served', detail: 'At your table' },
    { key: 'completed', label: 'Complete', detail: 'Ready to pay' },
] as const;

const fontFamilies: Record<string, string> = {
    inter: 'Inter, sans-serif',
    outfit: 'Outfit, sans-serif',
    poppins: 'Poppins, sans-serif',
    roboto: 'Roboto, sans-serif',
    playfair: 'Playfair Display, serif',
};

const statusThemes: Record<string, { bg: string; card: string; soft: string; text: string; muted: string; border: string; header: string }> = {
    light: { bg: '#f7f7f4', card: '#ffffff', soft: '#fafafa', text: '#18181b', muted: '#71717a', border: '#e4e4e7', header: 'rgba(247,247,244,0.9)' },
    dark: { bg: '#0f172a', card: '#1e293b', soft: '#172033', text: '#f8fafc', muted: '#94a3b8', border: '#334155', header: 'rgba(15,23,42,0.9)' },
    warm: { bg: '#fbf7f0', card: '#fffdf9', soft: '#f7efe4', text: '#332418', muted: '#806b5b', border: '#ebdfd0', header: 'rgba(251,247,240,0.92)' },
    cool: { bg: '#f0f9ff', card: '#ffffff', soft: '#e8f5fb', text: '#0c4a6e', muted: '#47788f', border: '#bae6fd', header: 'rgba(240,249,255,0.92)' },
};

const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export default function OrderStatusPage() {
    const params = useParams();
    const restaurantId = params?.restaurantId as string;
    const tableId = params?.tableId as string;
    const [orders, setOrders] = useState<Order[]>([]);
    const [restaurant, setRestaurant] = useState<RestaurantInfo | null>(null);
    const [isTakeaway, setIsTakeaway] = useState(false);
    const [menuItems, setMenuItems] = useState<MenuItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [reviewOrder, setReviewOrder] = useState<Order | null>(null);
    const [paymentOrderId, setPaymentOrderId] = useState<string | null>(null);
    const [localCheckouts, setLocalCheckouts] = useState<Record<string, Order['checkout']>>({});
    const [foodRating, setFoodRating] = useState(0);
    const [experienceRating, setExperienceRating] = useState(0);
    const [preparationRating, setPreparationRating] = useState(0);
    const [packagingRating, setPackagingRating] = useState(0);
    const [reviewText, setReviewText] = useState('');
    const [couponCode, setCouponCode] = useState('');
    const [tipChoice, setTipChoice] = useState('0');
    const [customTip, setCustomTip] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [checkoutError, setCheckoutError] = useState('');
    const [sessionId, setSessionId] = useState<string | null>(null);
    const [visitId, setVisitId] = useState<string | null>(null);
    const [thankYouOrder, setThankYouOrder] = useState<Order | null>(null);
    const seenPaidOrders = useRef(new Set<string>());

    useEffect(() => {
        if (paymentOrderId) window.scrollTo({ top: 0, behavior: 'smooth' });
    }, [paymentOrderId]);

    useEffect(() => {
        if (!restaurantId || !tableId) return;
        let mounted = true;
        const requestedVisit = new URLSearchParams(window.location.search).get('visit');
        const visit = getTableVisit(restaurantId, tableId);
        const currentVisit = requestedVisit && visit?.visitId === requestedVisit ? visit : null;
        setSessionId(currentVisit?.sessionId || null);
        setVisitId(currentVisit?.visitId || null);
        const loadOrders = async () => {
            if (!currentVisit) {
                if (mounted) { setOrders([]); setLoading(false); }
                return;
            }
            try {
                const result = await getOrdersBySession(currentVisit.sessionId, tableId);
                if (!mounted) return;
                if (!result.success) throw new Error(result.error || 'Unable to load your order');
                const freshPaidOrders = (result.orders as Order[]).filter((order) => {
                    if (document.hidden || order.status !== 'completed' || order.paymentStatus !== 'paid' || seenPaidOrders.current.has(order._id)) return false;
                    seenPaidOrders.current.add(order._id);
                    try {
                        const key = `payment_thanks:${currentVisit.visitId}:${order._id}`;
                        if (window.sessionStorage.getItem(key)) return false;
                        window.sessionStorage.setItem(key, 'shown');
                    } catch { /* The in-memory set still prevents repeated animation. */ }
                    return true;
                });
                setOrders(result.orders);
                if (freshPaidOrders.length > 0) {
                    setThankYouOrder(freshPaidOrders[0]);
                    setPaymentOrderId(null);
                    setReviewOrder(null);
                }
                setError('');
            } catch (cause) {
                if (mounted) setError(cause instanceof Error ? cause.message : 'Unable to load your order');
            } finally {
                if (mounted) setLoading(false);
            }
        };
        void loadOrders();
        void Promise.all([getPublicRestaurantInfo(restaurantId), getPublicMenu(restaurantId), getPublicTable(tableId)])
            .then(([info, menu, table]) => {
                if (!mounted) return;
                setRestaurant(info || null);
                setMenuItems(menu || []);
                setIsTakeaway(Boolean(table?.isTakeaway));
            });
        const timer = currentVisit ? window.setInterval(() => { void loadOrders(); }, 5000) : null;
        const onVisibilityChange = () => { if (!document.hidden) void loadOrders(); };
        if (currentVisit) document.addEventListener('visibilitychange', onVisibilityChange);
        return () => {
            mounted = false;
            if (timer) window.clearInterval(timer);
            document.removeEventListener('visibilitychange', onVisibilityChange);
        };
    }, [restaurantId, tableId]);

    const accent = restaurant?.accentSource === 'custom'
        ? restaurant?.themeColor || '#2563eb'
        : restaurant?.logoAccentColor || restaurant?.themeColor || '#2563eb';
    const accentText = contrastTextColor(accent);
    const fontFamily = fontFamilies[restaurant?.fontFamily || 'inter'] || fontFamilies.inter;
    const colorScheme = restaurant?.colorScheme || 'light';
    const statusTheme = statusThemes[colorScheme] || statusThemes.light;
    const themeStyle = {
        fontFamily,
        backgroundColor: statusTheme.bg,
        color: statusTheme.text,
        '--customer-card': statusTheme.card,
        '--customer-soft': statusTheme.soft,
        '--customer-text': statusTheme.text,
        '--customer-muted': statusTheme.muted,
        '--customer-border': statusTheme.border,
    } as CSSProperties;
    const tableUrl = '/table/' + restaurantId + '/' + tableId + (visitId ? '?visit=' + visitId : '');

    const openCheckout = (order: Order) => {
        if (order.checkout && typeof order.checkout.payableAmount === 'number') {
            setPaymentOrderId(order._id);
            return;
        }
        setFoodRating(0);
        setExperienceRating(0);
        setPreparationRating(0);
        setPackagingRating(0);
        setReviewText('');
        setCouponCode('');
        setTipChoice('0');
        setCustomTip('');
        setCheckoutError('');
        setReviewOrder(order);
    };

    const reviewingTakeaway = reviewOrder?.orderType === 'takeaway' || isTakeaway;
    const tipAmount = reviewOrder && !reviewingTakeaway
        ? tipChoice === 'custom'
            ? Number(customTip || 0)
            : roundMoney(reviewOrder.total * Number(tipChoice) / 100)
        : 0;
    const draftDiscount = reviewOrder && !reviewingTakeaway && couponCode.trim().toUpperCase() === 'DINE10'
        ? roundMoney(reviewOrder.total * 0.1) : 0;
    const draftTaxable = reviewOrder ? reviewOrder.total - draftDiscount : 0;
    const draftTax = roundMoney(draftTaxable * (Number(restaurant?.gstPercentage || 0) + Number(restaurant?.sgstPercentage || 0)) / 100);
    const draftPackagingCharge = isTakeaway ? Number(restaurant?.packagingCharge || 0) : 0;
    const draftPayable = roundMoney(draftTaxable + draftTax + draftPackagingCharge + (Number.isFinite(tipAmount) ? tipAmount : 0));

    const submitCheckout = async (skipReview: boolean) => {
        if (!reviewOrder || submitting || !sessionId) return;
        if (!skipReview && (reviewingTakeaway ? !preparationRating || !packagingRating : !foodRating || !experienceRating)) {
            setCheckoutError(reviewingTakeaway
                ? 'Please rate both Fast Preparation and Packaging.'
                : 'Please rate both Food and Experience.');
            return;
        }
        if (!reviewingTakeaway && couponCode.trim() && couponCode.trim().toUpperCase() !== 'DINE10') {
            setCheckoutError('That code is not valid. Try DINE10.');
            return;
        }
        if (!reviewingTakeaway && (!Number.isFinite(tipAmount) || tipAmount < 0 || tipAmount > 10000)) {
            setCheckoutError('Choose a tip between ₹0 and ₹10,000.');
            return;
        }
        setSubmitting(true);
        setCheckoutError('');
        const result = await prepareCustomerCheckout({
            orderId: reviewOrder._id,
            sessionId,
            tableId,
            couponCode: reviewingTakeaway ? '' : couponCode.trim().toUpperCase(),
            tipAmount: reviewingTakeaway ? 0 : tipAmount,
            ...(!skipReview && (reviewingTakeaway
                ? { preparationRating, packagingRating, reviewText: reviewText.trim() }
                : { foodRating, experienceRating, reviewText: reviewText.trim() })),
        });
        setSubmitting(false);
        if (!result.success || !result.order) {
            // Backend checkout unavailable — fall back to locally-computed totals so
            // the UPI QR (with bill amount embedded) can still be shown to the customer.
            const fallbackCheckout: Order['checkout'] = {
                couponCode: reviewingTakeaway ? '' : couponCode.trim().toUpperCase(),
                discountAmount: reviewingTakeaway ? 0 : draftDiscount,
                tipAmount: reviewingTakeaway ? 0 : (Number.isFinite(tipAmount) ? tipAmount : 0),
                packagingCharge: draftPackagingCharge,
                gstRate: Number(restaurant?.gstPercentage || 0),
                sgstRate: Number(restaurant?.sgstPercentage || 0),
                gstAmount: roundMoney(draftTaxable * Number(restaurant?.gstPercentage || 0) / 100),
                sgstAmount: roundMoney(draftTaxable * Number(restaurant?.sgstPercentage || 0) / 100),
                payableAmount: draftPayable,
            };
            setLocalCheckouts((prev) => ({ ...prev, [reviewOrder._id]: fallbackCheckout }));
            setPaymentOrderId(reviewOrder._id);
            setReviewOrder(null);
            return;
        }
        setOrders((current) => current.map((order) => order._id === result.order._id ? result.order : order));
        setPaymentOrderId(result.order._id);
        setReviewOrder(null);
    };

    const orderedNames = new Set(orders.filter((order) => order.status !== 'cancelled')
        .flatMap((order) => order.items.map((item) => item.name.toLowerCase().trim())));
    const memoryImages = menuItems.filter((item) => item.aestheticImageUrl && orderedNames.has(item.name.toLowerCase().trim()));
    // Merge any locally-computed fallback checkouts so the QR renders even when
    // the backend /checkout endpoint is temporarily unreachable.
    const effectiveOrders = orders.map((order) =>
        localCheckouts[order._id] && !order.checkout
            ? { ...order, checkout: localCheckouts[order._id] }
            : order
    );
    const paymentOrder = effectiveOrders.find((order) => order._id === paymentOrderId && order.status === 'completed' && order.paymentStatus !== 'paid' && typeof order.checkout?.payableAmount === 'number');
    const visitFullyPaid = orders.some((order) => order.status === 'completed' && order.paymentStatus === 'paid') &&
        orders.every((order) => order.status === 'cancelled' || (order.status === 'completed' && order.paymentStatus === 'paid'));

    if (loading) {
        return <div className="min-h-screen grid place-items-center bg-[#f7f7f4]"><div className="h-10 w-10 animate-spin rounded-full border-2 border-zinc-200 border-t-zinc-800" aria-label="Loading orders" /></div>;
    }

    return (
        <div className="customer-status-theme min-h-screen transition-colors duration-300" data-color-scheme={colorScheme} style={themeStyle}>
            <header className="sticky top-0 z-30 border-b backdrop-blur-xl" style={{ backgroundColor: statusTheme.header, borderColor: statusTheme.border }}>
                <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
                    <div className="flex min-w-0 items-center gap-3">
                        {restaurant?.logoUrl ? <img src={restaurant.logoUrl} alt="" className="h-10 w-10 rounded-2xl object-cover" /> :
                            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl text-lg font-bold" style={{ backgroundColor: accent, color: accentText }}>{restaurant?.name?.charAt(0) || 'B'}</div>}
                        <div className="min-w-0">
                            <p className="truncate text-sm font-bold">{restaurant?.name || 'Your restaurant'}</p>
                            <p className="text-xs text-zinc-500">{isTakeaway ? 'Your takeaway order' : 'Your table experience'}</p>
                        </div>
                    </div>
                    <Link href={tableUrl} className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-zinc-200 bg-white px-3 py-2 text-xs font-semibold hover:bg-zinc-50">
                        <ArrowLeftIcon className="h-3.5 w-3.5" /> Menu
                    </Link>
                </div>
            </header>

            <main className="mx-auto max-w-3xl space-y-5 px-4 pb-8 pt-5 sm:px-6">
                {paymentOrder && paymentOrder.checkout ? (
                    <section className="space-y-5">
                        <button type="button" onClick={() => setPaymentOrderId(null)} className="inline-flex items-center gap-2 text-sm font-semibold text-zinc-600 hover:text-zinc-900"><ArrowLeftIcon className="h-4 w-4" /> Back to order status</button>
                        <div className="rounded-[30px] bg-zinc-900 px-7 py-8 text-white sm:px-9">
                            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/50">Your final step</p>
                            <h1 className="mt-2 text-3xl font-bold tracking-tight">{isTakeaway ? 'Ready to take away? Let us settle up.' : 'Enjoyed your meal? Let us settle up.'}</h1>
                            <p className="mt-2 max-w-lg text-sm text-white/70">Payment for order #{paymentOrder._id.slice(-6).toUpperCase()} at {restaurant?.name || 'your restaurant'}.</p>
                        </div>
                        <UPIPaymentSection restaurant={restaurant} amount={paymentOrder.checkout.payableAmount} accent={accent} />
                        <div className="rounded-[26px] border border-zinc-200 bg-white p-6 text-sm shadow-sm">
                            <h2 className="font-bold">Payment summary</h2>
                            <div className="mt-4 space-y-2 text-zinc-500">
                                <div className="flex justify-between"><span>Food subtotal</span><span>{formatCurrency(paymentOrder.total)}</span></div>
                                {!isTakeaway && !!paymentOrder.checkout.discountAmount && <div className="flex justify-between text-emerald-700"><span>DINE10 discount</span><span>−{formatCurrency(paymentOrder.checkout.discountAmount)}</span></div>}
                                {!!(paymentOrder.checkout.gstAmount + paymentOrder.checkout.sgstAmount) && <div className="flex justify-between"><span>Taxes</span><span>{formatCurrency(paymentOrder.checkout.gstAmount + paymentOrder.checkout.sgstAmount)}</span></div>}
                                {!!paymentOrder.checkout.packagingCharge && <div className="flex justify-between"><span>Packaging</span><span>{formatCurrency(paymentOrder.checkout.packagingCharge)}</span></div>}
                                {!isTakeaway && !!paymentOrder.checkout.tipAmount && <div className="flex justify-between"><span>Tip</span><span>{formatCurrency(paymentOrder.checkout.tipAmount)}</span></div>}
                                <div className="flex justify-between border-t border-zinc-100 pt-3 text-base font-bold text-zinc-900"><span>To pay</span><span>{formatCurrency(paymentOrder.checkout.payableAmount)}</span></div>
                            </div>
                        </div>
                    </section>
                ) : <>
                <section className="relative overflow-hidden rounded-[30px] bg-zinc-900 p-7 text-white sm:p-9">
                    {restaurant?.coverImageUrl && <img src={restaurant.coverImageUrl} alt="" className="absolute inset-0 h-full w-full object-cover opacity-45" />}
                    <div className="absolute inset-0 bg-gradient-to-r from-zinc-950/85 to-zinc-950/25" />
                    <div className="relative">
                        <span className="rounded-full border border-white/30 bg-white/10 px-3 py-1 text-xs font-semibold backdrop-blur">{isTakeaway ? 'Takeaway · Your order' : 'Dine in · Your order'}</span>
                        <h1 className="mt-5 text-3xl font-bold tracking-tight sm:text-4xl">{visitFullyPaid ? 'Thank you for joining us.' : orders.length ? 'Good things are on their way.' : isTakeaway ? 'Ready when you are.' : 'Your table is ready.'}</h1>
                        <p className="mt-2 max-w-lg text-sm leading-relaxed text-white/75">{visitFullyPaid ? `Your payment has been received. We hope to welcome you back to ${restaurant?.name || 'our restaurant'} soon.` : orders.length ? isTakeaway ? 'Follow each step. We will have your order ready for pickup soon.' : `Follow each step, settle up when your meal is complete, and enjoy the time at ${restaurant?.name || 'your table'}.` : 'Your orders will appear here once you place them.'}</p>
                    </div>
                </section>

                {!visitFullyPaid && <OfferCarousel accent={accent} takeaway={isTakeaway} />}

                {error && <div role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

                <div className="flex items-end justify-between px-1 pt-3">
                    <div>
                        <p className="text-xs font-bold uppercase tracking-[0.18em]" style={{ color: accent }}>{isTakeaway ? 'Your pickup' : 'At your table'}</p>
                        <h2 className="mt-1 text-2xl font-bold tracking-tight">Your orders</h2>
                    </div>
                    <span className="text-xs text-zinc-500">{orders.length} {orders.length === 1 ? 'order' : 'orders'}</span>
                </div>

                {effectiveOrders.map((order) => {
                    const currentStep = steps.findIndex((step) => step.key === order.status);
                    const checkout = order.checkout;
                    const hasCheckout = typeof checkout?.payableAmount === 'number';
                    const originalTax = roundMoney(order.total * (Number(restaurant?.gstPercentage || 0) + Number(restaurant?.sgstPercentage || 0)) / 100);
                    const estimatedPackaging = isTakeaway ? Number(restaurant?.packagingCharge || 0) : 0;
                    const displayTotal = hasCheckout ? checkout.payableAmount : roundMoney(order.total + originalTax + estimatedPackaging);
                    return (
                        <article key={order._id} className="overflow-hidden rounded-[28px] border border-zinc-200/80 bg-white shadow-sm">
                            <div className="p-5 sm:p-7">
                                <div className="flex flex-wrap items-start justify-between gap-3">
                                    <div>
                                        <p className="text-xs font-semibold uppercase tracking-[0.15em] text-zinc-400">Order #{order._id.slice(-6).toUpperCase()}</p>
                                        <h3 className="mt-1 text-lg font-bold">{order.status === 'completed' ? 'Made with care, ready for you.' : order.status === 'cancelled' ? 'Order cancelled' : 'We have got your order.'}</h3>
                                        <p className="mt-1 text-xs text-zinc-500">{formatDate(order.createdAt)}</p>
                                    </div>
                                    <span className="rounded-full px-3 py-1.5 text-xs font-bold capitalize" style={{ backgroundColor: order.status === 'cancelled' ? '#fee2e2' : accent + '18', color: order.status === 'cancelled' ? '#b91c1c' : accent }}>{isTakeaway && order.status === 'served' ? 'Ready for pickup' : order.status}</span>
                                </div>

                                {order.status !== 'cancelled' && (
                                    <div className="mt-8">
                                        <div className="relative grid grid-cols-4">
                                            <div className="absolute left-[12.5%] right-[12.5%] top-[17px] h-1 rounded-full bg-zinc-100" />
                                            <div className="absolute left-[12.5%] top-[17px] h-1 rounded-full transition-all duration-700" style={{ width: String(Math.max(0, currentStep) * 25) + '%', backgroundColor: accent }} />
                                            {steps.map((step, index) => (
                                                <div key={step.key} className="relative flex flex-col items-center text-center">
                                                    <div className="grid h-9 w-9 place-items-center rounded-full border-2 bg-white transition-all duration-500" style={{ borderColor: index <= currentStep ? accent : '#e4e4e7', backgroundColor: index < currentStep ? accent : 'white', color: index < currentStep ? accentText : index === currentStep ? '#18181b' : '#a1a1aa' }}>
                                                        {index < currentStep ? <CheckIcon className="h-4 w-4 stroke-[3]" /> : <span className="text-xs font-bold">{index + 1}</span>}
                                                    </div>
                                                    <span className="mt-2 text-[11px] font-semibold sm:text-xs" style={{ color: index <= currentStep ? '#18181b' : '#a1a1aa' }}>{isTakeaway && step.key === 'served' ? 'Ready' : step.label}</span>
                                                    <span className="mt-0.5 hidden text-[10px] text-zinc-400 sm:block">{isTakeaway && step.key === 'served' ? 'Collect at counter' : step.detail}</span>
                                                </div>
                                            ))}
                                        </div>
                                        <div className="mt-6 flex items-center gap-2 rounded-2xl bg-zinc-50 px-4 py-3 text-xs text-zinc-600">
                                            <ClockIcon className="h-4 w-4 shrink-0" style={{ color: accent }} />
                                            {order.status === 'pending' ? 'The kitchen has your order and will begin shortly.' :
                                                order.status === 'preparing' ? 'Your food is being prepared fresh.' :
                                                order.status === 'served' ? isTakeaway ? 'Your order is ready for pickup. Payment opens after staff complete the order.' : 'Enjoy your meal. Payment opens after staff complete the order.' :
                                                'Your order is complete. You can now continue to payment.'}
                                        </div>
                                    </div>
                                )}

                                <div className="mt-7 border-t border-zinc-100 pt-5">
                                    <p className="mb-3 text-xs font-bold uppercase tracking-[0.14em] text-zinc-400">Your selection</p>
                                    <div className="space-y-3">
                                        {order.items.map((item, index) => (
                                            <div key={index} className="flex items-baseline justify-between gap-3 text-sm">
                                                <span className="font-medium text-zinc-700"><span className="mr-2 text-zinc-400">{item.quantity}×</span>{item.name}</span>
                                                <span className="shrink-0 font-semibold">{formatCurrency(item.price * item.quantity)}</span>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="mt-5 space-y-2 border-t border-zinc-100 pt-4 text-sm text-zinc-500">
                                        <div className="flex justify-between"><span>Subtotal</span><span>{formatCurrency(order.total)}</span></div>
                                        {!isTakeaway && !!checkout?.discountAmount && <div className="flex justify-between text-emerald-700"><span>DINE10 savings</span><span>−{formatCurrency(checkout.discountAmount)}</span></div>}
                                        {Number(hasCheckout ? checkout.gstRate : restaurant?.gstPercentage || 0) > 0 && <div className="flex justify-between"><span>GST ({hasCheckout ? checkout.gstRate : restaurant?.gstPercentage}%)</span><span>{formatCurrency(hasCheckout ? checkout.gstAmount : roundMoney(order.total * Number(restaurant?.gstPercentage || 0) / 100))}</span></div>}
                                        {Number(hasCheckout ? checkout.sgstRate : restaurant?.sgstPercentage || 0) > 0 && <div className="flex justify-between"><span>SGST ({hasCheckout ? checkout.sgstRate : restaurant?.sgstPercentage}%)</span><span>{formatCurrency(hasCheckout ? checkout.sgstAmount : roundMoney(order.total * Number(restaurant?.sgstPercentage || 0) / 100))}</span></div>}
                                        {(hasCheckout ? Number(checkout.packagingCharge || 0) : estimatedPackaging) > 0 && <div className="flex justify-between"><span>Packaging</span><span>{formatCurrency(hasCheckout ? Number(checkout.packagingCharge || 0) : estimatedPackaging)}</span></div>}
                                        {!isTakeaway && !!checkout?.tipAmount && <div className="flex justify-between"><span>Tip</span><span>{formatCurrency(checkout.tipAmount)}</span></div>}
                                        <div className="flex justify-between border-t border-zinc-100 pt-3 text-base font-bold text-zinc-900"><span>{hasCheckout ? 'Amount to pay' : 'Estimated total'}</span><span>{formatCurrency(displayTotal)}</span></div>
                                    </div>
                                </div>
                            </div>

                            <div className="border-t border-zinc-100 bg-zinc-50/80 p-5 sm:px-7">
                                {order.status === 'completed' && order.paymentStatus === 'paid' ? (
                                    <div className="flex flex-wrap items-center justify-between gap-3">
                                        <div className="flex items-center gap-2 font-semibold" style={{ color: accent }}><CheckIcon className="h-5 w-5" /> Payment received. Thank you! Please come again.</div>
                                        <button type="button" onClick={() => setThankYouOrder(order)} className="rounded-full border px-3 py-2 text-xs font-semibold" style={{ borderColor: accent, color: accent }}>View thank-you</button>
                                    </div>
                                ) : order.status === 'completed' ? (
                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                            <div>
                                                <p className="text-sm font-bold">Ready when you are</p>
                                                <p className="mt-1 text-xs text-zinc-500">A quick review, then scan or open your UPI app.</p>
                                            </div>
                                            <button type="button" onClick={() => openCheckout(order)} className="inline-flex items-center justify-center gap-2 rounded-2xl px-5 py-3 text-sm font-bold transition hover:opacity-90" style={{ backgroundColor: accent, color: accentText }}>
                                                <CreditCardIcon className="h-5 w-5" /> {hasCheckout ? 'View payment' : restaurant?.upiId ? 'Pay via UPI' : 'Continue to checkout'}
                                                <ArrowRightIcon className="h-4 w-4" />
                                            </button>
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-2 text-xs font-medium text-zinc-500"><ClockIcon className="h-4 w-4" /> Checkout unlocks after your order is complete.</div>
                                )}
                            </div>
                        </article>
                    );
                })}

                {orders.length === 0 && !error && (
                    <div className="rounded-[28px] border border-zinc-200 bg-white px-6 py-14 text-center shadow-sm">
                        <p className="text-lg font-bold">No orders for this visit yet.</p>
                        <p className="mt-2 text-sm text-zinc-500">Explore the menu and place your first order. Earlier visits stay private.</p>
                        <Link href={tableUrl} className="mt-5 inline-flex rounded-full px-5 py-3 text-sm font-bold" style={{ backgroundColor: accent, color: accentText }}>Browse menu</Link>
                    </div>
                )}

                {restaurant?.enableAestheticDownloads && (restaurant.coverImageUrl || memoryImages.length > 0) && (
                    <section className="rounded-[28px] border border-zinc-200 bg-white p-6 shadow-sm">
                        <div className="flex items-center gap-2"><HeartIcon className="h-5 w-5" style={{ color: accent }} /><h2 className="text-lg font-bold">A little memory to take home</h2></div>
                        <p className="mt-1 text-xs text-zinc-500">Save your favourite moments from this visit.</p>
                        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                            {[...(restaurant.coverImageUrl ? [{ name: restaurant.name, image: restaurant.coverImageUrl }] : []), ...memoryImages.map((item) => ({ name: item.name, image: item.aestheticImageUrl! }))].map((item, index) => (
                                <a key={item.name + index} href={item.image} download={item.name.replace(/\s+/g, '_') + '.jpg'} className="overflow-hidden rounded-2xl border border-zinc-100">
                                    <img src={item.image} alt={item.name} className="aspect-square w-full object-cover" />
                                    <span className="block truncate px-3 py-2 text-xs font-medium">{item.name} ↓</span>
                                </a>
                            ))}
                        </div>
                    </section>
                )}
                </>}
            </main>
            <BrandFooter className="mx-auto max-w-3xl px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-6 sm:px-6" />

            {reviewOrder && (
                <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-zinc-950/55 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) setReviewOrder(null); }}>
                    <div role="dialog" aria-modal="true" aria-labelledby="review-title" className="w-full max-w-lg max-h-[90dvh] overflow-y-auto rounded-[30px] bg-white p-6 shadow-2xl sm:p-8">
                        <div className="flex items-start justify-between gap-4">
                            <div>
                                <p className="text-xs font-bold uppercase tracking-[0.18em]" style={{ color: accent }}>Before you pay</p>
                                <h2 id="review-title" className="mt-1 text-2xl font-bold tracking-tight">{reviewingTakeaway ? 'How was your takeaway?' : 'How was everything?'}</h2>
                                <p className="mt-2 text-sm leading-relaxed text-zinc-500">{reviewingTakeaway ? 'Rate how quickly your order was prepared and how it was packaged. You can skip it.' : `Your feedback helps ${restaurant?.name || 'the restaurant'} make every visit better. You can skip it.`}</p>
                            </div>
                            <button type="button" onClick={() => setReviewOrder(null)} aria-label="Close review" className="rounded-full bg-zinc-100 p-2 text-zinc-600"><XMarkIcon className="h-5 w-5" /></button>
                        </div>

                        <div className="mt-6 space-y-5">
                            {reviewingTakeaway ? (
                                <>
                                    <RatingInput label="Fast Preparation" value={preparationRating} onChange={setPreparationRating} accent={accent} />
                                    <RatingInput label="Packaging" value={packagingRating} onChange={setPackagingRating} accent={accent} />
                                </>
                            ) : (
                                <>
                                    <RatingInput label="Food" value={foodRating} onChange={setFoodRating} accent={accent} />
                                    <RatingInput label="Experience" value={experienceRating} onChange={setExperienceRating} accent={accent} />
                                </>
                            )}
                            <div>
                                <label htmlFor="review-text" className="text-sm font-semibold">A note for the team <span className="font-normal text-zinc-400">(optional)</span></label>
                                <textarea id="review-text" value={reviewText} onChange={(event) => setReviewText(event.target.value)} maxLength={500} rows={3} placeholder={reviewingTakeaway ? 'How was your takeaway experience?' : 'What made your visit special?'} className="mt-2 w-full resize-none rounded-2xl border border-zinc-200 p-3 text-sm outline-none focus:border-zinc-400" />
                            </div>
                        </div>

                        {!reviewingTakeaway && <div className="mt-6 border-t border-zinc-100 pt-5">
                            <label htmlFor="coupon-code" className="text-sm font-semibold">Have a discount code?</label>
                            <div className="mt-2 flex gap-2">
                                <input id="coupon-code" value={couponCode} onChange={(event) => setCouponCode(event.target.value.toUpperCase())} placeholder="Enter code" className="min-w-0 flex-1 rounded-2xl border border-zinc-200 px-4 py-3 text-sm font-semibold uppercase outline-none focus:border-zinc-400" />
                                <button type="button" onClick={() => setCouponCode('DINE10')} className="rounded-2xl border px-3 text-xs font-bold" style={{ borderColor: accent, color: accent }}>Use DINE10</button>
                            </div>
                            <p className="mt-2 text-xs text-zinc-500">DINE10 takes 10% off your food subtotal.</p>
                        </div>}

                        {!reviewingTakeaway && <div className="mt-6 border-t border-zinc-100 pt-5">
                            <h3 className="text-sm font-semibold">Leave a tip <span className="font-normal text-zinc-400">(optional)</span></h3>
                            <p className="mt-1 text-xs text-zinc-500">A little thank you for the team. Entirely your choice.</p>
                            <div className="mt-3 grid grid-cols-4 gap-2">
                                {[['0', 'No tip'], ['5', '5%'], ['10', '10%'], ['custom', 'Custom']].map(([value, label]) => (
                                    <button key={value} type="button" onClick={() => setTipChoice(value)} className="rounded-2xl border px-2 py-2.5 text-xs font-semibold" style={{ borderColor: tipChoice === value ? accent : '#e4e4e7', backgroundColor: tipChoice === value ? accent + '12' : 'white', color: tipChoice === value ? accent : '#52525b' }}>{label}</button>
                                ))}
                            </div>
                            {tipChoice === 'custom' && <input type="number" min="0" max="10000" step="0.01" inputMode="decimal" aria-label="Custom tip in rupees" value={customTip} onChange={(event) => setCustomTip(event.target.value)} placeholder="Amount in ₹" className="mt-3 w-full rounded-2xl border border-zinc-200 px-4 py-3 text-sm outline-none focus:border-zinc-400" />}
                        </div>}

                        <div className="mt-6 rounded-2xl bg-zinc-50 p-4 text-sm">
                            <div className="flex justify-between text-zinc-500"><span>Food</span><span>{formatCurrency(reviewOrder.total)}</span></div>
                            {!reviewingTakeaway && draftDiscount > 0 && <div className="mt-2 flex justify-between text-emerald-700"><span>DINE10</span><span>−{formatCurrency(draftDiscount)}</span></div>}
                            {draftTax > 0 && <div className="mt-2 flex justify-between text-zinc-500"><span>Taxes</span><span>{formatCurrency(draftTax)}</span></div>}
                            {draftPackagingCharge > 0 && <div className="mt-2 flex justify-between text-zinc-500"><span>Packaging</span><span>{formatCurrency(draftPackagingCharge)}</span></div>}
                            {!reviewingTakeaway && tipAmount > 0 && <div className="mt-2 flex justify-between text-zinc-500"><span>Tip</span><span>{formatCurrency(tipAmount)}</span></div>}
                            <div className="mt-3 flex justify-between border-t border-zinc-200 pt-3 font-bold"><span>To pay</span><span>{formatCurrency(draftPayable)}</span></div>
                        </div>

                        {checkoutError && <p role="alert" className="mt-3 text-sm text-red-600">{checkoutError}</p>}
                        <div className="mt-5 flex flex-col gap-2 sm:flex-row">
                            <button type="button" disabled={submitting} onClick={() => void submitCheckout(true)} className="rounded-2xl border border-zinc-200 px-5 py-3 text-sm font-semibold text-zinc-600 disabled:opacity-50">Skip feedback</button>
                            <button type="button" disabled={submitting} onClick={() => void submitCheckout(false)} className="flex-1 rounded-2xl px-5 py-3 text-sm font-bold disabled:opacity-50" style={{ backgroundColor: accent, color: accentText }}>{submitting ? 'Preparing payment…' : 'Submit review & continue'}</button>
                        </div>
                    </div>
                </div>
            )}
            {thankYouOrder && (
                <PaymentThankYou
                    order={thankYouOrder}
                    restaurantName={restaurant?.name || 'the restaurant'}
                    restaurantAddress={restaurant?.address}
                    restaurantPhone={restaurant?.phone}
                    fssaiNumber={restaurant?.fssaiNumber}
                    logoUrl={restaurant?.logoUrl}
                    accent={accent}
                    menuHref={tableUrl}
                    onClose={() => setThankYouOrder(null)}
                />
            )}
            <style jsx global>{`
                .customer-status-theme .bg-white { background-color: var(--customer-card) !important; }
                .customer-status-theme .bg-zinc-50,
                .customer-status-theme .bg-zinc-50\/80,
                .customer-status-theme .bg-zinc-100 { background-color: var(--customer-soft) !important; }
                .customer-status-theme .text-zinc-900,
                .customer-status-theme .text-zinc-800,
                .customer-status-theme .text-zinc-700,
                .customer-status-theme .text-zinc-600 { color: var(--customer-text) !important; }
                .customer-status-theme .text-zinc-500,
                .customer-status-theme .text-zinc-400 { color: var(--customer-muted) !important; }
                .customer-status-theme .border-zinc-100,
                .customer-status-theme .border-zinc-200,
                .customer-status-theme .border-zinc-200\/80 { border-color: var(--customer-border) !important; }
                .customer-status-theme input,
                .customer-status-theme textarea { background: var(--customer-card); color: var(--customer-text); }
            `}</style>
        </div>
    );
}

function RatingInput({ label, value, onChange, accent }: { label: string; value: number; onChange: (value: number) => void; accent: string }) {
    return (
        <div>
            <p className="text-sm font-semibold">{label}</p>
            <div className="mt-2 flex items-center gap-1" role="group" aria-label={label + ' rating'}>
                {[1, 2, 3, 4, 5].map((star) => (
                    <button key={star} type="button" onClick={() => onChange(star)} aria-label={label + ': ' + star + (star === 1 ? ' star' : ' stars')} aria-pressed={value === star} className="rounded-lg p-1.5 transition hover:scale-110 focus-visible:outline-2" style={{ outlineColor: accent }}>
                        <StarIcon className="h-7 w-7" fill={star <= value ? accent : 'none'} stroke={star <= value ? accent : '#a1a1aa'} strokeWidth={1.5} />
                    </button>
                ))}
            </div>
        </div>
    );
}

function UPIPaymentSection({ restaurant, amount, accent }: { restaurant: RestaurantInfo | null; amount: number; accent: string }) {
    const [qrCodeData, setQrCodeData] = useState('');
    const payee = restaurant?.upiId?.trim();
    const payeeName = restaurant?.upiPayeeName?.trim() || restaurant?.name?.trim() || '';
    const upiUrl = payee ? 'upi://pay?pa=' + encodeURIComponent(payee) + '&pn=' + encodeURIComponent(payeeName) + '&am=' + amount.toFixed(2) + '&cu=INR' : '';

    useEffect(() => {
        if (!upiUrl) return;
        let mounted = true;
        void QRCode.toDataURL(upiUrl, { errorCorrectionLevel: 'M', margin: 2, width: 280 })
            .then((url) => { if (mounted) setQrCodeData(url); })
            .catch(() => { if (mounted) setQrCodeData(''); });
        return () => { mounted = false; };
    }, [upiUrl]);

    if (!payee) {
        return <div className="rounded-2xl bg-white p-5 text-center"><p className="font-bold">Please pay at the counter</p><p className="mt-1 text-sm text-zinc-500">This restaurant has not set up UPI yet. Your amount is {formatCurrency(amount)}.</p></div>;
    }

    return (
        <div className="rounded-[24px] border border-zinc-200 bg-white p-5 text-center sm:p-7">
            <div className="mx-auto grid h-11 w-11 place-items-center rounded-2xl" style={{ backgroundColor: accent + '18', color: accent }}><CreditCardIcon className="h-6 w-6" /></div>
            <h3 className="mt-3 text-xl font-bold">Your payment is ready</h3>
            <p className="mt-1 text-sm text-zinc-500">Scan with any UPI app, or tap below on your phone.</p>
            <div className="mx-auto mt-5 grid h-60 w-60 place-items-center rounded-[24px] border border-zinc-100 bg-white p-3 shadow-sm">
                {qrCodeData ? <img src={qrCodeData} alt={'UPI QR code to pay ' + formatCurrency(amount) + ' to ' + payeeName} className="h-full w-full object-contain" /> :
                    <span className="text-xs text-zinc-400">Preparing QR code…</span>}
            </div>
            <p className="mt-4 text-2xl font-bold">{formatCurrency(amount)}</p>
            <p className="mt-1 text-xs text-zinc-500">Paying {payeeName} · {payee}</p>
            <a href={upiUrl} className="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-2xl px-5 py-3.5 text-sm font-bold" style={{ backgroundColor: accent, color: contrastTextColor(accent) }}>Open UPI app <ArrowRightIcon className="h-4 w-4" /></a>
            <p className="mt-3 text-xs text-zinc-400">Your restaurant will confirm the payment after you complete it in your UPI app.</p>
        </div>
    );
}
