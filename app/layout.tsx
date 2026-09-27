import type { Metadata, Viewport } from "next";
import { Montserrat } from "next/font/google";
import "./globals.css";
import { DemoBanner } from "@/components/site/demo-banner";

// Montserrat matches the logo's lettering: wide, heavy geometric forms with angled terminals.
const montserrat = Montserrat({
  subsets: ["latin"],
  variable: "--font-montserrat",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Clutch — independent mechanics you can verify",
    template: "%s · Clutch",
  },
  description:
    "See verified certifications, repair history, experience, pricing and reviews before handing someone your keys.",
};

export const viewport: Viewport = {
  themeColor: "#f4f5f1",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={montserrat.variable}>
      <body className="min-h-dvh">
        <DemoBanner />
        {children}
      </body>
    </html>
  );
}
