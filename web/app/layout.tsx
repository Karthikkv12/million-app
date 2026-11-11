import type { Metadata, Viewport } from "next";
import { DM_Sans, DM_Mono } from "next/font/google";
import "./globals.css";
import Providers from "./providers";

const sans = DM_Sans({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = DM_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-mono", display: "swap" });

// Apply the saved / OS theme before first paint to avoid a light→dark flash
const THEME_BOOT = `try{var t=localStorage.getItem("of-theme");if(t!=="light"&&t!=="dark"){t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}if(t==="dark")document.documentElement.classList.add("dark")}catch(e){}`;

export const metadata: Metadata = {
  title: "OptionFlow",
  description: "Dealer positioning, gamma exposure and options flow",
  // Installable (Add to Home Screen): iPhone only delivers web push to installed apps.
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "OptionFlow", statusBarStyle: "default" },
  icons: { icon: "/favicon.ico", apple: "/apple-touch-icon.png" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  minimumScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT }} />
      </head>
      <body
        className={`${sans.variable} ${mono.variable} font-sans antialiased`}
        style={{ margin: 0 }}
      >
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
