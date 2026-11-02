import { auth } from '@/lib/auth';
import dbConnect from '@/lib/db';
import mongoose from 'mongoose';
import InventoryItem from '@/models/InventoryItem';
import KitchenDepartment from '@/models/KitchenDepartment';
import ProcurementDocument from '@/models/ProcurementDocument';
import StockMovement from '@/models/StockMovement';
import ExcelJS from 'exceljs';

export const runtime = 'nodejs';

const istDate = new Intl.DateTimeFormat('en-IN', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
});

const round2 = (value: number) => Math.round((Number(value) + Number.EPSILON) * 100) / 100;
const safeCell = (value: string) => /^[\s]*[=+\-@]/.test(value) ? `'${value}` : value;

function styleHeader(sheet: ExcelJS.Worksheet) {
    const header = sheet.getRow(1);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1E293B' } };
    header.height = 26;
    header.alignment = { vertical: 'middle', wrapText: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    if (sheet.columnCount) sheet.autoFilter = `A1:${sheet.getColumn(sheet.columnCount).letter}${Math.max(1, sheet.rowCount)}`;
}

function numberFormats(sheet: ExcelJS.Worksheet, columns: string[]) {
    for (const column of columns) sheet.getColumn(column).numFmt = '#,##0.00;[Red]-#,##0.00;–';
}

function monthBounds(month: string) {
    const match = /^(\d{4})-(\d{2})$/.exec(month);
    if (!match) return null;
    const year = Number(match[1]);
    const monthNumber = Number(match[2]);
    if (monthNumber < 1 || monthNumber > 12) return null;
    const indiaOffsetMs = 330 * 60 * 1000;
    return {
        start: new Date(Date.UTC(year, monthNumber - 1, 1) - indiaOffsetMs),
        end: new Date(Date.UTC(year, monthNumber, 1) - indiaOffsetMs),
    };
}

async function exportMonthlyInventory(restaurantId: string, month: string) {
    const bounds = monthBounds(month);
    if (!bounds) return new Response('Choose a valid month in YYYY-MM format', { status: 400 });
    const { start, end } = bounds;
    const restaurantObjectId = new mongoose.Types.ObjectId(restaurantId);

    const [items, departments, groupedMovements] = await Promise.all([
        InventoryItem.find({ restaurantId }).select('name category unit costPerUnit currentStock isActive').sort({ name: 1 }).lean(),
        KitchenDepartment.find({ restaurantId }).select('name').lean(),
        StockMovement.aggregate([
            {
                $match: {
                    restaurantId: restaurantObjectId,
                    $or: [
                        { movementDate: { $lt: end } },
                        { movementDate: null, createdAt: { $lt: end } },
                    ],
                },
            },
            {
                $addFields: {
                    effectiveDate: { $ifNull: ['$movementDate', '$createdAt'] },
                    locationDepartmentId: {
                        $cond: [
                            { $regexMatch: { input: { $ifNull: ['$note', ''] }, regex: '^Returned after requisition edit' } },
                            { $cond: [{ $eq: ['$type', 'transfer_out'] }, { $ifNull: ['$departmentId', null] }, null] },
                            { $cond: [{ $eq: ['$type', 'transfer_out'] }, null, { $ifNull: ['$departmentId', null] }] },
                        ],
                    },
                },
            },
            { $match: { effectiveDate: { $lt: end } } },
            { $sort: { inventoryItemId: 1, locationDepartmentId: 1, effectiveDate: 1, createdAt: 1, _id: 1 } },
            {
                $group: {
                    _id: {
                        inventoryItemId: '$inventoryItemId',
                        departmentId: '$locationDepartmentId',
                    },
                    firstStockBefore: { $first: '$stockBefore' },
                    openingMovements: {
                        $sum: { $cond: [{ $lt: ['$effectiveDate', start] }, '$quantity', 0] },
                    },
                    periodNet: {
                        $sum: { $cond: [{ $gte: ['$effectiveDate', start] }, '$quantity', 0] },
                    },
                    purchases: {
                        $sum: { $cond: [{ $and: [{ $gte: ['$effectiveDate', start] }, { $eq: ['$type', 'purchase'] }] }, '$quantity', 0] },
                    },
                    transfersToKitchen: {
                        $sum: { $cond: [{ $and: [{ $gte: ['$effectiveDate', start] }, { $eq: ['$type', 'transfer_out'] }, { $not: [{ $regexMatch: { input: { $ifNull: ['$note', ''] }, regex: '^Returned after requisition edit' } }] }] }, { $abs: '$quantity' }, 0] },
                    },
                    transfersFromKitchen: {
                        $sum: { $cond: [{ $and: [{ $gte: ['$effectiveDate', start] }, { $eq: ['$type', 'transfer_in'] }, { $regexMatch: { input: { $ifNull: ['$note', ''] }, regex: '^Returned after requisition edit' } }] }, '$quantity', 0] },
                    },
                    kitchenReceipts: {
                        $sum: { $cond: [{ $and: [{ $gte: ['$effectiveDate', start] }, { $eq: ['$type', 'transfer_in'] }, { $not: [{ $regexMatch: { input: { $ifNull: ['$note', ''] }, regex: '^Returned after requisition edit' } }] }] }, '$quantity', 0] },
                    },
                    kitchenReturns: {
                        $sum: { $cond: [{ $and: [{ $gte: ['$effectiveDate', start] }, { $eq: ['$type', 'transfer_out'] }, { $regexMatch: { input: { $ifNull: ['$note', ''] }, regex: '^Returned after requisition edit' } }] }, { $abs: '$quantity' }, 0] },
                    },
                    usage: {
                        $sum: { $cond: [{ $and: [{ $gte: ['$effectiveDate', start] }, { $eq: ['$type', 'usage'] }] }, { $abs: '$quantity' }, 0] },
                    },
                    wastage: {
                        $sum: { $cond: [{ $and: [{ $gte: ['$effectiveDate', start] }, { $eq: ['$type', 'wastage'] }] }, { $abs: '$quantity' }, 0] },
                    },
                    corrections: {
                        $sum: { $cond: [{ $and: [{ $gte: ['$effectiveDate', start] }, { $eq: ['$type', 'correction'] }] }, '$quantity', 0] },
                    },
                    returns: {
                        $sum: { $cond: [{ $and: [{ $gte: ['$effectiveDate', start] }, { $eq: ['$type', 'return'] }] }, '$quantity', 0] },
                    },
                    ledgerRows: { $sum: 1 },
                },
            },
        ]),
    ]);

    const itemById = new Map(items.map((item) => [String(item._id), item]));
    const departmentById = new Map(departments.map((department) => [String(department._id), String(department.name)]));
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'BitByte';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Inventory balances', { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = [
        { header: 'Inventory item', key: 'item', width: 28 },
        { header: 'Category', key: 'category', width: 20 },
        { header: 'Unit', key: 'unit', width: 12 },
        { header: 'Location', key: 'location', width: 24 },
        { header: 'Opening quantity', key: 'opening', width: 18 },
        { header: 'Purchases received', key: 'purchases', width: 20 },
        { header: 'Issued to kitchen', key: 'issued', width: 18 },
        { header: 'Received from Store', key: 'transfersIn', width: 21 },
        { header: 'Returned to Store', key: 'kitchenReturns', width: 18 },
        { header: 'Returned from Kitchen', key: 'transfersFromKitchen', width: 22 },
        { header: 'Menu usage', key: 'usage', width: 15 },
        { header: 'Wastage', key: 'wastage', width: 14 },
        { header: 'Other corrections', key: 'corrections', width: 19 },
        { header: 'Returns', key: 'returns', width: 13 },
        { header: 'Closing quantity', key: 'closing', width: 18 },
        { header: 'Current avg. cost (₹/unit)', key: 'cost', width: 24 },
        { header: 'Opening value (₹)*', key: 'openingValue', width: 19 },
        { header: 'Closing value (₹)*', key: 'closingValue', width: 19 },
    ];

    let openingValueTotal = 0;
    let closingValueTotal = 0;
    const seenItems = new Set<string>();
    for (const movement of groupedMovements) {
        const itemId = String(movement._id.inventoryItemId);
        const item = itemById.get(itemId);
        if (!item) continue;
        seenItems.add(itemId);
        const opening = Number(movement.firstStockBefore || 0) + Number(movement.openingMovements || 0);
        const closing = opening + Number(movement.periodNet || 0);
        const cost = Number(item.costPerUnit || 0);
        const openingValue = round2(opening * cost);
        const closingValue = round2(closing * cost);
        openingValueTotal += openingValue;
        closingValueTotal += closingValue;
        const departmentId = movement._id.departmentId ? String(movement._id.departmentId) : '';
        const location = departmentId ? `Kitchen · ${departmentById.get(departmentId) || 'Archived department'}` : 'Store';
        sheet.addRow({
            item: safeCell(String(item.name || 'Unnamed item')),
            category: safeCell(String(item.category || 'General')),
            unit: String(item.unit || ''), location,
            opening: round2(opening), purchases: round2(movement.purchases),
            issued: round2(movement.transfersToKitchen), transfersIn: round2(movement.kitchenReceipts),
            kitchenReturns: round2(movement.kitchenReturns), transfersFromKitchen: round2(movement.transfersFromKitchen),
            usage: round2(movement.usage), wastage: round2(movement.wastage),
            corrections: round2(movement.corrections), returns: round2(movement.returns),
            closing: round2(closing), cost, openingValue, closingValue,
        });
    }

    const untrackedItems = items.filter((item) => Number(item.currentStock || 0) > 0 && !seenItems.has(String(item._id)));
    if (sheet.rowCount > 1) {
        const total = sheet.addRow({ item: 'TOTAL INVENTORY VALUE', openingValue: round2(openingValueTotal), closingValue: round2(closingValueTotal) });
        total.font = { bold: true };
        total.getCell(1).alignment = { horizontal: 'right' };
    }
    styleHeader(sheet);
    numberFormats(sheet, ['opening', 'purchases', 'issued', 'transfersIn', 'kitchenReturns', 'transfersFromKitchen', 'usage', 'wastage', 'corrections', 'returns', 'closing', 'cost', 'openingValue', 'closingValue']);

    const summary = workbook.addWorksheet('Notes', { views: [{ state: 'frozen', ySplit: 1 }] });
    summary.columns = [{ width: 35 }, { width: 100 }];
    summary.addRows([
        ['Monthly inventory balance', month],
        ['Period basis', 'Stock movement date; missing dates use the record creation date. Dates are reported in IST.'],
        ['Opening quantity', 'Opening stock is reconstructed from the first recorded stock snapshot and all prior stock movements for each item and location.'],
        ['Closing quantity', 'Opening quantity plus the signed movements recorded during the selected month. Store and each kitchen department are shown separately.'],
        ['Inventory valuation', '* Values use the item’s current average cost per unit. Historical cost snapshots are not stored for every date, so values are estimates.'],
        ['Items needing opening stock', untrackedItems.length ? `${untrackedItems.length} item(s) have current stock but no movement ledger. Their historical balances cannot be reconstructed and they are excluded from the balance sheet.` : 'None detected.'],
        ...(untrackedItems.length ? [['Untracked item names', untrackedItems.map((item) => String(item.name || 'Unnamed item')).join(', ')] as [string, string]] : []),
        ['Generated', istDate.format(new Date())],
    ]);
    summary.getColumn(1).font = { bold: true, color: { argb: 'FF334155' } };
    summary.getColumn(2).alignment = { wrapText: true, vertical: 'top' };
    summary.getRow(1).font = { bold: true, size: 14 };
    summary.getRow(6).height = 38;

    const buffer = await workbook.xlsx.writeBuffer();
    return new Response(new Uint8Array(buffer), {
        headers: {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': `attachment; filename="BitByte-inventory-balance-${month}.xlsx"`,
            'Cache-Control': 'private, no-store',
        },
    });
}

async function exportPurchaseOrders(restaurantId: string) {
    const documents = await ProcurementDocument.find({ restaurantId, type: 'purchase_order' })
        .select('status reference supplier vendorBillNumber invoiceDate documentDate entrySource notes lines payments createdAt')
        .sort({ createdAt: -1 })
        .lean();

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'BitByte';
    workbook.created = new Date();
    const sheet = workbook.addWorksheet('All purchase orders', { views: [{ state: 'frozen', ySplit: 1 }], pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1 } });
    sheet.columns = [
        { header: 'Reference', key: 'reference', width: 23 },
        { header: 'Entry type', key: 'entryType', width: 20 },
        { header: 'Status', key: 'status', width: 20 },
        { header: 'Supplier', key: 'supplier', width: 26 },
        { header: 'Supplier invoice', key: 'invoice', width: 20 },
        { header: 'Order / bill date (IST)', key: 'date', width: 22 },
        { header: 'Item', key: 'item', width: 28 },
        { header: 'Category', key: 'category', width: 20 },
        { header: 'Unit', key: 'unit', width: 12 },
        { header: 'Ordered quantity', key: 'ordered', width: 18 },
        { header: 'Received quantity', key: 'received', width: 18 },
        { header: 'Unit cost (₹)', key: 'unitCost', width: 16 },
        { header: 'Ordered value (₹)', key: 'orderedValue', width: 18 },
        { header: 'Received value (₹)', key: 'receivedValue', width: 19 },
        { header: 'Paid (₹)', key: 'paid', width: 15 },
        { header: 'Balance due (₹)', key: 'due', width: 17 },
        { header: 'Notes', key: 'notes', width: 42 },
    ];

    let lineCount = 0;
    let orderValueTotal = 0;
    let receivedValueTotal = 0;
    let paidTotal = 0;
    for (const document of documents) {
        const paid = round2((document.payments || []).reduce((sum, payment) => sum + Number(payment.amount || 0), 0));
        const reference = String(document.reference || '');
        const source = document.entrySource === 'supplier_bill' || reference.startsWith('BILL-') ? 'Supplier bill' : 'Vendor order';
        const dateValue = document.invoiceDate || document.documentDate || document.createdAt;
        const lines = document.lines?.length ? document.lines : [{ itemName: 'No line items', category: '', unit: '', orderedQuantity: 0, receivedQuantity: 0, unitCost: 0 }];
        const documentReceivedValue = round2(lines.reduce((sum, line) => sum + Number(line.receivedQuantity || 0) * Number(line.unitCost || 0), 0));
        for (const line of lines) {
            const orderedValue = round2(Number(line.orderedQuantity || 0) * Number(line.unitCost || 0));
            const receivedValue = round2(Number(line.receivedQuantity || 0) * Number(line.unitCost || 0));
            orderValueTotal += orderedValue;
            receivedValueTotal += receivedValue;
            lineCount++;
            sheet.addRow({
                reference: safeCell(reference),
                entryType: source,
                status: String(document.status || '').replaceAll('_', ' '),
                supplier: safeCell(String(document.supplier || '')),
                invoice: safeCell(String(document.vendorBillNumber || '')),
                date: dateValue ? istDate.format(new Date(dateValue)) : '',
                item: safeCell(String(line.itemName || '')),
                category: safeCell(String(line.category || '')),
                unit: String(line.unit || ''),
                ordered: round2(Number(line.orderedQuantity || 0)),
                received: round2(Number(line.receivedQuantity || 0)),
                unitCost: round2(Number(line.unitCost || 0)),
                orderedValue, receivedValue,
                paid: line === lines[0] ? paid : '',
                due: line === lines[0] ? round2(Math.max(0, documentReceivedValue - paid)) : '',
                notes: safeCell(String(document.notes || '')),
            });
        }
        paidTotal += paid;
    }
    styleHeader(sheet);
    numberFormats(sheet, ['ordered', 'received', 'unitCost', 'orderedValue', 'receivedValue', 'paid', 'due']);

    const summary = workbook.addWorksheet('Summary');
    summary.columns = [{ width: 34 }, { width: 26 }];
    summary.addRows([
        ['Purchase order export', 'All recorded vendor orders and supplier bills'],
        ['Purchase documents', documents.length],
        ['Line items', lineCount],
        ['Total ordered value (₹)', round2(orderValueTotal)],
        ['Total received value (₹)', round2(receivedValueTotal)],
        ['Payments recorded (₹)', round2(paidTotal)],
        ['Generated (IST)', istDate.format(new Date())],
    ]);
    summary.getRow(1).font = { bold: true, size: 14 };
    summary.getColumn(1).font = { bold: true, color: { argb: 'FF334155' } };
    for (const rowNumber of [4, 5, 6]) summary.getCell(`B${rowNumber}`).numFmt = '"₹"#,##0.00';

    const buffer = await workbook.xlsx.writeBuffer();
    const today = istDate.format(new Date()).replaceAll('/', '-');
    return new Response(new Uint8Array(buffer), {
        headers: {
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'Content-Disposition': `attachment; filename="BitByte-all-purchase-orders-${today}.xlsx"`,
            'Cache-Control': 'private, no-store',
        },
    });
}

export async function GET(request: Request) {
    const session = await auth();
    if (!session?.user?.restaurantId || session.user.role !== 'restaurant_owner') {
        return new Response('Unauthorized', { status: 401 });
    }

    try {
        await dbConnect();
        const url = new URL(request.url);
        const type = url.searchParams.get('type');
        if (type === 'inventory-balance') {
            return await exportMonthlyInventory(String(session.user.restaurantId), url.searchParams.get('month') || '');
        }
        if (type === 'purchase-orders') {
            return await exportPurchaseOrders(String(session.user.restaurantId));
        }
        return new Response('Choose an available Store export', { status: 400 });
    } catch (error) {
        console.error('Store export failed:', error);
        return new Response('Could not generate the Store export', { status: 500 });
    }
}
