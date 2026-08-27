import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";

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
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
