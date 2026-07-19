import type { Metadata } from "next";
import { Bricolage_Grotesque, IBM_Plex_Mono, Instrument_Sans } from "next/font/google";
import "./globals.css";
import Providers from "../components/Providers";
import SiteNav from "../components/SiteNav";

const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-display-src" });
const sans = Instrument_Sans({ subsets: ["latin"], variable: "--font-sans-src" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-mono-src" });

export const metadata: Metadata = {
  title: "Steamline",
  description: "Steam-move detection on TxLINE World Cup odds, traded on devnet with play-money points.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body className="min-h-dvh antialiased">
        <Providers>
          <SiteNav />
          {children}
        </Providers>
      </body>
    </html>
  );
}
