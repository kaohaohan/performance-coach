import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { LocaleProvider } from "@/lib/i18n";
import { localeBootstrapScript } from "@/lib/i18n/locale";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "PumpLoop",
  description: "Strength training programs from your coach, tracked set by set.",
};

// viewportFit: "cover" lets the page draw edge-to-edge behind the notch/
// status bar/home indicator, which is what makes env(safe-area-inset-*)
// resolve to a real, nonzero value instead of 0. Every safe-area-aware
// padding in this app (e.g. pt-[max(1.5rem,env(safe-area-inset-top))] on
// header bars) silently degrades to just its flat fallback without this —
// harmless in ordinary Safari, which keeps content clear of its own chrome
// regardless, but wrong inside the Capacitor iOS shell's edge-to-edge
// WKWebView, where content can render under the status bar/notch.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // lang="en" is the server-rendered starting value, not the final one.
    // This is a server component and cannot know the device's locale, so the
    // inline script below corrects the attribute while the browser is still
    // parsing the HTML — before first paint, and before React has loaded.
    // suppressHydrationWarning is what tells React to keep the corrected DOM
    // value instead of treating it as a mismatch and re-rendering.
    // LocaleProvider re-applies it afterwards, which is what keeps it right
    // when the user switches language without reloading.
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: localeBootstrapScript() }} />
      </head>
      <body className="min-h-full flex flex-col">
        <LocaleProvider>
          <AuthProvider>{children}</AuthProvider>
        </LocaleProvider>
      </body>
    </html>
  );
}
