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
                if (!credentials?.email || !credentials?.password) {
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
                            email: credentials.email,
                            password: credentials.password,
                        }),
                    });

                    if (!res.ok) {
                        return null;
                    }

                    const user = await res.json();
                    return user; // Returns { id, email, name, role, restaurantId }
                } catch (error) {
                    console.error('NextAuth authorize fetch error:', error);
                    return null;
                }
            },
        }),
    ],
});
