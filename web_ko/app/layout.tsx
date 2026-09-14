import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "복이피는길 제작실",
  description: "Korean YouTube script pipeline",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
