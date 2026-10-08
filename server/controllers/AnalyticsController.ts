import { Request, Response } from 'express';
import Order from '../models/Order';
import mongoose from 'mongoose';
import redis from '../lib/redis';
import MenuItem from '../models/MenuItem';

// TTL constants (in seconds)
const METRICS_CACHE_TTL = 5 * 60;       // 5 minutes
const ASSOCIATIONS_CACHE_TTL = 10 * 60; // 10 minutes
// Combination mining is cubic in the number of distinct items in a basket.
// Keep pathological/imported orders from exhausting the API process.
const MAX_ASSOCIATION_ITEMS_PER_ORDER = 20;

/**
 * Build a deterministic Redis cache key scoped to restaurant + date range.
 * Using ISO date strings ensures keys are consistent for the same time window.
 */
function buildCacheKey(prefix: string, restaurantId: string, start: Date, end: Date): string {
    const startStr = start.toISOString().slice(0, 10); // YYYY-MM-DD
    const endStr = end.toISOString().slice(0, 10);
    return `bitbyte:analytics:${prefix}:${restaurantId}:${startStr}:${endStr}`;
}

const money = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const ratio = (part: number, whole: number) => whole ? Math.round(part / whole * 1000) / 10 : 0;
const average = (values: number[]) => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 100) / 100 : 0;
const beverageCategory = /drink|beverage|juice|shake|coffee|tea|mocktail|cocktail|soda|lassi|smoothie/i;
const waterName = /(^|\s)(water|mineral water|bottled water|aqua)(\s|$)/i;

async function calculateAdvancedMetrics(restaurantId: string, start: Date, end: Date) {
    const objectId = new mongoose.Types.ObjectId(restaurantId);
    const [periodOrders, allTimeStats, menuItems] = await Promise.all([
        Order.find({ restaurantId: objectId, createdAt: { $gte: start, $lte: end } })
            .select('createdAt status total items customerPhone customerName paymentStatus review orderType')
            .lean(),
        Order.aggregate([
            { $match: { restaurantId: objectId, status: { $ne: 'cancelled' } } },
            { $group: { _id: null, revenue: { $sum: '$total' }, count: { $sum: 1 } } },
        ]),
        MenuItem.find({ restaurantId: objectId }).select('name category price dietaryType itemType isAvailable').lean(),
    ]);

    const validOrders = periodOrders.filter((order: any) => order.status !== 'cancelled');
    const menuById = new Map(menuItems.map((item: any) => [String(item._id), item]));
    const itemStats = new Map<string, any>();
    const categoryStats = new Map<string, { quantity: number; revenue: number; orders: Set<string> }>();
    const dietaryStats = new Map<string, { quantity: number; revenue: number; orders: Set<string> }>();
    const typeStats = new Map<string, { quantity: number; revenue: number; orders: Set<string> }>();
    const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, orders: 0, revenue: 0, units: 0 }));
    const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const weekdays = weekdayNames.map((day) => ({ day, orders: 0, revenue: 0, units: 0 }));
    const dailyMap = new Map<string, { date: string; orders: number; revenue: number }>();

    for (const menuItem of menuItems as any[]) {
        itemStats.set(String(menuItem._id), {
            menuItemId: String(menuItem._id), name: menuItem.name, category: menuItem.category || 'Other',
            dietaryType: menuItem.dietaryType || 'unknown', itemType: menuItem.itemType || 'food',
            quantity: 0, revenue: 0, orders: new Set<string>(), isAvailable: menuItem.isAvailable !== false,
        });
    }

    for (const order of validOrders as any[]) {
        const createdAt = new Date(order.createdAt);
        const hour = createdAt.getHours();
        const weekday = createdAt.getDay();
        const date = createdAt.toISOString().slice(0, 10);
        hourly[hour].orders++;
        hourly[hour].revenue += Number(order.total || 0);
        weekdays[weekday].orders++;
        weekdays[weekday].revenue += Number(order.total || 0);
        const daily = dailyMap.get(date) || { date, orders: 0, revenue: 0 };
        daily.orders++;
        daily.revenue += Number(order.total || 0);
        dailyMap.set(date, daily);

        for (const line of order.items || []) {
            const id = String(line.menuItemId || '');
            const menu = menuById.get(id) as any;
            const name = menu?.name || line.name || 'Unknown item';
            const category = menu?.category || 'Other';
            const dietaryType = line.dietaryType || menu?.dietaryType || 'unknown';
            let itemType = line.itemType || menu?.itemType || (beverageCategory.test(category) ? 'beverage' : 'food');
            if (waterName.test(name)) itemType = 'water';
            const quantity = Number(line.quantity || 0);
            const revenue = Number(line.price || 0) * quantity;
            hourly[hour].units += quantity;
            weekdays[weekday].units += quantity;

            const stat = itemStats.get(id) || {
                menuItemId: id, name, category, dietaryType, itemType,
                quantity: 0, revenue: 0, orders: new Set<string>(), isAvailable: true,
            };
            stat.name = name;
            stat.category = category;
            stat.dietaryType = dietaryType;
            stat.itemType = itemType;
            stat.quantity += quantity;
            stat.revenue += revenue;
            stat.orders.add(String(order._id));
            itemStats.set(id || name.toLowerCase(), stat);

            for (const [map, key] of [[categoryStats, category], [dietaryStats, dietaryType], [typeStats, itemType]] as const) {
                const aggregate = map.get(key) || { quantity: 0, revenue: 0, orders: new Set<string>() };
                aggregate.quantity += quantity;
                aggregate.revenue += revenue;
                aggregate.orders.add(String(order._id));
                map.set(key, aggregate);
            }
        }
    }

    const normalizedItems = [...itemStats.values()].map((item) => ({
        ...item, orders: item.orders.size, revenue: money(item.revenue),
    }));
    const soldItems = normalizedItems.filter((item) => item.quantity > 0);
    const rank = (items: any[], direction = -1) => [...items].sort((a, b) => direction * (a.quantity - b.quantity) || direction * (a.revenue - b.revenue));
    const topItems = rank(soldItems).slice(0, 10);
    const leastItems = [...normalizedItems].sort((a, b) => a.quantity - b.quantity || a.revenue - b.revenue).slice(0, 10);
    const topVeg = rank(soldItems.filter((item) => ['veg', 'vegan'].includes(item.dietaryType))).slice(0, 10);
    const topNonVeg = rank(soldItems.filter((item) => ['non-veg', 'egg'].includes(item.dietaryType))).slice(0, 10);
    const topDrinks = rank(soldItems.filter((item) => item.itemType === 'beverage' && !waterName.test(item.name))).slice(0, 10);

    const revenue = validOrders.reduce((sum: number, order: any) => sum + Number(order.total || 0), 0);
    const units = soldItems.reduce((sum, item) => sum + item.quantity, 0);
    const completed = periodOrders.filter((order: any) => order.status === 'completed');
    const paid = periodOrders.filter((order: any) => order.paymentStatus === 'paid');
    const reviewed = periodOrders.filter((order: any) => order.review);
    const foodRatings = reviewed.map((order: any) => Number(order.review?.foodRating)).filter((value: number) => value > 0);
    const experienceRatings = reviewed.map((order: any) => Number(order.review?.experienceRating)).filter((value: number) => value > 0);
    const preparationRatings = reviewed.map((order: any) => Number(order.review?.preparationRating)).filter((value: number) => value > 0);
    const packagingRatings = reviewed.map((order: any) => Number(order.review?.packagingRating)).filter((value: number) => value > 0);
    const lowFoodOrders = reviewed.filter((order: any) => Number(order.review?.foodRating) <= 2 && Number(order.review?.foodRating) > 0)
        .map((order: any) => ({
            orderId: String(order._id), rating: order.review.foodRating, comment: order.review.comment || '',
            customerName: order.customerName || 'Guest', createdAt: order.createdAt,
            items: (order.items || []).map((item: any) => item.name),
        })).slice(0, 20);

    const customerMap = new Map<string, { name: string; phone: string; orders: number; spend: number }>();
    for (const order of validOrders as any[]) {
        const phone = String(order.customerPhone || '').replace(/\D/g, '');
        if (!phone) continue;
        const customer = customerMap.get(phone) || { name: order.customerName || 'Guest', phone, orders: 0, spend: 0 };
        customer.orders++;
        customer.spend += Number(order.total || 0);
        customerMap.set(phone, customer);
    }
    const customers = [...customerMap.values()];
    const repeatCustomers = customers.filter((customer) => customer.orders > 1);
    const statusCounts = Object.fromEntries(['pending', 'preparing', 'served', 'completed', 'cancelled']
        .map((status) => [status, periodOrders.filter((order: any) => order.status === status).length]));
    const orderTypes = Object.fromEntries(['dine-in', 'takeaway'].map((type) => {
        const orders = validOrders.filter((order: any) => (order.orderType || 'dine-in') === type);
        return [type, { orders: orders.length, revenue: money(orders.reduce((sum: number, order: any) => sum + Number(order.total || 0), 0)) }];
    }));

    const dimensions = (map: Map<string, { quantity: number; revenue: number; orders: Set<string> }>) =>
        [...map.entries()].map(([name, value]) => ({ name, quantity: value.quantity, revenue: money(value.revenue), orders: value.orders.size }))
            .sort((a, b) => b.quantity - a.quantity);
    const categoryPerformance = dimensions(categoryStats);
    const dietaryPerformance = dimensions(dietaryStats);
    const itemTypePerformance = dimensions(typeStats);
    const indicators: Array<{ group: string; key: string; label: string; value: number; unit: string }> = [];
    const add = (group: string, key: string, label: string, value: number, unit = 'number') =>
        indicators.push({ group, key, label, value: Number.isFinite(value) ? money(value) : 0, unit });

    add('Revenue', 'period_revenue', 'Period revenue', revenue, 'currency');
    add('Revenue', 'average_order_value', 'Average order value', validOrders.length ? revenue / validOrders.length : 0, 'currency');
    add('Orders', 'period_orders', 'Orders received', periodOrders.length);
    add('Orders', 'valid_orders', 'Non-cancelled orders', validOrders.length);
    add('Orders', 'units_sold', 'Units sold', units);
    add('Orders', 'average_basket_units', 'Average basket units', validOrders.length ? units / validOrders.length : 0);
    add('Customers', 'unique_customers', 'Unique identified customers', customers.length);
    add('Customers', 'repeat_customers', 'Repeat customers', repeatCustomers.length);
    add('Customers', 'repeat_rate', 'Repeat customer rate', ratio(repeatCustomers.length, customers.length), 'percent');
    add('Payments', 'paid_orders', 'Paid orders', paid.length);
    add('Payments', 'payment_rate', 'Payment completion rate', ratio(paid.length, completed.length), 'percent');
    add('Reviews', 'review_count', 'Reviews received', reviewed.length);
    add('Reviews', 'review_rate', 'Review response rate', ratio(reviewed.length, completed.length), 'percent');
    add('Reviews', 'food_rating', 'Average food rating', average(foodRatings), 'rating');
    add('Reviews', 'experience_rating', 'Average experience rating', average(experienceRatings), 'rating');
    add('Reviews', 'preparation_rating', 'Average preparation rating', average(preparationRatings), 'rating');
    add('Reviews', 'packaging_rating', 'Average packaging rating', average(packagingRatings), 'rating');
    add('Reviews', 'low_food_reviews', 'Low food ratings', lowFoodOrders.length);

    for (const status of Object.keys(statusCounts)) {
        add('Order status', `${status}_count`, `${status} orders`, statusCounts[status]);
        add('Order status', `${status}_share`, `${status} share`, ratio(statusCounts[status], periodOrders.length), 'percent');
    }
    for (const [type, value] of Object.entries(orderTypes) as any) {
        add('Service type', `${type}_orders`, `${type} orders`, value.orders);
        add('Service type', `${type}_revenue`, `${type} revenue`, value.revenue, 'currency');
        add('Service type', `${type}_share`, `${type} order share`, ratio(value.orders, validOrders.length), 'percent');
        add('Service type', `${type}_aov`, `${type} average order value`, value.orders ? value.revenue / value.orders : 0, 'currency');
    }
    for (const dimension of [
        ['Dietary', dietaryPerformance], ['Item type', itemTypePerformance], ['Category', categoryPerformance],
    ] as const) {
        for (const value of dimension[1]) {
            const key = value.name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
            add(dimension[0], `${key}_quantity`, `${value.name} units`, value.quantity);
            add(dimension[0], `${key}_revenue`, `${value.name} revenue`, value.revenue, 'currency');
            add(dimension[0], `${key}_orders`, `${value.name} orders`, value.orders);
            add(dimension[0], `${key}_share`, `${value.name} unit share`, ratio(value.quantity, units), 'percent');
        }
    }
    for (const point of hourly) {
        add('Hourly', `hour_${point.hour}_orders`, `${String(point.hour).padStart(2, '0')}:00 orders`, point.orders);
        add('Hourly', `hour_${point.hour}_revenue`, `${String(point.hour).padStart(2, '0')}:00 revenue`, point.revenue, 'currency');
        add('Hourly', `hour_${point.hour}_units`, `${String(point.hour).padStart(2, '0')}:00 units`, point.units);
    }
    for (const point of weekdays) {
        add('Weekday', `${point.day.toLowerCase()}_orders`, `${point.day} orders`, point.orders);
        add('Weekday', `${point.day.toLowerCase()}_revenue`, `${point.day} revenue`, point.revenue, 'currency');
        add('Weekday', `${point.day.toLowerCase()}_units`, `${point.day} units`, point.units);
    }

    const unclassified = menuItems.filter((item: any) => !item.dietaryType || item.dietaryType === 'unknown').length;
    return {
        revenue: { period: money(revenue), total: money(allTimeStats[0]?.revenue || 0) },
        orders: { period: periodOrders.length, total: allTimeStats[0]?.count || 0 },
        averageOrderValue: money(validOrders.length ? revenue / validOrders.length : 0),
        unitsSold: units,
        topItems,
        leastFavoriteItems: leastItems,
        topVegItems: topVeg,
        topNonVegItems: topNonVeg,
        topDrinks,
        categoryPerformance,
        dietaryPerformance,
        itemTypePerformance,
        hourlyPerformance: hourly.map((point) => ({ ...point, revenue: money(point.revenue) })),
        weekdayPerformance: weekdays.map((point) => ({ ...point, revenue: money(point.revenue) })),
        dailyTrend: [...dailyMap.values()].sort((a, b) => a.date.localeCompare(b.date)).map((point) => ({ ...point, revenue: money(point.revenue) })),
        statusCounts,
        orderTypes,
        payments: { paid: paid.length, unpaidCompleted: completed.filter((order: any) => order.paymentStatus !== 'paid').length, completionRate: ratio(paid.length, completed.length) },
        customers: {
            identified: customers.length, repeat: repeatCustomers.length, repeatRate: ratio(repeatCustomers.length, customers.length),
            top: customers.sort((a, b) => b.spend - a.spend).slice(0, 10).map((customer) => ({ ...customer, spend: money(customer.spend) })),
        },
        ratings: {
            count: reviewed.length, responseRate: ratio(reviewed.length, completed.length),
            food: average(foodRatings), experience: average(experienceRatings),
            preparation: average(preparationRatings), packaging: average(packagingRatings),
            lowFoodOrders,
        },
        dataQuality: { totalMenuItems: menuItems.length, unclassifiedDietaryItems: unclassified, classificationCoverage: ratio(menuItems.length - unclassified, menuItems.length) },
        indicators,
        indicatorCount: indicators.length,
    };
}

export class AnalyticsController {
    /**
     * Get association rules for frequently bought together items.
     * Results are cached in Redis for 10 minutes per restaurant + date range.
     */
    static async getAssociations(req: Request, res: Response) {
        try {
            const user = req.user;
            if (!user || !user.restaurantId) {
                return res.status(401).json({ error: 'Unauthorized: No restaurant associated' });
            }

            const restaurantId = user.restaurantId;
            const { startDate, endDate } = req.query;

            const end = endDate ? new Date(endDate as string) : new Date();
            const start = startDate ? new Date(startDate as string) : new Date(new Date().setDate(new Date().getDate() - 30));

            // Check Redis cache first
            const cacheKey = buildCacheKey('assoc', restaurantId, start, end);
            try {
                const cached = await redis.get(cacheKey);
                if (cached) {
                    res.set('X-Cache', 'HIT');
                    return res.json(JSON.parse(cached));
                }
            } catch (redisErr) {
                // Redis unavailable — fall through to DB computation
                console.warn('[Analytics] Redis unavailable, computing associations from DB:', (redisErr as Error).message);
            }

            const orders = await Order.find({
                restaurantId,
                status: { $in: ['completed', 'served'] },
                createdAt: { $gte: start, $lte: end }
            }).select('items').lean();

            const itemSetCounts: Record<string, number> = {};

            orders.forEach(order => {
                if (!order.items || order.items.length < 2) return;

                const uniqueItems = Array.from(new Set(order.items.map((item: any) => item.name)))
                    .sort()
                    .slice(0, MAX_ASSOCIATION_ITEMS_PER_ORDER) as string[];

                // 2-item combinations
                for (let i = 0; i < uniqueItems.length; i++) {
                    for (let j = i + 1; j < uniqueItems.length; j++) {
                        const pair = JSON.stringify([uniqueItems[i], uniqueItems[j]]);
                        itemSetCounts[pair] = (itemSetCounts[pair] || 0) + 1;
                    }
                }

                // 3-item combinations
                if (uniqueItems.length >= 3) {
                    for (let i = 0; i < uniqueItems.length; i++) {
                        for (let j = i + 1; j < uniqueItems.length; j++) {
                            for (let k = j + 1; k < uniqueItems.length; k++) {
                                const triplet = JSON.stringify([uniqueItems[i], uniqueItems[j], uniqueItems[k]]);
                                itemSetCounts[triplet] = (itemSetCounts[triplet] || 0) + 1;
                            }
                        }
                    }
                }
            });

            const rules = Object.entries(itemSetCounts)
                .map(([jsonItems, frequency]) => ({
                    items: JSON.parse(jsonItems),
                    frequency
                }))
                .filter(rule => rule.frequency > 1)
                .sort((a, b) => b.frequency - a.frequency)
                .slice(0, 15);

            // Store in Redis cache (fire-and-forget — don't block response)
            redis.set(cacheKey, JSON.stringify(rules), 'EX', ASSOCIATIONS_CACHE_TTL).catch((err: Error) =>
                console.warn('[Analytics] Failed to cache associations in Redis:', err.message)
            );

            res.set('X-Cache', 'MISS');
            res.json(rules);
        } catch (error: any) {
            console.error('Get associations error:', error);
            res.status(500).json({ error: 'Failed to calculate analytics' });
        }
    }

    /**
     * Get business metrics (revenue, orders, top selling items).
     * Results are cached in Redis for 5 minutes per restaurant + date range.
     */
    static async getMetrics(req: Request, res: Response) {
        try {
            const user = req.user;
            if (!user || !user.restaurantId) {
                return res.status(401).json({ error: 'Unauthorized: No restaurant associated' });
            }

            const restaurantId = user.restaurantId;
            const { startDate, endDate } = req.query;

            const end = endDate ? new Date(endDate as string) : new Date();
            const start = startDate ? new Date(startDate as string) : new Date(new Date().setDate(new Date().getDate() - 30));

            // Check Redis cache first
            const cacheKey = buildCacheKey('metrics-v2', restaurantId, start, end);
            try {
                const cached = await redis.get(cacheKey);
                if (cached) {
                    res.set('X-Cache', 'HIT');
                    return res.json(JSON.parse(cached));
                }
            } catch (redisErr) {
                console.warn('[Analytics] Redis unavailable, fetching metrics from DB:', (redisErr as Error).message);
            }

            const payload = await calculateAdvancedMetrics(restaurantId, start, end);

            // Store in Redis cache (fire-and-forget)
            redis.set(cacheKey, JSON.stringify(payload), 'EX', METRICS_CACHE_TTL).catch((err: Error) =>
                console.warn('[Analytics] Failed to cache metrics in Redis:', err.message)
            );

            res.set('X-Cache', 'MISS');
            res.json(payload);
        } catch (error: any) {
            console.error('Get business metrics error:', error);
            res.status(500).json({ error: 'Failed to fetch metrics' });
        }
    }
}
