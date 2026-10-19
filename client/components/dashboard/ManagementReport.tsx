'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { ArrowDownTrayIcon, ArrowPathIcon, BanknotesIcon, ChartBarIcon, CubeIcon } from '@heroicons/react/24/outline';
import { getManagementReport, type ManagementPeriod } from '@/app/actions/management';

type Report = {
    period: ManagementPeriod; label: string;
    mis: { sales: number; orders: number; cogs: number; wastage: number; purchases: number; expenses: number; grossProfit: number; netProfit: number; grossMargin: number; estimatedWasteCost: number; estimatedWaste: { itemName: string; unit: string; quantity: number; cost: number }[]; inventoryContribution: { itemName: string; unit: string; quantityUsed: number; allocatedSales: number; ingredientCost: number; contribution: number }[] };
    balanceSheet: { ready: boolean; asOf: string | null; cash: number; inventory: number; receivables: number; otherAssets: number; totalAssets: number; supplierPayables: number; loans: number; otherLiabilities: number; totalLiabilities: number; equity: number; totalLiabilitiesAndEquity: number };
};
const money = (amount: number) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(amount || 0);
const lines = (report: Report) => [
    ['Management information statement', report.label],
    ['Net sales (served orders)', report.mis.sales], ['Orders served', report.mis.orders], ['Ingredient cost (COGS)', report.mis.cogs],
    ['Wastage cost', report.mis.wastage], ['Gross profit', report.mis.grossProfit], ['Gross margin (%)', report.mis.grossMargin.toFixed(1)],
    ['Estimated perishable variance', report.mis.estimatedWasteCost],
    ['Operating expenses', report.mis.expenses], ['Net operating profit', report.mis.netProfit], ['Stock received / purchases', report.mis.purchases],
    [], ['Balance sheet', report.balanceSheet.asOf ? new Date(report.balanceSheet.asOf).toLocaleDateString('en-IN') : 'Opening balances not set'],
    ['Cash / bank (estimated)', report.balanceSheet.cash], ['Inventory', report.balanceSheet.inventory], ['Customer receivables', report.balanceSheet.receivables],
    ['Other assets', report.balanceSheet.otherAssets], ['Total assets', report.balanceSheet.totalAssets], ['Supplier payables', report.balanceSheet.supplierPayables],
    ['Loans', report.balanceSheet.loans], ['Other liabilities', report.balanceSheet.otherLiabilities], ['Total liabilities', report.balanceSheet.totalLiabilities],
    ['Owner equity / retained earnings', report.balanceSheet.equity], ['Total liabilities and equity', report.balanceSheet.totalLiabilitiesAndEquity],
    [], ['Ingredient sales contribution (allocated by recipe cost share)', ''],
    ...report.mis.inventoryContribution.map((item) => [item.itemName, item.allocatedSales]),
    [], ['Estimated perishable variance', ''],
    ...report.mis.estimatedWaste.map((item) => [item.itemName, `${item.quantity} ${item.unit}`, item.cost]),
];

export default function ManagementReport({ initialReport }: { initialReport?: Report }) {
    const [period, setPeriod] = useState<ManagementPeriod>(initialReport?.period || 'month');
    const [anchorDate, setAnchorDate] = useState(() => new Date().toISOString().slice(0, 10));
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
        const csv = lines(report).map((row) => row.map((cell) => `"${String(cell ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n');
        const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
        const anchor = document.createElement('a'); anchor.href = url; anchor.download = `management-report-${report.period}-${new Date().toISOString().slice(0, 10)}.csv`; anchor.click(); URL.revokeObjectURL(url);
    }
    if (!report) return <section className="rounded-3xl border border-slate-200/80 bg-slate-50 p-5 sm:p-6"><div className="flex items-center gap-2 text-sm font-semibold text-slate-700"><ArrowPathIcon className={`h-4 w-4 ${pending ? 'animate-spin' : ''}`} /> Loading management report…</div>{error && <p role="alert" className="mt-3 text-sm text-rose-700">{error}</p>}</section>;
    const metricCards = [
        { label: 'Net sales', value: report.mis.sales, detail: `${report.mis.orders} served orders`, icon: BanknotesIcon, tone: 'bg-emerald-50 text-emerald-700' },
        { label: 'Ingredient cost', value: report.mis.cogs, detail: 'Recipe usage at recorded unit cost', icon: CubeIcon, tone: 'bg-amber-50 text-amber-700' },
        { label: 'Gross profit', value: report.mis.grossProfit, detail: `${report.mis.grossMargin.toFixed(1)}% gross margin`, icon: ChartBarIcon, tone: 'bg-sky-50 text-sky-700' },
        { label: 'Net operating profit', value: report.mis.netProfit, detail: `After ${money(report.mis.expenses)} expenses`, icon: BanknotesIcon, tone: report.mis.netProfit >= 0 ? 'bg-violet-50 text-violet-700' : 'bg-rose-50 text-rose-700' },
    ];
    return <section className="space-y-4 rounded-3xl border border-slate-200/80 bg-slate-50 p-4 sm:p-6">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-sky-600">Management reports</p><h2 className="mt-1 text-xl font-bold tracking-tight text-slate-900">MIS & balance sheet</h2><p className="mt-1 text-sm text-slate-500">{report.label} · Sales from served orders and cost from recorded stock movements.</p></div><div className="flex flex-wrap items-center gap-2"><div className="inline-flex rounded-xl border border-slate-200 bg-white p-1"><button onClick={() => changePeriod('week')} className={`min-h-9 rounded-lg px-3 text-xs font-bold ${period === 'week' ? 'bg-slate-900 text-white' : 'text-slate-600'}`}>Weekly</button><button onClick={() => changePeriod('month')} className={`min-h-9 rounded-lg px-3 text-xs font-bold ${period === 'month' ? 'bg-slate-900 text-white' : 'text-slate-600'}`}>Monthly</button></div><label className="sr-only" htmlFor="management-report-date">Choose a date within the reporting period</label><input id="management-report-date" type="date" value={anchorDate} onChange={(event) => changeDate(event.target.value)} className="min-h-10 rounded-xl border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700" /><button onClick={exportCsv} className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 hover:bg-slate-100"><ArrowDownTrayIcon className="h-4 w-4" /> Export MIS</button><button onClick={() => changePeriod(period)} aria-label="Refresh report" className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-100"><ArrowPathIcon className={`h-4 w-4 ${pending ? 'animate-spin' : ''}`} /></button></div></div>
        {error && <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">{error}</div>}
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{metricCards.map((card) => <article key={card.label} className="rounded-2xl border border-slate-200 bg-white p-4"><span className={`inline-flex rounded-xl p-2 ${card.tone}`}><card.icon className="h-4 w-4" /></span><p className="mt-3 text-lg font-bold text-slate-900 sm:text-xl">{money(card.value)}</p><p className="mt-0.5 text-xs font-semibold text-slate-700">{card.label}</p><p className="mt-1 text-[10px] text-slate-400">{card.detail}</p></article>)}</div>
        <div className="grid gap-4 xl:grid-cols-[1fr_1.1fr]">
            <section className="rounded-2xl border border-slate-200 bg-white"><div className="border-b border-slate-100 px-4 py-3"><h3 className="text-sm font-bold text-slate-900">MIS · {report.label}</h3></div><dl className="divide-y divide-slate-100">{[
                ['Net sales', report.mis.sales], ['Orders served', report.mis.orders, true], ['Cost of goods sold', -report.mis.cogs], ['Wastage', -report.mis.wastage], ['Gross profit', report.mis.grossProfit, true], ['Operating expenses', -report.mis.expenses], ['Net operating profit', report.mis.netProfit, true], ['Inventory purchases received', report.mis.purchases],
            ].map(([label, value, strong]) => <div key={String(label)} className="flex items-center justify-between gap-3 px-4 py-2.5"><dt className={`text-xs ${strong ? 'font-bold text-slate-900' : 'text-slate-600'}`}>{label}</dt><dd className={`text-xs tabular-nums ${strong ? 'font-bold text-slate-900' : 'font-semibold text-slate-700'}`}>{label === 'Orders served' ? Number(value).toLocaleString('en-IN') : money(Number(value))}</dd></div>)}</dl></section>
            <section className="rounded-2xl border border-slate-200 bg-white"><div className="flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3"><div><h3 className="text-sm font-bold text-slate-900">Operational balance sheet</h3><p className="mt-0.5 text-[10px] text-slate-400">Current position from recorded balances and transactions</p></div>{report.balanceSheet.ready && <span className="rounded-full bg-emerald-50 px-2 py-1 text-[10px] font-bold text-emerald-700">Opening balances set</span>}</div>
                {!report.balanceSheet.ready && <div className="m-4 rounded-xl border border-amber-200 bg-amber-50 p-3"><p className="text-xs font-semibold text-amber-900">Add opening balances to enable the cash and equity view.</p><Link href="/dashboard/store" className="mt-2 inline-flex min-h-9 items-center rounded-lg bg-amber-900 px-3 text-xs font-bold text-white">Set up in Store</Link></div>}
                {report.balanceSheet.ready ? <div className="grid gap-4 p-4 sm:grid-cols-2"><div><p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Assets</p>{[['Cash / bank · estimated', report.balanceSheet.cash], ['Inventory', report.balanceSheet.inventory], ['Customer receivables', report.balanceSheet.receivables], ['Other assets', report.balanceSheet.otherAssets], ['Total assets', report.balanceSheet.totalAssets]].map(([label, value], index) => <div key={String(label)} className={`flex justify-between gap-2 py-1.5 ${index === 4 ? 'mt-1 border-t border-slate-200 font-bold' : ''}`}><span className="text-[11px] text-slate-600">{label}</span><span className="text-[11px] font-semibold tabular-nums text-slate-800">{money(Number(value))}</span></div>)}</div><div><p className="mb-2 text-[10px] font-bold uppercase tracking-wider text-slate-400">Liabilities & equity</p>{[['Supplier payables', report.balanceSheet.supplierPayables], ['Loans', report.balanceSheet.loans], ['Other liabilities', report.balanceSheet.otherLiabilities], ['Total liabilities', report.balanceSheet.totalLiabilities], ['Owner equity / retained earnings', report.balanceSheet.equity], ['Total liabilities & equity', report.balanceSheet.totalLiabilitiesAndEquity]].map(([label, value], index) => <div key={String(label)} className={`flex justify-between gap-2 py-1.5 ${index === 3 || index === 5 ? 'mt-1 border-t border-slate-200 font-bold' : ''}`}><span className="text-[11px] text-slate-600">{label}</span><span className="text-[11px] font-semibold tabular-nums text-slate-800">{money(Number(value))}</span></div>)}</div></div> : <p className="px-4 pb-4 text-xs text-slate-600">Current inventory valuation: <strong>{money(report.balanceSheet.inventory)}</strong>. Enter opening balances in Store to calculate cash, payables and owner equity from your starting date.</p>}<p className="px-4 pb-4 text-[10px] leading-4 text-slate-400">Cash and equity are management estimates. Results depend on complete purchase, payment, expense and opening balance records; this is not a statutory accounting statement.</p>
            </section>
        </div>
        <div className="grid gap-4 xl:grid-cols-[1.4fr_0.8fr]">
            <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white"><div className="border-b border-slate-100 px-4 py-3"><h3 className="text-sm font-bold text-slate-900">Ingredient contribution to menu sales</h3><p className="mt-1 text-[10px] leading-4 text-slate-500">Each dish’s menu price is allocated to ingredients by their share of recipe cost. Useful for comparison; this is an estimate, not standalone item sales.</p></div><div className="overflow-x-auto"><table className="w-full min-w-[600px] text-left text-xs"><thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500"><tr><th className="px-4 py-2">Ingredient</th><th className="px-3 py-2">Used</th><th className="px-3 py-2">Allocated sales</th><th className="px-3 py-2">Ingredient cost</th><th className="px-4 py-2">Contribution</th></tr></thead><tbody className="divide-y divide-slate-100">{report.mis.inventoryContribution.map((item) => <tr key={item.itemName}><td className="px-4 py-2.5 font-semibold text-slate-800">{item.itemName}</td><td className="px-3 py-2.5 text-slate-600">{Number(item.quantityUsed.toFixed(3))} {item.unit}</td><td className="px-3 py-2.5">{money(item.allocatedSales)}</td><td className="px-3 py-2.5">{money(item.ingredientCost)}</td><td className="px-4 py-2.5 font-bold">{money(item.contribution)}</td></tr>)}{!report.mis.inventoryContribution.length && <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">No served orders with linked recipes in this period.</td></tr>}</tbody></table></div></section>
            <section className="rounded-2xl border border-amber-200 bg-white"><div className="border-b border-amber-100 px-4 py-3"><h3 className="text-sm font-bold text-slate-900">Perishable stock variance</h3><p className="mt-1 text-[10px] leading-4 text-slate-500">Perishable issue quantity less recipe usage this period. This is a waste estimate, not an automatic stock write-off; record confirmed waste in Kitchen Inventory.</p></div><div className="p-4"><p className="text-lg font-bold text-amber-800">{money(report.mis.estimatedWasteCost)}</p>{report.mis.estimatedWaste.length ? <ul className="mt-3 space-y-2">{report.mis.estimatedWaste.map((item) => <li key={item.itemName} className="flex justify-between gap-3 text-xs"><span className="text-slate-700">{item.itemName} · {Number(item.quantity.toFixed(3))} {item.unit}</span><b className="shrink-0 text-slate-800">{money(item.cost)}</b></li>)}</ul> : <p className="mt-2 text-xs text-slate-500">No perishable issue variance for this period.</p>}<p className="mt-3 border-t border-amber-100 pt-3 text-[10px] leading-4 text-slate-400">Mark milk and other short-life stock as perishable when editing an ingredient. Reusable ingredients such as rice remain carry-over stock.</p></div></section>
        </div>
    </section>;
}
