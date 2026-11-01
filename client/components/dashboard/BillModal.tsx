'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Dialog, Transition } from '@headlessui/react';
import { XMarkIcon, PrinterIcon } from '@heroicons/react/24/outline';
import { formatCurrency, formatDate } from '@/lib/utils';
import { useReactToPrint } from 'react-to-print';
import QRCode from 'qrcode';

interface Restaurant {
    name: string;
    gstNumber?: string;
    fssaiNumber?: string;
    gstPercentage?: number;
    sgstPercentage?: number;
    packagingCharge?: number;
    address?: string;
    phone?: string;
    upiId?: string;
    upiPayeeName?: string;
    merchantCode?: string;
}

interface BillModalProps {
    isOpen: boolean;
    onClose: () => void;
    order: any;
    restaurant: Restaurant;
}

export default function BillModal({ isOpen, onClose, order, restaurant }: BillModalProps) {
    const componentRef = useRef<HTMLDivElement>(null);
    const [qrCodeSvg, setQrCodeSvg] = useState('');
    const [qrCodeError, setQrCodeError] = useState(false);
    const [qrAttempt, setQrAttempt] = useState(0);

    const subtotal = Number(order?.total || 0);
    const checkout = typeof order?.checkout?.payableAmount === 'number' ? order.checkout : null;
    const gstRate = checkout?.gstRate ?? restaurant.gstPercentage ?? 0;
    const sgstRate = checkout?.sgstRate ?? restaurant.sgstPercentage ?? 0;
    const gstAmount = checkout ? checkout.gstAmount : (subtotal * gstRate) / 100;
    const sgstAmount = checkout ? checkout.sgstAmount : (subtotal * sgstRate) / 100;
    const packagingCharge = checkout ? Number(checkout.packagingCharge || 0) : order?.orderType === 'takeaway' ? Number(restaurant.packagingCharge || 0) : 0;
    const grandTotal = checkout ? checkout.payableAmount : subtotal + gstAmount + sgstAmount + packagingCharge;
    const paymentAmount = Number(grandTotal.toFixed(2));
    const upiUri = useMemo(() => {
        const payee = restaurant.upiId?.trim();
        if (!order || order.paymentStatus === 'paid' || !payee || paymentAmount <= 0) return '';
        const params = new URLSearchParams({
            pa: payee,
            pn: restaurant.upiPayeeName?.trim() || restaurant.name,
            am: paymentAmount.toFixed(2),
            cu: 'INR',
            tn: `Bill ${String(order._id).slice(-6).toUpperCase()}`,
            tr: String(order._id),
        });
        if (restaurant.merchantCode?.trim()) params.set('mc', restaurant.merchantCode.trim());
        return `upi://pay?${params.toString()}`;
    }, [order, paymentAmount, restaurant.merchantCode, restaurant.name, restaurant.upiId, restaurant.upiPayeeName]);

    useEffect(() => {
        let active = true;
        setQrCodeSvg('');
        setQrCodeError(false);
        if (!isOpen || !upiUri) return () => { active = false; };
        void QRCode.toString(upiUri, { type: 'svg', errorCorrectionLevel: 'H', margin: 2, width: 320 })
            .then((svg) => { if (active) setQrCodeSvg(svg); })
            .catch(() => { if (active) setQrCodeError(true); });
        return () => { active = false; };
    }, [isOpen, qrAttempt, upiUri]);

    const handlePrint = useReactToPrint({
        contentRef: componentRef,
        documentTitle: `Bill-${order?._id?.slice(-6)}`,
        pageStyle: `
            @page { size: 80mm auto; margin: 3mm; }
            @media print {
                html, body { width: 74mm !important; margin: 0 !important; padding: 0 !important; }
                body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                .bill-print { width: 74mm !important; max-width: 74mm !important; padding: 0 !important; margin: 0 auto !important; font-size: 10px !important; }
                .bill-print table { page-break-inside: auto; }
                .bill-print tr { page-break-inside: avoid; page-break-after: auto; }
                .bill-payment-qr { display: block !important; visibility: visible !important; width: 34mm !important; height: 34mm !important; margin: 2mm auto !important; break-inside: avoid; }
                .bill-payment-qr svg { display: block !important; visibility: visible !important; width: 34mm !important; height: 34mm !important; }
            }
        `,
    });

    if (!order) return null;

    // Display helpers
    const showGst = gstRate > 0;
    const showSgst = sgstRate > 0;

    return (
        <Transition show={isOpen} as={Fragment}>
            <Dialog as="div" className="relative z-50" onClose={onClose}>
                {/* ... transition child ... */}
                <Transition.Child
                    as={Fragment}
                    enter="ease-out duration-300"
                    enterFrom="opacity-0"
                    enterTo="opacity-100"
                    leave="ease-in duration-200"
                    leaveFrom="opacity-100"
                    leaveTo="opacity-0"
                >
                    <div className="fixed inset-0 bg-black/30 backdrop-blur-sm" />
                </Transition.Child>

                <div className="fixed inset-0 overflow-y-auto">
                    <div className="flex min-h-full items-center justify-center p-4 text-center">
                        <Transition.Child
                            as={Fragment}
                            enter="ease-out duration-300"
                            enterFrom="opacity-0 scale-95"
                            enterTo="opacity-100 scale-100"
                            leave="ease-in duration-200"
                            leaveFrom="opacity-100 scale-100"
                            leaveTo="opacity-0 scale-95"
                        >
                            <Dialog.Panel className="w-full max-w-md transform overflow-hidden rounded-2xl bg-white text-left align-middle shadow-xl transition-all">
                                <div className="flex justify-between items-center p-4 border-b border-gray-100 bg-gray-50/50">
                                    <Dialog.Title as="h3" className="text-lg font-bold text-gray-900">
                                        Bill Receipt
                                    </Dialog.Title>
                                    <button
                                        onClick={onClose}
                                        className="text-gray-400 hover:text-gray-500 transition-colors"
                                    >
                                        <XMarkIcon className="w-6 h-6" />
                                    </button>
                                </div>

                                <div className="p-6 overflow-y-auto max-h-[80vh]">
                                    {/* Printable Area */}
                                    <div ref={componentRef} className="bill-print bg-white p-4 print:p-0 text-sm">
                                        <div className="text-center mb-6">
                                            <h2 className="text-xl font-bold text-gray-900 uppercase tracking-widest">{restaurant.name}</h2>
                                            {restaurant.address && <p className="text-gray-500 text-xs mt-1">{restaurant.address}</p>}
                                            {restaurant.phone && <p className="text-gray-500 text-xs mt-1">Contact: {restaurant.phone}</p>}
                                            {restaurant.gstNumber && (
                                                <p className="text-gray-500 text-xs mt-1 font-mono">GSTIN: {restaurant.gstNumber}</p>
                                            )}
                                            {restaurant.fssaiNumber && <p className="text-gray-500 text-xs mt-1 font-mono">FSSAI: {restaurant.fssaiNumber}</p>}
                                            {order.paymentStatus === 'paid' && <p className="text-gray-500 text-xs mt-1">Paid{order.paymentMethod ? ` via ${order.paymentMethod.toUpperCase()}` : ''}</p>}
                                            <p className="text-gray-500 text-xs mt-1">{order.orderType === 'takeaway' ? 'Thank you for ordering with us!' : 'Thank you for dining with us!'}</p>
                                        </div>

                                        <div className="flex justify-between text-xs text-gray-500 mb-4 border-b border-gray-100 pb-4">
                                            <div className="text-left">
                                                <p>Date: {new Date(order.createdAt || Date.now()).toLocaleDateString('en-IN')}</p>
                                                <p>Order #: {order._id.slice(-6).toUpperCase()}</p>
                                            </div>
                                            <div className="text-right">
                                                <p>{order.orderType === 'takeaway' ? 'Takeaway order' : `Table: ${order.tableId?.tableNumber || 'N/A'}`}</p>
                                                <p>Customer: {order.customerName || 'Guest'}</p>
                                            </div>
                                        </div>

                                        <table className="w-full text-left mb-6">
                                            <thead>
                                                <tr className="border-b border-gray-200 text-gray-500 text-xs uppercase tracking-wider">
                                                    <th className="py-2">Item</th>
                                                    <th className="py-2 text-center">Qty</th>
                                                    <th className="py-2 text-right">Price</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-gray-100">
                                                {order.items.map((item: any, index: number) => (
                                                    <tr key={index}>
                                                        <td className="py-2 text-gray-900">{item.name}</td>
                                                        <td className="py-2 text-center text-gray-600">{item.quantity}</td>
                                                        <td className="py-2 text-right text-gray-900">{formatCurrency(item.price * item.quantity)}</td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>

                                        <div className="space-y-2 border-t border-gray-200 pt-4">
                                            <div className="flex justify-between text-gray-600">
                                                <span>Subtotal</span>
                                                <span>{formatCurrency(subtotal)}</span>
                                            </div>

                                            {!!checkout?.discountAmount && (
                                                <div className="flex justify-between text-emerald-700 text-xs">
                                                    <span>Discount ({checkout.couponCode})</span>
                                                    <span>−{formatCurrency(checkout.discountAmount)}</span>
                                                </div>
                                            )}

                                            {showGst && (
                                                <div className="flex justify-between text-gray-600 text-xs">
                                                    <span>CGST/IGST ({gstRate}%)</span>
                                                    <span>{formatCurrency(gstAmount)}</span>
                                                </div>
                                            )}

                                            {showSgst && (
                                                <div className="flex justify-between text-gray-600 text-xs">
                                                    <span>SGST ({sgstRate}%)</span>
                                                    <span>{formatCurrency(sgstAmount)}</span>
                                                </div>
                                            )}

                                            {packagingCharge > 0 && (
                                                <div className="flex justify-between text-gray-600 text-xs">
                                                    <span>Packaging</span>
                                                    <span>{formatCurrency(packagingCharge)}</span>
                                                </div>
                                            )}

                                            {!!checkout?.tipAmount && (
                                                <div className="flex justify-between text-gray-600 text-xs">
                                                    <span>Tip</span>
                                                    <span>{formatCurrency(checkout.tipAmount)}</span>
                                                </div>
                                            )}

                                            <div className="flex justify-between text-lg font-bold text-gray-900 border-t border-gray-900 pt-2 mt-2">
                                                <span>Total</span>
                                                <span>{formatCurrency(grandTotal)}</span>
                                            </div>
                                        </div>

                                        {upiUri && (
                                            <div className="mt-5 border-t border-dashed border-gray-300 pt-4 text-center">
                                                <p className="font-bold text-gray-900">Scan to pay {formatCurrency(paymentAmount)}</p>
                                                <p className="mt-1 text-[10px] text-gray-500">{restaurant.upiPayeeName?.trim() || restaurant.name}</p>
                                                {qrCodeSvg ? (
                                                    <div
                                                        className="bill-payment-qr mx-auto mt-2 h-36 w-36 print:h-32 print:w-32"
                                                        role="img"
                                                        aria-label={`Dynamic UPI payment QR for ${formatCurrency(paymentAmount)}`}
                                                        dangerouslySetInnerHTML={{ __html: qrCodeSvg }}
                                                    />
                                                ) : (
                                                    <div className="mx-auto mt-3 flex min-h-32 w-40 flex-col items-center justify-center gap-2 rounded-lg border border-gray-200 px-2 text-[10px] text-gray-500">
                                                        <span>{qrCodeError ? 'Could not create the payment QR.' : 'Preparing payment QR…'}</span>
                                                        {qrCodeError && <button type="button" onClick={() => setQrAttempt((attempt) => attempt + 1)} className="font-semibold text-sky-700 print:hidden">Retry QR</button>}
                                                    </div>
                                                )}
                                                <p className="mt-1 break-all text-[10px] text-gray-500">UPI: {restaurant.upiId}</p>
                                            </div>
                                        )}

                                        <div className="mt-8 text-center text-xs text-gray-400 print:block hidden">
                                            <p>Generated via BitByte</p>
                                        </div>
                                    </div>
                                </div>

                                <div className="p-4 border-t border-gray-100 bg-gray-50/50 flex justify-end gap-3">
                                    <button
                                        onClick={onClose}
                                        className="px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700 hover:bg-gray-50"
                                    >
                                        Close
                                    </button>
                                    {upiUri && (
                                        <a href={upiUri} className="inline-flex items-center rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700">
                                            Open UPI app
                                        </a>
                                    )}
                                    <button
                                        disabled={!!upiUri && !qrCodeSvg}
                                        onClick={() => handlePrint && handlePrint()}
                                        className="flex items-center gap-2 px-4 py-2 bg-sky-500 text-white rounded-lg text-sm font-medium hover:bg-sky-600 shadow-md shadow-sky-500/20 disabled:cursor-not-allowed disabled:opacity-60"
                                    >
                                        <PrinterIcon className="w-4 h-4" />
                                        {upiUri && !qrCodeSvg ? (qrCodeError ? 'QR unavailable' : 'Preparing QR…') : 'Print Bill'}
                                    </button>
                                </div>
                            </Dialog.Panel>
                        </Transition.Child>
                    </div>
                </div>
            </Dialog>
        </Transition>
    );
}
