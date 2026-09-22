import type { Metadata } from "next";
import { Heebo } from "next/font/google";
import { brand } from "@/lib/brand";
import "./globals.css";

const heebo = Heebo({
  variable: "--font-heebo",
  subsets: ["hebrew", "latin"],
});

export const metadata: Metadata = {
  title: brand.title,
  description: "עוזר דיגיטלי לשאלות ביטוח בעברית",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="he" dir="rtl" data-brand={brand.id} className={`${heebo.variable} h-full antialiased`}>
      <body className="h-full min-h-dvh flex flex-col">{children}</body>
    </html>
  );
}
