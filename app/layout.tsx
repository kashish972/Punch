import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Keka Remote Punch",
  description: "Clock in and out of Keka from one page.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
