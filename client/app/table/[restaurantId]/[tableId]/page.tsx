import mongoose from 'mongoose';
import { unstable_cache } from 'next/cache';
import { notFound } from 'next/navigation';
import { CustomerMenu } from '@/components/customer/CustomerMenu';
import dbConnect from '@/lib/db';
import MenuItem from '@/models/MenuItem';
import Restaurant from '@/models/Restaurant';
import Table from '@/models/Table';

// This is a public page, so it reads public fields from the same Mongo database
// used by the dashboard. It does not depend on the separate API server being up.
const getCachedMenu = (restaurantId: string) => unstable_cache(
    async () => {
        if (!mongoose.Types.ObjectId.isValid(restaurantId)) return [];
        await dbConnect();
        const items = await MenuItem.find({ restaurantId, isAvailable: true })
            .select('name description price category imageUrl aestheticImageUrl')
            .sort({ category: 1, name: 1 })
            .lean();
        return JSON.parse(JSON.stringify(items));
    },
    [`public-menu-${restaurantId}`],
    { tags: [`menu-${restaurantId}`], revalidate: 60 },
)();

const getCachedRestaurant = (id: string) => unstable_cache(
    async () => {
        if (!mongoose.Types.ObjectId.isValid(id)) return null;
        await dbConnect();
        const restaurant = await Restaurant.findById(id)
            .select('name description logoUrl coverImageUrl themeColor logoAccentColor accentSource fontFamily colorScheme')
            .lean();
        return restaurant ? JSON.parse(JSON.stringify(restaurant)) : null;
    },
    [`public-restaurant-${id}`],
    { tags: [`restaurant-${id}`], revalidate: 60 },
)();

const getCachedTable = (id: string) => unstable_cache(
    async () => {
        if (!mongoose.Types.ObjectId.isValid(id)) return null;
        await dbConnect();
        const table = await Table.findById(id)
            .select('_id restaurantId tableNumber isActive isTakeaway')
            .lean();
        return table ? JSON.parse(JSON.stringify(table)) : null;
    },
    [`public-table-${id}`],
    { tags: [`table-${id}`], revalidate: 60 },
)();

export default async function CustomerTablePage(props: {
    params: Promise<{ restaurantId: string; tableId: string }>;
}) {
    const params = await props.params;
    if (!mongoose.Types.ObjectId.isValid(params.restaurantId) || !mongoose.Types.ObjectId.isValid(params.tableId)) {
        notFound();
    }

    const [restaurant, table, menuItems] = await Promise.all([
        getCachedRestaurant(params.restaurantId),
        getCachedTable(params.tableId),
        getCachedMenu(params.restaurantId),
    ]);

    if (!restaurant || !table || String(table.restaurantId) !== String(restaurant._id)) {
        notFound();
    }

    return <CustomerMenu restaurant={restaurant} table={table} menuItems={menuItems} />;
}
