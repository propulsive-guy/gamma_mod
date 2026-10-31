'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { ArrowDownTrayIcon, ArrowPathIcon, BanknotesIcon, ChartBarIcon, CubeIcon } from '@heroicons/react/24/outline';
import { getManagementReport, type ManagementPeriod } from '@/app/actions/management';

type Report = {
    period: ManagementPeriod; label: string;
    mis: {
        sales: number; restaurantSales: number; partySales: number; zomatoSales: number; grossSales: number; gst: number; netSales: number; orders: number;
        cogs: number; wastage: number; purchases: number; expenses: number; operatingExpenses: number; salary: number; averageExpensePerDay: number; averageSalePerDay: number;
        foodCost: number; foodCostPercent: number; profitMargin: number; grossProfit: number; netProfit: number; grossMargin: number; estimatedWasteCost: number;
        estimatedWaste: { itemName: string; category: string; unit: string; quantity: number; cost: number }[];
        expenseCategories: { category: string; amount: number; recordedExpense: number; lines: number; percentage: number }[];
        categoryPerformance: { category: string; purchases: number; purchaseLines: number; ingredientCost: number; recordedWasteCost: number; estimatedWasteCost: number; allocatedSales: number; grossProfit: number; grossMargin: number }[];
        inventoryContribution: { itemName: string; category: string; unit: string; quantityUsed: number; recordedWasteQuantity: number; allocatedSales: number; ingredientCost: number; recordedWasteCost: number; contribution: number }[];
    };
    balanceSheet: { ready: boolean; asOf: string | null; cash: number; inventory: number; receivables: number; otherAssets: number; totalAssets: number; supplierPayables: number; loans: number; otherLiabilities: number; totalLiabilities: number; equity: number; totalLiabilitiesAndEquity: number };
};
const money = (amount: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount || 0);
const indiaToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
const lines = (report: Report) => [
    ['Management information statement', report.label],
    ['Restaurant Sale', report.mis.restaurantSales], ['Party Sale', report.mis.partySales], ['Zomato', report.mis.zomatoSales],
    ['Grand Sale', report.mis.grossSales], ['Less: GST on restaurant sales (5% included)', -report.mis.gst], ['Net sales', report.mis.netSales],
    ['Orders served', report.mis.orders],
    [], ['Operating expenses by MIS category', 'Amount (₹)', '% of net sales'],
    ...report.mis.expenseCategories.map((item) => [item.category, item.amount, item.percentage.toFixed(2)]),
    ['Food cost (recipe usage + recorded waste)', report.mis.foodCost], ['Food cost (%)', report.mis.foodCostPercent.toFixed(2)],
    ['Operational expenses (excluding salary)', report.mis.operatingExpenses], ['Salary', report.mis.salary], ['Total expenses (food cost + operating expenses)', report.mis.expenses],
    ['Average expense per day', report.mis.averageExpensePerDay], ['Average net sale per day', report.mis.averageSalePerDay],
    ['Profit', report.mis.netProfit], ['Profit (%)', report.mis.profitMargin.toFixed(2)],
    [], ['Inventory operations', ''], ['Recipe ingredient usage cost', report.mis.cogs],
    ['Recorded wastage cost', report.mis.wastage], ['Estimated 1-day expiry variance', report.mis.estimatedWasteCost],
    ['Stock received / purchases', report.mis.purchases],
    [], ['Category performance', 'Store purchases', 'Ingredient cost', 'Recorded waste', 'Estimated waste', 'Allocated menu sales', 'Gross profit', 'Gross margin %'],
    ...report.mis.categoryPerformance.map((item) => [item.category, item.purchases, item.ingredientCost, item.recordedWasteCost, item.estimatedWasteCost, item.allocatedSales, item.grossProfit, item.grossMargin.toFixed(2)]),
    [], ['Balance sheet', report.balanceSheet.asOf ? new Date(report.balanceSheet.asOf).toLocaleDateString('en-IN') : 'Opening balances not set'],
    ['Cash / bank (estimated)', report.balanceSheet.cash], ['Inventory', report.balanceSheet.inventory], ['Customer receivables', report.balanceSheet.receivables],
    ['Other assets', report.balanceSheet.otherAssets], ['Total assets', report.balanceSheet.totalAssets], ['Supplier payables', report.balanceSheet.supplierPayables],
    ['Loans', report.balanceSheet.loans], ['Other liabilities', report.balanceSheet.otherLiabilities], ['Total liabilities', report.balanceSheet.totalLiabilities],
    ['Owner equity / retained earnings', report.balanceSheet.equity], ['Total liabilities and equity', report.balanceSheet.totalLiabilitiesAndEquity],
    [], ['Ingredient sales contribution (allocated by recipe cost share)', ''],
    ['Ingredient', 'Store category', 'Used', 'Allocated sales', 'Ingredient cost', 'Recorded waste quantity', 'Recorded waste cost', 'Contribution'],
    ...report.mis.inventoryContribution.map((item) => [item.itemName, item.category, `${item.quantityUsed.toFixed(2)} ${item.unit}`, item.allocatedSales, item.ingredientCost, `${item.recordedWasteQuantity.toFixed(2)} ${item.unit}`, item.recordedWasteCost, item.contribution]),
    [], ['Estimated 1-day expiry variance', ''],
    ...report.mis.estimatedWaste.map((item) => [item.itemName, `${item.quantity.toFixed(2)} ${item.unit}`, item.cost]),
];

export default function ManagementReport({ initialReport }: { initialReport?: Report }) {
    const [period, setPeriod] = useState<ManagementPeriod>(initialReport?.period || 'month');
    const [anchorDate, setAnchorDate] = useState(indiaToday);
    const [report, setReport] = useState<Report | null>(initialReport || null);
    const [error, setError] = useState('');
    const [pending, startTransition] = useTransition();
    useEffect(() => {
        if (report) return;
        startTransition(async () => {
            const result = await getManagementReport('month', anchorDate);
            if (result.success) setReport(result.report);
            else setError(result.error || 'Could not load this report.');
        });
    }, [report, anchorDate]);
    function changePeriod(next: ManagementPeriod) {
        setPeriod(next);
        startTransition(async () => {
            const result = await getManagementReport(next, anchorDate);
            if (result.success) { setReport(result.report); setError(''); }
            else setError(result.error || 'Could not refresh this report.');
        });
    }
    function changeDate(nextDate: string) {
        setAnchorDate(nextDate);
        startTransition(async () => {
            const result = await getManagementReport(period, nextDate);
            if (result.success) { setReport(result.report); setError(''); }
            else setError(result.error || 'Could not refresh this report.');
        });
    }
    function exportCsv() {
        if (!report) return;
        const csv = lines(report).map((row) => row.map((cell) => {
            const value = typeof cell === 'number' ? cell.toFixed(2) : String(cell ?? '');
            return `"${value.replaceAll('"', '""')}"`;
        }).join(',')).join('\r\n');
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        const anchor = document.createElement('a'); anchor.href = url; anchor.download = `management-report-${report.period}-${indiaToday()}.csv`; anchor.click(); URL.revokeObjectURL(url);
    }
    if (!report) return <section className="rounded-3xl border border-slate-200/80 bg-slate-50 p-5 sm:p-6"><div className="flex items-center gap-2 text-sm font-semibold text-slate-700"><ArrowPathIcon className={`h-4 w-4 ${pending ? 'animate-spin' : ''}`} /> Loading management report…</div>{error && <p role="alert" className="mt-3 text-sm text-rose-700">{error}</p>}</section>;
    const metricCards = [
        { label: 'Net sales', value: report.mis.netSales, detail: `${report.mis.orders} served orders · GST removed`, icon: BanknotesIcon, tone: 'bg-emerald-50 text-emerald-700' },
        { label: 'Food cost', value: report.mis.foodCost, detail: `${report.mis.foodCostPercent.toFixed(2)}% of net sales`, icon: CubeIcon, tone: 'bg-amber-50 text-amber-700' },
        { label: 'Total expenses', value: report.mis.expenses, detail: `${money(report.mis.foodCost)} food + ${money(report.mis.operatingExpenses)} operating + ${money(report.mis.salary)} salary`, icon: ChartBarIcon, tone: 'bg-sky-50 text-sky-700' },
        { label: 'Profit', value: report.mis.netProfit, detail: `${report.mis.profitMargin.toFixed(2)}% of net sales`, icon: BanknotesIcon, tone: report.mis.netProfit >= 0 ? 'bg-violet-50 text-violet-700' : 'bg-rose-50 text-rose-700' },
    ];
    return <section className="space-y-4 rounded-3xl border border-slate-200/80 bg-slate-50 p-4 sm:p-6">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-sky-600">Management reports</p><h2 className="mt-1 text-xl font-bold tracking-tight text-slate-900">MIS & balance sheet</h2><p className="mt-1 text-sm text-slate-500">{report.label} · Restaurant sales come from served orders; Party and Zomato sales are entered in Store. GST is calculated as 5/105 of restaurant sales. Purchases remain stock value until ingredients are used or wasted.</p></div><div className="flex flex-wrap items-center gap-2"><div className="inline-flex rounded-xl border border-slate-200 bg-white p-1"><button onClick={() => changePeriod('week')} className={`min-h-9 rounded-lg px-3 text-xs font-bold ${period === 'week' ? 'bg-slate-900 text-white' : 'text-slate-600'}`}>Weekly</button><button onClick={() => changePeriod('month')} className={`min-h-9 rounded-lg px-3 text-xs font-bold ${period === 'month' ? 'bg-slate-900 text-white' : 'text-slate-600'}`}>Monthly</button></div><label className="sr-only" htmlFor="management-report-date">Choose a date within the reporting period</label><input id="management-report-date" type="date" value={anchorDate} onChange={(event) => changeDate(event.target.value)} className="min-h-10 rounded-xl border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700" /><button onClick={exportCsv} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-100"><ArrowDownTrayIcon className="h-4 w-4" /> Export MIS</button><button onClick={() => changePeriod(period)} aria-label="Refresh report" className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-100"><ArrowPathIcon className={`h-4 w-4 ${pending ? 'animate-spin' : ''}`} /></button></div></div>
        {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{metricCards.map((card) => <article key={card.label} className="rounded-2xl border border-slate-200 bg-white p-4"><span className={`inline-flex rounded-xl p-2 ${card.tone}`}><card.icon className="h-4 w-4" /></span><p className="mt-3 text-lg font-bold text-slate-900 sm:text-xl">{money(card.value)}</p><p className="mt-0.5 text-xs font-semibold text-slate-700">{card.label}</p><p className="mt-1 text-[10px] text-slate-400">{card.detail}</p></article>)}</div>
        <div className="grid gap-4 xl:grid-cols-[1fr_1.1fr]">
            <section className="rounded-2xl border border-slate-200 bg-white"><div className="border-b border-slate-100 px-4 py-3"><h3 className="text-sm font-bold text-slate-900">MIS · {report.label}</h3><p className="mt-1 text-[10px] text-slate-500">Amounts and percentages are rounded to two decimal places.</p></div><dl className="divide-y divide-slate-100">
                {[
                    ['Restaurant Sale', report.mis.restaurantSales], ['Party Sale', report.mis.partySales], ['Zomato', report.mis.zomatoSales],
                    ['Grand Sale', report.mis.grossSales, true], ['GST on restaurant sales', -report.mis.gst], ['Net sales', report.mis.netSales, true],
                    ['Orders served', report.mis.orders],
                ].map(([label, value, strong]) => <div key={String(label)} className="flex items-center justify-between gap-3 px-4 py-2.5"><dt className={`text-xs ${strong ? 'font-bold text-slate-900' : 'text-slate-600'}`}>{label}</dt><dd className={`text-xs tabular-nums ${strong ? 'font-bold text-slate-900' : 'font-semibold text-slate-700'}`}>{label === 'Orders served' ? Number(value).toLocaleString('en-IN') : money(Number(value))}</dd></div>)}
                <div className="bg-slate-50 px-4 py-2 text-[10px] font-bold uppercase tracking-wide text-slate-500">Operating expenses by category</div>
                {report.mis.expenseCategories.map((item) => <div key={item.category} className="flex items-center justify-between gap-3 px-4 py-2"><dt className="text-xs text-slate-600">{item.category}<span className="ml-2 text-[10px] text-slate-400">{item.percentage.toFixed(2)}%</span></dt><dd className="text-xs font-semibold tabular-nums text-slate-700">{money(item.amount)}</dd></div>)}
                {[
                    ['Food cost', report.mis.foodCost], ['Operational expenses (excluding salary)', report.mis.operatingExpenses], ['Salary', report.mis.salary],
                    ['Total expenses', report.mis.expenses, true], ['Average expense per day', report.mis.averageExpensePerDay],
                    ['Average net sale per day', report.mis.averageSalePerDay],
                    ['Food cost (%)', report.mis.foodCostPercent], ['Profit', report.mis.netProfit, true], ['Profit (%)', report.mis.profitMargin],
                ].map(([label, value, strong]) => <div key={String(label)} className="flex items-center justify-between gap-3 px-4 py-2.5"><dt className={`text-xs ${strong ? 'font-bold text-slate-900' : 'text-slate-600'}`}>{label}</dt><dd className={`text-xs tabular-nums ${strong ? 'font-bold text-slate-900' : 'font-semibold text-slate-700'}`}>{String(label).includes('(%)') ? `${Number(value).toFixed(2)}%` : money(Number(value))}</dd></div>)}
            </dl></section>
            <section className="rounded-2xl border border-slate-200 bg-white"><div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3"><div><h3 className="text-sm font-bold text-slate-900">Operational balance sheet</h3><p className="mt-0.5 text-[10px] text-slate-400">Current position from recorded balances and transactions</p></div>{report.balanceSheet.ready && <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700">Opening balances set</span>}</div>
                {!report.balanceSheet.ready && <div className="m-4 rounded-xl border border-amber-200 bg-amber-50 p-3"><p className="text-xs font-semibold text-amber-900">Add opening balances to enable the cash and equity view.</p><Link href="/dashboard/store" className="mt-2 inline-flex min-h-9 items-center rounded-lg bg-amber-900 px-3 text-xs font-bold text-white">Set up in Store</Link></div>}
                {report.balanceSheet.ready ? <div className="grid gap-4 p-4 sm:grid-cols-2"><div><p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Assets</p>{[['Cash / bank · estimated', report.balanceSheet.cash], ['Inventory', report.balanceSheet.inventory], ['Customer receivables', report.balanceSheet.receivables], ['Other assets', report.balanceSheet.otherAssets], ['Total assets', report.balanceSheet.totalAssets]].map(([label, value], index) => <div key={String(label)} className={`flex justify-between gap-2 py-1.5 ${index === 4 ? 'mt-1 border-t border-slate-200 font-bold' : ''}`}><span className="text-[11px] text-slate-600">{label}</span><span className="text-[11px] font-semibold tabular-nums text-slate-800">{money(Number(value))}</span></div>)}</div><div><p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Liabilities & equity</p>{[['Supplier payables', report.balanceSheet.supplierPayables], ['Loans', report.balanceSheet.loans], ['Other liabilities', report.balanceSheet.otherLiabilities], ['Total liabilities', report.balanceSheet.totalLiabilities], ['Owner equity / retained earnings', report.balanceSheet.equity], ['Total liabilities & equity', report.balanceSheet.totalLiabilitiesAndEquity]].map(([label, value], index) => <div key={String(label)} className={`flex justify-between gap-2 py-1.5 ${index === 3 || index === 5 ? 'mt-1 border-t border-slate-200 font-bold' : ''}`}><span className="text-[11px] text-slate-600">{label}</span><span className="text-[11px] font-semibold tabular-nums text-slate-800">{money(Number(value))}</span></div>)}</div></div> : <p className="px-4 pb-4 text-xs text-slate-600">Current inventory valuation: <strong>{money(report.balanceSheet.inventory)}</strong>. Enter opening balances in Store to calculate cash, payables and owner equity from your starting date.</p>}<p className="px-4 pb-4 text-[10px] leading-4 text-slate-400">Cash and equity are management estimates. Results depend on complete purchase, payment, expense and opening balance records; this is not a statutory accounting statement.</p>
            </section>
        </div>
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white"><div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3"><div><h3 className="text-sm font-bold text-slate-900">Category performance</h3><p className="mt-1 text-[10px] leading-4 text-slate-500">Uses the exact inventory categories set in Store. Served menu sales are allocated by recipe cost share; Party and Zomato remain in overall sales because they are not linked to order recipes. Purchases stay separate from profit until stock is consumed or wasted.</p></div><span className="shrink-0 text-xs font-bold text-slate-700">{report.mis.categoryPerformance.length} categories</span></div><div className="overflow-x-auto"><table className="w-full min-w-[900px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-2">Store category</th><th className="px-3 py-2">Purchases</th><th className="px-3 py-2">Ingredient cost</th><th className="px-3 py-2">Recorded waste</th><th className="px-3 py-2">Est. waste</th><th className="px-3 py-2">Allocated sales</th><th className="px-3 py-2">Gross profit</th><th className="px-4 py-2">Margin</th></tr></thead><tbody className="divide-y divide-slate-100">{report.mis.categoryPerformance.map((item) => <tr key={item.category}><td className="px-4 py-2.5 font-semibold text-slate-800">{item.category}</td><td className="px-3 py-2.5">{money(item.purchases)}<span className="ml-1 text-[10px] text-slate-400">{item.purchaseLines} lines</span></td><td className="px-3 py-2.5">{money(item.ingredientCost)}</td><td className="px-3 py-2.5">{money(item.recordedWasteCost)}</td><td className="px-3 py-2.5">{money(item.estimatedWasteCost)}</td><td className="px-3 py-2.5">{money(item.allocatedSales)}</td><td className={`px-3 py-2.5 font-bold ${item.grossProfit < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>{money(item.grossProfit)}</td><td className="px-4 py-2.5">{item.grossMargin.toFixed(2)}%</td></tr>)}{!report.mis.categoryPerformance.length && <tr><td colSpan={8} className="px-4 py-8 text-center text-slate-400">Add inventory items to a Store category to see category performance.</td></tr>}</tbody></table></div><p className="border-t border-slate-100 px-4 py-2 text-[10px] text-slate-400">Category gross profit = allocated menu sales − recipe ingredient cost − recorded waste. Estimated waste is shown separately and is not booked as a confirmed loss. Purchases are stock value, and operating overhead remains in total MIS profit rather than being spread across categories.</p></section>
        <div className="grid gap-4 xl:grid-cols-[1.4fr_0.8fr]">
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white"><div className="border-b border-slate-100 px-4 py-3"><h3 className="text-sm font-bold text-slate-900">Ingredient contribution to menu sales</h3><p className="mt-1 text-[10px] leading-4 text-slate-500">Each dish’s menu price is allocated to ingredients by their share of recipe cost. Useful for comparison; this is an estimate, not standalone item sales.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[700px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-2">Ingredient</th><th className="px-3 py-2">Category</th><th className="px-3 py-2">Used</th><th className="px-3 py-2">Allocated sales</th><th className="px-3 py-2">Ingredient cost</th><th className="px-4 py-2">Recorded waste</th><th className="px-4 py-2">Contribution</th></tr></thead><tbody className="divide-y divide-slate-100">{report.mis.inventoryContribution.map((item) => <tr key={`${item.itemName}:${item.category}`}><td className="px-4 py-2.5 font-semibold text-slate-800">{item.itemName}</td><td className="px-3 py-2.5 text-slate-600">{item.category}</td><td className="px-3 py-2.5 text-slate-600">{item.quantityUsed.toFixed(2)} {item.unit}</td><td className="px-3 py-2.5">{money(item.allocatedSales)}</td><td className="px-3 py-2.5">{money(item.ingredientCost)}</td><td className="px-3 py-2.5">{money(item.recordedWasteCost)}<span className="ml-1 text-[10px] text-slate-400">({item.recordedWasteQuantity.toFixed(2)} {item.unit})</span></td><td className="px-4 py-2.5 font-bold">{money(item.contribution)}</td></tr>)}{!report.mis.inventoryContribution.length && <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-400">No served orders with linked recipes in this period.</td></tr>}</tbody></table></div></section>
            <section className="rounded-2xl border border-amber-200 bg-white"><div className="border-b border-amber-100 px-4 py-3"><h3 className="text-sm font-bold text-slate-900">Short-expiry stock variance</h3><p className="mt-1 text-[10px] leading-4 text-slate-500">For ingredients set to expire after 1 day, this compares issues with recipe usage. It is an estimate; confirmed auto-expiry and manual waste are recorded separately.</p></div><div className="p-4"><p className="text-lg font-bold text-amber-800">{money(report.mis.estimatedWasteCost)}</p>{report.mis.estimatedWaste.length ? <ul className="mt-3 space-y-2">{report.mis.estimatedWaste.map((item) => <li key={item.itemName} className="flex justify-between gap-3 text-xs"><span className="text-slate-700">{item.itemName} · {item.quantity.toFixed(2)} {item.unit}</span><b className="shrink-0 text-slate-800">{money(item.cost)}</b></li>)}</ul> : <p className="mt-2 text-xs text-slate-500">No 1-day expiry variance for this period.</p>}<p className="mt-3 border-t border-amber-100 pt-3 text-[10px] leading-4 text-slate-400">Set the number of days from kitchen issue until an ingredient expires in the menu ingredient settings.</p></div></section>
        </div>
    </section>;
}
