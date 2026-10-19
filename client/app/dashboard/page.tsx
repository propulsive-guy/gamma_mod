import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import dbConnect from '@/lib/db';
import Order from '@/models/Order';
import Restaurant from '@/models/Restaurant';
import MenuItem from '@/models/MenuItem';
import Table from '@/models/Table';
import mongoose from 'mongoose';
import Link from 'next/link';
import DashboardGreeting from '@/components/dashboard/DashboardGreeting';
import ManagementReport from '@/components/dashboard/ManagementReport';
import {
    ShoppingBagIcon,
    CurrencyDollarIcon,
    DocumentTextIcon,
    TableCellsIcon,
    ArrowTrendingUpIcon,
    PlusIcon,
    QrCodeIcon,
    ClipboardDocumentListIcon,
} from '@heroicons/react/24/outline';

export default async function DashboardPage() {
    const session = await auth();

    if (!session || !session.user.restaurantId) {
        redirect('/auth/signin');
    }

    await dbConnect();

    const restaurantId = session.user.restaurantId;

    // Fetch statistics — all queries run in parallel, lean for speed
    const todayStart = new Date(new Date().setHours(0, 0, 0, 0));
    const [totalOrders, totalMenuItems, totalTables, revenueResult] = await Promise.all([
        Order.countDocuments({ restaurantId }).lean(),
        MenuItem.countDocuments({ restaurantId }).lean(),
        Table.countDocuments({ restaurantId, isTakeaway: { $ne: true } }).lean(),
        Order.aggregate([
            { $match: { restaurantId: new mongoose.Types.ObjectId(restaurantId), createdAt: { $gte: todayStart }, status: { $ne: 'cancelled' } } },
            { $group: { _id: null, total: { $sum: '$total' } } },
        ]),
    ]);

    const todayRevenue = revenueResult.length > 0 ? revenueResult[0].total : 0;

    const stats = [
        {
            name: 'Total Orders',
            value: totalOrders,
            icon: ShoppingBagIcon,
            iconBg: 'bg-blue-50',
            iconColor: 'text-blue-600',
            trend: '+12%',
        },
        {
            name: 'Menu Items',
            value: totalMenuItems,
            icon: DocumentTextIcon,
            iconBg: 'bg-emerald-50',
            iconColor: 'text-emerald-600',
            trend: null,
        },
        {
            name: 'Active Tables',
            value: totalTables,
            icon: TableCellsIcon,
            iconBg: 'bg-violet-50',
            iconColor: 'text-violet-600',
            trend: null,
        },
        {
            name: "Today's Revenue",
            value: `₹${todayRevenue.toLocaleString()}`,
            icon: CurrencyDollarIcon,
            iconBg: 'bg-amber-50',
            iconColor: 'text-amber-600',
            trend: null,
        },
    ];

    const quickActions = [
        {
            name: 'Manage Menu',
            description: 'Add, edit, or remove items',
            href: '/dashboard/menu',
            icon: DocumentTextIcon,
            iconBg: 'bg-blue-50',
            iconColor: 'text-blue-600',
        },
        {
            name: 'Manage Tables',
            description: 'Configure tables & QR codes',
            href: '/dashboard/tables',
            icon: QrCodeIcon,
            iconBg: 'bg-violet-50',
            iconColor: 'text-violet-600',
        },
        {
            name: 'View Orders',
            description: 'Track & manage live orders',
            href: '/dashboard/orders',
            icon: ClipboardDocumentListIcon,
            iconBg: 'bg-emerald-50',
            iconColor: 'text-emerald-600',
        },
        {
            name: 'Store & purchasing',
            description: 'Request stock, order, receive and track costs',
            href: '/dashboard/store',
            icon: ClipboardDocumentListIcon,
            iconBg: 'bg-amber-50',
            iconColor: 'text-amber-600',
        },
    ];

    return (
        <div className="space-y-8">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
                    Dashboard
                </h1>
                <DashboardGreeting />
            </div>

            <ManagementReport />

            {/* Stats Grid */}
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
                {stats.map((stat) => (
                    <div
                        key={stat.name}
                        className="bg-white rounded-2xl border border-slate-200/60 p-5 hover:shadow-md hover:shadow-slate-200/50 transition-all duration-300"
                    >
                        <div className="flex items-start justify-between">
                            <div className={`p-2.5 rounded-xl ${stat.iconBg}`}>
                                <stat.icon className={`h-5 w-5 ${stat.iconColor}`} />
                            </div>
                            {stat.trend && (
                                <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-600 bg-emerald-50 px-2 py-1 rounded-full">
                                    <ArrowTrendingUpIcon className="h-3 w-3" />
                                    {stat.trend}
                                </span>
                            )}
                        </div>
                        <div className="mt-4">
                            <p className="text-2xl font-bold text-slate-900 tracking-tight">
                                {stat.value}
                            </p>
                            <p className="text-sm text-slate-500 mt-0.5">
                                {stat.name}
                            </p>
                        </div>
                    </div>
                ))}
            </div>

            {/* Quick Actions */}
            <div>
                <h2 className="text-lg font-semibold text-slate-900 mb-4">
                    Quick Actions
                </h2>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {quickActions.map((action) => (
                        <Link
                            key={action.name}
                            href={action.href}
                            className="group bg-white rounded-2xl border border-slate-200/60 p-5 hover:shadow-md hover:shadow-slate-200/50 hover:border-slate-300/60 transition-all duration-300"
                        >
                            <div className="flex items-start gap-4">
                                <div className={`p-2.5 rounded-xl ${action.iconBg} group-hover:scale-110 transition-transform duration-300`}>
                                    <action.icon className={`h-5 w-5 ${action.iconColor}`} />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className="font-semibold text-slate-900 text-sm group-hover:text-sky-600 transition-colors">
                                        {action.name}
                                    </p>
                                    <p className="text-xs text-slate-500 mt-0.5">
                                        {action.description}
                                    </p>
                                </div>
                                <svg className="w-4 h-4 text-slate-400 group-hover:text-sky-500 group-hover:translate-x-0.5 transition-all mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                </svg>
                            </div>
                        </Link>
                    ))}
                </div>
            </div>
        </div>
    );
}
