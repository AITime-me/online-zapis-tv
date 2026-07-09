import type { Metadata } from "next";
import { fontBody, fontDisplay } from "@/lib/brand/fonts";
import { PublicSiteChrome } from "@/components/legal/public-site-chrome";
import "./globals.css";

export const metadata: Metadata = {
  title: "Твоё время — студия красоты",
  description:
    "Онлайн-запись в студию красоты «Твоё время». Выберите процедуру, специалиста и удобное время для визита.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ru"
      className={`${fontDisplay.variable} ${fontBody.variable} h-full antialiased`}
    >
      <body className="font-body min-h-full flex flex-col">
        <PublicSiteChrome>{children}</PublicSiteChrome>
      </body>
    </html>
  );
}
