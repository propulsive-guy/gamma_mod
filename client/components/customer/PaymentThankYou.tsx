'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRightIcon, ArrowTopRightOnSquareIcon, StarIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { useReactToPrint } from 'react-to-print';
import { formatCurrency } from '@/lib/utils';
import { contrastTextColor } from '@/lib/color';
import styles from './PaymentThankYou.module.css';
import { BrandFooter } from '@/components/BrandFooter';

interface PaymentThankYouProps {
    order: {
        _id: string;
        createdAt: string;
        total: number;
        status: string;
        paymentStatus?: string;
        paymentMethod?: 'upi' | 'cash';
        orderType?: string;
        items: { name: string; price: number; quantity: number }[];
        checkout?: {
            discountAmount?: number;
            tipAmount?: number;
            packagingCharge?: number;
            gstRate?: number;
            sgstRate?: number;
            gstAmount?: number;
            sgstAmount?: number;
            payableAmount: number;
        };
    };
    restaurantName: string;
    restaurantAddress?: string;
    restaurantPhone?: string;
    fssaiNumber?: string;
    logoUrl?: string;
    accent: string;
    menuHref: string;
    instagramHandle?: string;
    googleReviewUrl?: string;
    onClose: () => void;
}

export function PaymentThankYou({ order, restaurantName, restaurantAddress, restaurantPhone, fssaiNumber, logoUrl, accent, menuHref, instagramHandle, googleReviewUrl, onClose }: PaymentThankYouProps) {
    const billRef = useRef<HTMLDivElement>(null);
    const [storyDetailsCopied, setStoryDetailsCopied] = useState(false);
    const saveBill = useReactToPrint({ contentRef: billRef, documentTitle: `Bill-${order._id.slice(-6).toUpperCase()}` });
    const checkout = order.checkout;
    const amount = checkout?.payableAmount ?? order.total;
    const instagramProfileUrl = instagramHandle ? `https://www.instagram.com/${instagramHandle.replace(/^@/, '')}/` : '';
    const safeGoogleReviewUrl = (() => {
        try {
            const url = new URL(googleReviewUrl || '');
            return url.protocol === 'https:' ? url.toString() : '';
        } catch {
            return '';
        }
    })();
    const copyStoryDetails = async () => {
        const cafeUrl = new URL(menuHref, window.location.origin).toString();
        const details = [`Tag @${instagramHandle}`, `Cafe link: ${cafeUrl}`].join('\n');
        try {
            await navigator.clipboard.writeText(details);
            setStoryDetailsCopied(true);
            window.setTimeout(() => setStoryDetailsCopied(false), 2500);
        } catch {
            setStoryDetailsCopied(false);
        }
    };
    useEffect(() => {
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKeyDown);
        return () => {
            document.body.style.overflow = previousOverflow;
            window.removeEventListener('keydown', onKeyDown);
        };
    }, [onClose]);

    if (order.status !== 'completed' || order.paymentStatus !== 'paid') return null;

    return (
        <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="payment-thank-you-title"
            className={`fixed inset-0 z-[70] overflow-y-auto bg-[#faf9f6] text-zinc-900 ${styles.backdrop}`}
            style={{ backgroundImage: `radial-gradient(circle at 50% 35%, ${accent}18, transparent 55%)` }}
        >
            <div className="mx-auto flex min-h-[100dvh] max-w-xl flex-col px-5 pb-[max(2rem,env(safe-area-inset-bottom))] pt-[max(1.5rem,env(safe-area-inset-top))] sm:px-8">
                <div className="flex items-center justify-between gap-4">
                    <div className="flex min-w-0 items-center gap-3">
                        {logoUrl ? <img src={logoUrl} alt="" className="h-10 w-10 shrink-0 rounded-xl object-cover" /> :
                            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl font-bold" style={{ backgroundColor: accent, color: contrastTextColor(accent) }}>{restaurantName.charAt(0)}</div>}
                        <span className="truncate text-sm font-bold">{restaurantName}</span>
                    </div>
                    <button type="button" onClick={onClose} aria-label="Close payment confirmation" className="grid h-11 w-11 shrink-0 place-items-center rounded-full border border-zinc-200 bg-white text-zinc-600 transition hover:bg-zinc-100">
                        <XMarkIcon className="h-5 w-5" />
                    </button>
                </div>

                <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
                    <div className={`relative grid h-32 w-32 place-items-center rounded-full ${styles.seal}`} style={{ backgroundColor: `${accent}16`, color: accent, boxShadow: `0 0 0 1px ${accent}25, 0 18px 55px ${accent}22` }}>
                        <div className={`absolute inset-3 rounded-full border-2 ${styles.ring}`} style={{ borderColor: `${accent}55` }} />
                        <svg viewBox="0 0 64 64" fill="none" className="relative h-16 w-16" aria-hidden="true">
                            <path className={styles.check} d="M15 33.5 27 45 50 20" stroke="currentColor" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                        <span className={`absolute -left-5 top-4 h-2 w-2 rounded-full ${styles.sparkleOne}`} style={{ backgroundColor: accent }} />
                        <span className={`absolute -right-4 top-11 h-1.5 w-1.5 rounded-full ${styles.sparkleTwo}`} style={{ backgroundColor: accent }} />
                        <span className={`absolute bottom-1 -right-1 h-2 w-2 rounded-full ${styles.sparkleThree}`} style={{ backgroundColor: accent }} />
                    </div>

                    <div className={styles.message}>
                        <p role="status" className="mt-9 text-[11px] font-bold uppercase tracking-[0.3em]" style={{ color: accent }}>Payment received</p>
                        <h1 id="payment-thank-you-title" className="mt-4 font-serif text-[clamp(3.5rem,14vw,6rem)] leading-none tracking-tight">Thank you<span style={{ color: accent }}>.</span></h1>
                        <p className="mx-auto mt-5 max-w-sm text-base leading-relaxed text-zinc-600">It was a pleasure having you at <span className="font-semibold text-zinc-900">{restaurantName}</span>.</p>
                        <p className="mt-2 font-serif text-2xl italic" style={{ color: accent }}>Please come again.</p>
                        <p className="mt-2 text-sm text-zinc-500">We look forward to welcoming you back.</p>
                    </div>

                    <div className={`mt-9 w-full max-w-sm rounded-[22px] border border-zinc-200 bg-white/80 px-5 py-4 shadow-sm ${styles.message}`}>
                        <div className="flex items-center justify-between gap-3 text-sm">
                            <span className="text-zinc-500">Order #{order._id.slice(-6).toUpperCase()}</span>
                            <span className="font-bold" style={{ color: accent }}>Paid</span>
                        </div>
                        <p className="mt-2 border-t border-zinc-100 pt-2 text-left text-sm font-semibold">{formatCurrency(amount)} received</p>
                    </div>

                    <div ref={billRef} className="mt-4 w-full max-w-sm rounded-[22px] border border-zinc-200 bg-white p-5 text-left text-sm text-zinc-900 shadow-sm">
                        <div className="border-b border-dashed border-zinc-300 pb-4 text-center">
                            <p className="text-lg font-extrabold uppercase tracking-wide">{restaurantName}</p>
                            {restaurantAddress && <p className="mt-1 text-xs text-zinc-500">{restaurantAddress}</p>}
                            {restaurantPhone && <p className="mt-1 text-xs text-zinc-500">Contact: {restaurantPhone}</p>}
                            <p className="mt-1 font-semibold">PAID BILL</p>
                            {fssaiNumber && <p className="mt-1 text-xs text-zinc-500">FSSAI: {fssaiNumber}</p>}
                        </div>
                        <div className="flex justify-between gap-3 border-b border-dashed border-zinc-300 py-3 text-xs text-zinc-600">
                            <span>#{order._id.slice(-6).toUpperCase()}<br />{order.orderType === 'takeaway' ? 'Takeaway' : 'Dine in'}</span>
                            <span className="text-right">{new Date(order.createdAt).toLocaleString()}<br />Payment received{order.paymentMethod ? ` via ${order.paymentMethod.toUpperCase()}` : ''}</span>
                        </div>
                        <div className="space-y-2 border-b border-dashed border-zinc-300 py-4">
                            {order.items.map((item, index) => <div key={index} className="flex justify-between gap-3"><span>{item.quantity}× {item.name}</span><span className="shrink-0">{formatCurrency(item.price * item.quantity)}</span></div>)}
                        </div>
                        <div className="space-y-2 pt-4 text-xs">
                            <div className="flex justify-between"><span>Subtotal</span><span>{formatCurrency(order.total)}</span></div>
                            {!!checkout?.discountAmount && <div className="flex justify-between"><span>Discount</span><span>−{formatCurrency(checkout.discountAmount)}</span></div>}
                            {!!checkout?.gstAmount && <div className="flex justify-between"><span>GST</span><span>{formatCurrency(checkout.gstAmount)}</span></div>}
                            {!!checkout?.sgstAmount && <div className="flex justify-between"><span>SGST</span><span>{formatCurrency(checkout.sgstAmount)}</span></div>}
                            {!!checkout?.packagingCharge && <div className="flex justify-between"><span>Packaging</span><span>{formatCurrency(checkout.packagingCharge)}</span></div>}
                            {!!checkout?.tipAmount && <div className="flex justify-between"><span>Tip</span><span>{formatCurrency(checkout.tipAmount)}</span></div>}
                            <div className="flex justify-between border-t border-zinc-200 pt-3 text-base font-extrabold"><span>Paid total</span><span>{formatCurrency(amount)}</span></div>
                        </div>
                        <p className="mt-5 text-center text-xs text-zinc-500">Thank you for visiting {restaurantName}.</p>
                    </div>

                    {(instagramProfileUrl || safeGoogleReviewUrl) && (
                        <section aria-label="Share your experience" className="mt-6 w-full max-w-sm rounded-[22px] border border-zinc-200 bg-white p-4 text-left shadow-sm sm:p-5">
                            <h2 className="text-base font-bold">Enjoyed your visit?</h2>
                            <p className="mt-1 text-sm text-zinc-600">Share a Story or leave a review to support {restaurantName}.</p>
                            <div className="mt-4 grid gap-2">
                                {instagramProfileUrl && (
                                    <div>
                                        <a
                                            href={instagramProfileUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            onClick={() => { void copyStoryDetails(); }}
                                            className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-fuchsia-600 via-rose-500 to-amber-500 px-4 py-3 text-center text-sm font-bold text-white transition hover:brightness-105 active:scale-[0.99]"
                                        >
                                            Share your experience on Insta <ArrowTopRightOnSquareIcon className="h-4 w-4" />
                                        </a>
                                        <p className="mt-2 text-xs leading-relaxed text-zinc-500">
                                            In Instagram, create a Story, tag <span className="font-semibold text-zinc-700">@{instagramHandle?.replace(/^@/, '')}</span>, then add the cafe link sticker.
                                        </p>
                                        <button type="button" onClick={() => void copyStoryDetails()} className="mt-2 min-h-10 text-xs font-semibold text-zinc-700 underline decoration-zinc-300 underline-offset-4">
                                            {storyDetailsCopied ? 'Tag and cafe link copied' : 'Copy tag and cafe link'}
                                        </button>
                                    </div>
                                )}
                                {safeGoogleReviewUrl && (
                                    <a
                                        href={safeGoogleReviewUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-center text-sm font-bold text-zinc-800 transition hover:bg-zinc-50 active:scale-[0.99]"
                                    >
                                        <StarIcon className="h-5 w-5 text-amber-500" /> Give us a review on Google <ArrowTopRightOnSquareIcon className="h-4 w-4 text-zinc-400" />
                                    </a>
                                )}
                            </div>
                        </section>
                    )}
                </div>

                <div className="grid w-full gap-3 sm:grid-cols-2">
                    <button type="button" onClick={() => saveBill()} autoFocus className="min-h-12 rounded-2xl px-5 py-3 text-sm font-bold transition active:scale-[0.98]" style={{ backgroundColor: accent, color: contrastTextColor(accent) }}>Save your bill</button>
                    <Link href={menuHref} onClick={onClose} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-zinc-200 bg-white px-5 py-3 text-sm font-semibold transition hover:bg-zinc-50">Back to menu <ArrowRightIcon className="h-4 w-4" /></Link>
                </div>
                <p className="mt-2 text-center text-xs text-zinc-500">Choose “Save as PDF” in the print dialog.</p>
                <BrandFooter className="mt-8 pt-4" showDivider={false} />
            </div>
        </div>
    );
}
