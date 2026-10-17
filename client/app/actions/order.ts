'use server';

import { apiFetch } from '@/client-lib/api';
import { getBackendUrl } from '@/lib/backendUrl';
import { revalidatePath } from 'next/cache';

/**
 * Update order status
 */
export async function updateOrderStatus(orderId: string, status: string) {
    try {
        const res = await apiFetch(`/api/v1/orders/${orderId}/status`, {
            method: 'PATCH',
            body: JSON.stringify({ status }),
        });

        if (!res.ok) {
            const errData = await res.json();
            return { success: false, error: errData.error || 'Failed to update order status' };
        }

        const order = await res.json();
        revalidatePath('/dashboard/orders');
        return { success: true, data: order };
    } catch (error) {
        console.error('Error updating order status:', error);
        return { success: false, error: 'Failed to update order status' };
    }
}

/**
 * Create a new order (customer-facing)
 */
export async function createOrder(data: any) {
    try {
        const res = await apiFetch('/api/v1/orders', {
            method: 'POST',
            body: JSON.stringify(data),
        });

        if (!res.ok) {
            const errData = await res.json();
            return { success: false, error: errData.error || 'Failed to create order' };
        }

        const order = await res.json();
        return { success: true, data: order };
    } catch (error) {
        console.error('Error creating order:', error);
        return { success: false, error: 'Failed to create order' };
    }
}

/**
 * Get all orders for the current restaurant
 */
export async function getOrders() {
    try {
        const res = await apiFetch('/api/v1/orders');

        if (!res.ok) {
            const errData = await res.json();
            return { success: false, error: errData.error || 'Failed to fetch orders' };
        }

        const orders = await res.json();
        return { success: true, data: orders };
    } catch (error) {
        console.error('Error fetching orders:', error);
        return { success: false, error: 'Failed to fetch orders' };
    }
}

/**
 * Get orders by session ID and table ID (customer-facing, used by order-status page)
 * This runs server-side to avoid mixed-content (HTTPS->HTTP) browser blocking.
 */
export async function getOrdersBySession(sessionId: string, tableId: string) {
    try {
        const backendUrl = getBackendUrl();
        const res = await fetch(
            `${backendUrl}/api/v1/orders/by-session?sessionId=${sessionId}&tableId=${tableId}`,
            { cache: 'no-store' }
        );

        if (!res.ok) {
            return { success: false, orders: [], error: `HTTP ${res.status}` };
        }

        const data = await res.json();
        return { success: true, orders: data.orders || [] };
    } catch (error: any) {
        console.error('Error fetching orders by session:', error);
        return { success: false, orders: [], error: error.message || 'Failed to fetch orders' };
    }
}

/** Save the checkout quote and optional feedback before showing UPI payment. */
export async function prepareCustomerCheckout(data: {
    orderId: string;
    sessionId: string;
    tableId: string;
    couponCode: string;
    tipAmount: number;
    foodRating?: number;
    experienceRating?: number;
    preparationRating?: number;
    packagingRating?: number;
    reviewText?: string;
}) {
    try {
        const backendUrl = getBackendUrl();
        const { orderId, ...body } = data;
        const res = await fetch(`${backendUrl}/api/v1/orders/${orderId}/checkout`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            cache: 'no-store',
        });
        const result = await res.json();
        if (!res.ok) return { success: false, error: result.error || 'Could not prepare payment' };
        revalidatePath('/dashboard/orders');
        return { success: true, order: result };
    } catch (error) {
        console.error('Prepare checkout error:', error);
        return { success: false, error: 'Payment service is unavailable' };
    }
}

/**
 * Update payment status
 */
export async function updatePaymentStatus(orderId: string, paymentStatus: 'paid', paymentMethod: 'upi' | 'cash') {
    try {
        const res = await apiFetch(`/api/v1/orders/${orderId}/payment`, {
            method: 'PATCH',
            body: JSON.stringify({ paymentStatus, paymentMethod }),
        });

        if (!res.ok) {
            const errData = await res.json();
            return { success: false, error: errData.error || 'Failed to update payment status' };
        }

        const order = await res.json();
        revalidatePath('/dashboard/orders');
        return { success: true, data: order };
    } catch (error) {
        console.error('Error updating payment status:', error);
        return { success: false, error: 'Failed to update payment status' };
    }
}
