import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import dbConnect from '@/lib/db';
import Table from '@/models/Table';
import { TableList } from '@/components/dashboard/TableList';

export default async function TablesPage() {
    const session = await auth();

    if (!session || !session.user.restaurantId) {
        redirect('/auth/signin');
    }

    await dbConnect();

    await Table.findOneAndUpdate(
        { restaurantId: session.user.restaurantId, tableNumber: '__takeaway__' },
        { $set: { isTakeaway: true, isActive: true } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    const tables = await Table.find({
        restaurantId: session.user.restaurantId,
    })
        .select('_id tableNumber isActive isTakeaway')
        .sort({ tableNumber: 1 })
        .lean();

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-3xl font-bold text-gray-900 font-display">
                    Table Management
                </h1>
                <p className="text-gray-600 mt-1">
                    Manage your restaurant tables and QR codes
                </p>
            </div>

            <TableList
                initialTables={JSON.parse(JSON.stringify(tables))}
                restaurantId={session.user.restaurantId}
            />
        </div>
    );
}
