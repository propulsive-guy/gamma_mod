'use server';

import mongoose from 'mongoose';
import { auth } from '@/lib/auth';
import dbConnect from '@/lib/db';
import Order from '@/models/Order';
import StockMovement from '@/models/StockMovement';
import InventoryItem from '@/models/InventoryItem';
import MenuItem from '@/models/MenuItem';
import FinancialEntry from '@/models/FinancialEntry';
import FinancialSettings from '@/models/FinancialSettings';
import ProcurementDocument from '@/models/ProcurementDocument';
import KitchenStock from '@/models/KitchenStock';
import InventoryCategory from '@/models/InventoryCategory';
import { canonicalExternalSalesChannel, canonicalMisExpenseCategory, MIS_EXPENSE_CATEGORIES } from '@/lib/managementMis';
import { effectiveExpiryDays } from '../../../shared/kitchenStockLots';
import { processKitchenStockExpiry } from '@/lib/kitchenStockLots';

export type ManagementPeriod = 'week' | 'month';

function periodRange(period: ManagementPeriod, anchor = new Date()) {
    const indiaOffset = 330 * 60 * 1000;
    const anchorCalendarDate = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate()));
    let startCalendarDate: Date;
    if (period === 'month') {
        startCalendarDate = new Date(Date.UTC(anchorCalendarDate.getUTCFullYear(), anchorCalendarDate.getUTCMonth(), 1));
    } else {
        const mondayOffset = (anchorCalendarDate.getUTCDay() + 6) % 7;
        startCalendarDate = new Date(anchorCalendarDate);
        startCalendarDate.setUTCDate(startCalendarDate.getUTCDate() - mondayOffset);
    }
    const start = new Date(startCalendarDate.getTime() - indiaOffset);
    const endCalendarDate = period === 'month'
        ? new Date(Date.UTC(startCalendarDate.getUTCFullYear(), startCalendarDate.getUTCMonth() + 1, 1))
        : new Date(startCalendarDate.getTime() + 7 * 24 * 60 * 60 * 1000);
    const end = new Date(endCalendarDate.getTime() - indiaOffset);
    const fmt = (date: Date) => date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' });
    return { start, end, label: `${fmt(start)} – ${fmt(new Date(end.getTime() - 1))}` };
}

function movementPeriodMatch(start: Date, end?: Date) {
    const range = end ? { $gte: start, $lt: end } : { $gte: start };
    return {
        $or: [
            { movementDate: range },
            { movementDate: { $exists: false }, createdAt: range },
        ],
    };
}

const round2 = (value: number) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const zero = { sales: 0, orders: 0, cogs: 0, wastage: 0, purchases: 0, expenses: 0, cashSales: 0 };

export async function getManagementReport(periodInput: ManagementPeriod, anchorDateInput?: string) {
    try {
        const session = await auth();
        if (!session?.user?.restaurantId) return { success: false as const, error: 'Please sign in again.' };
        await dbConnect();
        const restaurantId = new mongoose.Types.ObjectId(String(session.user.restaurantId));
        await processKitchenStockExpiry(restaurantId);
        const period: ManagementPeriod = periodInput === 'week' ? 'week' : 'month';
        const requestedDate = anchorDateInput ? new Date(anchorDateInput) : new Date();
        const range = periodRange(period, Number.isNaN(requestedDate.getTime()) ? new Date() : requestedDate);
        const settings = await FinancialSettings.findOne({ restaurantId }).lean();
        const openingDate = settings?.openingDate || new Date();

        const settledOrderMatch = { restaurantId, status: { $in: ['served', 'completed'] } };
        const [periodSales, openingSales, currentReceivables, openingStock, periodEntries, openingEntries, inventory, kitchenStocks, purchaseOrders, settledOrders, menuCatalog, inventoryCatalog, inventoryCategories, periodMovements] = await Promise.all([
            Order.aggregate([
                { $match: { ...settledOrderMatch, createdAt: { $gte: range.start, $lt: range.end } } },
                { $group: { _id: null, sales: { $sum: { $ifNull: ['$checkout.payableAmount', '$total'] } }, orders: { $sum: 1 } } },
            ]),
            Order.aggregate([
                { $match: { ...settledOrderMatch, createdAt: { $gte: openingDate } } },
                { $group: {
                    _id: null,
                    sales: { $sum: { $ifNull: ['$checkout.payableAmount', '$total'] } },
                    cashSales: { $sum: { $cond: [{ $eq: ['$paymentStatus', 'paid'] }, { $ifNull: ['$checkout.payableAmount', '$total'] }, 0] } },
                } },
            ]),
            Order.aggregate([
                { $match: { ...settledOrderMatch, paymentStatus: { $ne: 'paid' }, createdAt: { $gte: openingDate } } },
                { $group: { _id: null, amount: { $sum: { $ifNull: ['$checkout.payableAmount', '$total'] } } } },
            ]),
            StockMovement.aggregate([
                { $match: { restaurantId, ...movementPeriodMatch(openingDate) } },
                { $group: { _id: null,
                    cogs: { $sum: { $cond: [{ $eq: ['$type', 'usage'] }, { $multiply: [{ $abs: '$quantity' }, { $ifNull: ['$unitCost', 0] }] }, 0] } },
                    wastage: { $sum: { $cond: [{ $eq: ['$type', 'wastage'] }, { $multiply: [{ $abs: '$quantity' }, { $ifNull: ['$unitCost', 0] }] }, 0] } },
                    purchases: { $sum: { $cond: [{ $and: [{ $eq: ['$type', 'purchase'] }, { $eq: [{ $ifNull: ['$procurementDocumentId', null] }, null] }] }, { $multiply: ['$quantity', { $ifNull: ['$unitCost', 0] }] }, 0] } },
                } },
            ]),
            FinancialEntry.aggregate([
                { $match: { restaurantId, entryDate: { $gte: range.start, $lt: range.end } } },
                { $group: { _id: { type: '$type', category: '$category' }, amount: { $sum: '$amount' } } },
            ]),
            FinancialEntry.aggregate([
                { $match: { restaurantId, entryDate: { $gte: openingDate } } },
                { $group: { _id: { type: '$type', category: '$category' }, amount: { $sum: '$amount' } } },
            ]),
            InventoryItem.aggregate([
                { $match: { restaurantId, isActive: true } },
                { $group: { _id: null, value: { $sum: { $multiply: ['$currentStock', '$costPerUnit'] } } } },
            ]),
            KitchenStock.find({ restaurantId }).populate('inventoryItemId', 'costPerUnit').lean(),
            ProcurementDocument.find({ restaurantId, type: 'purchase_order', status: { $in: ['partially_received', 'received'] }, createdAt: { $gte: openingDate } })
                .select('lines payments').lean(),
            Order.find({ restaurantId, status: { $in: ['served' as const, 'completed' as const] }, createdAt: { $gte: range.start, $lt: range.end } }).select('items total checkout').select('+inventoryUsage +items.recipeSnapshot').lean(),
            MenuItem.find({ restaurantId }).select('name recipe').lean(),
            InventoryItem.find({ restaurantId }).select('name category unit costPerUnit expiryDays wasteBehavior').lean(),
            InventoryCategory.find({ restaurantId }).select('name').lean(),
            StockMovement.find({ restaurantId, ...movementPeriodMatch(range.start, range.end) }).select('inventoryItemId inventoryCategory orderId type quantity unitCost movementDate createdAt').lean(),
        ]);

        const entryAmount = (rows: { _id: string | { type: string; category?: string }; amount: number }[], type: string, category?: string) => rows.reduce((sum, row) => {
            const rowType = typeof row._id === 'string' ? row._id : row._id.type;
            const rowCategory = typeof row._id === 'string' ? '' : String(row._id.category || '');
            if (rowType !== type) return sum;
            if (category && rowCategory !== category) return sum;
            return sum + Number(row.amount || 0);
        }, 0);
        const externalRevenue = (rows: { _id: string | { type: string; category?: string }; amount: number }[], channel?: string) => rows.reduce((sum, row) => {
            const rowType = typeof row._id === 'string' ? row._id : row._id.type;
            const rowCategory = typeof row._id === 'string' ? '' : String(row._id.category || '');
            const normalizedChannel = canonicalExternalSalesChannel(rowCategory);
            return rowType === 'revenue' && (!channel || normalizedChannel === channel) ? sum + Number(row.amount || 0) : sum;
        }, 0);
        const pSales = Number(periodSales[0]?.sales || 0);
        const pOrders = Number(periodSales[0]?.orders || 0);
        const entryPeriod = periodEntries as { _id: string | { type: string; category?: string }; amount: number }[];
        const partySales = externalRevenue(entryPeriod, 'Party Sale');
        const zomatoSales = externalRevenue(entryPeriod, 'Zomato');
        const grossSales = pSales + partySales + zomatoSales;
        const restaurantGst = pSales * 5 / 105;
        const netSales = grossSales - restaurantGst;
        const settledOrderRows = settledOrders as any[];
        const movementRows = periodMovements as any[];
        const menuById = new Map(menuCatalog.map((item: any) => [String(item._id), item]));
        const stockById = new Map(inventoryCatalog.map((item: any) => [String(item._id), item]));
        const categoryName = (snapshot: unknown, item?: any) => String(snapshot || item?.category || 'Uncategorized').trim() || 'Uncategorized';
        type CategoryPerformance = { category: string; purchases: number; purchaseLines: number; ingredientCost: number; recordedWasteCost: number; estimatedWasteCost: number; allocatedSales: number };
        const categoryPerformanceByName = new Map<string, CategoryPerformance>();
        const ensureCategory = (category: string) => {
            let row = categoryPerformanceByName.get(category);
            if (!row) {
                row = { category, purchases: 0, purchaseLines: 0, ingredientCost: 0, recordedWasteCost: 0, estimatedWasteCost: 0, allocatedSales: 0 };
                categoryPerformanceByName.set(category, row);
            }
            return row;
        };
        for (const category of inventoryCategories as any[]) ensureCategory(category.name);
        for (const item of inventoryCatalog as any[]) ensureCategory(categoryName(item.category));

        // Keep the Store's exact category names. MIS expense categories are for
        // overhead entries; inventory categories remain independent dimensions.
        let purchaseTotal = 0;
        for (const movement of movementRows) {
            if (movement.type !== 'purchase') continue;
            const item = stockById.get(String(movement.inventoryItemId)) as any;
            const category = categoryName(movement.inventoryCategory, item);
            const amount = Number(movement.quantity || 0) * Number(movement.unitCost || 0);
            purchaseTotal += amount;
            const performance = ensureCategory(category);
            performance.purchases += amount;
            performance.purchaseLines += 1;
        }

        const expenseRowsByCategory = new Map<string, { category: string; amount: number; recordedExpense: number; lines: number }>();
        for (const category of MIS_EXPENSE_CATEGORIES) expenseRowsByCategory.set(category, { category, amount: 0, recordedExpense: 0, lines: 0 });
        for (const entry of entryPeriod) {
            const type = typeof entry._id === 'string' ? entry._id : entry._id.type;
            const category = typeof entry._id === 'string' ? '' : String(entry._id.category || 'Miscellaneous');
            if (type !== 'expense') continue;
            const row = expenseRowsByCategory.get(canonicalMisExpenseCategory(category))!;
            row.recordedExpense += Number(entry.amount || 0);
            row.lines += 1;
        }
        for (const row of expenseRowsByCategory.values()) row.amount = row.recordedExpense;
        const misExpenseCategories = [...expenseRowsByCategory.values()];
        const recordedOperatingExpenses = misExpenseCategories.reduce((sum, row) => sum + row.recordedExpense, 0);
        const salary = expenseRowsByCategory.get('Salary')!.recordedExpense;
        const operationalExpenses = recordedOperatingExpenses - salary;

        const contributionByItem = new Map<string, { itemName: string; category: string; unit: string; quantityUsed: number; recordedWasteQuantity: number; allocatedSales: number; ingredientCost: number; recordedWasteCost: number }>();
        const ensureItemContribution = (id: string, item: any, category: string) => {
            let row = contributionByItem.get(id);
            if (!row) {
                row = { itemName: item?.name || 'Inventory item', category, unit: item?.unit || '', quantityUsed: 0, recordedWasteQuantity: 0, allocatedSales: 0, ingredientCost: 0, recordedWasteCost: 0 };
                contributionByItem.set(id, row);
            }
            return row;
        };
        const usageByOrderId = new Map<string, any[]>();
        const settledOrderIds = new Set(settledOrderRows.map((order) => String(order._id)));
        for (const movement of movementRows) {
            if (movement.type !== 'usage' || !movement.orderId) continue;
            const orderId = String(movement.orderId);
            if (!settledOrderIds.has(orderId)) continue;
            const rows = usageByOrderId.get(orderId) || [];
            rows.push(movement);
            usageByOrderId.set(orderId, rows);
        }
        let reportedCogs = 0;
        const addUsage = (part: any) => {
            const id = String(part.inventoryItemId);
            const item = stockById.get(id) as any;
            const category = categoryName(part.inventoryCategory, item);
            const quantity = Math.abs(Number(part.quantity || 0));
            const unitCost = Number(part.unitCost ?? item?.costPerUnit ?? 0);
            const cost = quantity * unitCost;
            reportedCogs += cost;
            ensureCategory(category).ingredientCost += cost;
            const row = ensureItemContribution(id, item, category);
            row.quantityUsed += quantity;
            row.ingredientCost += cost;
        };

        for (const order of settledOrderRows) {
            const snapshotUsage = Array.isArray(order.inventoryUsage) ? order.inventoryUsage : [];
            const movementUsage = usageByOrderId.get(String(order._id)) || [];
            const actualUsage = snapshotUsage.length ? snapshotUsage : movementUsage;
            const unitCostByItem = new Map<string, number>();
            const categoryByItem = new Map<string, string>();
            for (const part of actualUsage) {
                unitCostByItem.set(String(part.inventoryItemId), Number(part.unitCost || 0));
                if (part.inventoryCategory) categoryByItem.set(String(part.inventoryItemId), String(part.inventoryCategory));
                addUsage(part);
            }

            const recipeUsage = new Map<string, { inventoryItemId: string; quantity: number; item: any; unitCost: number; inventoryCategory: string }>();
            const orderSubtotal = (order.items || []).reduce((sum: number, line: any) => sum + Number(line.price || 0) * Number(line.quantity || 0), 0);
            const discountFactor = orderSubtotal > 0
                ? Math.max(0, (orderSubtotal - Number(order.checkout?.discountAmount || 0)) / orderSubtotal)
                : 1;
            for (const soldLine of order.items || []) {
                const menu = menuById.get(String(soldLine.menuItemId)) as any;
                const recipe = Array.isArray(soldLine.recipeSnapshot) && soldLine.recipeSnapshot.length
                    ? soldLine.recipeSnapshot
                    : menu?.recipe || [];
                const sale = Number(soldLine.price || 0) * Number(soldLine.quantity || 0) * discountFactor;
                const portions = recipe.map((part: any) => {
                    const id = String(part.inventoryItemId);
                    const item = stockById.get(id) as any;
                    const unitCost = Number(part.unitCost ?? unitCostByItem.get(id) ?? item?.costPerUnit ?? 0);
                    const category = categoryName(part.inventoryCategory ?? categoryByItem.get(id), item);
                    return { part, item, id, unitCost, category, cost: Number(part.quantity || 0) * unitCost };
                }).filter((row: any) => row.item);
                const recipeCost = portions.reduce((sum: number, row: any) => sum + row.cost, 0);
                for (const row of portions as any[]) {
                    const used = Number(row.part.quantity || 0) * Number(soldLine.quantity || 0);
                    const category = row.category;
                    const performance = ensureCategory(category);
                    performance.allocatedSales += sale * (recipeCost > 0 ? row.cost / recipeCost : 1 / portions.length);
                    const itemContribution = ensureItemContribution(row.id, row.item, category);
                    itemContribution.allocatedSales += sale * (recipeCost > 0 ? row.cost / recipeCost : 1 / portions.length);
                    const fallback = recipeUsage.get(row.id) || { inventoryItemId: row.id, quantity: 0, item: row.item, unitCost: row.unitCost, inventoryCategory: row.category };
                    fallback.quantity += used;
                    recipeUsage.set(row.id, fallback);
                }
            }

            // Old orders can predate usage snapshots and movement logs. Use the
            // saved menu recipe as a best available historical cost estimate.
            if (!actualUsage.length) {
                for (const part of recipeUsage.values()) addUsage({ inventoryItemId: part.inventoryItemId, quantity: part.quantity, unitCost: part.unitCost, inventoryCategory: part.inventoryCategory });
            }
        }

        const issuedByItem = new Map<string, number>();
        const consumedByItem = new Map<string, number>();
        const returnedByItem = new Map<string, number>();
        const recordedWasteByItem = new Map<string, number>();
        let recordedWasteCost = 0;
        for (const movement of movementRows) {
            const id = String(movement.inventoryItemId);
            const item = stockById.get(id) as any;
            if (movement.type === 'usage' && !movement.orderId) addUsage(movement);
            if (movement.type === 'transfer_in') issuedByItem.set(id, (issuedByItem.get(id) || 0) + Number(movement.quantity || 0));
            if (movement.type === 'usage') consumedByItem.set(id, (consumedByItem.get(id) || 0) + Math.abs(Number(movement.quantity || 0)));
            if (movement.type === 'return' && movement.orderId) returnedByItem.set(id, (returnedByItem.get(id) || 0) + Math.abs(Number(movement.quantity || 0)));
            if (movement.type === 'wastage') {
                const quantity = Math.abs(Number(movement.quantity || 0));
                const cost = quantity * Number(movement.unitCost ?? item?.costPerUnit ?? 0);
                recordedWasteByItem.set(id, (recordedWasteByItem.get(id) || 0) + quantity);
                recordedWasteCost += cost;
                const category = categoryName(movement.inventoryCategory, item);
                const performance = ensureCategory(category);
                performance.recordedWasteCost += cost;
                const itemContribution = ensureItemContribution(id, item, category);
                itemContribution.recordedWasteCost += cost;
                itemContribution.recordedWasteQuantity += quantity;
            }
        }
        const estimatedWaste = inventoryCatalog.filter((item: any) => effectiveExpiryDays(item) === 1).map((item: any) => {
            const id = String(item._id);
            const quantity = Math.max(0, (issuedByItem.get(id) || 0) - (consumedByItem.get(id) || 0) + (returnedByItem.get(id) || 0) - (recordedWasteByItem.get(id) || 0));
            const cost = quantity * Number(item.costPerUnit || 0);
            if (quantity > 0) {
                const performance = ensureCategory(categoryName(undefined, item));
                performance.estimatedWasteCost += cost;
            }
            return { inventoryItemId: id, itemName: item.name, category: categoryName(undefined, item), unit: item.unit, quantity, cost };
        }).filter((item: any) => item.quantity > 0);
        const estimatedWasteCost = estimatedWaste.reduce((sum: number, item: any) => sum + item.cost, 0);
        const foodCost = reportedCogs + recordedWasteCost;
        const totalExpenses = foodCost + recordedOperatingExpenses;
        const profit = netSales - totalExpenses;
        const grossProfit = netSales - foodCost;
        const dayCount = Math.max(1, Math.round((range.end.getTime() - range.start.getTime()) / 86_400_000));
        const averageSalePerDay = netSales / dayCount;
        const averageExpensePerDay = totalExpenses / dayCount;

        const openingEntryRows = openingEntries as { _id: string | { type: string; category?: string }; amount: number }[];
        const contributions = entryAmount(openingEntryRows, 'capital_contribution');
        const ownerDraws = entryAmount(openingEntryRows, 'owner_draw');
        const loansReceived = entryAmount(openingEntryRows, 'loan_received');
        const loanRepayments = entryAmount(openingEntryRows, 'loan_repayment');
        const allSales = Number(openingSales[0]?.sales || 0);
        const cashSales = Number(openingSales[0]?.cashSales || 0);
        const externalSalesSinceOpening = externalRevenue(openingEntryRows);
        const accumulated = openingStock[0] || zero;
        const expensesSinceOpening = entryAmount(openingEntryRows, 'expense');
        const accumulatedProfit = allSales + externalSalesSinceOpening - Number(accumulated.cogs || 0) - Number(accumulated.wastage || 0) - expensesSinceOpening;
        const procurementPayments = purchaseOrders.flatMap((po: any) => po.payments || []).filter((payment: any) => new Date(payment.paidAt) >= openingDate).reduce((sum: number, payment: any) => sum + Number(payment.amount || 0), 0);
        const supplierDue = purchaseOrders.reduce((sum: number, po: any) => {
            const receivedValue = (po.lines || []).reduce((lineSum: number, line: any) => lineSum + Number(line.receivedQuantity || 0) * Number(line.unitCost || 0), 0);
            const paidValue = (po.payments || []).reduce((lineSum: number, payment: any) => lineSum + Number(payment.amount || 0), 0);
            return sum + Math.max(0, receivedValue - paidValue);
        }, 0);
        const nonOrderPurchases = Number(accumulated.purchases || 0);
        const cash = Number(settings?.openingCash || 0) + cashSales + externalSalesSinceOpening + contributions + loansReceived - nonOrderPurchases - procurementPayments - expensesSinceOpening - ownerDraws - loanRepayments;
        const receivables = Number(currentReceivables[0]?.amount || 0);
        const inventoryValue = Number(inventory[0]?.value || 0) + kitchenStocks.reduce((sum: number, row: any) => sum + Number(row.currentStock || 0) * Number(row.inventoryItemId?.costPerUnit || 0), 0);
        const totalAssets = cash + inventoryValue + receivables + Number(settings?.otherAssets || 0);
        const totalLiabilities = Number(settings?.openingPayables || 0) + Number(settings?.openingLoans || 0) + Number(settings?.otherLiabilities || 0) + supplierDue + loansReceived - loanRepayments;
        const openingEquity = Number(settings?.openingCash || 0) + Number(settings?.openingInventoryValue || 0) + Number(settings?.otherAssets || 0)
            - Number(settings?.openingPayables || 0) - Number(settings?.openingLoans || 0) - Number(settings?.otherLiabilities || 0);
        const equity = openingEquity + contributions - ownerDraws + accumulatedProfit;

        return {
            success: true as const,
            report: {
                period, label: range.label,
                mis: {
                    sales: round2(netSales), restaurantSales: round2(pSales), partySales: round2(partySales), zomatoSales: round2(zomatoSales),
                    grossSales: round2(grossSales), gst: round2(restaurantGst), netSales: round2(netSales), orders: pOrders,
                    cogs: round2(reportedCogs), wastage: round2(recordedWasteCost),
                    purchases: round2(purchaseTotal), expenses: round2(totalExpenses),
                    expenseCategories: misExpenseCategories.map((row) => ({
                        ...row, amount: round2(row.amount), recordedExpense: round2(row.recordedExpense),
                        percentage: netSales > 0 ? round2(row.amount / netSales * 100) : 0,
                    })),
                    operatingExpenses: round2(operationalExpenses), salary: round2(salary),
                    averageExpensePerDay: round2(averageExpensePerDay), averageSalePerDay: round2(averageSalePerDay),
                    foodCost: round2(foodCost), foodCostPercent: netSales > 0 ? round2(foodCost / netSales * 100) : 0,
                    grossProfit: round2(grossProfit), netProfit: round2(profit),
                    grossMargin: netSales > 0 ? round2(grossProfit / netSales * 100) : 0,
                    profitMargin: netSales > 0 ? round2(profit / netSales * 100) : 0,
                    estimatedWasteCost: round2(estimatedWasteCost),
                    estimatedWaste: estimatedWaste.map((item: any) => ({ ...item, quantity: round2(item.quantity), cost: round2(item.cost) })),
                    categoryPerformance: [...categoryPerformanceByName.values()].map((item) => ({
                        category: item.category, purchases: round2(item.purchases), purchaseLines: item.purchaseLines,
                        ingredientCost: round2(item.ingredientCost), recordedWasteCost: round2(item.recordedWasteCost),
                        estimatedWasteCost: round2(item.estimatedWasteCost), allocatedSales: round2(item.allocatedSales),
                        grossProfit: round2(item.allocatedSales - item.ingredientCost - item.recordedWasteCost),
                        grossMargin: item.allocatedSales > 0 ? round2((item.allocatedSales - item.ingredientCost - item.recordedWasteCost) / item.allocatedSales * 100) : 0,
                    })).sort((a, b) => b.allocatedSales - a.allocatedSales || b.purchases - a.purchases),
                    inventoryContribution: [...contributionByItem.entries()].map(([inventoryItemId, value]) => ({
                        inventoryItemId, itemName: value.itemName, category: value.category, unit: value.unit, quantityUsed: round2(value.quantityUsed), recordedWasteQuantity: round2(value.recordedWasteQuantity),
                        allocatedSales: round2(value.allocatedSales), ingredientCost: round2(value.ingredientCost), recordedWasteCost: round2(value.recordedWasteCost),
                        contribution: round2(value.allocatedSales - value.ingredientCost - value.recordedWasteCost),
                    })).sort((a, b) => b.allocatedSales - a.allocatedSales),
                },
                balanceSheet: {
                    ready: Boolean(settings), asOf: settings?.openingDate ? settings.openingDate.toISOString() : null,
                    cash: round2(cash), inventory: round2(inventoryValue), receivables: round2(receivables), otherAssets: round2(Number(settings?.otherAssets || 0)), totalAssets: round2(totalAssets),
                    supplierPayables: round2(supplierDue + Number(settings?.openingPayables || 0)), loans: round2(Number(settings?.openingLoans || 0) + loansReceived - loanRepayments),
                    otherLiabilities: round2(Number(settings?.otherLiabilities || 0)), totalLiabilities: round2(totalLiabilities), equity: round2(equity), totalLiabilitiesAndEquity: round2(totalLiabilities + equity),
                },
            },
        };
    } catch (error: any) {
        console.error('Get management report error:', error);
        return { success: false as const, error: error?.message || 'Could not load management report.' };
    }
}
