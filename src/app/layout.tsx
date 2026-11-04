import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Township",
  description: "Resident app and staff console",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
