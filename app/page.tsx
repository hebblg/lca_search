// app/page.tsx
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { unstable_cache } from "next/cache";
import SearchClient from "./search-client";
import { pgPool } from "@/lib/pgPool";

export const runtime = "nodejs";
export const revalidate = 86400;

const INDEX_MIN_CASES = 500;
const TOP_STATES_N = 20;
const NOINDEX_QUERY_KEYS = ["year", "state", "em"] as const;

type TopStateRow = {
  state: string; // uppercase in MV
  total_cases: string | number;
  latest_year: number | null;
  wage_p50: string | number | null;
};

function asNumber(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}
function formatInt(v: unknown) {
  return asNumber(v).toLocaleString("en-US", { maximumFractionDigits: 0 });
}
function formatUSD(v: unknown) {
  const n = typeof v === "string" || typeof v === "number" ? Number(v) : NaN;
  if (!Number.isFinite(n) || n <= 0) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}


const SQL_TOP_STATES = /* sql */ `
select
  state,
  total_cases::bigint as total_cases,
  latest_year::int as latest_year,
  wage_p50::numeric as wage_p50
from agg.lca_state_summary_mv
where total_cases >= $1
order by total_cases desc, state asc
limit $2;
`;

const getTopStates = unstable_cache(
  async () => {
    const res = await pgPool.query<TopStateRow>(SQL_TOP_STATES, [
      INDEX_MIN_CASES,
      TOP_STATES_N,
    ]);
    return res.rows.filter((r) => typeof r.state === "string" && /^[A-Z]{2}$/.test(r.state));
  },
  ["home-top-states-v1"],
  { revalidate: 86400 }
);

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Record<string, string | string[] | undefined>;
}): Promise<Metadata> {
  const hasQueryParams = NOINDEX_QUERY_KEYS.some((key) =>
    Object.prototype.hasOwnProperty.call(searchParams, key)
  );

  if (!hasQueryParams) return {};

  return {
    alternates: {
      canonical: "/",
    },
    robots: {
      index: false,
      follow: true,
    },
  };
}

export default async function Page() {
  const topStates = await getTopStates();

  return (
    <div>
      {/* SEO intro (lightweight, does not fight the search-first UX) */}
      <section style={{ maxWidth: 1160, margin: "0 auto", padding: "18px 16px 6px" }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, margin: "0 0 8px 0" }}>
          Search H-1B LCA Wage Records
        </h1>
        <p style={{ margin: 0, lineHeight: 1.6, opacity: 0.9 }}>
          Explore public U.S. Department of Labor LCA disclosure data by employer, job title, city, state, and year.
          Or browse summaries by state.
        </p>
      </section>

      {/* Your existing search UI */}
{/* Your existing search UI */}
    <section style={{ maxWidth: 1160, margin: "0 auto", padding: "14px 16px 0" }}>
      <Suspense fallback={<div style={{ padding: 16 }}>Loading…</div>}>
        <SearchClient />
      </Suspense>
    </section>


      {/* Browse by state (internal links to help indexing + user navigation) */}
      <section style={{ maxWidth: 1160, margin: "0 auto", padding: "18px 16px 28px" }}>
        <div
          style={{
            border: "1px solid rgba(0,0,0,0.1)",
            borderRadius: 12,
            padding: 16,
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
            <div>
              <h2 style={{ fontSize: 18, fontWeight: 800, margin: "0 0 6px 0" }}>
                Browse wages by state
              </h2>
              <p style={{ margin: 0, opacity: 0.85, lineHeight: 1.6 }}>
                These state hub pages include case counts, wage percentiles, and top cities/employers/jobs.
              </p>
            </div>

            <div style={{ alignSelf: "center" }}>
              <Link href="/salary" style={{ fontWeight: 700 }}>
                View all states →
              </Link>
            </div>
          </div>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 12 }}>
            {topStates.map((s) => {
              const stLower = s.state.toLowerCase();
              return (
                <Link
                  key={s.state}
                  href={`/salary/${stLower}`}
                  style={{
                    textDecoration: "none",
                    border: "1px solid rgba(0,0,0,0.14)",
                    borderRadius: 999,
                    padding: "8px 10px",
                    display: "inline-flex",
                    gap: 10,
                    alignItems: "center",
                  }}
                >
                  <strong>{s.state}</strong>
                  <span style={{ opacity: 0.85 }}>{formatInt(s.total_cases)} cases</span>
                  <span style={{ opacity: 0.85 }}>
                    {s.latest_year ? `· ${s.latest_year}` : ""} {s.wage_p50 ? `· ${formatUSD(s.wage_p50)} median` : ""}
                  </span>
                </Link>
              );
            })}

            {topStates.length === 0 ? (
              <p style={{ margin: "8px 0 0 0" }}>
                No states available yet. Confirm your materialized views are refreshed.
              </p>
            ) : null}
          </div>
        </div>
      </section>

    </div>
  );
}
