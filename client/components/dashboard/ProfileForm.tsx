'use client';

import { useState, useEffect } from 'react';
import { toast } from 'react-hot-toast';
import { PhotoIcon, UserCircleIcon } from '@heroicons/react/24/solid';
import {
    BuildingStorefrontIcon,
    CreditCardIcon,
    PaintBrushIcon,
    ReceiptPercentIcon,
    CameraIcon,
    ShoppingBagIcon,
} from '@heroicons/react/24/outline';
import { updateRestaurant } from '@/app/actions/restaurant';
import { uploadFile } from '@/app/actions/upload';
import { RestaurantAddressField } from '@/components/RestaurantAddressField';

interface RestaurantData {
    _id: string;
    name: string;
    logoUrl?: string;
    coverImageUrl?: string;
    phone?: string;
    address?: string;
    upiId?: string;
    upiPayeeName?: string;
    merchantCode?: string;
    appId?: string;
    colorScheme?: string;
    themeColor?: string;
    logoAccentColor?: string;
    accentSource?: 'logo' | 'custom';
    fontFamily?: string;
    gstNumber?: string;
    fssaiNumber?: string;
    gstPercentage?: number;
    sgstPercentage?: number;
    packagingCharge?: number;
    enableAestheticDownloads?: boolean;
}

export default function ProfileForm({ initialData }: { initialData: RestaurantData }) {
    const [isSaving, setIsSaving] = useState(false);
    const [name, setName] = useState(initialData.name || '');
    const [phone, setPhone] = useState(initialData.phone || '');
    const [address, setAddress] = useState(initialData.address || '');
    const [upiId, setUpiId] = useState(initialData.upiId || '');
    const [upiPayeeName, setUpiPayeeName] = useState(initialData.upiPayeeName || '');
    const [merchantCode, setMerchantCode] = useState(initialData.merchantCode || '0000');
    const [appId, setAppId] = useState(initialData.appId || '');
    const [colorScheme, setColorScheme] = useState(initialData.colorScheme || 'light');
    const [themeColor, setThemeColor] = useState(initialData.themeColor || '#38bdf8');
    const [accentSource, setAccentSource] = useState<'logo' | 'custom'>(initialData.accentSource || 'logo');
    const [fontFamily, setFontFamily] = useState(initialData.fontFamily || 'inter');
    const [gstNumber, setGstNumber] = useState(initialData.gstNumber || '');
    const [fssaiNumber, setFssaiNumber] = useState(initialData.fssaiNumber || '');
    const [gstPercentage, setGstPercentage] = useState(initialData.gstPercentage?.toString() || '0');
    const [sgstPercentage, setSgstPercentage] = useState(initialData.sgstPercentage?.toString() || '0');
    const [packagingCharge, setPackagingCharge] = useState(initialData.packagingCharge?.toString() || '0');

    // Logo image states
    const [logoFile, setLogoFile] = useState<File | null>(null);
    const [logoPreview, setLogoPreview] = useState<string | null>(initialData.logoUrl || null);

    // Aesthetic Downloads states
    const [enableAestheticDownloads, setEnableAestheticDownloads] = useState<boolean>(initialData.enableAestheticDownloads || false);
    const [coverFile, setCoverFile] = useState<File | null>(null);
    const [coverPreview, setCoverPreview] = useState<string | null>(initialData.coverImageUrl || null);

    // Sync toggle state when server re-renders with fresh data after save
    useEffect(() => {
        setEnableAestheticDownloads(initialData.enableAestheticDownloads || false);
    }, [initialData.enableAestheticDownloads]);

    useEffect(() => {
        setCoverPreview(initialData.coverImageUrl || null);
    }, [initialData.coverImageUrl]);

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            if (file.size > 2 * 1024 * 1024) {
                toast.error('Logo must be under 2MB');
                return;
            }
            setLogoFile(file);
            const reader = new FileReader();
            reader.onloadend = () => {
                setLogoPreview(reader.result as string);
            };
            reader.readAsDataURL(file);
        }
    };

    const handleCoverChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            if (file.size > 2 * 1024 * 1024) {
                toast.error('Aesthetic photo must be under 2MB');
                return;
            }
            setCoverFile(file);
            const reader = new FileReader();
            reader.onloadend = () => {
                setCoverPreview(reader.result as string);
            };
            reader.readAsDataURL(file);
        }
    };

    // QR decode states
    const [isDecodingQr, setIsDecodingQr] = useState(false);
    const [qrDecodeResult, setQrDecodeResult] = useState<{ status: 'idle' | 'success' | 'error'; message?: string }>({ status: 'idle' });

    const handleQrUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setIsDecodingQr(true);
        setQrDecodeResult({ status: 'idle' });

        try {
            if (!file.type.startsWith('image/')) throw new Error('Choose an image file');
            if (file.size > 12 * 1024 * 1024) throw new Error('Choose an image under 12MB');
            const img = new Image();
            const imageUrl = URL.createObjectURL(file);
            let rawValue = '';
            try {
                await new Promise<void>((resolve, reject) => {
                    img.onload = () => resolve();
                    img.onerror = () => reject(new Error('Could not open that image. Try a JPG or PNG photo.'));
                    img.src = imageUrl;
                });
                if ('BarcodeDetector' in window) {
                    const detector = new (window as any).BarcodeDetector({ formats: ['qr_code'] });
                    const barcodes = await detector.detect(img);
                    rawValue = barcodes?.[0]?.rawValue || '';
                }
                if (!rawValue) {
                    const { default: jsQR } = await import('jsqr');
                    const canvas = document.createElement('canvas');
                    const scale = Math.min(1, 1800 / Math.max(img.naturalWidth, img.naturalHeight));
                    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
                    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
                    const context = canvas.getContext('2d', { willReadFrequently: true });
                    if (!context) throw new Error('Could not process that image. Try another photo.');
                    context.drawImage(img, 0, 0, canvas.width, canvas.height);
                    rawValue = jsQR(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height)?.data || '';
                }
            } finally {
                URL.revokeObjectURL(imageUrl);
            }

            if (!rawValue) {
                toast.error('No QR code found in the image');
                setQrDecodeResult({ status: 'error', message: 'No QR code detected. Try a clearer photo.' });
                return;
            }

            // Validate it's a UPI URI
            if (!rawValue.toLowerCase().startsWith('upi://pay')) {
                toast.error('This is not a UPI payment QR code');
                setQrDecodeResult({ status: 'error', message: 'Not a UPI QR code.' });
                return;
            }

            // Parse the UPI URI
            // upi://pay?pa=xxx&pn=yyy&mc=zzz...
            const queryString = rawValue.split('?')[1] || '';
            const params = new URLSearchParams(queryString);

            const extractedPa = params.get('pa') || '';
            const extractedPn = params.get('pn') || '';
            const extractedMc = params.get('mc') || '';
            const extractedAid = params.get('aid') || '';

            // Auto-fill the form fields
            if (extractedPa) setUpiId(extractedPa);
            if (extractedPn) setUpiPayeeName(extractedPn);
            if (extractedMc && extractedMc !== '0000') setMerchantCode(extractedMc);
            if (extractedAid) setAppId(extractedAid);

            const successMsg = `Extracted: ${extractedPa}${extractedPn ? ` (${extractedPn})` : ''}`;
            toast.success('UPI details extracted from QR!');
            setQrDecodeResult({ status: 'success', message: successMsg });
        } catch (error) {
            console.error('QR decode error:', error);
            const message = error instanceof Error ? error.message : 'Failed to decode QR. Try a clearer image.';
            toast.error(message);
            setQrDecodeResult({ status: 'error', message });
        } finally {
            setIsDecodingQr(false);
            // Reset file input so the same file can be re-uploaded
            e.target.value = '';
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const parsedPackagingCharge = Number(packagingCharge);
        if (!Number.isFinite(parsedPackagingCharge) || parsedPackagingCharge < 0 || parsedPackagingCharge > 10000 ||
            Math.abs(Math.round(parsedPackagingCharge * 100) - parsedPackagingCharge * 100) > 1e-8) {
            toast.error('Enter a packaging charge between ₹0 and ₹10,000, with at most two decimal places');
            return;
        }
        setIsSaving(true);
        const toastId = toast.loading('Saving changes...');

        try {
            let finalLogoUrl = initialData.logoUrl || '';
            let finalCoverUrl = initialData.coverImageUrl || '';

            // 1. Upload Logo if a new file is chosen
            if (logoFile) {
                const uploadFormData = new FormData();
                uploadFormData.append('file', logoFile);

                const uploadRes = await uploadFile(uploadFormData);
                if (uploadRes.success && uploadRes.url) {
                    finalLogoUrl = uploadRes.url;
                } else {
                    toast.error(uploadRes.error || 'Failed to upload logo', { id: toastId });
                    setIsSaving(false);
                    return;
                }
            }

            // Upload Cover if a new file is chosen
            if (coverFile) {
                const uploadFormData = new FormData();
                uploadFormData.append('file', coverFile);

                const uploadRes = await uploadFile(uploadFormData);
                if (uploadRes.success && uploadRes.url) {
                    finalCoverUrl = uploadRes.url;
                } else {
                    toast.error(uploadRes.error || 'Failed to upload cafe aesthetic photo', { id: toastId });
                    setIsSaving(false);
                    return;
                }
            }

            // 2. Submit all changes using updateRestaurant Action
            const submitData = new FormData();
            submitData.append('name', name);
            submitData.append('phone', phone);
            submitData.append('address', address);
            submitData.append('upiId', upiId);
            submitData.append('upiPayeeName', upiPayeeName);
            submitData.append('merchantCode', merchantCode);
            submitData.append('appId', appId);
            submitData.append('themeColor', themeColor);
            submitData.append('accentSource', accentSource);
            submitData.append('fontFamily', fontFamily);
            submitData.append('colorScheme', colorScheme);
            submitData.append('gstNumber', gstNumber);
            submitData.append('fssaiNumber', fssaiNumber);
            submitData.append('gstPercentage', gstPercentage);
            submitData.append('sgstPercentage', sgstPercentage);
            submitData.append('packagingCharge', packagingCharge);
            submitData.append('logoUrl', finalLogoUrl);
            submitData.append('coverImageUrl', finalCoverUrl);
            submitData.append('enableAestheticDownloads', enableAestheticDownloads ? 'true' : 'false');

            const result = await updateRestaurant(submitData);

            if (result.success) {
                toast.success('Changes saved successfully!', { id: toastId });
            } else {
                toast.error(result.error || 'Failed to save changes', { id: toastId });
            }
        } catch (error) {
            console.error('Error saving settings:', error);
            toast.error('An unexpected error occurred', { id: toastId });
        } finally {
            setIsSaving(false);
        }
    };

    const inputClass = "w-full h-11 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-400 text-slate-900 transition-all";
    const labelClass = "block text-sm font-semibold text-slate-700 mb-1.5";
    const hintClass = "text-xs text-slate-400 mt-1.5";

    return (
        <form onSubmit={handleSubmit} className="space-y-6">
            {/* ── Section 1: Basic Info ── */}
            <div className="bg-white rounded-2xl border border-slate-200/60 overflow-hidden">
                <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-4 sm:px-6">
                    <div className="p-2 rounded-lg bg-blue-50">
                        <BuildingStorefrontIcon className="w-4 h-4 text-blue-600" />
                    </div>
                    <div>
                        <h2 className="text-sm font-semibold text-slate-900">Basic Information</h2>
                        <p className="text-xs text-slate-500">Your restaurant name and branding</p>
                    </div>
                </div>
                <div className="space-y-5 p-4 sm:p-6">
                    {/* Name */}
                    <div>
                        <label htmlFor="name" className={labelClass}>Restaurant Name</label>
                        <input
                            type="text"
                            name="name"
                            id="name"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className={inputClass}
                            placeholder="Enter restaurant name"
                            required
                        />
                    </div>

                    {/* Contact Number */}
                    <div>
                        <label htmlFor="phone" className={labelClass}>Contact Number</label>
                        <input
                            type="tel"
                            name="phone"
                            id="phone"
                            value={phone}
                            onChange={(e) => setPhone(e.target.value)}
                            className={inputClass}
                            placeholder="Enter contact number (e.g. +91 98765 43210)"
                        />
                        <p className={hintClass}>Printed on kitchen order tickets only.</p>
                    </div>

                    <RestaurantAddressField id="address" value={address} onChange={setAddress} labelClassName={labelClass} inputClassName={inputClass} />

                    {/* Logo */}
                    <div>
                        <label className={labelClass}>Restaurant Logo</label>
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-5">
                            <div className="flex-shrink-0">
                                {logoPreview ? (
                                    <div className="w-20 h-20 rounded-2xl overflow-hidden bg-slate-50 border border-slate-200 shadow-sm relative group">
                                        <img src={logoPreview} alt="Logo" className="w-full h-full object-cover" />
                                    </div>
                                ) : (
                                    <div className="w-20 h-20 rounded-2xl bg-slate-50 border-2 border-dashed border-slate-200 flex items-center justify-center">
                                        <PhotoIcon className="w-8 h-8 text-slate-300" />
                                    </div>
                                )}
                            </div>
                            <div className="flex-1">
                                <label
                                    htmlFor="logo"
                                    className="flex flex-col items-center justify-center w-full h-28 border-2 border-slate-200 border-dashed rounded-2xl cursor-pointer bg-slate-50/50 hover:bg-slate-50 hover:border-sky-300 transition-all group"
                                >
                                    <UserCircleIcon className="w-7 h-7 mb-2 text-slate-400 group-hover:text-sky-500 transition-colors" />
                                    <p className="text-sm text-slate-500">
                                        <span className="font-semibold text-sky-600">Click to upload</span> or drag and drop
                                    </p>
                                    <p className="text-xs text-slate-400 mt-0.5">PNG, JPG, GIF (Max 2MB)</p>
                                    <input
                                        type="file"
                                        name="logo"
                                        id="logo"
                                        accept="image/*"
                                        className="hidden"
                                        onChange={handleFileChange}
                                    />
                                </label>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Section 2: Payment Settings ── */}
            <div className="bg-white rounded-2xl border border-slate-200/60 overflow-hidden">
                <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-4 sm:px-6">
                    <div className="p-2 rounded-lg bg-emerald-50">
                        <CreditCardIcon className="w-4 h-4 text-emerald-600" />
                    </div>
                    <div>
                        <h2 className="text-sm font-semibold text-slate-900">Payment Settings</h2>
                        <p className="text-xs text-slate-500">Configure UPI payment parameters</p>
                    </div>
                </div>
                <div className="space-y-5 p-4 sm:p-6">
                    {/* QR Upload Section */}
                    <div className="relative">
                        <label
                            htmlFor="qrUpload"
                            className={`flex min-h-36 flex-col items-center justify-center w-full py-6 px-4 border-2 rounded-2xl text-center cursor-pointer transition-all duration-200 ${
                                qrDecodeResult.status === 'success'
                                    ? 'border-emerald-300 bg-emerald-50/50'
                                    : qrDecodeResult.status === 'error'
                                    ? 'border-red-200 bg-red-50/30'
                                    : 'border-dashed border-slate-200 bg-slate-50/30 hover:bg-slate-50 hover:border-sky-300'
                            }`}
                        >
                            {isDecodingQr ? (
                                <>
                                    <div className="w-8 h-8 border-2 border-sky-500 border-t-transparent rounded-full animate-spin mb-2" />
                                    <p className="text-sm font-medium text-sky-600">Decoding QR code...</p>
                                </>
                            ) : qrDecodeResult.status === 'success' ? (
                                <>
                                    <div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center mb-2">
                                        <svg className="w-5 h-5 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                        </svg>
                                    </div>
                                    <p className="text-sm font-medium text-emerald-700">QR Decoded Successfully!</p>
                                    <p className="text-xs text-emerald-600 mt-1 font-mono">{qrDecodeResult.message}</p>
                                    <p className="text-xs text-slate-400 mt-2">Upload another QR to re-extract</p>
                                </>
                            ) : (
                                <>
                                    <div className="w-10 h-10 rounded-xl bg-sky-50 flex items-center justify-center mb-2">
                                        <svg className="w-5 h-5 text-sky-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5A1.125 1.125 0 013.75 9.375v-4.5zM3.75 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5zM13.5 4.875c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5z" />
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.5 14.625c0-.621.504-1.125 1.125-1.125h4.5c.621 0 1.125.504 1.125 1.125v4.5c0 .621-.504 1.125-1.125 1.125h-4.5a1.125 1.125 0 01-1.125-1.125v-4.5z" />
                                        </svg>
                                    </div>
                                    <p className="text-sm text-slate-600">
                                        <span className="font-semibold text-sky-600">Upload your merchant QR code</span>
                                    </p>
                                    <p className="text-xs text-slate-400 mt-1">We'll extract UPI ID, payee name & merchant code automatically</p>
                                    {qrDecodeResult.status === 'error' && (
                                        <p className="text-xs text-red-500 mt-2">{qrDecodeResult.message}</p>
                                    )}
                                </>
                            )}
                            <input
                                type="file"
                                id="qrUpload"
                                accept="image/*"
                                className="hidden"
                                onChange={handleQrUpload}
                            />
                        </label>
                    </div>

                    <div className="relative flex items-center gap-3">
                        <div className="flex-1 border-t border-slate-200" />
                        <span className="text-xs font-medium text-slate-400 uppercase tracking-wider">or enter manually</span>
                        <div className="flex-1 border-t border-slate-200" />
                    </div>

                    <div>
                        <label htmlFor="upiId" className={labelClass}>UPI ID (VPA)</label>
                        <input
                            type="text"
                            name="upiId"
                            id="upiId"
                            value={upiId}
                            onChange={(e) => setUpiId(e.target.value)}
                            className={`${inputClass} font-mono`}
                            placeholder="merchant@upi"
                        />
                        <p className={hintClass}>Your virtual payment address to receive customer payments</p>
                    </div>
                    <div>
                        <label htmlFor="upiPayeeName" className={labelClass}>UPI Payee Name (Banking Name)</label>
                        <input
                            type="text"
                            name="upiPayeeName"
                            id="upiPayeeName"
                            value={upiPayeeName}
                            onChange={(e) => setUpiPayeeName(e.target.value)}
                            className={inputClass}
                            placeholder="e.g. PRIYANSHU BEHERE"
                        />
                        <p className={hintClass}>Exact name on your bank account — shown to customers when they scan the QR</p>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                        <div>
                            <label htmlFor="merchantCode" className={labelClass}>Merchant Code (MCC)</label>
                            <input
                                type="text"
                                name="merchantCode"
                                id="merchantCode"
                                value={merchantCode}
                                onChange={(e) => setMerchantCode(e.target.value)}
                                className={`${inputClass} font-mono`}
                                placeholder="e.g. 5812"
                            />
                            <p className={hintClass}>4-digit category code. Use 0000 for default.</p>
                        </div>
                        <div>
                            <label htmlFor="appId" className={labelClass}>App ID (aid)</label>
                            <input
                                type="text"
                                name="appId"
                                id="appId"
                                value={appId}
                                onChange={(e) => setAppId(e.target.value)}
                                className={`${inputClass} font-mono`}
                                placeholder="Optional"
                            />
                            <p className={hintClass}>Provided by your UPI app (e.g. Google Pay)</p>
                        </div>
                    </div>
                </div>
            </div>

            {/* ── Section 3: Theme Customization ── */}
            <div className="bg-white rounded-2xl border border-slate-200/60 overflow-hidden">
                <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-4 sm:px-6">
                    <div className="p-2 rounded-lg bg-violet-50">
                        <PaintBrushIcon className="w-4 h-4 text-violet-600" />
                    </div>
                    <div>
                        <h2 className="text-sm font-semibold text-slate-900">Theme Customization</h2>
                        <p className="text-xs text-slate-500">Customize your customer-facing pages</p>
                    </div>
                </div>
                <div className="space-y-6 p-4 sm:p-6">
                    {/* Color Scheme */}
                    <div>
                        <label className={labelClass}>Color Scheme</label>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            {[
                                { value: 'light', label: 'Light', bg: 'bg-white', border: 'border-slate-200', dot: 'bg-slate-300' },
                                { value: 'dark', label: 'Dark', bg: 'bg-slate-800', border: 'border-slate-600', dot: 'bg-slate-500' },
                                { value: 'warm', label: 'Warm', bg: 'bg-amber-50', border: 'border-amber-200', dot: 'bg-amber-300' },
                                { value: 'cool', label: 'Cool', bg: 'bg-sky-50', border: 'border-sky-200', dot: 'bg-sky-300' },
                            ].map((scheme) => (
                                <label
                                    key={scheme.value}
                                    className="relative flex flex-col items-center p-3 rounded-xl border-2 border-slate-200 cursor-pointer transition-all hover:shadow-sm hover:border-slate-300 group"
                                >
                                    <input
                                        type="radio"
                                        name="colorScheme"
                                        value={scheme.value}
                                        checked={colorScheme === scheme.value}
                                        onChange={() => setColorScheme(scheme.value)}
                                        className="sr-only peer"
                                    />
                                    <div className={`w-full h-9 rounded-lg ${scheme.bg} ${scheme.border} border mb-2 flex items-center justify-center gap-1.5`}>
                                        <div className={`w-6 h-1.5 rounded-full ${scheme.dot}`}></div>
                                        <div className={`w-4 h-1.5 rounded-full ${scheme.dot} opacity-50`}></div>
                                    </div>
                                    <span className="text-xs font-medium text-slate-600">{scheme.label}</span>
                                    <div className="absolute inset-0 rounded-xl border-2 border-sky-400 opacity-0 peer-checked:opacity-100 transition-opacity pointer-events-none"></div>
                                </label>
                            ))}
                        </div>
                    </div>

                    {/* Accent Color */}
                    <div>
                        <label className={labelClass}>Accent Color Source</label>
                        <div className="mb-4 grid grid-cols-2 gap-3">
                            {[
                                { value: 'logo', label: 'Logo color', description: 'Detected automatically' },
                                { value: 'custom', label: 'Custom color', description: 'Use the color picker' },
                            ].map((option) => (
                                <button
                                    key={option.value}
                                    type="button"
                                    onClick={() => setAccentSource(option.value as 'logo' | 'custom')}
                                    className={`rounded-xl border-2 p-3 text-left transition ${accentSource === option.value ? 'border-sky-400 bg-sky-50' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                                >
                                    <span className="block text-sm font-semibold text-slate-800">{option.label}</span>
                                    <span className="mt-0.5 block text-xs text-slate-500">{option.description}</span>
                                </button>
                            ))}
                        </div>
                        <label htmlFor="themeColor" className={labelClass}>Custom Accent Color</label>
                        <div className="flex items-center gap-4">
                            <input
                                type="color"
                                name="themeColor"
                                id="themeColor"
                                value={themeColor}
                                onChange={(e) => setThemeColor(e.target.value)}
                                disabled={accentSource !== 'custom'}
                                className="w-11 h-11 rounded-xl border border-slate-200 cursor-pointer p-1 bg-white disabled:cursor-not-allowed disabled:opacity-40"
                            />
                            <p className={hintClass}>{accentSource === 'custom' ? 'This color will be used across customer menu, tracking, feedback, and payment screens.' : 'Customer colors are detected from your uploaded logo. The custom color is used as a fallback.'}</p>
                        </div>
                    </div>

                    {/* Font */}
                    <div>
                        <label htmlFor="fontFamily" className={labelClass}>Font Family</label>
                        <select
                            name="fontFamily"
                            id="fontFamily"
                            value={fontFamily}
                            onChange={(e) => setFontFamily(e.target.value)}
                            className={inputClass}
                        >
                            <option value="inter">Inter (Modern, Clean)</option>
                            <option value="outfit">Outfit (Friendly, Round)</option>
                            <option value="poppins">Poppins (Geometric, Bold)</option>
                            <option value="roboto">Roboto (Classic, Readable)</option>
                            <option value="playfair">Playfair Display (Elegant, Serif)</option>
                        </select>
                    </div>
                </div>
            </div>

            {/* ── Section 4: Tax Configuration ── */}
            <div className="bg-white rounded-2xl border border-slate-200/60 overflow-hidden">
                <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-4 sm:px-6">
                    <div className="p-2 rounded-lg bg-amber-50">
                        <ReceiptPercentIcon className="w-4 h-4 text-amber-600" />
                    </div>
                    <div>
                        <h2 className="text-sm font-semibold text-slate-900">Tax Configuration</h2>
                        <p className="text-xs text-slate-500">GST and tax settings for invoices</p>
                    </div>
                </div>
                <div className="space-y-5 p-4 sm:p-6">
                    <div>
                        <label htmlFor="gstNumber" className={labelClass}>GST Number</label>
                        <input
                            type="text"
                            name="gstNumber"
                            id="gstNumber"
                            value={gstNumber}
                            onChange={(e) => setGstNumber(e.target.value)}
                            className={`${inputClass} uppercase font-mono`}
                            placeholder="GSTIN..."
                        />
                    </div>
                    <div>
                        <label htmlFor="fssaiNumber" className={labelClass}>FSSAI Number</label>
                        <input type="text" name="fssaiNumber" id="fssaiNumber" inputMode="numeric" maxLength={30} value={fssaiNumber} onChange={(e) => setFssaiNumber(e.target.value)} className={inputClass} placeholder="Enter FSSAI number" />
                    </div>
                    <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
                        <div>
                            <label htmlFor="gstPercentage" className={labelClass}>CGST/IGST (%)</label>
                            <div className="relative">
                                <input
                                    type="number"
                                    name="gstPercentage"
                                    id="gstPercentage"
                                    min="0"
                                    step="0.01"
                                    value={gstPercentage}
                                    onChange={(e) => setGstPercentage(e.target.value)}
                                    className={`${inputClass} pr-8`}
                                    placeholder="0"
                                />
                                <span className="absolute right-4 top-3 text-slate-400 text-sm">%</span>
                            </div>
                        </div>
                        <div>
                            <label htmlFor="sgstPercentage" className={labelClass}>SGST (%)</label>
                            <div className="relative">
                                <input
                                    type="number"
                                    name="sgstPercentage"
                                    id="sgstPercentage"
                                    min="0"
                                    step="0.01"
                                    value={sgstPercentage}
                                    onChange={(e) => setSgstPercentage(e.target.value)}
                                    className={`${inputClass} pr-8`}
                                    placeholder="0"
                                />
                                <span className="absolute right-4 top-3 text-slate-400 text-sm">%</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className="overflow-hidden rounded-2xl border border-slate-200/60 bg-white">
                <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-4 sm:px-6">
                    <div className="rounded-lg bg-violet-50 p-2"><ShoppingBagIcon className="h-4 w-4 text-violet-600" /></div>
                    <div>
                        <h2 className="text-sm font-semibold text-slate-900">Takeaway packaging</h2>
                        <p className="text-xs text-slate-500">A fixed charge added once per takeaway order at payment</p>
                    </div>
                </div>
                <div className="p-4 sm:p-6">
                    <label htmlFor="packagingCharge" className={labelClass}>Packaging charge (₹)</label>
                    <input id="packagingCharge" name="packagingCharge" type="number" inputMode="decimal" min="0" max="10000" step="0.01" value={packagingCharge} onChange={(event) => setPackagingCharge(event.target.value)} className={inputClass} placeholder="0.00" required />
                    <p className={hintClass}>Set to ₹0 for no charge. This does not affect dine-in orders.</p>
                </div>
            </div>

            {/* ── Aesthetic Downloads Settings ── */}
            <div className="bg-white rounded-2xl border border-slate-200/60 overflow-hidden">
                <div className="flex items-center gap-3 border-b border-slate-100 px-4 py-4 sm:px-6">
                    <div className="p-2 rounded-lg bg-pink-50">
                        <CameraIcon className="w-4 h-4 text-pink-600" />
                    </div>
                    <div>
                        <h2 className="text-sm font-semibold text-slate-900">Instagramable Photo Downloads</h2>
                        <p className="text-xs text-slate-500">Allow customers to download high-quality aesthetic photos of your cafe and menu items</p>
                    </div>
                </div>
                <div className="space-y-6 p-4 sm:p-6">
                    {/* Toggle Switch */}
                    <div className="flex items-center justify-between p-4 rounded-xl bg-slate-50 border border-slate-100 hover:border-slate-200 transition-all">
                        <div className="space-y-0.5">
                            <label className="text-sm font-semibold text-slate-800">Enable Instagram Photo Gallery</label>
                            <p className="text-xs text-slate-400">Shows a dedicated downloads page to customers after they successfully place an order</p>
                        </div>
                        <button
                            type="button"
                            onClick={() => setEnableAestheticDownloads(!enableAestheticDownloads)}
                            className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                                enableAestheticDownloads ? 'bg-sky-400' : 'bg-slate-200'
                            }`}
                        >
                            <span
                                className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                    enableAestheticDownloads ? 'translate-x-5' : 'translate-x-0'
                                }`}
                            />
                        </button>
                    </div>

                    {enableAestheticDownloads && (
                        <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-200">
                            {/* Cafe Aesthetic Photo Upload */}
                            <div>
                                <label className={labelClass}>Cafe Aesthetic Image (Instagram-ready)</label>
                                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:gap-5">
                                    <div className="flex-shrink-0">
                                        {coverPreview ? (
                                            <div className="w-24 h-24 rounded-2xl overflow-hidden bg-slate-50 border border-slate-200 shadow-sm relative group">
                                                <img src={coverPreview} alt="Cafe Aesthetic" className="w-full h-full object-cover" />
                                            </div>
                                        ) : (
                                            <div className="w-24 h-24 rounded-2xl bg-slate-50 border-2 border-dashed border-slate-200 flex items-center justify-center">
                                                <PhotoIcon className="w-8 h-8 text-slate-300" />
                                            </div>
                                        )}
                                    </div>
                                    <div className="flex-1">
                                        <label
                                            htmlFor="coverImage"
                                            className="flex flex-col items-center justify-center w-full h-28 border-2 border-slate-200 border-dashed rounded-2xl cursor-pointer bg-slate-50/50 hover:bg-slate-50 hover:border-sky-300 transition-all group"
                                        >
                                            <PhotoIcon className="w-7 h-7 mb-2 text-slate-400 group-hover:text-sky-500 transition-colors" />
                                            <p className="text-sm text-slate-500">
                                                <span className="font-semibold text-sky-600">Click to upload</span> or drag and drop
                                            </p>
                                            <p className="text-xs text-slate-400 mt-0.5">PNG, JPG, GIF (Max 2MB)</p>
                                            <input
                                                type="file"
                                                name="coverImage"
                                                id="coverImage"
                                                accept="image/*"
                                                className="hidden"
                                                onChange={handleCoverChange}
                                            />
                                        </label>
                                    </div>
                                </div>
                                <p className={hintClass}>This is the main aesthetic image of your cafe that customers can download after ordering.</p>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Save Button */}
            <button
                type="submit"
                disabled={isSaving}
                className="w-full py-3 px-4 bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold rounded-xl transition-all duration-200 shadow-lg shadow-slate-900/20 hover:shadow-xl hover:shadow-slate-900/25 hover:-translate-y-0.5 flex items-center justify-center gap-2 disabled:opacity-50"
            >
                {isSaving ? 'Saving Changes...' : 'Save Changes'}
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
            </button>
        </form>
    );
}
