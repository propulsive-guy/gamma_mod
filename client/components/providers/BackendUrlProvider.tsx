'use client';

import { createContext, useContext } from 'react';

const BackendUrlContext = createContext('');

export function BackendUrlProvider({
    backendUrl,
    children,
}: {
    backendUrl: string;
    children: React.ReactNode;
}) {
    return (
        <BackendUrlContext.Provider value={backendUrl}>
            {children}
        </BackendUrlContext.Provider>
    );
}

export function useBackendUrl() {
    return useContext(BackendUrlContext);
}
