"use client";

import { useEffect, useRef } from "react";
import { Capacitor } from "@capacitor/core";
import { parseInviteUniversalLink } from "@/lib/invite-universal-link";
import { usePathname, useRouter } from "next/navigation";

export function InviteUniversalLinkRouter() {
  const router = useRouter();
  const pathname = usePathname();
  const seen = useRef(new Set<string>());

  useEffect(() => {
    if (pathname) seen.current.delete(pathname);
  }, [pathname]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let disposed = false;
    let removeListener: (() => void) | undefined;
    const deliver = (value?: string) => {
      if (disposed || !value) return;
      const path = parseInviteUniversalLink(value);
      if (!path || seen.current.has(path)) return;
      seen.current.add(path);
      router.replace(path);
    };

    void import("@capacitor/app").then(async ({ App }) => {
      if (disposed) return;
      const handle = await App.addListener("appUrlOpen", ({ url }) => deliver(url));
      if (disposed) {
        await handle.remove();
        return;
      }
      removeListener = () => void handle.remove();
      const launch = await App.getLaunchUrl();
      deliver(launch?.url);
    }).catch(() => {
      // The web shell can still render if the native plugin is unavailable.
    });

    return () => {
      disposed = true;
      removeListener?.();
    };
  }, [router]);

  return null;
}
