import type { Metadata } from "next";
import { Suspense } from "react";
import SearchClient from "../search-client";

export const metadata: Metadata = {
  title: "Search H-1B LCA Wages",
  description: "Search public H-1B LCA wage disclosure data.",
  alternates: { canonical: "/" },
  robots: { index: false, follow: true },
};

export default function SearchPage() {
  return (
    <section style={{ maxWidth: 1160, margin: "0 auto", padding: "14px 16px 0" }}>
      <Suspense fallback={<div style={{ padding: 16 }}>Loading…</div>}>
        <SearchClient />
      </Suspense>
    </section>
  );
}
