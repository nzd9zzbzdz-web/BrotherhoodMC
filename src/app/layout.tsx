import type { Metadata } from "next";
import {
  EB_Garamond,
  Inter,
  JetBrains_Mono,
  Lato,
} from "next/font/google";
import localFont from "next/font/local";
import "./globals.css";

// All tenant-selectable fonts load once here and are referenced by CSS
// variable name from org branding docs (allowlist — no arbitrary font loading).
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});
const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});
// Cloister Black (Dieter Steffmann, free) — the classic Old English face used
// across the club's brand art; self-hosted, referenced as --font-blackletter.
const blackletter = localFont({
  src: "../fonts/CloisterBlack.ttf",
  variable: "--font-blackletter",
  display: "swap",
});
const garamond = EB_Garamond({
  subsets: ["latin"],
  variable: "--font-garamond",
  display: "swap",
});
const lato = Lato({
  weight: ["300", "400", "700"],
  subsets: ["latin"],
  variable: "--font-lato",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Brotherhood Portal",
  description: "Community organization management platform",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${inter.variable} ${jetbrains.variable} ${blackletter.variable} ${garamond.variable} ${lato.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
