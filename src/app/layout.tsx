import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Ajudan",
  description: "AI teammates that help grow your business",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <header className="border-b border-border px-4 sm:px-6 h-12 flex items-center gap-3 shrink-0">
          <Link href="/" className="font-semibold tracking-tight flex items-center gap-2">
            <span className="inline-block size-5 rounded-md bg-primary" />
            Ajudan
          </Link>
          <span className="text-xs text-muted-foreground">AI teammates for your business</span>
        </header>
        {children}
      </body>
    </html>
  );
}
