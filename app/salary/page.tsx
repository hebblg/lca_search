// app/salary/page.tsx
import Link from "next/link";
import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import { pgPool } from "@/lib/pgPool";

export const runtime = "nodejs";
export const revalidate = 86400;

const INDEX_MIN_CASES = 500;

export const metadata: Metadata = {
  title: "H-1B LCA Wages by State",
  description:
    "Browse public H-1B LCA wage disclosure data by U.S. state, including case counts and wage percentiles.",
};

type StateRow = {
  state: string; // uppercase from MV
  total_cases: string | number;
  latest_year: number | null;
  wage_p50: string | number | null;
  wage_p25: string | number | null;
  wage_p75: string | number | null;
  refreshed_at: string | Date | null;
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

function formatDate(v: unknown) {
  if (!v) return "—";
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "2-digit" });
}

const SQL_INDEXABLE_STATES = /* sql */ `
select
  state,
  total_cases::bigint as total_cases,
  latest_year::int as latest_year,
  wage_p50::numeric as wage_p50,
  wage_p25::numeric as wage_p25,
  wage_p75::numeric as wage_p75,
  refreshed_at
from agg.lca_state_summary_mv
where total_cases >= $1
order by total_cases desc, state asc;
`;

const getIndexableStates = unstable_cache(
  async () => {
    const res = await pgPool.query<StateRow>(SQL_INDEXABLE_STATES, [INDEX_MIN_CASES]);
    // Safety: keep only valid 2-letter states
    return res.rows.filter((r) => typeof r.state === "string" && /^[A-Z]{2}$/.test(r.state));
  },
  ["salary-hub-indexable-states-v1"],
  { revalidate: 86400 }
);

export default async function SalaryHubPage() {
  const rows = await getIndexableStates();
  const updatedAt = rows.length ? rows.map((r) => r.refreshed_at).find(Boolean) : null;

  const topStates = rows.slice(0, 12);

  return (
    <main style={{ maxWidth: 1160, margin: "0 auto", padding: "26px 16px" }}>
      <header style={{ marginBottom: 18 }}>
        <h1 style={{ fontSize: 28, fontWeight: 750, margin: "0 0 8px 0" }}>
          H-1B LCA Wages by State
        </h1>
        <p style={{ margin: 0, lineHeight: 1.6 }}>
          Browse indexable state pages (only states with <strong>{INDEX_MIN_CASES}+</strong> cases).
          Updated: <strong>{formatDate(updatedAt)}</strong>.
        </p>
      </header>

      {/* Quick links */}
      <section
        style={{
          border: "1px solid rgba(0,0,0,0.1)",
          borderRadius: 12,
          padding: 16,
          marginBottom: 18,
        }}
      >
        <div style={{ fontSize: 16, fontWeight: 750, marginBottom: 8 }}>Top states by volume</div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
          {topStates.map((r) => {
            const stLower = r.state.toLowerCase();
            return (
              <Link
                key={r.state}
                href={`/salary/${stLower}`}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 10px",
                  borderRadius: 999,
                  border: "1px solid rgba(0,0,0,0.14)",
                  textDecoration: "none",
                }}
              >
                <strong>{r.state}</strong>
                <span style={{ opacity: 0.8 }}>{formatInt(r.total_cases)}</span>
              </Link>
            );
          })}
        </div>
      </section>

      {/* Table */}
      <section style={{ border: "1px solid rgba(0,0,0,0.1)", borderRadius: 12, padding: 16 }}>
        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 750 }}>All indexable states</div>
            <div style={{ fontSize: 12.5, opacity: 0.8, marginTop: 3 }}>
              Click a state to open its hub page. Use “Search” to jump into raw records.
            </div>
          </div>
          <div style={{ fontSize: 12.5, opacity: 0.85 }}>
            Total states listed: <strong>{rows.length}</strong>
          </div>
        </div>

        <div style={{ overflowX: "auto", marginTop: 10 }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["State", "Total cases", "Latest year", "Median wage (latest)", "P25–P75 (latest)", "Search"].map(
                  (h) => (
                    <th
                      key={h}
                      style={{
                        textAlign: "left",
                        fontSize: 13,
                        padding: "10px 8px",
                        borderBottom: "1px solid rgba(0,0,0,0.12)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {h}
                    </th>
                  )
                )}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const stLower = r.state.toLowerCase();
                return (
                  <tr key={r.state}>
                    <td style={td}>
                      <Link href={`/salary/${stLower}`} style={{ textDecoration: "none" }}>
                        <strong>{r.state}</strong>
                      </Link>
                    </td>
                    <td style={td}>{formatInt(r.total_cases)}</td>
                    <td style={td}>{r.latest_year ?? "—"}</td>
                    <td style={td}>{formatUSD(r.wage_p50)}</td>
                    <td style={td}>
                      {formatUSD(r.wage_p25)} – {formatUSD(r.wage_p75)}
                    </td>
                    <td style={td}>
                      <Link href={`/?state=${encodeURIComponent(r.state)}`}>Search</Link>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 ? (
                <tr>
                  <td style={td} colSpan={6}>
                    No states returned. Confirm your materialized views are refreshed and contain data.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <footer style={{ marginTop: 22, fontSize: 13, opacity: 0.85 }}>
        <p style={{ margin: 0, lineHeight: 1.6 }}>
          Data source: U.S. Department of Labor LCA public disclosure. LCA filings do not necessarily indicate approval.
        </p>
      </footer>
    </main>
  );
}

const td: React.CSSProperties = {
  padding: "10px 8px",
  borderBottom: "1px solid rgba(0,0,0,0.06)",
  verticalAlign: "top",
};
