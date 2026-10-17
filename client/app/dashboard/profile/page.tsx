import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import dbConnect from '@/lib/db';
import Restaurant from '@/models/Restaurant';
import React from 'react';
import ProfileForm from '@/components/dashboard/ProfileForm';

export default async function ProfilePage() {
    const session = await auth();
    if (!session || !session.user.restaurantId) {
        redirect('/auth/signin');
    }

    await dbConnect();
    const restaurant = await Restaurant.findById(session.user.restaurantId).lean();

    if (!restaurant) {
        return <div>Restaurant not found</div>;
    }

    return (
        <div className="mx-auto w-full max-w-3xl min-w-0 space-y-5 sm:space-y-6">
            {/* Header */}
            <div>
                <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
                    Restaurant Settings
                </h1>
                <p className="text-slate-500 mt-1 text-sm">
                    Manage your restaurant details, branding, and configuration
                </p>
            </div>

            <ProfileForm initialData={JSON.parse(JSON.stringify(restaurant))} />
        </div>
    );
}
