import type { Metadata } from "next";
import {
  Bricolage_Grotesque,
  IBM_Plex_Mono,
  IBM_Plex_Sans,
  IBM_Plex_Sans_Condensed,
} from "next/font/google";
import "./globals.css";

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500"],
});

const plexCondensed = IBM_Plex_Sans_Condensed({
  variable: "--font-plex-condensed",
  subsets: ["latin"],
  weight: ["500", "600"],
});

// Display face — public pages and auth only, 32px and up. Never in the console.
const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Gather",
  description: "Speaker and session management for conferences",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // data-theme and data-density are read by tokens.css. Defaults are light and
    // compact; the theme and density providers will drive these per user.
    <html lang="en" data-density="compact" suppressHydrationWarning>
      <body
        className={`${plexSans.variable} ${plexMono.variable} ${plexCondensed.variable} ${bricolage.variable} font-sans antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
