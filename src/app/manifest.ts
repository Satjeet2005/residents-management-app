import type { MetadataRoute } from "next";
import { PAPER } from "@/lib/brand";

/**
 * The web app manifest: what makes Township installable. It is served at /manifest.webmanifest without a login. The colours are the paper token (a light status bar with dark
 * icons: ink on paper is 16.37:1). The maskable icon keeps its content inside the central 60%.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Township",
    short_name: "Township",
    description: "Resident app and staff console",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    theme_color: PAPER,
    background_color: PAPER,
    lang: "en",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
