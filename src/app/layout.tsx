import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { Lato } from "next/font/google";
import { Urbanist } from "next/font/google";
import { Lexend } from "next/font/google";
import Script from "next/script";
import { ClerkProvider } from "@clerk/nextjs";
import { TRPCProvider } from "@/components/providers/trpc-provider";
import { Toaster } from "@/components/ui/toaster";
import { ThemeColorSync } from "@/components/theme-color-sync";
import { Providers } from "./providers";
import { ScrollRestoration } from "@/components/scroll-restoration";
import { GOOGLE_ANALYTICS_ID } from "@/lib/google-analytics";
import "./globals.css";

const inter = Inter({ subsets: ["latin"] });
const lato = Lato({ subsets: ["latin"], weight: ["400", "700"] });
const urbanist = Urbanist({ subsets: ["latin"], weight: ["400", "700"] });
const lexend = Lexend({ subsets: ["latin"], weight: ["400", "700"] });
const metadataBaseUrl =
  process.env.NEXT_PUBLIC_APP_URL ||
  (process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : "http://localhost:3000");

export const metadata: Metadata = {
  metadataBase: new URL(metadataBaseUrl),
  title: "WIG",
  description: "Discover local events and connect with your community",
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#141416",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider>
      <html lang="en">
        <body className={urbanist.className}>
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
