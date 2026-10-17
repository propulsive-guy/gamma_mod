/** Resolve the server-only backend base URL used by Next.js server code. */
export function getBackendUrl(): string {
    const configuredUrl = process.env.BACKEND_URL?.trim();

    if (configuredUrl) {
        return configuredUrl.replace(/\/+$/, '');
    }

    if (process.env.NODE_ENV !== 'production') {
        return 'http://localhost:3001';
    }

    throw new Error('BACKEND_URL is not configured');
}
