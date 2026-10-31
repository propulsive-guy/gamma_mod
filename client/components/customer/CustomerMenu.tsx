'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Cart } from './Cart';
import { OfferCarousel } from './OfferCarousel';
import { getTableVisit, startTableVisit, type TableVisit } from '@/lib/session';
import { createOrder } from '@/app/actions/order';
import { toast } from 'react-hot-toast';
import { ShoppingBagIcon, ArrowRightIcon, SparklesIcon, MagnifyingGlassIcon, MinusIcon, PlusIcon, ClockIcon } from '@heroicons/react/24/outline';
import { formatCurrency } from '@/lib/utils';
import { contrastTextColor } from '@/lib/color';
import { BrandFooter } from '@/components/BrandFooter';

interface MenuItem {
    _id: string;
    name: string;
    description: string;
    price: number;
    category: string;
    imageUrl?: string;
    aestheticImageUrl?: string;
}

interface Restaurant {
    _id: string;
    name: string;
    description: string;
    logoUrl?: string;
    coverImageUrl?: string;
    themeColor?: string;
    logoAccentColor?: string;
    accentSource?: 'logo' | 'custom';
    fontFamily?: string;
    colorScheme?: string;
    enableAestheticDownloads?: boolean;
    packagingCharge?: number;
}

interface Table {
    _id: string;
    tableNumber: string;
    isTakeaway?: boolean;
}

interface CartItem extends MenuItem {
    quantity: number;
}

export function CustomerMenu({
    restaurant,
    table,
    menuItems,
    captainMode = false,
}: {
    restaurant: Restaurant;
    table: Table;
    menuItems: MenuItem[];
    captainMode?: boolean;
}) {
    const router = useRouter();
    const [cart, setCart] = useState<CartItem[]>([]);
    const [showCart, setShowCart] = useState(false);
    const [selectedCategory, setSelectedCategory] = useState<string>('all');
    const [searchQuery, setSearchQuery] = useState('');
    const [isPlacingOrder, setIsPlacingOrder] = useState(false);
    const [visit, setVisit] = useState<TableVisit | null>(null);
    const initializedTable = useRef('');

    useEffect(() => {
        const key = `${restaurant._id}:${table._id}`;
        if (initializedTable.current === key) return;
        initializedTable.current = key;

        const requestedVisit = new URLSearchParams(window.location.search).get('visit');
        const savedVisit = getTableVisit(restaurant._id, table._id);
        const currentVisit = requestedVisit && savedVisit?.visitId === requestedVisit
            ? savedVisit : startTableVisit(restaurant._id, table._id);
        setVisit(currentVisit);

        const url = new URL(window.location.href);
        url.searchParams.delete('scan');
        url.searchParams.set('visit', currentVisit.visitId);
        window.history.replaceState(window.history.state, '', url);
    }, [restaurant._id, table._id]);

    const accent = restaurant.accentSource === 'custom'
        ? restaurant.themeColor || '#38bdf8'
        : restaurant.logoAccentColor || restaurant.themeColor || '#38bdf8';
    const accentText = contrastTextColor(accent);
    const font = restaurant.fontFamily || 'inter';
    const scheme = restaurant.colorScheme || 'light';

    const fontMap: Record<string, string> = {
        inter: "'Inter', sans-serif",
        outfit: "'Outfit', sans-serif",
        poppins: "'Poppins', sans-serif",
        roboto: "'Roboto', sans-serif",
        playfair: "'Playfair Display', serif",
    };

    const fontUrlMap: Record<string, string> = {
        inter: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
        outfit: 'https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700&display=swap',
        poppins: 'https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap',
        roboto: 'https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap',
        playfair: 'https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;500;600;700&display=swap',
    };

    const schemes: Record<string, { bg: string; cardBg: string; headerBg: string; text: string; subtext: string; border: string }> = {
        light: { bg: '#f8f7f4', cardBg: '#ffffff', headerBg: 'rgba(255,255,255,0.92)', text: '#18181b', subtext: '#71717a', border: '#e9e7e1' },
        dark: { bg: '#0f172a', cardBg: '#1e293b', headerBg: 'rgba(15,23,42,0.9)', text: '#f8fafc', subtext: '#94a3b8', border: '#334155' },
        warm: { bg: '#fbf7f0', cardBg: '#ffffff', headerBg: 'rgba(251,247,240,0.92)', text: '#332418', subtext: '#806b5b', border: '#ebdfd0' },
        cool: { bg: '#f0f9ff', cardBg: '#ffffff', headerBg: 'rgba(240,249,255,0.9)', text: '#0c4a6e', subtext: '#0369a1', border: '#bae6fd' },
    };

    const t = schemes[scheme] || schemes.light;
    const fontFamily = fontMap[font] || fontMap.inter;

    // Normalize category names to Title Case for casing consistency
    const titleCase = (str: string) => str.trim().split(/\s+/).map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()).join(' ');
    const menuCategory = (value: string) => {
        const category = titleCase(value || 'Other');
        const key = category.toLowerCase();
        if (['starter', 'starters', 'appetizer', 'appetizers'].includes(key)) return 'Starter';
        if (['main', 'mains', 'main course', 'main courses'].includes(key)) return 'Main Course';
        if (['chapati', 'chapatis', 'roti', 'rotis', 'bread', 'breads', 'indian breads'].includes(key)) return 'Breads';
        if (['drink', 'drinks', 'beverage', 'beverages'].includes(key)) return 'Drinks';
        return category;
    };
    const categoryOrder = ['Starter', 'Main Course', 'Breads', 'Drinks'];

    const normalizedMenuItems = menuItems.map(item => ({
        ...item,
        category: menuCategory(item.category)
    }));

    const categories = ['all', ...Array.from(new Set(normalizedMenuItems.map((item) => item.category)))
        .sort((a, b) => {
            const aIndex = categoryOrder.indexOf(a);
            const bIndex = categoryOrder.indexOf(b);
            if (aIndex !== -1 || bIndex !== -1) return (aIndex === -1 ? Infinity : aIndex) - (bIndex === -1 ? Infinity : bIndex);
            return a.localeCompare(b);
        })];

    const filteredItems = normalizedMenuItems.filter((item) =>
        (selectedCategory === 'all' || item.category === selectedCategory) &&
        `${item.name} ${item.description || ''} ${item.category}`.toLowerCase().includes(searchQuery.trim().toLowerCase())
    );
    const cartQuantities = new Map(cart.map(item => [item._id, item.quantity]));
    const heroImage = restaurant.coverImageUrl || normalizedMenuItems.find(item => item.imageUrl)?.imageUrl;
    const trackHref = `/table/${restaurant._id}/${table._id}/order-status${visit ? `?visit=${visit.visitId}` : ''}`;

    const addToCart = (item: MenuItem) => {
        setCart((prevCart) => {
            const existing = prevCart.find((i) => i._id === item._id);
            if (existing) {
                return prevCart.map((i) =>
                    i._id === item._id ? { ...i, quantity: i.quantity + 1 } : i
                );
            }
            return [...prevCart, { ...item, quantity: 1 }];
        });
        toast.success(`${item.name} added to cart`);
    };

    const updateQuantity = (itemId: string, quantity: number) => {
        if (quantity <= 0) {
            setCart((prevCart) => prevCart.filter((item) => item._id !== itemId));
        } else {
            setCart((prevCart) =>
                prevCart.map((item) => (item._id === itemId ? { ...item, quantity } : item))
            );
        }
    };

    const total = cart.reduce((sum, item) => sum + item.price * item.quantity, 0);

    const placeOrder = async (details: { name: string; phone: string; instructions: string }) => {
        if (cart.length === 0) {
            toast.error('Cart is empty');
            return;
        }

        setIsPlacingOrder(true);

        try {
            const currentVisit = visit || getTableVisit(restaurant._id, table._id);
            if (!currentVisit) {
                toast.error('Please refresh the menu and try again');
                return;
            }

            const result = await createOrder({
                tableId: table._id,
                restaurantId: restaurant._id,
                sessionId: currentVisit.sessionId,
                items: cart.map((item) => ({
                    menuItemId: item._id,
                    name: item.name,
                    price: item.price,
                    quantity: item.quantity,
                })),
                customerName: details.name,
                customerPhone: details.phone,
                notes: details.instructions,
            });

            if (result.success) {
                toast.success(captainMode
                    ? `Order saved for Table ${table.tableNumber}. Its KOT is available in Orders.`
                    : 'Order placed successfully!');
                setCart([]);
                setShowCart(false);
                if (!captainMode) {
                    router.push(`/table/${restaurant._id}/${table._id}/order-status?visit=${currentVisit.visitId}&pay=${encodeURIComponent(result.data._id)}`);
                }
            } else {
                toast.error(result.error || 'Failed to place order');
            }
        } catch (error) {
            toast.error('An unexpected error occurred');
        } finally {
            setIsPlacingOrder(false);
        }
    };

    return (
        <>
            <link rel="stylesheet" href={fontUrlMap[font] || fontUrlMap.inter} />

            <div className="min-h-[100dvh] overflow-x-hidden pb-32 transition-colors duration-300" style={{ backgroundColor: t.bg, fontFamily, color: t.text }}>
                <header className={`sticky ${captainMode ? 'top-[60px]' : 'top-0'} z-40 border-b backdrop-blur-2xl`} style={{ backgroundColor: t.headerBg, borderColor: t.border }}>
                    <div className="mx-auto flex h-[68px] max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
                        <div className="flex min-w-0 items-center gap-2.5 sm:gap-3">
                            {restaurant.logoUrl ? (
                                <img src={restaurant.logoUrl} alt="" className="h-11 w-11 shrink-0 rounded-2xl border object-cover shadow-sm" style={{ borderColor: t.border }} />
                            ) : (
                                <div className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-lg font-bold" style={{ backgroundColor: accent, color: accentText }}>{restaurant.name.charAt(0)}</div>
                            )}
                            <div className="min-w-0">
                                <p className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: accent }}>{captainMode ? `Waiter · Table ${table.tableNumber}` : table.isTakeaway ? 'Order to go' : 'At your table'}</p>
                                <h1 className="truncate text-[15px] font-bold leading-tight sm:text-base">{restaurant.name}</h1>
                            </div>
                        </div>
                        {!captainMode && <Link href={trackHref} aria-label="View your bill" className="inline-flex min-h-11 shrink-0 items-center justify-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition active:scale-95 sm:px-4" style={{ borderColor: t.border, backgroundColor: t.cardBg, color: t.text }}>
                            <ClockIcon className="h-4 w-4" /><span className="hidden min-[360px]:inline">View bill</span>
                        </Link>}
                    </div>
                </header>

                <main className="mx-auto max-w-6xl px-4 sm:px-6">
                    <section className="relative mt-4 flex min-h-[340px] overflow-hidden rounded-[30px] text-white shadow-[0_18px_60px_-30px_rgba(0,0,0,0.6)] sm:mt-6 sm:min-h-[420px] sm:rounded-[38px]" style={{ backgroundColor: accent }}>
                        {heroImage ? <img src={heroImage} alt="" className="absolute inset-0 h-full w-full object-cover" /> : <div className="absolute -right-16 -top-20 h-80 w-80 rounded-full border-[65px] border-white/15 sm:h-[500px] sm:w-[500px]" />}
                        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/50 to-black/15 sm:bg-gradient-to-r sm:from-black/80 sm:via-black/45 sm:to-black/10" />
                        <div className="relative flex w-full flex-col justify-between p-6 sm:p-10 lg:p-12">
                            <div className="flex flex-wrap items-center gap-2">
                                <span className="rounded-full border border-white/30 bg-white/15 px-3 py-1.5 text-[11px] font-bold tracking-wide backdrop-blur-lg">{table.isTakeaway ? 'TAKEAWAY' : `TABLE ${table.tableNumber}`}</span>
                                <span className="rounded-full border border-white/30 bg-white/15 px-3 py-1.5 text-[11px] font-medium backdrop-blur-lg">{table.isTakeaway ? 'Order ahead · Pick up fresh' : 'Dine in · Made fresh'}</span>
                            </div>
                            <div className="max-w-2xl pb-1">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-white/75">{table.isTakeaway ? 'Your favourites, ready to go' : 'A meal worth slowing down for'}</p>
                                <h2 className="mt-3 max-w-xl text-[clamp(2.25rem,8vw,5rem)] font-semibold leading-[1.02] tracking-tight">Welcome to<br /><span className="font-serif italic">{restaurant.name}</span></h2>
                                <p className="mt-4 max-w-lg text-sm leading-relaxed text-white/85 sm:text-base">{captainMode ? `Place an order for Table ${table.tableNumber}. The bill opens as soon as the order is sent.` : restaurant.description || (table.isTakeaway ? 'Explore the menu and place your order for pickup.' : 'Your table is ready. Explore the menu, find something lovely, and let us take care of the rest.')}</p>
                                <a href="#menu" className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-full bg-white px-5 py-2.5 text-sm font-bold text-zinc-900 transition active:scale-95">Explore the menu <ArrowRightIcon className="h-4 w-4" /></a>
                            </div>
                        </div>
                    </section>

                    <div className="mt-4 sm:mt-5"><OfferCarousel accent={accent} dark={scheme === 'dark'} takeaway={table.isTakeaway} /></div>

                    <section id="menu" className="scroll-mt-24 pt-10 sm:pt-14">
                        <h2 className="font-serif text-4xl leading-none tracking-tight sm:text-5xl">Menu<span style={{ color: accent }}>.</span></h2>

                        <label className="mt-6 flex min-h-12 items-center gap-3 rounded-2xl border px-4 shadow-sm transition focus-within:ring-2" style={{ backgroundColor: t.cardBg, borderColor: t.border, outlineColor: accent }}>
                            <MagnifyingGlassIcon className="h-5 w-5 shrink-0" style={{ color: t.subtext }} />
                            <span className="sr-only">Search the menu</span>
                            <input type="search" value={searchQuery} onChange={event => setSearchQuery(event.target.value)} placeholder="Search dishes, flavours, categories" className="w-full min-w-0 bg-transparent text-base outline-none placeholder:opacity-70 sm:text-sm" style={{ color: t.text }} />
                        </label>

                        <div className="-mx-4 mt-5 flex snap-x gap-2 overflow-x-auto px-4 pb-3 sm:mx-0 sm:px-0" aria-label="Menu categories">
                            {categories.map(category => (
                                <button key={category} type="button" onClick={() => setSelectedCategory(category)} aria-pressed={selectedCategory === category} className="min-h-11 shrink-0 snap-start rounded-full border px-5 text-sm font-semibold transition active:scale-95" style={selectedCategory === category
                                    ? { backgroundColor: accent, borderColor: accent, color: accentText }
                                    : { backgroundColor: t.cardBg, borderColor: t.border, color: t.text }}>
                                    {category === 'all' ? 'All' : category}
                                </button>
                            ))}
                        </div>

                        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-5">
                            {filteredItems.map(item => {
                                const quantity = cartQuantities.get(item._id) || 0;
                                return (
                                    <article key={item._id} className="group flex min-w-0 gap-3 overflow-hidden rounded-[24px] border p-3 shadow-[0_6px_25px_-17px_rgba(0,0,0,0.3)] transition hover:-translate-y-0.5 hover:shadow-lg sm:gap-4 sm:p-4" style={{ backgroundColor: t.cardBg, borderColor: t.border }}>
                                        {item.imageUrl ? (
                                            <img src={item.imageUrl} alt={item.name} loading="lazy" className="h-32 w-28 shrink-0 rounded-[17px] object-cover transition group-hover:scale-[1.02] min-[380px]:w-32 sm:h-36 sm:w-36" />
                                        ) : (
                                            <div className="grid h-32 w-28 shrink-0 place-items-center rounded-[17px] min-[380px]:w-32 sm:h-36 sm:w-36" style={{ backgroundColor: `${accent}16`, color: accent }}><SparklesIcon className="h-8 w-8" /></div>
                                        )}
                                        <div className="flex min-w-0 flex-1 flex-col justify-between py-0.5">
                                            <div>
                                                <p className="text-[10px] font-bold uppercase tracking-[0.15em]" style={{ color: accent }}>{item.category}</p>
                                                <h3 className="mt-1 line-clamp-2 text-[15px] font-bold leading-snug sm:text-base">{item.name}</h3>
                                                {item.description && <p className="mt-1 line-clamp-2 text-xs leading-relaxed" style={{ color: t.subtext }}>{item.description}</p>}
                                            </div>
                                            <div className="mt-2 flex flex-wrap items-end justify-between gap-2">
                                                <span className="text-base font-bold tracking-tight">{formatCurrency(item.price)}</span>
                                                {quantity ? (
                                                    <div className="flex h-10 items-center rounded-full border" style={{ borderColor: accent, color: accent }}>
                                                        <button type="button" onClick={() => updateQuantity(item._id, quantity - 1)} aria-label={`Remove one ${item.name}`} className="grid h-10 w-10 place-items-center rounded-full"><MinusIcon className="h-4 w-4" /></button>
                                                        <span className="min-w-5 text-center text-sm font-bold" aria-live="polite">{quantity}</span>
                                                        <button type="button" onClick={() => updateQuantity(item._id, quantity + 1)} aria-label={`Add one ${item.name}`} className="grid h-10 w-10 place-items-center rounded-full"><PlusIcon className="h-4 w-4" /></button>
                                                    </div>
                                                ) : (
                                                    <button type="button" onClick={() => addToCart(item)} aria-label={`Add ${item.name} to cart`} className="flex h-10 items-center gap-1 rounded-full px-4 text-xs font-bold transition active:scale-95" style={{ backgroundColor: accent, color: accentText }}><PlusIcon className="h-4 w-4" /> Add</button>
                                                )}
                                            </div>
                                        </div>
                                    </article>
                                );
                            })}
                        </div>

                        {filteredItems.length === 0 && (
                            <div className="rounded-[24px] border px-6 py-12 text-center" style={{ backgroundColor: t.cardBg, borderColor: t.border }}>
                                <MagnifyingGlassIcon className="mx-auto h-8 w-8" style={{ color: t.subtext }} />
                                <h3 className="mt-3 text-lg font-bold">No dishes found</h3>
                                <p className="mt-1 text-sm" style={{ color: t.subtext }}>Try another search or category.</p>
                                <button type="button" onClick={() => { setSearchQuery(''); setSelectedCategory('all'); }} className="mt-4 text-sm font-bold" style={{ color: accent }}>Show all dishes</button>
                            </div>
                        )}
                    </section>
                </main>
                <BrandFooter className="mx-auto mt-12 max-w-6xl px-4 pb-2 pt-7 sm:px-6" color={t.subtext} borderColor={t.border} />

                {/* Floating Cart Button */}
                {cart.length > 0 && (
                    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 flex justify-center bg-gradient-to-t from-black/10 to-transparent px-4 pt-5 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:pb-5">
                        <button
                            onClick={() => setShowCart(true)}
                            className="pointer-events-auto mx-auto flex min-h-16 w-full max-w-md items-center gap-3 rounded-[20px] p-1.5 pr-5 shadow-2xl transition active:scale-[0.98]"
                            style={{ backgroundColor: accent, color: accentText }}
                        >
                            <div className="rounded-2xl bg-white/20 p-3">
                                <ShoppingBagIcon className="h-6 w-6" />
                            </div>
                            <div className="flex flex-col items-start flex-1 min-w-0">
                                <span className="text-xs font-medium opacity-90">{cart.reduce((a, b) => a + b.quantity, 0)} items in cart</span>
                                <span className="text-sm font-bold">View Cart</span>
                            </div>
                            <span className="font-bold text-lg">{formatCurrency(total)}</span>
                        </button>
                    </div>
                )}

                {/* Cart Drawer */}
                {showCart && (
                    <Cart
                        cart={cart}
                        onClose={() => setShowCart(false)}
                        onUpdateQuantity={updateQuantity}
                        onPlaceOrder={placeOrder}
                        isPlacingOrder={isPlacingOrder}
                        accent={accent} // Pass accent color to Cart
                        theme={t} // Pass theme object to Cart
                    />
                )}
            </div>
        </>
    );
}
