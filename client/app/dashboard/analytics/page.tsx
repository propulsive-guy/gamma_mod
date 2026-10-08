import mongoose from 'mongoose';
import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import dbConnect from '@/lib/db';
import Order from '@/models/Order';
import { formatCurrency } from '@/lib/utils';
import DateFilter from '@/components/dashboard/DateFilter';
import { getAnalyticsDateRange, getAnalyticsPeriodLabel, normalizeAnalyticsPeriod } from '@/lib/analyticsPeriod';
import { ArrowDownTrayIcon, CurrencyDollarIcon, ShoppingBagIcon, ChartBarIcon } from '@heroicons/react/24/outline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PageProps {
    searchParams: Promise<{ period?: string }>;
}

type PeriodSummary = { orders: number; revenue: number };
type TopItem = { name: string; quantity: number; revenue: number };

export default async function AnalyticsPage({ searchParams }: PageProps) {
    const [params, session] = await Promise.all([searchParams, auth()]);
    if (!session?.user?.restaurantId) redirect('/auth/signin');

    const period = normalizeAnalyticsPeriod(params.period);
    const periodLabel = getAnalyticsPeriodLabel(period);
    const { startDate, endDate } = getAnalyticsDateRange(period);
    let periodSummary: PeriodSummary = { orders: 0, revenue: 0 };
    let allTimeSummary: PeriodSummary = { orders: 0, revenue: 0 };
    let topItems: TopItem[] = [];
    let loadFailed = false;

    try {
        await dbConnect();
        const restaurantId = new mongoose.Types.ObjectId(String(session.user.restaurantId));

        // Aggregate in MongoDB so the serverless function never loads whole order
        // documents or builds large in-memory analytics structures.
        const [periodResult, allTimeResult] = await Promise.all([
            Order.aggregate([
                { $match: { restaurantId, status: { $ne: 'cancelled' }, createdAt: { $gte: startDate, $lte: endDate } } },
                {
                    $facet: {
                        summary: [{ $group: { _id: null, orders: { $sum: 1 }, revenue: { $sum: '$total' } } }],
                        topItems: [
                            { $unwind: '$items' },
                            {
                                $group: {
                                    _id: { $ifNull: ['$items.menuItemId', '$items.name'] },
                                    name: { $first: '$items.name' },
                                    quantity: { $sum: '$items.quantity' },
                                    revenue: { $sum: { $multiply: ['$items.price', '$items.quantity'] } },
                                },
                            },
                            { $sort: { quantity: -1, revenue: -1 } },
                            { $limit: 8 },
                            { $project: { _id: 0, name: 1, quantity: 1, revenue: 1 } },
                        ],
                    },
                },
            ]).allowDiskUse(true),
            Order.aggregate([
                { $match: { restaurantId, status: { $ne: 'cancelled' } } },
                { $group: { _id: null, orders: { $sum: 1 }, revenue: { $sum: '$total' } } },
            ]).allowDiskUse(true),
        ]);

        periodSummary = periodResult[0]?.summary[0] || periodSummary;
        allTimeSummary = allTimeResult[0] || allTimeSummary;
        topItems = periodResult[0]?.topItems || [];
    } catch (error) {
        loadFailed = true;
        console.error('[AnalyticsPage] Could not calculate analytics:', error);
    }

    const averageOrder = periodSummary.orders > 0 ? periodSummary.revenue / periodSummary.orders : 0;
    const cards = [
        { label: `Revenue · ${periodLabel}`, value: formatCurrency(periodSummary.revenue), icon: CurrencyDollarIcon, tone: 'bg-emerald-50 text-emerald-600' },
        { label: `Orders · ${periodLabel}`, value: periodSummary.orders.toLocaleString('en-IN'), icon: ShoppingBagIcon, tone: 'bg-blue-50 text-blue-600' },
        { label: 'Average order value', value: formatCurrency(averageOrder), icon: ChartBarIcon, tone: 'bg-violet-50 text-violet-600' },
        { label: 'All-time revenue', value: formatCurrency(allTimeSummary.revenue), icon: CurrencyDollarIcon, tone: 'bg-amber-50 text-amber-600' },
    ];

    return (
        <div className="space-y-6">
            <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
                <div>
                    <h1 className="text-2xl font-bold tracking-tight text-slate-900">Analytics</h1>
                    <p className="mt-1 text-sm text-slate-500">Sales overview for {periodLabel.toLowerCase()}.</p>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                    <DateFilter />
                    <a href={`/api/analytics/sales-export?period=${period}`} className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700">
                        <ArrowDownTrayIcon className="h-4 w-4" /> Download sales Excel
                    </a>
                </div>
            </div>

            {loadFailed && (
                <div role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                    Analytics data could not be loaded right now. The rest of your dashboard is still available.
                </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                {cards.map((card) => (
                    <section key={card.label} className="rounded-2xl border border-slate-200/70 bg-white p-5">
                        <div className={`inline-flex rounded-xl p-2 ${card.tone}`}><card.icon className="h-5 w-5" /></div>
                        <p className="mt-3 text-2xl font-bold text-slate-900">{card.value}</p>
                        <p className="mt-1 text-xs text-slate-500">{card.label}</p>
                    </section>
                ))}
            </div>

            <section className="overflow-hidden rounded-2xl border border-slate-200/70 bg-white">
                <div className="border-b border-slate-100 px-5 py-4">
                    <h2 className="text-sm font-bold text-slate-900">Top-selling items</h2>
                    <p className="mt-0.5 text-xs text-slate-500">Ranked by units sold · {periodLabel}</p>
                </div>
                {!topItems.length ? (
                    <p className="p-8 text-center text-sm text-slate-400">No completed sales in this period.</p>
                ) : (
                    <div className="divide-y divide-slate-100">
                        {topItems.map((item, index) => (
                            <div key={item.name} className="flex items-center justify-between gap-4 px-5 py-3.5">
                                <div className="flex min-w-0 items-center gap-3">
                                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-600">{index + 1}</span>
                                    <span className="truncate text-sm font-semibold text-slate-800">{item.name}</span>
                                </div>
                                <div className="shrink-0 text-right">
                                    <p className="text-sm font-bold text-slate-800">{item.quantity} sold</p>
                                    <p className="text-xs text-slate-400">{formatCurrency(item.revenue)}</p>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </section>
        </div>
    );
}
