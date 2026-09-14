import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "auto_YT :: KO-JP Content Pipeline",
  description: "Cross-Cultural Korean to Japanese Video Localization Pipeline",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
