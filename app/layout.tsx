import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const origin = `${protocol}://${host}`;

  return {
    metadataBase: new URL(origin),
    title: "Lea would you marry me — CV vers QR code",
    description: "Transformez gratuitement votre CV PDF en QR code à partager.",
    icons: { icon: "/og.png", shortcut: "/og.png" },
    robots: { index: true, follow: true },
    openGraph: {
      title: "Lea would you marry me",
      description: "Un CV, un QR code, un partage instantané.",
      type: "website",
      images: [{ url: "/og.png", width: 1536, height: 909, alt: "Lea would you marry me — CV vers QR code" }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Lea would you marry me",
      description: "Un CV, un QR code, un partage instantané.",
      images: ["/og.png"],
    },
  };
}

export const viewport: Viewport = {
  themeColor: "#050505",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const apiBase = process.env.NEXT_PUBLIC_UPLOAD_API_URL ?? "";
  const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";

  return (
    <html lang="fr">
      <head>
        <meta name="upload-api-base" content={apiBase} />
        <meta name="turnstile-site-key" content={turnstileSiteKey} />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        {children}
      </body>
    </html>
  );
}
