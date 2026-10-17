import { cookies } from 'next/headers';
import { getBackendUrl } from '@/lib/backendUrl';

/**
 * Perform a fetch request to the Express backend, automatically forwarding user session cookies.
 */
export async function apiFetch(path: string, options: RequestInit = {}) {
    const backendUrl = getBackendUrl();
    
    const headers = new Headers(options.headers);
    
    // Set content-type to application/json by default if body is present
    if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
        headers.set('Content-Type', 'application/json');
    }

    try {
        const cookieStore = await cookies();
        const allCookies = cookieStore.getAll()
            .map(c => `${c.name}=${c.value}`)
            .join('; ');
        
        if (allCookies) {
            headers.set('Cookie', allCookies);
        }
    } catch (e) {
        // cookies() can throw when called outside a request context, ignore gracefully
    }

    const response = await fetch(`${backendUrl}${path}`, {
        ...options,
        headers,
    });

    return response;
}
