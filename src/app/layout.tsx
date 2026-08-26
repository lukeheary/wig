import type { Metadata, Viewport } from "next";
import { createElement } from "react";
import Script from "next/script";
import { ClerkProvider } from "@clerk/nextjs";
import { TRPCProvider } from "@/components/providers/trpc-provider";
import { Toaster } from "@/components/ui/toaster";
import { ThemeColorSync } from "@/components/theme-color-sync";
import { Providers } from "./providers";
import { ScrollRestoration } from "@/components/scroll-restoration";
import { GOOGLE_ANALYTICS_ID } from "@/lib/google-analytics";
import "./globals.css";

const metadataBaseUrl =
  process.env.NEXT_PUBLIC_APP_URL ||
  (process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(metadataBaseUrl),
  title: "WIG",
  description: "Discover local events and connect with your community",
  icons: {
    icon: "/wig-logo.svg",
  },
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#000000",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="en">
        <head>
          {createElement("meta", {
            name: "impact-site-verification",
            value: "48bb8a3a-aca5-4981-aea2-7729c02877ca",
          } as any)}
        </head>
        <body>
          <Script
            src={`https://www.googletagmanager.com/gtag/js?id=${GOOGLE_ANALYTICS_ID}`}
            strategy="afterInteractive"
          />
          <Script id="google-analytics" strategy="afterInteractive">
            {`
              window.dataLayer = window.dataLayer || [];
              function gtag(){dataLayer.push(arguments);}
              window.gtag = gtag;
              gtag('js', new Date());
              gtag('config', '${GOOGLE_ANALYTICS_ID}');
            `}
          </Script>
          <TRPCProvider>
            <Providers>
              <ThemeColorSync />
              <ScrollRestoration />
              {children}
              <Toaster />
            </Providers>
          </TRPCProvider>
        </body>
      </html>
    </ClerkProvider>
  );
}
