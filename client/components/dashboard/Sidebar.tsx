'use client';

import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { signOut } from 'next-auth/react';
import { useState } from 'react';
import { DivineTransition } from '@/components/DivineTransition';
import {
    HomeIcon,
    DocumentTextIcon,
    TableCellsIcon,
    ShoppingBagIcon,
    ChartBarIcon,
    ArrowRightOnRectangleIcon,
    UserCircleIcon,
    ArchiveBoxIcon,
    CreditCardIcon,
} from '@heroicons/react/24/outline';

const navigation = [
    { name: 'Overview', href: '/dashboard', icon: HomeIcon },
    { name: 'Profile', href: '/dashboard/profile', icon: UserCircleIcon },
    { name: 'Menu', href: '/dashboard/menu', icon: DocumentTextIcon },
    { name: 'Tables', href: '/dashboard/tables', icon: TableCellsIcon },
    { name: 'Orders', href: '/dashboard/orders', icon: ShoppingBagIcon },
    { name: 'Analytics', href: '/dashboard/analytics', icon: ChartBarIcon },
    { name: 'Inventory', href: '/dashboard/inventory', icon: ArchiveBoxIcon },
    { name: 'Subscription', href: '/dashboard/subscription', icon: CreditCardIcon },
];

export default function Sidebar() {
    const pathname = usePathname();
    const [isSigningOut, setIsSigningOut] = useState(false);

    const handleSignOut = () => {
        if (isSigningOut) return;
        setIsSigningOut(true);
        window.setTimeout(() => {
            void signOut({ callbackUrl: '/auth/signin' });
        }, 2200);
    };

    return (
        <div className="flex w-full shrink-0 flex-col border-b border-sky-100 bg-sky-50 text-slate-900 lg:h-full lg:w-64 lg:border-b-0 lg:border-r">
            {isSigningOut && <DivineTransition deity="lakshmi" />}
            <div className="flex items-center justify-between border-b border-sky-100 px-4 py-3 sm:px-6 lg:block lg:px-6 lg:py-7">
                <div className="flex items-center gap-3">
                    <span className="text-xl font-bold tracking-tight text-slate-900 select-none">BitByte</span>
                </div>
                <button
                    onClick={handleSignOut}
                    disabled={isSigningOut}
                    className="inline-flex min-h-11 items-center gap-2 rounded-xl px-3 text-sm font-medium text-slate-500 hover:bg-red-50 hover:text-red-600 disabled:opacity-50 lg:hidden"
                >
                    <ArrowRightOnRectangleIcon className="h-5 w-5" />
                    <span>{isSigningOut ? 'Signing out…' : 'Sign out'}</span>
                </button>
            </div>

            {/* Navigation */}
            <nav aria-label="Dashboard" className="flex gap-1 overflow-x-auto px-2 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden lg:block lg:flex-1 lg:space-y-1 lg:overflow-y-auto lg:px-3 lg:py-4">
                {navigation.map((item) => {
                    const isActive = pathname === item.href;
                    return (
                        <Link
                            key={item.name}
                            href={item.href}
                            className={`flex min-h-10 shrink-0 items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-xs font-medium transition-all duration-200 lg:min-h-0 lg:gap-3 lg:px-3 lg:py-2.5 lg:text-sm ${isActive
                                ? 'bg-sky-200/60 text-sky-700'
                                : 'text-slate-600 hover:bg-sky-100 hover:text-slate-900'
                                }`}
                        >
                            <item.icon className={`h-5 w-5 ${isActive ? 'text-sky-600' : ''}`} />
                            <span>{item.name}</span>
                            {isActive && (
                                <div className="ml-auto hidden h-1.5 w-1.5 rounded-full bg-sky-500 lg:block" />
                            )}
                        </Link>
                    );
                })}
            </nav>

            {/* Sign Out */}
            <div className="hidden h-24 shrink-0 items-center border-t border-slate-200 px-3 lg:flex">
                <button
                    onClick={handleSignOut}
                    disabled={isSigningOut}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-500 hover:bg-red-50 hover:text-red-600 transition-all duration-200 w-full"
                >
                    <ArrowRightOnRectangleIcon className="h-5 w-5" />
                    <span>Sign Out</span>
                </button>
            </div>
        </div>
    );
}
