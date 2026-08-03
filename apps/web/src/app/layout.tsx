import type { Metadata } from "next";
import { Chakra_Petch, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import "./globals.css";

/**
 * Three roles, deliberately separated.
 *
 * Chakra Petch is a display face — angular, with cut corners that echo the
 * interface's zero-radius geometry. It has the personality but not the
 * legibility for running text, so it sets the wordmark and nothing else.
 * Plex Sans and Plex Mono are a superfamily with matching metrics: the sans
 * carries every label and control, the mono carries anything a person might
 * copy or type. All three are self-hosted at build time.
 *
 * To use a licensed display face of your own instead, swap this for
 * `next/font/local` — see design/direction.md.
 */
const display = Chakra_Petch({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-display",
  display: "swap",
});

const ui = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-ui",
  display: "swap",
});

const data = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-data",
  display: "swap",
});

export const metadata: Metadata = {
  title: process.env.NEXT_PUBLIC_APP_NAME ?? "Cerebro",
  description: "Feature flags, promoted through an ordered pipeline",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${ui.variable} ${data.variable}`}>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
