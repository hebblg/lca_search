// app/page.tsx
import { Suspense } from "react";
import SearchClient from "./search-client";

export default function Page() {
  return (
    <Suspense fallback={<main style={{ padding: 16 }}>Loading…</main>}>
      <SearchClient />
    </Suspense>
  );
}
