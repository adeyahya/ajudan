import type { Metadata } from "next";
import { Geist, Geist_Mono, Pixelify_Sans } from "next/font/google";
import Link from "next/link";
import { Suspense } from "react";
import { OpenFolderBadge } from "@/components/open-folder-badge";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/** Game UI font: headings, tabs, buttons, badges. Long text stays in Geist. */
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

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${pixelify.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <header className="pixel-wood relative z-10 h-12 shrink-0 shadow-[0_3px_0_var(--frame),0_6px_0_rgb(0_0_0/0.3)]">
          <div className="mx-auto flex h-full max-w-6xl items-center gap-3 px-4 sm:px-6">
            <Link href="/" className="flex items-center gap-2">
              <PixelLogo />
              <span className="font-pixel text-xl leading-none text-ink drop-shadow-[1px_1px_0_#fff3c4]">Ajudan</span>
            </Link>
            <span className="font-pixel hidden text-xs text-ink/70 sm:inline">· your AI team, at work</span>
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
