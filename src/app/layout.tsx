import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: {
    default: "MZ Talent Intelligence",
    template: "%s · MZ Talent Intelligence",
  },
  description: "Company Finder AI — MZ Personalvermittlung. Azərbaycanlı işçiləri sponsorluq edən alman işəgötürənlərlə birləşdirir.",
  applicationName: "MZ Talent Intelligence",
  robots: { index: false, follow: false }, // internal admin tool — keep out of search engines
  formatDetection: { telephone: false, email: false, address: false },
  manifest: "/manifest.webmanifest",
  // Installable as a standalone app on phone/desktop
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "MZ Talent" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
  // Browser chrome color tracks the OS light/dark preference
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#080b0f" },
    { media: "(prefers-color-scheme: light)", color: "#f3f6f9" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="az" suppressHydrationWarning>
      <head>
        {/* Apply the saved (or system) theme before paint to avoid a flash */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('mz-theme');if(!t){t=window.matchMedia('(prefers-color-scheme: light)').matches?'light':'dark';}if(t==='light'){document.documentElement.classList.add('light');}}catch(e){}})();`,
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} min-h-screen antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
