import { notFound } from 'next/navigation';
import { CustomerMenu } from '@/components/customer/CustomerMenu';
import { unstable_cache } from 'next/cache';
import { getBackendUrl } from '@/lib/backendUrl';

// Cached data fetching functions - Decoupled to fetch from backend REST APIs
const getCachedMenu = (restaurantId: string) => unstable_cache(
    async () => {
        const backendUrl = getBackendUrl();
        const res = await fetch(`${backendUrl}/api/v1/menu/public/${restaurantId}`);
        return res.ok ? res.json() : [];
    },
    [`menu-${restaurantId}`],
    { tags: [`menu-${restaurantId}`], revalidate: 60 }
)();

const getCachedRestaurant = (id: string) => unstable_cache(
    async () => {
        const backendUrl = getBackendUrl();
        const res = await fetch(`${backendUrl}/api/v1/restaurant/public/${id}`);
        return res.ok ? res.json() : null;
    },
    [`restaurant-${id}`],
    { tags: [`restaurant-${id}`], revalidate: 60 }
)();

const getCachedTable = (id: string) => unstable_cache(
    async () => {
        const backendUrl = getBackendUrl();
        const res = await fetch(`${backendUrl}/api/v1/tables/public/${id}`);
        return res.ok ? res.json() : null;
    },
    [`table-${id}`],
    { tags: [`table-${id}`], revalidate: 60 }
)();

export default async function CustomerTablePage(props: {
    params: Promise<{ restaurantId: string; tableId: string }>;
}) {
    const params = await props.params;

    const [restaurant, table, menuItems] = await Promise.all([
        getCachedRestaurant(params.restaurantId),
        getCachedTable(params.tableId),
        getCachedMenu(params.restaurantId),
    ]);

    if (!restaurant || !table || table.restaurantId.toString() !== restaurant._id.toString()) {
        notFound();
    }

    return (
        <CustomerMenu
            restaurant={restaurant}
            table={table}
            menuItems={menuItems}
        />
    );
}
