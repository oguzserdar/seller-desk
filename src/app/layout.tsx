import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import { ModeBanner } from "@/components/mode-banner";
import "@/components/arc/foundation.css";
import "./globals.css";

// Shop identity, sandbox status and credentials belong to runtime, not build-time prerendering.
export const dynamic = "force-dynamic";

// Arc's pairing: Geist for headings and figures, Inter for reading, Geist Mono for record lines.
const display = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const body = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
// Record lines appear only on owner screens; the face downloads when used instead of preloading on every page.
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap", preload: false });

export const metadata: Metadata = {
  title: { default: "Seller Desk", template: "%s · Seller Desk" },
  description: "Open-source seller desk for PayPal sellers: a buyer assistant, reviewed quotes, verified PayPal checkout and an owner desk.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f6f7f9",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body className="min-h-dvh antialiased">
        <ModeBanner />
        {children}
      </body>
    </html>
  );
}
