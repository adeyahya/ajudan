import type { Metadata } from "next";
import { Geist_Mono, Inter, Pixelify_Sans } from "next/font/google";
import Link from "next/link";
import { PixelLogo } from "@/components/kit";
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
  variable: "--font-game-face",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Ajudan",
  description: "AI teammates that help grow your business",
};

/**
 * Runs before first paint: restores the business sidebar's width and collapsed state
 * from localStorage (src/app/b/[id]/nav.tsx), and documents' full width
 * (src/components/doc-layout.tsx), so the layout never jumps on hydration.
 */
const SIDEBAR_SCRIPT = `try{var d=document.documentElement,w=parseInt(localStorage.getItem("ajudan:sidebar:w")||"",10);if(w>=200&&w<=360)d.style.setProperty("--sidebar-w-open",w+"px");if(localStorage.getItem("ajudan:sidebar:collapsed")==="1")d.setAttribute("data-sidebar","collapsed");["workspace","team","settings"].forEach(function(n){if(localStorage.getItem("ajudan:sidebar:sec:"+n)==="0")d.setAttribute("data-sec-"+n,"closed")});if(localStorage.getItem("ajudan:doc:wide")==="1")d.setAttribute("data-doc-wide","")}catch(e){}`;

// <html lang> stays static: the root layout renders outside any <Suspense>, so reading the
// request (Accept-Language) or the business here would block prerendering under Cache
// Components. I18nProvider (src/components/i18n.tsx) updates it on the client, and the
// business layout and home page put `lang` on their own wrapper for the server HTML.
// suppressHydrationWarning: SIDEBAR_SCRIPT sets a style and data attribute on <html>.
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${geistMono.variable} ${pixelify.variable} h-full antialiased`}
    >
      <body className="flex min-h-full flex-col">
        <script dangerouslySetInnerHTML={{ __html: SIDEBAR_SCRIPT }} />
        {/*
          The home page's top bar (UI-PLAN §3.13). A business renders its own chrome
          (sidebar + top bar), and globals.css hides this one under it. The home page can
          put controls on the right through the #site-header-actions slot.
        */}
        <header className="site-header sticky top-0 z-20 h-14 shrink-0 bg-background/95 backdrop-blur-sm">
          <div className="mx-auto flex h-full max-w-[var(--content-w-wide)] items-center gap-2.5 px-4 sm:px-12">
            <Link href="/" className="-mx-1.5 flex items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-hover">
              <PixelLogo size={22} />
              <span className="text-[15px] leading-5 font-semibold text-foreground">Ajudan</span>
            </Link>
            <div id="site-header-actions" className="ml-auto flex items-center gap-2" />
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
