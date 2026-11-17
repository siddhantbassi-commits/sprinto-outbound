import type { Metadata, Viewport } from "next";
import { Geist_Mono, Instrument_Sans } from "next/font/google";
import { cookies } from "next/headers";
import "./globals.css";

const sans = Instrument_Sans({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Sprinto Outbound", template: "%s · Sprinto Outbound" },
  description: "Cold outreach at scale: read the site, qualify, find the person, write the email. Gemini reads and writes; code decides.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: [{ media: "(prefers-color-scheme: dark)", color: "#150a11" }, { media: "(prefers-color-scheme: light)", color: "#fbf6f3" }] };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const t = (await cookies()).get("theme")?.value;
  const theme = t === "light" || t === "dark" ? t : undefined;
  return (
    <html lang="en" data-theme={theme} className={`${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
