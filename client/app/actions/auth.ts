'use server';

import { signIn } from '@/lib/auth';
import { AuthError } from 'next-auth';
import { getBackendUrl } from '@/lib/backendUrl';

export async function signInAction(email: string, password: string) {
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (!normalizedEmail || typeof password !== 'string' || !password) {
        return { success: false, error: 'Enter your email and password.' };
    }

    try {
        const responseUrl = await signIn('credentials', {
            email: normalizedEmail,
            password,
            redirect: false,
            redirectTo: '/dashboard',
        });

        if (typeof responseUrl === 'string') {
            const authUrl = new URL(responseUrl, 'http://auth.local');
            const authError = authUrl.searchParams.get('error');
            if (authError === 'CredentialsSignin') {
                return { success: false, error: 'Email or password is incorrect.' };
            }
            if (authError) {
                console.error('Auth.js sign-in returned an error:', authError);
                return { success: false, error: 'Login service is temporarily unavailable. Please try again.' };
            }
        }

        return { success: true };
    } catch (error) {
        if (error instanceof AuthError) {
            if (error.type === 'CredentialsSignin') {
                return { success: false, error: 'Email or password is incorrect.' };
            }
            console.error('Auth.js sign-in failed:', error.type);
            return { success: false, error: 'Login service is temporarily unavailable. Please try again.' };
        }
        console.error('Sign-in action failed:', error);
        return { success: false, error: 'Login service is temporarily unavailable. Please try again.' };
    }
}

export async function signUpAction(data: {
    name: string;
    email: string;
    password: string;
    restaurantName: string;
    fssaiNumber?: string;
    phone?: string;
    address: string;
    secretKey: string;
}) {
    try {
        const backendUrl = getBackendUrl();
        const res = await fetch(`${backendUrl}/api/v1/auth/signup`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(data),
        });

        if (!res.ok) {
            const errData = await res.json();
            return { success: false, error: errData.error || 'Failed to create account' };
        }

        return { success: true };
    } catch (error) {
        console.error('Signup error:', error);
        return { success: false, error: 'Failed to create account' };
    }
}
