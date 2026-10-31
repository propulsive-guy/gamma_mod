/** Resolve the server-only backend base URL used by Next.js server code. */
export const PRODUCTION_BACKEND_FALLBACK = 'https://3-108-33-215.sslip.io';

export function getBackendUrl(): string {
    const configuredUrl = process.env.BACKEND_URL?.trim();

    if (configuredUrl) {
        return configuredUrl.replace(/\/+$/, '');
    }

    if (process.env.NODE_ENV !== 'production') {
        return 'http://localhost:3001';
    }

    // Keep production sign-in and server actions available if BACKEND_URL was
    // omitted from a Vercel environment. The configured value still takes priority.
    return PRODUCTION_BACKEND_FALLBACK;
}
