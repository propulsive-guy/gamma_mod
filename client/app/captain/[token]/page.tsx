import mongoose from 'mongoose';
import { notFound } from 'next/navigation';
import { CaptainOrderPage } from '@/components/customer/CaptainOrderPage';
import { CustomerMenu } from '@/components/customer/CustomerMenu';
import dbConnect from '@/lib/db';
import MenuItem from '@/models/MenuItem';
import Restaurant from '@/models/Restaurant';
import Table from '@/models/Table';

export const dynamic = 'force-dynamic';

/** One private waiter link for the restaurant; legacy table links still resolve. */
export default async function CaptainTablePage(props: { params: Promise<{ token: string }> }) {
    const { token } = await props.params;
    if (!/^[a-f0-9]{64}$/.test(token)) notFound();

    await dbConnect();
    const captainRestaurant = await Restaurant.findOne({ captainToken: token })
        .select('_id name description logoUrl coverImageUrl themeColor logoAccentColor accentSource fontFamily colorScheme +captainToken')
        .lean();

    if (captainRestaurant) {
        const [tables, menuItems] = await Promise.all([
            Table.find({ restaurantId: captainRestaurant._id, isActive: true, isTakeaway: { $ne: true } })
                .select('_id tableNumber isTakeaway')
                .sort({ tableNumber: 1 })
                .lean(),
            MenuItem.find({ restaurantId: captainRestaurant._id, isAvailable: true })
                .select('name description price category imageUrl aestheticImageUrl')
                .sort({ category: 1, name: 1 })
                .lean(),
        ]);

        const restaurant = {
            _id: String(captainRestaurant._id),
            name: captainRestaurant.name,
            description: captainRestaurant.description,
            logoUrl: captainRestaurant.logoUrl,
            coverImageUrl: captainRestaurant.coverImageUrl,
            themeColor: captainRestaurant.themeColor,
            logoAccentColor: captainRestaurant.logoAccentColor,
            accentSource: captainRestaurant.accentSource,
            fontFamily: captainRestaurant.fontFamily,
            colorScheme: captainRestaurant.colorScheme,
        };

        return <CaptainOrderPage
            restaurant={JSON.parse(JSON.stringify(restaurant))}
            tables={JSON.parse(JSON.stringify(tables))}
            menuItems={JSON.parse(JSON.stringify(menuItems))}
        />;
    }

    const table = await Table.findOne({ captainToken: token, isActive: true, isTakeaway: { $ne: true } })
        .select('_id restaurantId tableNumber isTakeaway +captainToken').lean();
    if (!table || !mongoose.Types.ObjectId.isValid(String(table.restaurantId))) notFound();

    const [restaurant, menuItems] = await Promise.all([
        Restaurant.findById(table.restaurantId)
            .select('name description logoUrl coverImageUrl themeColor logoAccentColor accentSource fontFamily colorScheme')
            .lean(),
        MenuItem.find({ restaurantId: table.restaurantId, isAvailable: true })
            .select('name description price category imageUrl aestheticImageUrl')
            .sort({ category: 1, name: 1 })
            .lean(),
    ]);

    if (!restaurant) notFound();

    return <CustomerMenu
        restaurant={JSON.parse(JSON.stringify(restaurant))}
        table={JSON.parse(JSON.stringify(table))}
        menuItems={JSON.parse(JSON.stringify(menuItems))}
        captainMode
    />;
}
