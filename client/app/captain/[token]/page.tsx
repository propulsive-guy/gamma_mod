import mongoose from 'mongoose';
import { notFound } from 'next/navigation';
import { CaptainOrderPage } from '@/components/customer/CaptainOrderPage';
import dbConnect from '@/lib/db';
import MenuItem from '@/models/MenuItem';
import Restaurant from '@/models/Restaurant';
import Table from '@/models/Table';

export const dynamic = 'force-dynamic';

/** Restaurant-ID Captain URLs are permanent; token-based links remain compatible. */
export default async function CaptainTablePage(props: { params: Promise<{ token: string }> }) {
    const { token } = await props.params;
    const isRestaurantId = mongoose.Types.ObjectId.isValid(token);
    const isLegacyToken = /^[a-f0-9]{64}$/.test(token);
    if (!isRestaurantId && !isLegacyToken) notFound();

    await dbConnect();
    const restaurantFields = '_id name description logoUrl coverImageUrl themeColor logoAccentColor accentSource fontFamily colorScheme upiId upiPayeeName merchantCode gstNumber fssaiNumber gstPercentage sgstPercentage address phone';
    let captainRestaurant = isRestaurantId
        ? await Restaurant.findById(token).select(restaurantFields).lean()
        : null;

    if (!captainRestaurant && isLegacyToken) {
        captainRestaurant = await Restaurant.findOne({ captainToken: token }).select(restaurantFields).lean();
    }

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
            upiId: captainRestaurant.upiId,
            upiPayeeName: captainRestaurant.upiPayeeName,
            merchantCode: captainRestaurant.merchantCode,
            gstNumber: captainRestaurant.gstNumber,
            fssaiNumber: captainRestaurant.fssaiNumber,
            gstPercentage: captainRestaurant.gstPercentage,
            sgstPercentage: captainRestaurant.sgstPercentage,
            address: captainRestaurant.address,
            phone: captainRestaurant.phone,
        };

        return <CaptainOrderPage
            restaurant={JSON.parse(JSON.stringify(restaurant))}
            captainKey={token}
            tables={JSON.parse(JSON.stringify(tables))}
            menuItems={JSON.parse(JSON.stringify(menuItems))}
        />;
    }

    const table = await Table.findOne({ captainToken: token, isActive: true, isTakeaway: { $ne: true } })
        .select('_id restaurantId tableNumber isTakeaway +captainToken').lean();
    if (!table || !mongoose.Types.ObjectId.isValid(String(table.restaurantId))) notFound();

    const [restaurant, menuItems] = await Promise.all([
        Restaurant.findById(table.restaurantId)
            .select('name description logoUrl coverImageUrl themeColor logoAccentColor accentSource fontFamily colorScheme upiId upiPayeeName merchantCode gstNumber fssaiNumber gstPercentage sgstPercentage address phone')
            .lean(),
        MenuItem.find({ restaurantId: table.restaurantId, isAvailable: true })
            .select('name description price category imageUrl aestheticImageUrl')
            .sort({ category: 1, name: 1 })
            .lean(),
    ]);

    if (!restaurant) notFound();

    const restaurantInfo = JSON.parse(JSON.stringify(restaurant));
    return <CaptainOrderPage
        restaurant={restaurantInfo}
        captainKey={String(table.restaurantId)}
        tables={[JSON.parse(JSON.stringify(table))]}
        menuItems={JSON.parse(JSON.stringify(menuItems))}
    />;
}
