import { useEffect, useState } from 'react';
import Button from '@/components/ui/Button';
import { XMarkIcon, MinusIcon, PlusIcon, ShoppingBagIcon } from '@heroicons/react/24/outline';
import { formatCurrency } from '@/lib/utils';
import { contrastTextColor } from '@/lib/color';
import Input from '@/components/ui/Input';

interface CartItem {
    _id: string;
    name: string;
    price: number;
    quantity: number;
}

interface CartProps {
    cart: CartItem[];
    onClose: () => void;
    onUpdateQuantity: (itemId: string, quantity: number) => void;
    onPlaceOrder: (details: { name: string; phone: string; instructions: string }) => void;
    isPlacingOrder: boolean;
    accent: string;
    theme: { bg: string; text: string; subtext: string; border: string; cardBg: string };
}

export function Cart({ cart, onClose, onUpdateQuantity, onPlaceOrder, isPlacingOrder, accent, theme }: CartProps) {
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [instructions, setInstructions] = useState('');
    const [errors, setErrors] = useState({ name: '', phone: '', instructions: '' });

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

    const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

    const handlePlaceOrder = () => {
        const newErrors = { name: '', phone: '', instructions: '' };
        let isValid = true;

        if (!name.trim()) {
            newErrors.name = 'Name is required';
            isValid = false;
        } else if (name.trim().length > 120) {
            newErrors.name = 'Name must be 120 characters or fewer';
            isValid = false;
        }

        if (!phone.trim()) {
            newErrors.phone = 'Phone number is required';
            isValid = false;
        } else if (!/^\d{10}$/.test(phone)) {
            newErrors.phone = 'Enter exactly 10 digits';
            isValid = false;
        }

        if (instructions.length > 500) {
            newErrors.instructions = 'Use 500 characters or fewer';
            isValid = false;
        }

        setErrors(newErrors);

        if (isValid) {
            onPlaceOrder({ name: name.trim(), phone, instructions: instructions.trim() });
        }
    };

    return (
        <div className="fixed inset-0 z-50 overflow-hidden">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/40 backdrop-blur-sm transition-opacity duration-300"
                onClick={onClose}
            />

            {/* Cart Panel */}
            <div
                role="dialog"
                aria-modal="true"
                aria-label="Your order"
                className="absolute inset-x-0 bottom-0 flex h-[min(94dvh,900px)] w-full flex-col overflow-hidden overscroll-contain rounded-t-[30px] shadow-2xl sm:inset-y-0 sm:left-auto sm:right-0 sm:h-full sm:max-w-md sm:rounded-none"
                style={{ backgroundColor: theme.cardBg }}
            >
                {/* Header */}
                <div className="flex shrink-0 items-center justify-between border-b p-4 sm:p-5" style={{ borderColor: theme.border }}>
                    <div className="flex items-center gap-3">
                        <div className="p-2 rounded-lg" style={{ backgroundColor: `${accent}15` }}>
                            <ShoppingBagIcon className="h-6 w-6" style={{ color: accent }} />
                        </div>
                        <div>
                            <h2 className="text-lg font-bold" style={{ color: theme.text }}>Your Order</h2>
                            <p className="text-xs" style={{ color: theme.subtext }}>{cart.reduce((a, b) => a + b.quantity, 0)} items</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        aria-label="Close cart"
                        className="grid h-11 w-11 place-items-center rounded-full transition-colors hover:bg-gray-100/50"
                        style={{ color: theme.subtext }}
                    >
                        <XMarkIcon className="h-6 w-6" />
                    </button>
                </div>

                {/* Items */}
                <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 sm:p-5">
                    {cart.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-50">
                            <ShoppingBagIcon className="h-16 w-16" style={{ color: theme.subtext }} />
                            <p className="text-lg font-medium" style={{ color: theme.text }}>Your cart is empty</p>
                            <Button onClick={onClose} variant="ghost" className="text-sm">Start Ordering</Button>
                        </div>
                    ) : (
                        cart.map((item) => (
                            <div
                                key={item._id}
                                className="flex gap-4 p-3 rounded-xl border transition-all duration-200"
                                style={{ borderColor: theme.border, backgroundColor: theme.bg }}
                            >
                                <div className="flex-1 min-w-0">
                                    <div className="flex justify-between items-start mb-1">
                                        <h3 className="font-semibold text-sm leading-tight pr-2" style={{ color: theme.text }}>{item.name}</h3>
                                        <span className="font-bold text-sm shrink-0" style={{ color: theme.text }}>
                                            {formatCurrency(item.price * item.quantity)}
                                        </span>
                                    </div>
                                    <p className="text-xs mb-3" style={{ color: theme.subtext }}>{formatCurrency(item.price)} each</p>

                                    <div className="flex items-center gap-3">
                                        <div className="flex h-10 items-center rounded-lg border shadow-sm" style={{ borderColor: theme.border, backgroundColor: theme.cardBg }}>
                                            <button
                                                onClick={() => onUpdateQuantity(item._id, item.quantity - 1)}
                                                aria-label={`Remove one ${item.name}`}
                                                className="flex h-10 w-10 items-center justify-center rounded-l-lg transition-colors hover:bg-gray-50"
                                                style={{ color: theme.text }}
                                            >
                                                <MinusIcon className="h-3 w-3" />
                                            </button>
                                            <span className="w-7 select-none text-center text-sm font-semibold" style={{ color: theme.text }}>
                                                {item.quantity}
                                            </span>
                                            <button
                                                onClick={() => onUpdateQuantity(item._id, item.quantity + 1)}
                                                aria-label={`Add one ${item.name}`}
                                                className="flex h-10 w-10 items-center justify-center rounded-r-lg transition-colors hover:bg-gray-50"
                                                style={{ color: theme.text }}
                                            >
                                                <PlusIcon className="h-3 w-3" />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ))
                    )}
                </div>

                {/* Footer */}
                {cart.length > 0 && (
                    <div className="max-h-[min(64dvh,520px)] shrink-0 space-y-5 overflow-y-auto border-t p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] backdrop-blur-sm sm:max-h-[65dvh] sm:p-5" style={{ borderColor: theme.border, backgroundColor: theme.bg }}>
                        <div className="space-y-4">
                            <div className="grid grid-cols-1 gap-3 min-[440px]:grid-cols-2">
                                <div className="space-y-1">
                                    <label htmlFor="cart-customer-name" className="ml-1 text-xs font-semibold uppercase tracking-wider" style={{ color: theme.subtext }}>Name</label>
                                    <Input
                                        id="cart-customer-name"
                                        placeholder="Enter name"
                                        value={name}
                                        maxLength={120}
                                        onChange={(e) => { setName(e.target.value); setErrors((current) => ({ ...current, name: '' })); }}
                                        type="text"
                                        inputMode="text"
                                        autoComplete="name"
                                        className={`w-full rounded-xl border px-4 py-2.5 text-base focus:ring-2 focus:ring-offset-0 transition-all ${errors.name ? 'border-red-500' : ''}`}
                                        style={{ backgroundColor: theme.cardBg, borderColor: errors.name ? undefined : theme.border, color: theme.text }}
                                    />
                                    {errors.name && <p className="text-red-500 text-[10px] ml-1">{errors.name}</p>}
                                </div>
                                <div className="space-y-1">
                                    <label htmlFor="cart-customer-phone" className="ml-1 text-xs font-semibold uppercase tracking-wider" style={{ color: theme.subtext }}>Phone</label>
                                    <Input
                                        id="cart-customer-phone"
                                        placeholder="10-digit mobile"
                                        value={phone}
                                        onChange={(e) => {
                                            const digits = e.target.value.replace(/\D/g, '');
                                            setPhone(digits);
                                            setErrors((current) => ({ ...current, phone: digits.length > 10 ? 'Enter exactly 10 digits' : '' }));
                                        }}
                                        type="tel"
                                        autoComplete="tel-national"
                                        inputMode="numeric"
                                        className={`w-full rounded-xl border px-4 py-2.5 text-base focus:ring-2 focus:ring-offset-0 transition-all ${errors.phone ? 'border-red-500' : ''}`}
                                        style={{ backgroundColor: theme.cardBg, borderColor: errors.phone ? undefined : theme.border, color: theme.text }}
                                    />
                                    {errors.phone && <p className="text-red-500 text-[10px] ml-1">{errors.phone}</p>}
                                </div>
                            </div>

                            <textarea
                                className="w-full resize-none rounded-xl border px-4 py-3 text-base focus:ring-2 focus:ring-offset-0 transition-all"
                                rows={2}
                                maxLength={500}
                                placeholder="Any special requests for the kitchen?"
                                value={instructions}
                                onChange={(e) => { setInstructions(e.target.value); setErrors((current) => ({ ...current, instructions: '' })); }}
                                aria-label="Special requests for the kitchen"
                                aria-invalid={!!errors.instructions}
                                style={{ backgroundColor: theme.cardBg, borderColor: errors.instructions ? '#ef4444' : theme.border, color: theme.text }}
                            />
                            <p className="text-[10px]" style={{ color: theme.subtext }}>Optional · up to 500 characters</p>
                            {errors.instructions && <p className="text-red-500 text-[10px]">{errors.instructions}</p>}
                        </div>

                        <div className="pt-2">
                            <div className="flex justify-between items-center mb-4">
                                <span className="text-sm font-medium" style={{ color: theme.subtext }}>Total Amount</span>
                                <span className="text-2xl font-bold" style={{ color: theme.text }}>{formatCurrency(total)}</span>
                            </div>

                            <Button
                                onClick={handlePlaceOrder}
                                isLoading={isPlacingOrder}
                                className="w-full py-3.5 rounded-xl text-base font-bold text-white shadow-lg active:scale-[0.98] transition-all"
                                style={{ backgroundColor: accent, color: contrastTextColor(accent), boxShadow: `0 4px 14px 0 ${accent}4d` }}
                            >
                                Place Order
                            </Button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
