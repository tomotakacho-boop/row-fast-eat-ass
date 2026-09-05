import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Row Fast Eat Ass Season 10 · Draft Room 2026",
    template: "%s · Row Fast Eat Ass Season 10",
  },
  description: "The standalone 2026 full-PPR draft room for Row Fast Eat Ass Season 10.",
  openGraph: {
    title: "Row Fast Eat Ass Season 10 · Draft Room 2026",
    description: "Live full-PPR rankings, watchlists, mock drafts, injury context, and roster planning for the 12-team ESPN league.",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
