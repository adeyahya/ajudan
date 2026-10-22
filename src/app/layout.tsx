import type { Metadata } from "next";
import { Geist_Mono, Inter, Pixelify_Sans } from "next/font/google";
import Link from "next/link";
import { Suspense } from "react";
import { HeaderTagline, OpenFolderBadge } from "@/components/open-folder-badge";
import "./globals.css";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/** The office's lettering: only for game badges (levels, streaks). */
const pixelify = Pixelify_Sans({
  variable: "--font-pixelify",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Ajudan",
  description: "AI teammates that help grow your business",
};

/** 10×10 pixel briefcase logo, drawn with rects so it stays crisp at any size. */
function PixelLogo() {
  const px = [
    "...####...",
    "...#..#...",
    "##########",
    "#oooooooo#",
    "#oooooooo#",
    "####gg####",
    "#oooooooo#",
    "#oooooooo#",
    "#oooooooo#",
    "##########",
  ];
  const fill: Record<string, string> = { "#": "#2a1d22", o: "#f4b942", g: "#fff3c4" };
  return (
    <svg viewBox="0 0 10 10" width={26} height={26} shapeRendering="crispEdges" aria-hidden>
      {px.flatMap((row, y) =>
        [...row].map((c, x) => (c === "." ? null : <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={fill[c]} />)),
      )}
    </svg>
  );
}

// <html lang> stays static: the root layout renders outside any <Suspense>, so reading the
// request (Accept-Language) or the business here would block prerendering under Cache
// Components. I18nProvider (src/components/i18n.tsx) updates it on the client, and the
// business layout and home page put `lang` on their own wrapper for the server HTML.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${inter.variable} ${geistMono.variable} ${pixelify.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <header className="relative z-10 h-12 shrink-0 border-b border-border bg-background">
          <div className="mx-auto flex h-full max-w-6xl items-center gap-3 px-4 sm:px-6">
            <Link href="/" className="flex items-center gap-2">
              <PixelLogo />
              <span className="text-[15px] font-semibold leading-none text-foreground">Ajudan</span>
            </Link>
            <Suspense fallback={null}>
              <HeaderTagline />
            </Suspense>
            <Suspense fallback={null}>
              <OpenFolderBadge />
            </Suspense>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
