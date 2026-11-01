'use client';

import { useState, type ComponentProps } from 'react';
import { CustomerMenu } from '@/components/customer/CustomerMenu';
import { CaptainOrdersPanel } from '@/components/customer/CaptainOrdersPanel';

interface CaptainTable {
    _id: string;
    tableNumber: string;
    isTakeaway?: boolean;
}

export function CaptainOrderPage({
    restaurant,
    captainKey,
    tables,
    menuItems,
}: {
    restaurant: ComponentProps<typeof CustomerMenu>['restaurant'];
    captainKey: string;
    tables: CaptainTable[];
    menuItems: ComponentProps<typeof CustomerMenu>['menuItems'];
}) {
    const [selectedTableId, setSelectedTableId] = useState(tables[0]?._id || '');
    const [activeTab, setActiveTab] = useState<'order' | 'track'>('order');
    const selectedTable = tables.find((table) => table._id === selectedTableId);

    return (
        <>
            <div className="sticky top-0 z-50 border-b border-slate-200 bg-white px-4 py-0 shadow-sm sm:px-6">
                <div className="mx-auto flex h-[60px] max-w-6xl items-center gap-4">
                    <label htmlFor="captain-table" className="shrink-0 text-sm font-bold text-slate-900">Captain · Table</label>
                    {tables.length > 0 ? (
                        <select
                            id="captain-table"
                            value={selectedTableId}
                            onChange={(event) => setSelectedTableId(event.target.value)}
                            className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-900 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200 sm:max-w-xs"
                        >
                            {tables.map((table) => <option key={table._id} value={table._id}>Table {table.tableNumber}</option>)}
                        </select>
                    ) : (
                        <p className="text-sm text-slate-500">Add an active dine-in table to take orders.</p>
                    )}
                </div>
            </div>
            {selectedTable ? (
                <>
                    <nav className="sticky top-[60px] z-40 border-b border-slate-200 bg-white px-4 py-1.5 shadow-sm sm:px-6" aria-label="Waiter actions">
                        <div className="mx-auto flex max-w-6xl gap-2">
                            <button type="button" onClick={() => setActiveTab('order')} aria-pressed={activeTab === 'order'} className={`min-h-11 flex-1 rounded-xl px-4 text-sm font-bold ${activeTab === 'order' ? 'bg-emerald-700 text-white' : 'bg-slate-100 text-slate-700'}`}>Take order</button>
                            <button type="button" onClick={() => setActiveTab('track')} aria-pressed={activeTab === 'track'} className={`min-h-11 flex-1 rounded-xl px-4 text-sm font-bold ${activeTab === 'track' ? 'bg-emerald-700 text-white' : 'bg-slate-100 text-slate-700'}`}>Track table orders</button>
                        </div>
                    </nav>
                    <div className={activeTab === 'order' ? '' : 'hidden'}>
                        <CustomerMenu
                            key={selectedTable._id}
                            restaurant={restaurant}
                            table={selectedTable}
                            menuItems={menuItems}
                            captainMode
                            onCaptainOrderCreated={() => setActiveTab('track')}
                        />
                    </div>
                    {activeTab === 'track' && <CaptainOrdersPanel
                        key={`orders-${selectedTable._id}`}
                        captainKey={captainKey}
                        table={selectedTable}
                        tables={tables}
                        menuItems={menuItems}
                        restaurant={restaurant}
                    />}
                </>
            ) : (
                <main className="grid min-h-[70vh] place-items-center bg-slate-50 px-6 text-center">
                    <div className="max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
                        <h1 className="text-xl font-bold text-slate-900">No active tables</h1>
                        <p className="mt-2 text-sm text-slate-600">Create a dine-in table in the dashboard, then refresh this captain page.</p>
                    </div>
                </main>
            )}
        </>
    );
}
