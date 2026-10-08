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
const metricsInFlight = new Map<string, Promise<any>>();

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
const average = (sum: number, count: number) => count ? Math.round(sum / count * 100) / 100 : 0;
const beverageCategory = /drink|beverage|juice|shake|coffee|tea|mocktail|cocktail|soda|lassi|smoothie/i;
const waterName = /(^|\s)(water|mineral water|bottled water|aqua)(\s|$)/i;

async function calculateAdvancedMetrics(restaurantId: string, start: Date, end: Date) {
    const objectId = new mongoose.Types.ObjectId(restaurantId);
    const [allTimeStats, menuItems] = await Promise.all([
        Order.aggregate([
            { $match: { restaurantId: objectId, status: { $ne: 'cancelled' } } },
            { $group: { _id: null, revenue: { $sum: '$total' }, count: { $sum: 1 } } },
        ]),
        MenuItem.find({ restaurantId: objectId }).select('name category price dietaryType itemType isAvailable').lean(),
    ]);

    const periodOrderCursor = Order.find({ restaurantId: objectId, createdAt: { $gte: start, $lte: end } })
        .select('createdAt status total items customerPhone customerName paymentStatus review orderType')
        .lean()
        .cursor();
    const menuById = new Map(menuItems.map((item: any) => [String(item._id), item]));
    const itemStats = new Map<string, any>();
    const categoryStats = new Map<string, { quantity: number; revenue: number; orders: number }>();
    const dietaryStats = new Map<string, { quantity: number; revenue: number; orders: number }>();
    const typeStats = new Map<string, { quantity: number; revenue: number; orders: number }>();
    const hourly = Array.from({ length: 24 }, (_, hour) => ({ hour, orders: 0, revenue: 0, units: 0 }));
    const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const weekdays = weekdayNames.map((day) => ({ day, orders: 0, revenue: 0, units: 0 }));
    const dailyMap = new Map<string, { date: string; orders: number; revenue: number }>();
    const statusCounts: Record<string, number> = { pending: 0, preparing: 0, served: 0, completed: 0, cancelled: 0 };
    const orderTypes: Record<string, { orders: number; revenue: number }> = {
        'dine-in': { orders: 0, revenue: 0 }, takeaway: { orders: 0, revenue: 0 },
    };
    let periodOrderCount = 0;
    let validOrderCount = 0;
    let revenue = 0;
    let completedCount = 0;
    let paidCount = 0;
    let unpaidCompletedCount = 0;
    let reviewCount = 0;
    let foodRatingSum = 0, foodRatingCount = 0;
    let experienceRatingSum = 0, experienceRatingCount = 0;
    let preparationRatingSum = 0, preparationRatingCount = 0;
    let packagingRatingSum = 0, packagingRatingCount = 0;
    const lowFoodOrders: Array<{ orderId: string; rating: number; comment: string; customerName: string; createdAt: Date; items: string[] }> = [];
    const customerMap = new Map<string, { name: string; phone: string; orders: number; spend: number }>();

    for (const menuItem of menuItems as any[]) {
        itemStats.set(String(menuItem._id), {
            menuItemId: String(menuItem._id), name: menuItem.name, category: menuItem.category || 'Other',
            dietaryType: menuItem.dietaryType || 'unknown', itemType: menuItem.itemType || 'food',
            quantity: 0, revenue: 0, orders: 0, isAvailable: menuItem.isAvailable !== false,
        });
    }

    for await (const order of periodOrderCursor as any) {
        periodOrderCount++;
        if (statusCounts[order.status] !== undefined) statusCounts[order.status]++;
        if (order.status === 'completed') completedCount++;
        if (order.paymentStatus === 'paid') paidCount++;

        if (order.review) {
            reviewCount++;
            for (const [field, target] of [
                ['foodRating', 'food'], ['experienceRating', 'experience'],
                ['preparationRating', 'preparation'], ['packagingRating', 'packaging'],
            ]) {
                const rating = Number(order.review[field] || 0);
                if (rating <= 0) continue;
                if (target === 'food') { foodRatingSum += rating; foodRatingCount++; }
                else if (target === 'experience') { experienceRatingSum += rating; experienceRatingCount++; }
                else if (target === 'preparation') { preparationRatingSum += rating; preparationRatingCount++; }
                else { packagingRatingSum += rating; packagingRatingCount++; }
            }
            const rating = Number(order.review.foodRating || 0);
            if (rating > 0 && rating <= 2 && lowFoodOrders.length < 20) {
                lowFoodOrders.push({
                    orderId: String(order._id), rating, comment: order.review.comment || '',
                    customerName: order.customerName || 'Guest', createdAt: order.createdAt,
                    items: (order.items || []).map((item: any) => item.name),
                });
            }
        }

        if (order.status === 'cancelled') continue;
        validOrderCount++;
        const orderRevenue = Number(order.total || 0);
        revenue += orderRevenue;
        if (order.status === 'completed' && order.paymentStatus !== 'paid') unpaidCompletedCount++;
        const orderType = (order.orderType || 'dine-in') === 'takeaway' ? 'takeaway' : 'dine-in';
        orderTypes[orderType].orders++;
        orderTypes[orderType].revenue += orderRevenue;
        const phone = String(order.customerPhone || '').replace(/\D/g, '');
        if (phone) {
            const customer = customerMap.get(phone) || { name: order.customerName || 'Guest', phone, orders: 0, spend: 0 };
            customer.orders++;
            customer.spend += orderRevenue;
            customerMap.set(phone, customer);
        }

        const createdAt = new Date(order.createdAt);
        const hour = createdAt.getHours();
        const weekday = createdAt.getDay();
        const date = createdAt.toISOString().slice(0, 10);
        hourly[hour].orders++;
        hourly[hour].revenue += orderRevenue;
        weekdays[weekday].orders++;
        weekdays[weekday].revenue += orderRevenue;
        const daily = dailyMap.get(date) || { date, orders: 0, revenue: 0 };
        daily.orders++;
        daily.revenue += orderRevenue;
        dailyMap.set(date, daily);

        const orderItemKeys = new Set<string>();
        const orderCategories = new Set<string>();
        const orderDietaryTypes = new Set<string>();
        const orderItemTypes = new Set<string>();
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
                quantity: 0, revenue: 0, orders: 0, isAvailable: true,
            };
            stat.name = name;
            stat.category = category;
            stat.dietaryType = dietaryType;
            stat.itemType = itemType;
            stat.quantity += quantity;
            stat.revenue += revenue;
            orderItemKeys.add(id || name.toLowerCase());
            itemStats.set(id || name.toLowerCase(), stat);

            const categoryTotal = categoryStats.get(category) || { quantity: 0, revenue: 0, orders: 0 };
            categoryTotal.quantity += quantity;
            categoryTotal.revenue += revenue;
            categoryStats.set(category, categoryTotal);
            const dietaryTotal = dietaryStats.get(dietaryType) || { quantity: 0, revenue: 0, orders: 0 };
            dietaryTotal.quantity += quantity;
            dietaryTotal.revenue += revenue;
            dietaryStats.set(dietaryType, dietaryTotal);
            const typeTotal = typeStats.get(itemType) || { quantity: 0, revenue: 0, orders: 0 };
            typeTotal.quantity += quantity;
            typeTotal.revenue += revenue;
            typeStats.set(itemType, typeTotal);
            orderCategories.add(category);
            orderDietaryTypes.add(dietaryType);
            orderItemTypes.add(itemType);
        }
        for (const key of orderItemKeys) itemStats.get(key).orders++;
        for (const key of orderCategories) categoryStats.get(key)!.orders++;
        for (const key of orderDietaryTypes) dietaryStats.get(key)!.orders++;
        for (const key of orderItemTypes) typeStats.get(key)!.orders++;
    }

    const normalizedItems = [...itemStats.values()].map((item) => ({
        ...item, revenue: money(item.revenue),
    }));
    const soldItems = normalizedItems.filter((item) => item.quantity > 0);
    const rank = (items: any[], direction = -1) => [...items].sort((a, b) => direction * (a.quantity - b.quantity) || direction * (a.revenue - b.revenue));
    const topItems = rank(soldItems).slice(0, 10);
    const leastItems = [...normalizedItems].sort((a, b) => a.quantity - b.quantity || a.revenue - b.revenue).slice(0, 10);
    const topVeg = rank(soldItems.filter((item) => ['veg', 'vegan'].includes(item.dietaryType))).slice(0, 10);
    const topNonVeg = rank(soldItems.filter((item) => ['non-veg', 'egg'].includes(item.dietaryType))).slice(0, 10);
    const topDrinks = rank(soldItems.filter((item) => item.itemType === 'beverage' && !waterName.test(item.name))).slice(0, 10);

    const units = soldItems.reduce((sum, item) => sum + item.quantity, 0);
    const customers = [...customerMap.values()];
    const repeatCustomers = customers.filter((customer) => customer.orders > 1);
    for (const type of Object.keys(orderTypes)) orderTypes[type].revenue = money(orderTypes[type].revenue);

    const dimensions = (map: Map<string, { quantity: number; revenue: number; orders: number }>) =>
        [...map.entries()].map(([name, value]) => ({ name, quantity: value.quantity, revenue: money(value.revenue), orders: value.orders }))
            .sort((a, b) => b.quantity - a.quantity);
    const categoryPerformance = dimensions(categoryStats);
    const dietaryPerformance = dimensions(dietaryStats);
    const itemTypePerformance = dimensions(typeStats);
    const indicators: Array<{ group: string; key: string; label: string; value: number; unit: string }> = [];
    const add = (group: string, key: string, label: string, value: number, unit = 'number') =>
        indicators.push({ group, key, label, value: Number.isFinite(value) ? money(value) : 0, unit });

    add('Revenue', 'period_revenue', 'Period revenue', revenue, 'currency');
    add('Revenue', 'average_order_value', 'Average order value', validOrderCount ? revenue / validOrderCount : 0, 'currency');
    add('Orders', 'period_orders', 'Orders received', periodOrderCount);
    add('Orders', 'valid_orders', 'Non-cancelled orders', validOrderCount);
    add('Orders', 'units_sold', 'Units sold', units);
    add('Orders', 'average_basket_units', 'Average basket units', validOrderCount ? units / validOrderCount : 0);
    add('Customers', 'unique_customers', 'Unique identified customers', customers.length);
    add('Customers', 'repeat_customers', 'Repeat customers', repeatCustomers.length);
    add('Customers', 'repeat_rate', 'Repeat customer rate', ratio(repeatCustomers.length, customers.length), 'percent');
    add('Payments', 'paid_orders', 'Paid orders', paidCount);
    add('Payments', 'payment_rate', 'Payment completion rate', ratio(paidCount, completedCount), 'percent');
    add('Reviews', 'review_count', 'Reviews received', reviewCount);
    add('Reviews', 'review_rate', 'Review response rate', ratio(reviewCount, completedCount), 'percent');
    add('Reviews', 'food_rating', 'Average food rating', average(foodRatingSum, foodRatingCount), 'rating');
    add('Reviews', 'experience_rating', 'Average experience rating', average(experienceRatingSum, experienceRatingCount), 'rating');
    add('Reviews', 'preparation_rating', 'Average preparation rating', average(preparationRatingSum, preparationRatingCount), 'rating');
    add('Reviews', 'packaging_rating', 'Average packaging rating', average(packagingRatingSum, packagingRatingCount), 'rating');
    add('Reviews', 'low_food_reviews', 'Low food ratings', lowFoodOrders.length);

    for (const status of Object.keys(statusCounts)) {
        add('Order status', `${status}_count`, `${status} orders`, statusCounts[status]);
        add('Order status', `${status}_share`, `${status} share`, ratio(statusCounts[status], periodOrderCount), 'percent');
    }
    for (const [type, value] of Object.entries(orderTypes) as any) {
        add('Service type', `${type}_orders`, `${type} orders`, value.orders);
        add('Service type', `${type}_revenue`, `${type} revenue`, value.revenue, 'currency');
        add('Service type', `${type}_share`, `${type} order share`, ratio(value.orders, validOrderCount), 'percent');
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
        orders: { period: periodOrderCount, total: allTimeStats[0]?.count || 0 },
        averageOrderValue: money(validOrderCount ? revenue / validOrderCount : 0),
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
        payments: { paid: paidCount, unpaidCompleted: unpaidCompletedCount, completionRate: ratio(paidCount, completedCount) },
        customers: {
            identified: customers.length, repeat: repeatCustomers.length, repeatRate: ratio(repeatCustomers.length, customers.length),
            top: customers.sort((a, b) => b.spend - a.spend).slice(0, 10).map((customer) => ({ ...customer, spend: money(customer.spend) })),
        },
        ratings: {
            count: reviewCount, responseRate: ratio(reviewCount, completedCount),
            food: average(foodRatingSum, foodRatingCount), experience: average(experienceRatingSum, experienceRatingCount),
            preparation: average(preparationRatingSum, preparationRatingCount), packaging: average(packagingRatingSum, packagingRatingCount),
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

            const orders = Order.find({
                restaurantId,
                status: { $in: ['completed', 'served'] },
                createdAt: { $gte: start, $lte: end }
            }).select('items').lean().cursor();

            const itemSetCounts: Record<string, number> = {};

            for await (const order of orders as any) {
                if (!order.items || order.items.length < 2) continue;

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
            }

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
            const cacheKey = buildCacheKey('metrics-v3', restaurantId, start, end);
            try {
                const cached = await redis.get(cacheKey);
                if (cached) {
                    res.set('X-Cache', 'HIT');
                    return res.json(JSON.parse(cached));
                }
            } catch (redisErr) {
                console.warn('[Analytics] Redis unavailable, fetching metrics from DB:', (redisErr as Error).message);
            }

            let calculation = metricsInFlight.get(cacheKey);
            if (!calculation) {
                calculation = calculateAdvancedMetrics(restaurantId, start, end);
                metricsInFlight.set(cacheKey, calculation);
                calculation.finally(() => {
                    if (metricsInFlight.get(cacheKey) === calculation) metricsInFlight.delete(cacheKey);
                }).catch(() => undefined);
            }
            const payload = await calculation;

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
