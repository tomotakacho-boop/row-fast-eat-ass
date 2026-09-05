import type { Metadata } from "next";
import RedraftBoard from "./RedraftBoard";

export const metadata: Metadata = {
  title: "Row Fast Eat Ass Season 10 · Draft Room 2026",
  description: "A standalone full-PPR draft room for Row Fast Eat Ass Season 10 with live rankings, watchlists, simulations, injury context, and roster planning.",
};

export default function Home() {
  return <RedraftBoard />;
}
