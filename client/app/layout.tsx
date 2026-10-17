import type { Metadata } from "next";
import "./globals.css";
import { Toaster } from "react-hot-toast";
import { BackendUrlProvider } from "@/components/providers/BackendUrlProvider";
import { getBackendUrl } from "@/lib/backendUrl";

export const metadata: Metadata = {
  title: "BitByte",
  description: "Digital menu and order management system for cafes and restaurants",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <BackendUrlProvider backendUrl={getBackendUrl()}>
          {children}
          <Toaster position="top-right" />
        </BackendUrlProvider>
      </body>
    </html>
  );
}
