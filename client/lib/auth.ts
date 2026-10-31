import NextAuth from 'next-auth';
import { authConfig } from '@/lib/auth.config';
import Credentials from 'next-auth/providers/credentials';
import { getBackendUrl, PRODUCTION_BACKEND_FALLBACK } from '@/lib/backendUrl';

export const { handlers, auth, signIn, signOut } = NextAuth({
    ...authConfig,
    providers: [
        Credentials({
            credentials: {
                email: { label: 'Email', type: 'email' },
                password: { label: 'Password', type: 'password' },
            },
            async authorize(credentials) {
                const email = typeof credentials?.email === 'string' ? credentials.email.trim().toLowerCase() : '';
                const password = typeof credentials?.password === 'string' ? credentials.password : '';
                if (!email || !password) {
                    return null;
                }

                const primaryUrl = getBackendUrl();
                const backendUrls = process.env.NODE_ENV === 'production'
                    ? [...new Set([primaryUrl, PRODUCTION_BACKEND_FALLBACK])]
                    : [primaryUrl];
                let lastError: unknown;

                for (const backendUrl of backendUrls) {
                    try {
                        const res = await fetch(`${backendUrl}/api/v1/auth/verify`, {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                            },
                            body: JSON.stringify({ email, password }),
                            signal: AbortSignal.timeout(8000),
                        });

                        if (res.status === 401) {
                            return null;
                        }
                        if (!res.ok) {
                            lastError = new Error(`Login verification service returned HTTP ${res.status}`);
                            continue;
                        }

                        const user = await res.json();
                        if (!user || typeof user.id !== 'string' || typeof user.email !== 'string') {
                            lastError = new Error('Login verification service returned an invalid user record');
                            continue;
                        }
                        return user; // Returns { id, email, name, role, restaurantId }
                    } catch (error) {
                        lastError = error;
                    }
                }

                console.error('NextAuth could not reach a login verification service:', lastError);
                throw lastError instanceof Error ? lastError : new Error('Login verification service is unavailable');
            },
        }),
    ],
});
