import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'auto_YT — Sâm Kể Chuyện Audio Drama Engine',
  description: 'Automated 2.5-hour Vietnamese Storytelling & OmniVoice Audio Pipeline',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="vi" className="dark">
      <body className="bg-slate-950 text-slate-100 antialiased selection:bg-amber-500/30 selection:text-amber-200">
        {children}
      </body>
    </html>
  );
}
