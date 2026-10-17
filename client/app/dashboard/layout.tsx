import { auth } from '@/lib/auth';
import { redirect } from 'next/navigation';
import Sidebar from '@/components/dashboard/Sidebar';
import OrderAlerts from '@/components/dashboard/OrderAlerts';
import LowStockAlerts from '@/components/dashboard/LowStockAlerts';
import { BrandFooter } from '@/components/BrandFooter';

export default async function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const session = await auth();

    if (!session) {
        redirect('/auth/signin');
    }

    return (
        <div className="flex min-h-dvh flex-col bg-slate-50 lg:h-dvh lg:flex-row">
            <Sidebar />
            <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
                <div className="flex min-h-full flex-col">
                    <div className="mx-auto w-full max-w-7xl flex-1 px-4 py-5 sm:px-6 sm:py-8">
                        <OrderAlerts restaurantId={session.user.restaurantId ? String(session.user.restaurantId) : undefined} baselineTime={Date.now()} />
                        <LowStockAlerts restaurantId={session.user.restaurantId ? String(session.user.restaurantId) : undefined} />
                        {children}
                    </div>
                    <BrandFooter className="flex h-24 w-full shrink-0 flex-col justify-center px-6" borderColor="#e2e8f0" />
                </div>
            </main>
        </div>
    );
}
