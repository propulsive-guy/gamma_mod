import NextAuth from 'next-auth';
import { authConfig } from '@/lib/auth.config';
import Credentials from 'next-auth/providers/credentials';
import { getBackendUrl } from '@/lib/backendUrl';

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

                const backendUrl = getBackendUrl();
                try {
                    const res = await fetch(`${backendUrl}/api/v1/auth/verify`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                            email,
                            password,
                        }),
                        signal: AbortSignal.timeout(12000),
                    });

                    if (res.status === 401) {
                        return null;
                    }
                    if (!res.ok) {
                        throw new Error(`Login verification service returned HTTP ${res.status}`);
                    }

                    const user = await res.json();
                    if (!user || typeof user.id !== 'string' || typeof user.email !== 'string') {
                        throw new Error('Login verification service returned an invalid user record');
                    }
                    return user; // Returns { id, email, name, role, restaurantId }
                } catch (error) {
                    console.error('NextAuth authorize fetch error:', error);
                    throw error;
                }
            },
        }),
    ],
});
