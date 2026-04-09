import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Catalyst Brands Store Analytics",
  description: "Catalyst Brands retail performance dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
