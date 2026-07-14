import type { MetadataRoute } from "next";

// Web app manifest — lets the tool be installed as a standalone app on
// phone/desktop (Add to Home Screen / Install). Served at /manifest.webmanifest.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "MZ Talent Intelligence",
    short_name: "MZ Talent",
    description: "MZ Personalvermittlung — namizəd–işəgötürən uyğunlaşdırma və outreach.",
    start_url: "/az/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#080b0f",
    theme_color: "#080b0f",
    lang: "az",
    orientation: "portrait-primary",
    icons: [
      { src: "/logo-icon.jpeg", sizes: "512x512", type: "image/jpeg", purpose: "any" },
      { src: "/logo-icon.jpeg", sizes: "192x192", type: "image/jpeg", purpose: "maskable" },
      { src: "/favicon.ico", sizes: "48x48", type: "image/x-icon" },
    ],
  };
}
