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

export type ManagementPeriod = 'week' | 'month';

function periodRange(period: ManagementPeriod, anchor = new Date()) {
    const anchorDate = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate()));
    const start = new Date(anchorDate);
    if (period === 'month') start.setUTCDate(1);
    else {
        const mondayOffset = (start.getUTCDay() + 6) % 7;
        start.setUTCDate(start.getUTCDate() - mondayOffset);
    }
    const end = period === 'month'
        ? new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1))
        : new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
    const fmt = (date: Date) => date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    return { start, end, label: `${fmt(start)} – ${fmt(new Date(end.getTime() - 1))}` };
}

const zero = { sales: 0, orders: 0, cogs: 0, wastage: 0, purchases: 0, expenses: 0, cashSales: 0 };

export async function getManagementReport(periodInput: ManagementPeriod, anchorDateInput?: string) {
    try {
        const session = await auth();
        if (!session?.user?.restaurantId) return { success: false as const, error: 'Please sign in again.' };
        await dbConnect();
        const restaurantId = new mongoose.Types.ObjectId(String(session.user.restaurantId));
        const period: ManagementPeriod = periodInput === 'week' ? 'week' : 'month';
        const requestedDate = anchorDateInput ? new Date(anchorDateInput) : new Date();
        const range = periodRange(period, Number.isNaN(requestedDate.getTime()) ? new Date() : requestedDate);
        const settings = await FinancialSettings.findOne({ restaurantId }).lean();
        const openingDate = settings?.openingDate || new Date();

        const settledOrderMatch = { restaurantId, status: { $in: ['served', 'completed'] } };
        const [periodSales, openingSales, currentReceivables, periodStock, openingStock, periodEntries, openingEntries, inventory, kitchenStocks, purchaseOrders, settledOrders, menuCatalog, inventoryCatalog, periodMovements] = await Promise.all([
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
                { $match: { restaurantId, createdAt: { $gte: range.start, $lt: range.end } } },
                { $group: { _id: null,
                    cogs: { $sum: { $cond: [{ $eq: ['$type', 'usage'] }, { $multiply: [{ $abs: '$quantity' }, { $ifNull: ['$unitCost', 0] }] }, 0] } },
                    wastage: { $sum: { $cond: [{ $eq: ['$type', 'wastage'] }, { $multiply: [{ $abs: '$quantity' }, { $ifNull: ['$unitCost', 0] }] }, 0] } },
                    purchases: { $sum: { $cond: [{ $eq: ['$type', 'purchase'] }, { $multiply: ['$quantity', { $ifNull: ['$unitCost', 0] }] }, 0] } },
                } },
            ]),
            StockMovement.aggregate([
                { $match: { restaurantId, createdAt: { $gte: openingDate } } },
                { $group: { _id: null,
                    cogs: { $sum: { $cond: [{ $eq: ['$type', 'usage'] }, { $multiply: [{ $abs: '$quantity' }, { $ifNull: ['$unitCost', 0] }] }, 0] } },
                    wastage: { $sum: { $cond: [{ $eq: ['$type', 'wastage'] }, { $multiply: [{ $abs: '$quantity' }, { $ifNull: ['$unitCost', 0] }] }, 0] } },
                    purchases: { $sum: { $cond: [{ $and: [{ $eq: ['$type', 'purchase'] }, { $eq: [{ $ifNull: ['$procurementDocumentId', null] }, null] }] }, { $multiply: ['$quantity', { $ifNull: ['$unitCost', 0] }] }, 0] } },
                } },
            ]),
            FinancialEntry.aggregate([
                { $match: { restaurantId, entryDate: { $gte: range.start, $lt: range.end } } },
                { $group: { _id: '$type', amount: { $sum: '$amount' } } },
            ]),
            FinancialEntry.aggregate([
                { $match: { restaurantId, entryDate: { $gte: openingDate } } },
                { $group: { _id: '$type', amount: { $sum: '$amount' } } },
            ]),
            InventoryItem.aggregate([
                { $match: { restaurantId, isActive: true } },
                { $group: { _id: null, value: { $sum: { $multiply: ['$currentStock', '$costPerUnit'] } } } },
            ]),
            KitchenStock.find({ restaurantId }).populate('inventoryItemId', 'costPerUnit').lean(),
            ProcurementDocument.find({ restaurantId, type: 'purchase_order', status: { $in: ['partially_received', 'received'] }, createdAt: { $gte: openingDate } })
                .select('lines payments').lean(),
            Order.find({ restaurantId, status: { $in: ['served' as const, 'completed' as const] }, createdAt: { $gte: range.start, $lt: range.end } }).select('items total checkout inventoryUsage').lean(),
            MenuItem.find({ restaurantId }).select('name recipe').lean(),
            InventoryItem.find({ restaurantId, isActive: true }).select('name unit costPerUnit wasteBehavior').lean(),
            StockMovement.find({ restaurantId, createdAt: { $gte: range.start, $lt: range.end } }).select('inventoryItemId orderId type quantity unitCost').lean(),
        ]);

        const entryAmount = (rows: { _id: string; amount: number }[], type: string) => Number(rows.find((row) => row._id === type)?.amount || 0);
        const pSales = Number(periodSales[0]?.sales || 0);
        const pOrders = Number(periodSales[0]?.orders || 0);
        const stock = periodStock[0] || zero;
        const entryPeriod = periodEntries as { _id: string; amount: number }[];
        const pExpenses = entryAmount(entryPeriod, 'expense');
        const orderCostRows = (settledOrders as any[]).filter((order) => Array.isArray(order.inventoryUsage));
        const settledOrderCogs = orderCostRows.reduce((sum, order) => sum + order.inventoryUsage.reduce((orderSum: number, part: any) => orderSum + Number(part.quantity || 0) * Number(part.unitCost || 0), 0), 0);
        const nonOrderUsageCogs = (periodMovements as any[]).filter((movement) => movement.type === 'usage' && !movement.orderId).reduce((sum, movement) => sum + Math.abs(Number(movement.quantity || 0)) * Number(movement.unitCost || 0), 0);
        const reportedCogs = orderCostRows.length ? settledOrderCogs + nonOrderUsageCogs : Number(stock.cogs || 0);
        const grossProfit = pSales - reportedCogs - Number(stock.wastage || 0);
        const netProfit = grossProfit - pExpenses;

        // Allocate each sold dish's menu sales across its recipe ingredients by
        // their share of recipe cost. This is a management attribution, not a
        // claim that ingredients are independently sold to customers.
        const contributionByItem = new Map<string, { itemName: string; unit: string; quantityUsed: number; allocatedSales: number; ingredientCost: number }>();
        const menuById = new Map(menuCatalog.map((item: any) => [String(item._id), item]));
        const stockById = new Map(inventoryCatalog.map((item: any) => [String(item._id), item]));
        for (const order of settledOrders as any[]) {
            for (const soldLine of order.items || []) {
                const menu = menuById.get(String(soldLine.menuItemId)) as any;
                const recipe = menu?.recipe || [];
                const sale = Number(soldLine.price || 0) * Number(soldLine.quantity || 0);
                const portions = recipe.map((part: any) => {
                    const stockItem = stockById.get(String(part.inventoryItemId)) as any;
                    return { part, stockItem, cost: Number(part.quantity || 0) * Number(stockItem?.costPerUnit || 0) };
                }).filter((row: any) => row.stockItem);
                const recipeCost = portions.reduce((sum: number, row: any) => sum + row.cost, 0);
                for (const row of portions as any[]) {
                    const id = String(row.part.inventoryItemId);
                    const current = contributionByItem.get(id) || { itemName: row.stockItem.name, unit: row.stockItem.unit, quantityUsed: 0, allocatedSales: 0, ingredientCost: 0 };
                    const used = Number(row.part.quantity || 0) * Number(soldLine.quantity || 0);
                    current.quantityUsed += used;
                    current.ingredientCost += used * Number(row.stockItem.costPerUnit || 0);
                    current.allocatedSales += sale * (recipeCost > 0 ? row.cost / recipeCost : 1 / portions.length);
                    contributionByItem.set(id, current);
                }
            }
        }
        const issuedByItem = new Map<string, number>();
        const consumedByItem = new Map<string, number>();
        const returnedByItem = new Map<string, number>();
        const recordedWasteByItem = new Map<string, number>();
        for (const movement of periodMovements as any[]) {
            const id = String(movement.inventoryItemId);
            if (movement.type === 'transfer_in') issuedByItem.set(id, (issuedByItem.get(id) || 0) + Number(movement.quantity || 0));
            if (movement.type === 'usage') consumedByItem.set(id, (consumedByItem.get(id) || 0) + Math.abs(Number(movement.quantity || 0)));
            if (movement.type === 'return' && movement.orderId) returnedByItem.set(id, (returnedByItem.get(id) || 0) + Math.abs(Number(movement.quantity || 0)));
            if (movement.type === 'wastage') recordedWasteByItem.set(id, (recordedWasteByItem.get(id) || 0) + Math.abs(Number(movement.quantity || 0)));
        }
        const estimatedWaste = inventoryCatalog.filter((item: any) => item.wasteBehavior === 'perishable').map((item: any) => {
            const id = String(item._id);
            const quantity = Math.max(0, (issuedByItem.get(id) || 0) - (consumedByItem.get(id) || 0) + (returnedByItem.get(id) || 0) - (recordedWasteByItem.get(id) || 0));
            return { inventoryItemId: id, itemName: item.name, unit: item.unit, quantity, cost: quantity * Number(item.costPerUnit || 0) };
        }).filter((item: any) => item.quantity > 0);
        const estimatedWasteCost = estimatedWaste.reduce((sum: number, item: any) => sum + item.cost, 0);

        const openingEntryRows = openingEntries as { _id: string; amount: number }[];
        const contributions = entryAmount(openingEntryRows, 'capital_contribution');
        const ownerDraws = entryAmount(openingEntryRows, 'owner_draw');
        const loansReceived = entryAmount(openingEntryRows, 'loan_received');
        const loanRepayments = entryAmount(openingEntryRows, 'loan_repayment');
        const allSales = Number(openingSales[0]?.sales || 0);
        const cashSales = Number(openingSales[0]?.cashSales || 0);
        const accumulated = openingStock[0] || zero;
        const expensesSinceOpening = entryAmount(openingEntryRows, 'expense');
        const accumulatedProfit = allSales - Number(accumulated.cogs || 0) - Number(accumulated.wastage || 0) - expensesSinceOpening;
        const procurementPayments = purchaseOrders.flatMap((po: any) => po.payments || []).filter((payment: any) => new Date(payment.paidAt) >= openingDate).reduce((sum: number, payment: any) => sum + Number(payment.amount || 0), 0);
        const supplierDue = purchaseOrders.reduce((sum: number, po: any) => {
            const receivedValue = (po.lines || []).reduce((lineSum: number, line: any) => lineSum + Number(line.receivedQuantity || 0) * Number(line.unitCost || 0), 0);
            const paidValue = (po.payments || []).reduce((lineSum: number, payment: any) => lineSum + Number(payment.amount || 0), 0);
            return sum + Math.max(0, receivedValue - paidValue);
        }, 0);
        const nonOrderPurchases = Number(accumulated.purchases || 0);
        const cash = Number(settings?.openingCash || 0) + cashSales + contributions + loansReceived - nonOrderPurchases - procurementPayments - expensesSinceOpening - ownerDraws - loanRepayments;
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
                    sales: pSales, orders: pOrders, cogs: reportedCogs, wastage: Number(stock.wastage || 0),
                    purchases: Number((periodStock[0] || zero).purchases || 0), expenses: pExpenses, grossProfit, netProfit,
                    grossMargin: pSales > 0 ? grossProfit / pSales * 100 : 0,
                    estimatedWasteCost,
                    estimatedWaste,
                    inventoryContribution: [...contributionByItem.entries()].map(([inventoryItemId, value]) => ({ inventoryItemId, ...value, contribution: value.allocatedSales - value.ingredientCost })).sort((a, b) => b.allocatedSales - a.allocatedSales),
                },
                balanceSheet: {
                    ready: Boolean(settings), asOf: settings?.openingDate ? settings.openingDate.toISOString() : null,
                    cash, inventory: inventoryValue, receivables, otherAssets: Number(settings?.otherAssets || 0), totalAssets,
                    supplierPayables: supplierDue + Number(settings?.openingPayables || 0), loans: Number(settings?.openingLoans || 0) + loansReceived - loanRepayments,
                    otherLiabilities: Number(settings?.otherLiabilities || 0), totalLiabilities, equity, totalLiabilitiesAndEquity: totalLiabilities + equity,
                },
            },
        };
    } catch (error: any) {
        console.error('Get management report error:', error);
        return { success: false as const, error: error?.message || 'Could not load management report.' };
    }
}
