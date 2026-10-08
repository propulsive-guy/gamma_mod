'use client';

export default function AnalyticsError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
    return (
        <div role="alert" className="mx-auto max-w-xl rounded-2xl border border-amber-200 bg-white p-8 text-center shadow-sm">
            <h2 className="text-lg font-bold text-slate-900">Analytics is temporarily unavailable</h2>
            <p className="mt-2 text-sm text-slate-600">The rest of your dashboard is still available. Try loading this page again in a moment.</p>
            <button onClick={reset} className="mt-5 rounded-xl bg-slate-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700">
                Retry analytics
            </button>
        </div>
    );
}
