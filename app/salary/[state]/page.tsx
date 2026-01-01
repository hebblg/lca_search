// app/salary/[state]/page.tsx
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import type { ReactNode } from "react";
import { pgPool } from "@/lib/pgPool";

export const runtime = "nodejs";
export const revalidate = 86400;

const TOP_N = 25;
const SITE_URL = "https://www.h1bdata.fyi";

/** US state/territory name map (SEO: use full names in titles/snippets). */
const STATE_NAME: Record<string, string> = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
  DC: "District of Columbia",
};

function isValidStateSlug(s: string) {
  return /^[a-zA-Z]{2}$/.test(s);
}
function toUpperState(s: string) {
  return s.toUpperCase();
}
function toLowerState(s: string) {
  return s.toLowerCase();
}
function getStateName(stateUpper: string) {
  return STATE_NAME[stateUpper] ?? stateUpper;
}

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
  if (!Number.isFinite(n)) return "—";
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

function safeJsonArray(v: unknown): any[] {
  if (!v) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

type YearPoint = {
  year: number;
  total_cases: number;
  wage_p25: number;
  wage_p50: number;
  wage_p75: number;
};

function normalizeYearSeries(raw: unknown): YearPoint[] {
  const arr = safeJsonArray(raw);
  return arr
    .map((x) => ({
      year: asNumber((x as any).year),
      total_cases: asNumber((x as any).total_cases),
      wage_p25: asNumber((x as any).wage_p25),
      wage_p50: asNumber((x as any).wage_p50),
      wage_p75: asNumber((x as any).wage_p75),
    }))
    .filter((p) => Number.isFinite(p.year) && p.year > 0)
    .sort((a, b) => a.year - b.year);
}

/**
 * 4 queries total:
 * 1) Summary (includes year-series JSON from state_year_summary)
 * 2) Top cities
 * 3) Top employers
 * 4) Top jobs
 */
const SQL_STATE_SUMMARY = /* sql */ `
WITH yrs AS (
  SELECT
    year,
    total_cases,
    wage_p25,
    wage_p50,
    wage_p75
  FROM agg.lca_state_year_summary_mv
  WHERE state = $1
  ORDER BY year ASC
)
SELECT
  s.state,
  s.total_cases::bigint          AS total_cases,
  s.latest_year::int             AS latest_year,
  s.wage_p25::numeric            AS wage_p25,
  s.wage_p50::numeric            AS wage_p50,
  s.wage_p75::numeric            AS wage_p75,
  s.wage_p90::numeric            AS wage_p90,
  s.wage_n_latest_year::bigint   AS wage_n_latest_year,
  s.latest_decision_date         AS latest_decision_date,
  s.refreshed_at                 AS refreshed_at,
  (
    SELECT json_agg(
      json_build_object(
        'year', y.year,
        'total_cases', y.total_cases,
        'wage_p25', y.wage_p25,
        'wage_p50', y.wage_p50,
        'wage_p75', y.wage_p75
      )
      ORDER BY y.year
    )
    FROM yrs y
  ) AS year_series
FROM agg.lca_state_summary_mv s
WHERE s.state = $1
LIMIT 1;
`;

const SQL_TOP_CITIES = /* sql */ `
SELECT
  COALESCE(NULLIF(TRIM(city), ''), 'Unknown') AS city,
  case_count::bigint   AS case_count,
  median_wage::numeric AS median_wage,
  rnk::int             AS rnk
FROM agg.lca_state_top_cities_mv
WHERE state = $1
ORDER BY rnk ASC
LIMIT $2;
`;

const SQL_TOP_EMPLOYERS = /* sql */ `
SELECT
  COALESCE(NULLIF(TRIM(employer_name), ''), 'Unknown') AS employer_name,
  case_count::bigint AS case_count,
  rnk::int           AS rnk
FROM agg.lca_state_top_employers_mv
WHERE state = $1
ORDER BY rnk ASC
LIMIT $2;
`;

const SQL_TOP_JOBS = /* sql */ `
SELECT
  COALESCE(NULLIF(TRIM(job_title), ''), 'Unknown') AS job_title,
  case_count::bigint AS case_count,
  rnk::int           AS rnk
FROM agg.lca_state_top_jobs_mv
WHERE state = $1
ORDER BY rnk ASC
LIMIT $2;
`;

type SummaryRow = {
  state: string;
  total_cases: string | number;
  latest_year: number | null;
  wage_p25: string | number | null;
  wage_p50: string | number | null;
  wage_p75: string | number | null;
  wage_p90: string | number | null;
  wage_n_latest_year: string | number | null;
  latest_decision_date: string | Date | null;
  refreshed_at: string | Date | null;
  year_series: unknown;
};

type CityRow = {
  city: string;
  case_count: string | number;
  median_wage: string | number | null;
  rnk: number;
};

type EmployerRow = {
  employer_name: string;
  case_count: string | number;
  rnk: number;
};

type JobRow = {
  job_title: string;
  case_count: string | number;
  rnk: number;
};

const getStateHubData = unstable_cache(
  async (stateUpper: string, topN: number) => {
    const [summaryRes, citiesRes, employersRes, jobsRes] = await Promise.all([
      pgPool.query<SummaryRow>(SQL_STATE_SUMMARY, [stateUpper]),
      pgPool.query<CityRow>(SQL_TOP_CITIES, [stateUpper, topN]),
      pgPool.query<EmployerRow>(SQL_TOP_EMPLOYERS, [stateUpper, topN]),
      pgPool.query<JobRow>(SQL_TOP_JOBS, [stateUpper, topN]),
    ]);

    return {
      summary: summaryRes.rows[0] ?? null,
      cities: citiesRes.rows,
      employers: employersRes.rows,
      jobs: jobsRes.rows,
    };
  },
  ["state-hub-v4"],
  { revalidate: 86400 }
);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ state: string }>;
}): Promise<Metadata> {
  const { state: slug } = await params;

  if (!isValidStateSlug(slug)) {
    return { title: "H-1B Salary Data (LCA)", robots: { index: false, follow: false } };
  }

  const stateLower = toLowerState(slug);
  const stateUpper = toUpperState(slug);
  const stateName = getStateName(stateUpper);

  const data = await getStateHubData(stateUpper, TOP_N);

  if (!data.summary) {
    return {
      title: `H-1B Salary Data (LCA) – ${stateName}`,
      description: `Public H-1B LCA wage disclosure data for ${stateName}.`,
      alternates: { canonical: `/salary/${stateLower}` },
      robots: { index: false, follow: false },
    };
  }

  const totalCases = asNumber(data.summary.total_cases);
  const latestYear = data.summary.latest_year;
  const median = data.summary.wage_p50;
  const indexable = totalCases >= 500;

  // Build a concise, query-aligned title and description.
  const title = latestYear
    ? `${stateName} H-1B Salary Data (LCA) – ${latestYear}`
    : `${stateName} H-1B Salary Data (LCA)`;

  const descParts: string[] = [];
  descParts.push(`Explore ${formatInt(totalCases)} public H-1B LCA filings in ${stateName}`);
  if (latestYear) descParts.push(`through ${latestYear}`);
  if (median != null && asNumber(median) > 0 && latestYear) {
    descParts.push(`(median ${formatUSD(median)} in ${latestYear})`);
  }
  descParts.push(`See trends and top cities, employers, and job titles.`);

  const description = descParts.join(" ").replace(/\s+/g, " ").trim();

  const url = `${SITE_URL}/salary/${stateLower}`;
  const ogTitle = title;
  const ogDescription = description;

  return {
    title,
    description,
    alternates: { canonical: `/salary/${stateLower}` },
    robots: {
      index: indexable,
      follow: indexable,
      googleBot: { index: indexable, follow: indexable },
    },
    openGraph: {
      title: ogTitle,
      description: ogDescription,
      url,
      siteName: "h1bdata.fyi",
      type: "website",
    },
    twitter: {
      card: "summary",
      title: ogTitle,
      description: ogDescription,
    },
  };
}

export default async function Page({
  params,
}: {
  params: Promise<{ state: string }>;
}) {
  const { state: raw } = await params;

  if (!isValidStateSlug(raw)) notFound();

  const stateLower = toLowerState(raw);
  if (raw !== stateLower) redirect(`/salary/${stateLower}`);

  const stateUpper = toUpperState(stateLower);
  const stateName = getStateName(stateUpper);

  const { summary, cities, employers, jobs } = await getStateHubData(stateUpper, TOP_N);
  if (!summary) notFound();

  const totalCases = asNumber(summary.total_cases);
  const yearSeries = normalizeYearSeries(summary.year_series);

  const topCity = cities?.[0]?.city;
  const topEmployer = employers?.[0]?.employer_name;
  const topJob = jobs?.[0]?.job_title;

  // Breadcrumb JSON-LD (helps Google understand site hierarchy)
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "Salary by State", item: `${SITE_URL}/salary` },
      { "@type": "ListItem", position: 3, name: `${stateName} (${stateUpper})`, item: `${SITE_URL}/salary/${stateLower}` },
    ],
  };

  return (
    <main style={{ maxWidth: 1160, margin: "0 auto", padding: "26px 16px" }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }}
      />

      <header style={{ marginBottom: 18 }}>
        <div style={{ marginBottom: 10 }}>
          <Link href="/salary" style={{ textDecoration: "none" }}>
            ← All states
          </Link>
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <div>
            <h1 style={{ fontSize: 28, fontWeight: 750, margin: "0 0 8px 0" }}>
              {stateName} H-1B Salary Data (LCA) <span style={{ opacity: 0.8 }}>({stateUpper})</span>
            </h1>

            <p style={{ margin: 0, lineHeight: 1.6 }}>
              Total cases: <strong>{formatInt(summary.total_cases)}</strong>
              {summary.latest_year ? (
                <>
                  {" "}
                  · Latest year: <strong>{summary.latest_year}</strong>
                </>
              ) : null}{" "}
              · Updated: <strong>{formatDate(summary.refreshed_at)}</strong>
            </p>

            <p style={{ margin: "10px 0 0 0", lineHeight: 1.6 }}>
              <Link href={`/?state=${encodeURIComponent(stateUpper)}`}>
                Search all records in {stateName} →
              </Link>
            </p>
          </div>

          <div style={{ minWidth: 260 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Metric label={`P25 (${summary.latest_year ?? "latest"})`} value={formatUSD(summary.wage_p25)} />
              <Metric label={`Median (${summary.latest_year ?? "latest"})`} value={formatUSD(summary.wage_p50)} />
              <Metric label={`P75 (${summary.latest_year ?? "latest"})`} value={formatUSD(summary.wage_p75)} />
              <Metric label={`P90 (${summary.latest_year ?? "latest"})`} value={formatUSD(summary.wage_p90)} />
            </div>
          </div>
        </div>

        {totalCases < 500 ? (
          <div
            style={{
              marginTop: 14,
              padding: "10px 12px",
              border: "1px solid rgba(0,0,0,0.12)",
              borderRadius: 10,
              background: "rgba(0,0,0,0.02)",
              lineHeight: 1.55,
            }}
          >
            This page is marked <strong>noindex</strong> because total cases are below 500.
          </div>
        ) : null}
      </header>

      {/* ✅ Quality block (unique per state, improves indexability) */}
      <section
        style={{
          margin: "0 0 22px 0",
          border: "1px solid rgba(0,0,0,0.1)",
          borderRadius: 12,
          padding: 16,
          background: "rgba(0,0,0,0.02)",
          lineHeight: 1.65,
        }}
      >
        <h2 style={{ fontSize: 16, fontWeight: 800, margin: "0 0 8px 0" }}>
          {stateName} wage snapshot
        </h2>

        <p style={{ margin: 0 }}>
          {summary.latest_year ? (
            <>
              In <strong>{stateName}</strong>, the <strong>median annual wage</strong> in{" "}
              <strong>{summary.latest_year}</strong> was <strong>{formatUSD(summary.wage_p50)}</strong>
              {asNumber(summary.wage_n_latest_year) > 0 ? (
                <>
                  {" "}
                  based on <strong>{formatInt(summary.wage_n_latest_year)}</strong> wage observations (wage_annual &gt; 0)
                </>
              ) : null}
              . The middle 50% of wages ranged from <strong>{formatUSD(summary.wage_p25)}</strong> (P25) to{" "}
              <strong>{formatUSD(summary.wage_p75)}</strong> (P75), and P90 was{" "}
              <strong>{formatUSD(summary.wage_p90)}</strong>.
            </>
          ) : (
            <>
              In <strong>{stateName}</strong>, this page summarizes public H-1B LCA wage disclosure records.
            </>
          )}
        </p>

        <p style={{ margin: "10px 0 0 0" }}>
          This state hub aggregates <strong>{formatInt(summary.total_cases)}</strong> total cases across all years. Use
          the links below to drill into raw filings.
        </p>

        <ul style={{ margin: "10px 0 0 18px", padding: 0 }}>
          <li>
            <Link href={`/?state=${encodeURIComponent(stateUpper)}`} style={{ fontWeight: 700 }}>
              Search all records in {stateName}
            </Link>
          </li>

          {topCity ? (
            <li>
              Top city:{" "}
              <Link href={`/?state=${encodeURIComponent(stateUpper)}&city=${encodeURIComponent(String(topCity))}`}>
                {String(topCity)}
              </Link>
            </li>
          ) : null}

          {topEmployer ? (
            <li>
              Top employer:{" "}
              <Link href={`/?state=${encodeURIComponent(stateUpper)}&em=${encodeURIComponent(String(topEmployer))}`}>
                {String(topEmployer)}
              </Link>
            </li>
          ) : null}

          {topJob ? (
            <li>
              Top job title:{" "}
              <Link href={`/?state=${encodeURIComponent(stateUpper)}&job=${encodeURIComponent(String(topJob))}`}>
                {String(topJob)}
              </Link>
            </li>
          ) : null}

          <li>
            How this is computed: <Link href="/methodology">Methodology</Link>
          </li>
        </ul>

        <p style={{ margin: "10px 0 0 0", fontSize: 13, opacity: 0.85 }}>
          Note: LCA filings do not necessarily indicate visa approval. Wage fields may be missing or inconsistent due to
          source reporting and cleaning.
        </p>
      </section>

      {/* Trends / plots */}
      <section style={{ marginBottom: 22 }}>
        <h2 style={{ fontSize: 18, fontWeight: 750, margin: "0 0 10px 0" }}>Trends over time</h2>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
          <Card title="Cases by year" subtitle="Count of LCA records in the state-year summary">
            {yearSeries.length ? (
              <BarChartSVG
                data={yearSeries.map((p) => ({ x: String(p.year), y: p.total_cases }))}
                ariaLabel={`Cases by year for ${stateName} (${stateUpper})`}
              />
            ) : (
              <EmptyHint text="No year-series data available (check that your materialized views are refreshed)." />
            )}
          </Card>

          <Card title="Median wage by year" subtitle="Median (P50) with P25–P75 band (wage_annual > 0)">
            {yearSeries.length ? (
              <WageBandChartSVG data={yearSeries} ariaLabel={`Median wage by year for ${stateName} (${stateUpper})`} />
            ) : (
              <EmptyHint text="No year-series data available (check that your materialized views are refreshed)." />
            )}
          </Card>
        </div>
      </section>

      {/* Supporting stats */}
      <section style={{ marginBottom: 22 }}>
        <Card
          title="Latest-year wage sample size"
          subtitle="Number of wage observations (wage_annual > 0) used to compute percentiles for the latest year"
        >
          <div style={{ display: "flex", gap: 18, flexWrap: "wrap" }}>
            <KPI label="Wage observations" value={formatInt(summary.wage_n_latest_year)} />
            <KPI label="Latest decision date" value={formatDate(summary.latest_decision_date)} />
          </div>
        </Card>
      </section>

      {/* Top lists */}
      <section style={{ display: "grid", gridTemplateColumns: "1fr", gap: 18 }}>
        <HubTable
          title={`Top Cities in ${stateName} (${stateUpper})`}
          subtitle={`Top ${TOP_N} by case count`}
          columns={[
            {
              key: "city",
              label: "City",
              renderCell: (v: any) => (
                <Link href={`/?state=${encodeURIComponent(stateUpper)}&city=${encodeURIComponent(String(v))}`}>
                  {String(v)}
                </Link>
              ),
            },
            { key: "case_count", label: "Cases", renderCell: (v: any) => formatInt(v) },
            { key: "median_wage", label: "Median wage", renderCell: (v: any) => formatUSD(v) },
          ]}
          rows={cities}
          emptyText="No city data available."
        />

        <HubTable
          title={`Top Employers in ${stateName} (${stateUpper})`}
          subtitle={`Top ${TOP_N} by case count`}
          columns={[
            {
              key: "employer_name",
              label: "Employer",
              renderCell: (v: any) => (
                <Link href={`/?state=${encodeURIComponent(stateUpper)}&em=${encodeURIComponent(String(v))}`}>
                  {String(v)}
                </Link>
              ),
            },
            { key: "case_count", label: "Cases", renderCell: (v: any) => formatInt(v) },
          ]}
          rows={employers}
          emptyText="No employer data available."
        />

        <HubTable
          title={`Top Job Titles in ${stateName} (${stateUpper})`}
          subtitle={`Top ${TOP_N} by case count`}
          columns={[
            {
              key: "job_title",
              label: "Job title",
              renderCell: (v: any) => (
                <Link href={`/?state=${encodeURIComponent(stateUpper)}&job=${encodeURIComponent(String(v))}`}>
                  {String(v)}
                </Link>
              ),
            },
            { key: "case_count", label: "Cases", renderCell: (v: any) => formatInt(v) },
          ]}
          rows={jobs}
          emptyText="No job title data available."
        />
      </section>

      <footer style={{ marginTop: 26, fontSize: 13, opacity: 0.85 }}>
        <p style={{ margin: 0, lineHeight: 1.6 }}>
          Data source: U.S. Department of Labor LCA public disclosure. LCA filings do not necessarily indicate approval.
          Data may contain errors or inconsistencies due to reporting and cleaning.
        </p>
      </footer>
    </main>
  );
}

/* --------------------------
   UI building blocks
-------------------------- */

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
}) {
  return (
    <section style={{ border: "1px solid rgba(0,0,0,0.1)", borderRadius: 12, padding: 16 }}>
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 16, fontWeight: 750 }}>{title}</div>
        {subtitle ? <div style={{ fontSize: 12.5, opacity: 0.8, marginTop: 3 }}>{subtitle}</div> : null}
      </div>
      {children}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: "1px solid rgba(0,0,0,0.1)", borderRadius: 12, padding: 12 }}>
      <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 750 }}>{value}</div>
    </div>
  );
}

function KPI({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 5 }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 750 }}>{value}</div>
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div
      style={{
        padding: "10px 12px",
        borderRadius: 10,
        border: "1px dashed rgba(0,0,0,0.2)",
        background: "rgba(0,0,0,0.02)",
        lineHeight: 1.55,
      }}
    >
      {text}
    </div>
  );
}

/* --------------------------
   SVG Charts (no client JS)
-------------------------- */

function BarChartSVG({
  data,
  ariaLabel,
}: {
  data: Array<{ x: string; y: number }>;
  ariaLabel: string;
}) {
  const W = 520;
  const H = 210;
  const pad = { l: 34, r: 12, t: 10, b: 28 };

  const maxY = Math.max(1, ...data.map((d) => d.y));
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;

  const barW = innerW / Math.max(1, data.length);
  const scaleY = (v: number) => pad.t + innerH - (v / maxY) * innerH;

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} style={{ display: "block" }}>
      <line x1={pad.l} y1={pad.t} x2={pad.l} y2={H - pad.b} stroke="rgba(0,0,0,0.25)" />
      <line x1={pad.l} y1={H - pad.b} x2={W - pad.r} y2={H - pad.b} stroke="rgba(0,0,0,0.25)" />

      {data.map((d, i) => {
        const x0 = pad.l + i * barW + barW * 0.12;
        const x1 = pad.l + (i + 1) * barW - barW * 0.12;
        const y1 = H - pad.b;
        const y0 = scaleY(d.y);
        return (
          <g key={d.x}>
            <rect
              x={x0}
              y={y0}
              width={Math.max(2, x1 - x0)}
              height={Math.max(1, y1 - y0)}
              fill="rgba(0,0,0,0.18)"
              stroke="rgba(0,0,0,0.25)"
            />
            <text
              x={pad.l + i * barW + barW / 2}
              y={H - 10}
              textAnchor="middle"
              fontSize="11"
              fill="rgba(0,0,0,0.75)"
            >
              {d.x}
            </text>
          </g>
        );
      })}

      <text x={pad.l} y={pad.t + 10} fontSize="11" fill="rgba(0,0,0,0.7)" textAnchor="start">
        {formatInt(maxY)}
      </text>
    </svg>
  );
}

function WageBandChartSVG({
  data,
  ariaLabel,
}: {
  data: YearPoint[];
  ariaLabel: string;
}) {
  const W = 520;
  const H = 210;
  const pad = { l: 46, r: 12, t: 10, b: 28 };

  const years = data.map((d) => d.year);
  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);

  const wagesAll = data.flatMap((d) => [d.wage_p25, d.wage_p50, d.wage_p75]).filter((x) => x > 0);
  const minW = Math.min(...wagesAll);
  const maxW = Math.max(...wagesAll);

  const yMin = Math.max(0, minW * 0.9);
  const yMax = Math.max(yMin + 1, maxW * 1.1);

  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;

  const xScale = (year: number) => {
    if (maxYear === minYear) return pad.l + innerW / 2;
    return pad.l + ((year - minYear) / (maxYear - minYear)) * innerW;
  };
  const yScale = (w: number) => {
    if (yMax === yMin) return pad.t + innerH / 2;
    return pad.t + innerH - ((w - yMin) / (yMax - yMin)) * innerH;
  };

  const p25 = data.map((d) => [xScale(d.year), yScale(d.wage_p25)] as const);
  const p50 = data.map((d) => [xScale(d.year), yScale(d.wage_p50)] as const);
  const p75 = data.map((d) => [xScale(d.year), yScale(d.wage_p75)] as const);

  const linePath = (pts: ReadonlyArray<readonly [number, number]>) =>
    pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");

  const bandPath = () => {
    if (!p25.length || !p75.length) return "";
    const top = p75;
    const bot = [...p25].reverse();
    const dTop = top.map((p, i) => `${i === 0 ? "M" : "L"} ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
    const dBot = bot.map((p) => `L ${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(" ");
    return `${dTop} ${dBot} Z`;
  };

  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} style={{ display: "block" }}>
      <line x1={pad.l} y1={pad.t} x2={pad.l} y2={H - pad.b} stroke="rgba(0,0,0,0.25)" />
      <line x1={pad.l} y1={H - pad.b} x2={W - pad.r} y2={H - pad.b} stroke="rgba(0,0,0,0.25)" />

      <text x={pad.l - 6} y={pad.t + 10} textAnchor="end" fontSize="11" fill="rgba(0,0,0,0.75)">
        {formatUSD(yMax)}
      </text>
      <text x={pad.l - 6} y={H - pad.b} textAnchor="end" fontSize="11" fill="rgba(0,0,0,0.75)">
        {formatUSD(yMin)}
      </text>

      <text x={pad.l} y={H - 10} textAnchor="start" fontSize="11" fill="rgba(0,0,0,0.75)">
        {minYear}
      </text>
      <text x={W - pad.r} y={H - 10} textAnchor="end" fontSize="11" fill="rgba(0,0,0,0.75)">
        {maxYear}
      </text>

      <path d={bandPath()} fill="rgba(0,0,0,0.10)" stroke="none" />
      <path d={linePath(p50)} fill="none" stroke="rgba(0,0,0,0.65)" strokeWidth="2" />

      {p50.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="2.6" fill="rgba(0,0,0,0.65)" />
      ))}
    </svg>
  );
}

/* --------------------------
   Tables
-------------------------- */

function HubTable<T extends Record<string, any>>({
  title,
  subtitle,
  columns,
  rows,
  emptyText,
}: {
  title: string;
  subtitle?: string;
  columns: Array<{
    key: keyof T;
    label: string;
    renderCell?: (value: any, row: T) => ReactNode;
  }>;
  rows: T[];
  emptyText: string;
}) {
  return (
    <section style={{ border: "1px solid rgba(0,0,0,0.1)", borderRadius: 12, padding: 16 }}>
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 16, fontWeight: 750 }}>{title}</div>
        {subtitle ? <div style={{ fontSize: 12.5, opacity: 0.8, marginTop: 3 }}>{subtitle}</div> : null}
      </div>

      {rows.length === 0 ? (
        <p style={{ margin: 0 }}>{emptyText}</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th
                    key={String(c.key)}
                    style={{
                      textAlign: "left",
                      fontSize: 13,
                      padding: "10px 8px",
                      borderBottom: "1px solid rgba(0,0,0,0.12)",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={idx}>
                  {columns.map((c) => {
                    const raw = r[c.key as string];
                    const cell = c.renderCell ? c.renderCell(raw, r) : raw ?? "—";
                    return (
                      <td
                        key={String(c.key)}
                        style={{
                          padding: "10px 8px",
                          borderBottom: "1px solid rgba(0,0,0,0.06)",
                          verticalAlign: "top",
                        }}
                      >
                        {cell}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
