'use server';

import mongoose from 'mongoose';
import { randomBytes } from 'crypto';
import { revalidatePath, updateTag } from 'next/cache';
import { auth } from '@/lib/auth';
import dbConnect from '@/lib/db';
import Table from '@/models/Table';

async function getRestaurantId() {
    const session = await auth();
    const value = String(session?.user?.restaurantId || '');
    if (!mongoose.Types.ObjectId.isValid(value)) return null;
    return new mongoose.Types.ObjectId(value);
}

function isDuplicateKey(error: unknown) {
    return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: number }).code === 11000);
}

function refreshTableData(ids: string[] = []) {
    revalidatePath('/dashboard/tables');
    revalidatePath('/dashboard');
    for (const id of ids) updateTag(`table-${id}`);
}

/** Public QR page data; no API-server cookie or BACKEND_URL is needed. */
export async function getPublicTable(id: string) {
    try {
        if (!mongoose.Types.ObjectId.isValid(id)) return null;
        await dbConnect();
        const table = await Table.findById(id)
            .select('_id restaurantId tableNumber isActive isTakeaway')
            .lean();
        if (!table) return null;
        return JSON.parse(JSON.stringify(table));
    } catch (error) {
        console.error('Get public table error:', error);
        return null;
    }
}

export async function createTable(tableNumberInput: string) {
    try {
        const restaurantId = await getRestaurantId();
        if (!restaurantId) return { success: false, error: 'Your session has expired. Sign in again and retry.' };

        const tableNumber = typeof tableNumberInput === 'string'
            ? tableNumberInput.trim().replace(/\s+/g, ' ')
            : '';
        if (!tableNumber) return { success: false, error: 'Enter a table label.' };
        if (tableNumber.length > 40) return { success: false, error: 'Table labels must be 40 characters or fewer.' };
        if (tableNumber.toLowerCase() === '__takeaway__') return { success: false, error: 'That label is reserved for takeaway.' };

        await dbConnect();
        if (await Table.exists({ restaurantId, tableNumber })) {
            return { success: false, error: 'That table label already exists. Choose a different label.' };
        }
        const table = await Table.create({ restaurantId, tableNumber });
        refreshTableData([String(table._id)]);
        return {
            success: true,
            data: {
                _id: String(table._id),
                tableNumber: table.tableNumber,
                isActive: table.isActive,
                isTakeaway: false,
            },
        };
    } catch (error) {
        if (isDuplicateKey(error)) return { success: false, error: 'That table label already exists. Choose a different label.' };
        console.error('Create table error:', error);
        return { success: false, error: 'Could not save the table. Check the database connection and try again.' };
    }
}

/** Add consecutively numbered tables; roll back the batch if any write fails. */
export async function createTables(countInput: number) {
    const count = Number(countInput);
    if (!Number.isInteger(count) || count < 1 || count > 50) {
        return { success: false, error: 'Choose between 1 and 50 tables.' };
    }

    let restaurantId: mongoose.Types.ObjectId | null = null;
    const createdIds: mongoose.Types.ObjectId[] = [];
    try {
        restaurantId = await getRestaurantId();
        if (!restaurantId) return { success: false, error: 'Your session has expired. Sign in again and retry.' };
        await dbConnect();

        const existing = await Table.find({ restaurantId, isTakeaway: { $ne: true } })
            .select('tableNumber').lean();
        const numericNumbers = existing
            .map(({ tableNumber }) => /^\d+$/.test(tableNumber) ? Number(tableNumber) : NaN)
            .filter((number) => Number.isSafeInteger(number) && number > 0);
        let nextNumber = (numericNumbers.length ? Math.max(...numericNumbers) : 0) + 1;
        const tables: { _id: string; tableNumber: string; isActive: boolean; isTakeaway: boolean }[] = [];

        while (tables.length < count) {
            let saved = false;
            for (let attempt = 0; attempt < 10 && !saved; attempt += 1) {
                const tableNumber = String(nextNumber++);
                try {
                    if (await Table.exists({ restaurantId, tableNumber })) continue;
                    const table = await Table.create({ restaurantId, tableNumber });
                    createdIds.push(table._id as mongoose.Types.ObjectId);
                    tables.push({ _id: String(table._id), tableNumber, isActive: table.isActive, isTakeaway: false });
                    saved = true;
                } catch (error) {
                    if (!isDuplicateKey(error)) throw error;
                }
            }
            if (!saved) throw new Error('Could not reserve the next available table numbers.');
        }

        refreshTableData(tables.map(({ _id }) => _id));
        return { success: true, tables };
    } catch (error) {
        if (restaurantId && createdIds.length) {
            await Table.deleteMany({ restaurantId, _id: { $in: createdIds } }).catch((rollbackError) => {
                console.error('Could not roll back incomplete table batch:', rollbackError);
            });
        }
        console.error('Create tables error:', error);
        return { success: false, error: 'Could not add the tables. Check the database connection and try again.' };
    }
}

export async function deleteTable(id: string) {
    try {
        const restaurantId = await getRestaurantId();
        if (!restaurantId) return { success: false, error: 'Your session has expired. Sign in again and retry.' };
        if (!mongoose.Types.ObjectId.isValid(id)) return { success: false, error: 'Invalid table.' };
        await dbConnect();

        const deleted = await Table.findOneAndDelete({
            _id: id,
            restaurantId,
            isTakeaway: { $ne: true },
        }).select('_id');
        if (!deleted) return { success: false, error: 'Table not found.' };

        refreshTableData([id]);
        return { success: true };
    } catch (error) {
        console.error('Delete table error:', error);
        return { success: false, error: 'Could not delete the table. Try again.' };
    }
}

export async function toggleTableStatus(id: string) {
    try {
        const restaurantId = await getRestaurantId();
        if (!restaurantId) return { success: false, error: 'Your session has expired. Sign in again and retry.' };
        if (!mongoose.Types.ObjectId.isValid(id)) return { success: false, error: 'Invalid table.' };
        await dbConnect();

        const table = await Table.findOne({ _id: id, restaurantId, isTakeaway: { $ne: true } });
        if (!table) return { success: false, error: 'Table not found.' };
        table.isActive = !table.isActive;
        await table.save();

        refreshTableData([id]);
        return { success: true, isActive: table.isActive };
    } catch (error) {
        console.error('Toggle table status error:', error);
        return { success: false, error: 'Could not update the table. Try again.' };
    }
}

/** Return the signed-in owner's private captain URL token for one active dine-in table. */
export async function getCaptainLinkToken(id: string) {
    try {
        const restaurantId = await getRestaurantId();
        if (!restaurantId) return { success: false, error: 'Your session has expired. Sign in again.' };
        if (!mongoose.Types.ObjectId.isValid(id)) return { success: false, error: 'Invalid table.' };
        await dbConnect();

        const table = await Table.findOne({
            _id: id,
            restaurantId,
            isTakeaway: { $ne: true },
            isActive: true,
        }).select('+captainToken');
        if (!table) return { success: false, error: 'Active table not found. Check the table and try again.' };

        if (!table.captainToken) {
            table.captainToken = randomBytes(32).toString('hex');
            await table.save();
        }
        return { success: true, token: table.captainToken };
    } catch (error) {
        console.error('Get captain table link error:', error);
        return { success: false, error: 'Could not create the captain link. Try again.' };
    }
}
