"use client";

import { useEffect } from "react";

/** Registers /sw.js, only in a production build and only where the browser allows a service worker (HTTPS, or localhost). It renders nothing. */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    const secure = window.location.protocol === "https:" || window.location.hostname === "localhost";
    if (process.env.NODE_ENV !== "production" || !secure || !("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => undefined);
  }, []);
  return null;
}
