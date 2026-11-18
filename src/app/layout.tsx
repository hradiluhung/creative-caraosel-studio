import type { Metadata, Viewport } from "next";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://karosel.netlify.app"),
  title: "Karosel",
  description: "Free carousel maker for Instagram: photo journal templates, photos and video, right in your browser.",
  applicationName: "Karosel",
  appleWebApp: { capable: true, title: "Karosel", statusBarStyle: "default" },
  // What a shared link shows on social media and in chats.
  openGraph: {
    type: "website",
    siteName: "Karosel",
    title: "Karosel: free Instagram carousel maker",
    description: "Photo journal templates, seamless slides, photos and video. Free, works in your browser and on your phone.",
    url: "/",
    images: [{ url: "/icons/icon-512.png", width: 512, height: 512, alt: "Karosel" }],
  },
  twitter: { card: "summary", title: "Karosel: free Instagram carousel maker", images: ["/icons/icon-512.png"] },
  icons: { apple: "/icons/apple-touch-icon.png" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // The editor implements its own pinch zoom; page zoom would fight with it.
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafaf9" },
    { media: "(prefers-color-scheme: dark)", color: "#151514" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full">
        {children}
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
