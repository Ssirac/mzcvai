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
    default: "Germany Career Center",
    template: "%s · Germany Career Center",
  },
  description: "Germany Career Center — ixtisaslı işçiləri alman işəgötürənlərlə birləşdirir.",
  applicationName: "Germany Career Center",
  robots: { index: false, follow: false }, // internal admin tool — keep out of search engines
  formatDetection: { telephone: false, email: false, address: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="az">
      <body
        className={`${geistSans.variable} ${geistMono.variable} bg-gray-950 text-gray-100 min-h-screen antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
