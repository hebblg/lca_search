// app/salary/[state]/page.tsx
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { unstable_cache } from "next/cache";
import { pgPool } from "@/lib/pgPool";
import { CitiesTable, EmployersTable, JobsTable } from "@/components/StateHubTables";

export const runtime = "nodejs";
export const revalidate = 86400;

const TOP_N = 25;
const SITE_URL = "https://www.h1bdata.fyi";
const SEARCH_YEAR = 2025; // ✅ all Search links will be filtered to this year

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

// Helper to get nearby/related states for internal linking
const NEARBY_STATES: Record<string, string[]> = {
  TX: ["LA", "AR", "OK", "NM"],
  CA: ["NV", "OR", "AZ"],
  NY: ["NJ", "CT", "PA", "MA"],
  FL: ["GA", "AL"],
  IL: ["IN", "WI", "IA", "MO"],
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
function getNearbyStates(stateUpper: string): string[] {
  return NEARBY_STATES[stateUpper] ?? [];
}

function titleCaseSimple(s: string) {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}

function slugify(s: string) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .trim();
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
function toIsoOrNull(v: unknown): string | undefined {
  if (!v) return undefined;
  const d = v instanceof Date ? v : new Date(String(v));
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toISOString();
}

/** ✅ build /?state=TX&year=2025&... consistently */
function buildSearchHref(params: Record<string, string | number | null | undefined>) {
  const usp = new URLSearchParams();
  usp.set("year", String(SEARCH_YEAR));
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined) continue;
    const s = String(v).trim();
    if (!s) continue;
    usp.set(k, s);
  }
  return `/search?${usp.toString()}`;
}

function buildCityHref(stateLower: string, city: string) {
  return `/salary/${stateLower}/city/${slugify(city)}`;
}

function buildEmployerHref(stateLower: string, employer: string) {
  return `/salary/${stateLower}/employer/${slugify(employer)}`;
}

function buildJobHref(stateLower: string, job: string) {
  return `/salary/${stateLower}/job/${slugify(job)}`;
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
  median_wage::numeric AS median_wage,
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
  median_wage::numeric AS median_wage,
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
  median_wage: string | number | null;
  rnk: number;
};

type JobRow = {
  job_title: string;
  case_count: string | number;
  median_wage: string | number | null;
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
  ["state-hub-v6"],
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
  const indexable = totalCases >= 500;

  // For messaging, force the year wording to 2025 (your request).
  const title = `${stateName} H-1B Visa Salaries ${SEARCH_YEAR} | LCA Wage Data & Statistics`;

  const median = data.summary.wage_p50;
  const descParts: string[] = [];
  descParts.push(`Explore ${formatInt(totalCases)} public H-1B LCA filings in ${stateName}.`);
  descParts.push(`All search links on this page are filtered to ${SEARCH_YEAR}.`);
  if (median != null && asNumber(median) > 0) {
    descParts.push(`Latest-year median salary: ${formatUSD(median)}.`);
  }
  descParts.push(`View top cities, employers, job titles, and wage percentiles.`);

  const description = descParts.join(" ").replace(/\s+/g, " ").trim();

  const url = `${SITE_URL}/salary/${stateLower}`;

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
      title,
      description,
      url,
      siteName: "h1bdata.fyi",
      type: "website",
      locale: "en_US",
    },
    twitter: {
      card: "summary",
      title,
      description,
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

  // Structured data: Breadcrumb + Dataset (kept conservative)
  const breadcrumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "Salary by State", item: `${SITE_URL}/salary` },
      { "@type": "ListItem", position: 3, name: `${stateName} (${stateUpper})`, item: `${SITE_URL}/salary/${stateLower}` },
    ],
  };

  const datasetJsonLd = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: `${stateName} H-1B Salary Data (LCA) – ${SEARCH_YEAR}`,
    description: `H-1B LCA wage statistics for ${stateName}. Search links on this page are filtered to ${SEARCH_YEAR}.`,
    url: `${SITE_URL}/salary/${stateLower}`,
    temporalCoverage: `${SEARCH_YEAR}/${SEARCH_YEAR}`,
    spatialCoverage: { "@type": "Place", name: stateName },
    creator: { "@type": "Organization", name: "h1bdata.fyi", url: SITE_URL },
    isBasedOn: { "@type": "Dataset", name: "U.S. Department of Labor LCA Disclosure Data", url: "https://www.dol.gov" },
    dateModified: toIsoOrNull(summary.refreshed_at),
  };

  const nearbyStates = getNearbyStates(stateUpper);

  return (
    <main style={{ maxWidth: 1160, margin: "0 auto", padding: "26px 16px" }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(datasetJsonLd) }} />

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
              <Link href={buildSearchHref({ state: stateUpper })}>
                Search {SEARCH_YEAR} records in {stateName} →
              </Link>
            </p>
          </div>

          <aside style={{ minWidth: 260 }}>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <Metric label={`P25 (${summary.latest_year ?? "latest"})`} value={formatUSD(summary.wage_p25)} />
              <Metric label={`Median (${summary.latest_year ?? "latest"})`} value={formatUSD(summary.wage_p50)} />
              <Metric label={`P75 (${summary.latest_year ?? "latest"})`} value={formatUSD(summary.wage_p75)} />
              <Metric label={`P90 (${summary.latest_year ?? "latest"})`} value={formatUSD(summary.wage_p90)} />
            </div>
          </aside>
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

      {/* Unique content block */}
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
          In <strong>{stateName}</strong>, the latest-year median annual wage shown here is{" "}
          <strong>{formatUSD(summary.wage_p50)}</strong>. All “Search” links on this page are filtered to{" "}
          <strong>{SEARCH_YEAR}</strong>.
        </p>

        <ul style={{ margin: "10px 0 0 18px", padding: 0 }}>
          <li>
            <Link href={buildSearchHref({ state: stateUpper })} style={{ fontWeight: 700 }}>
              Search {SEARCH_YEAR} records in {stateName}
            </Link>
          </li>

          {topCity ? (
            <li>
              Top city:{" "}
              <Link href={buildCityHref(stateLower, String(topCity))}>{String(topCity)}</Link>
            </li>
          ) : null}

          {topEmployer ? (
            <li>
              Top employer:{" "}
              <Link href={buildEmployerHref(stateLower, String(topEmployer))}>{String(topEmployer)}</Link>
            </li>
          ) : null}

          {topJob ? (
            <li>
              Top job title:{" "}
              <Link href={buildJobHref(stateLower, String(topJob))}>{titleCaseSimple(String(topJob))}</Link>
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

      {/* Trends (kept as-is; these are your MV’s year series) */}
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

      {/* Top lists (✅ fixed: correct rows per table) */}
      <section style={{ display: "grid", gridTemplateColumns: "1fr", gap: 18 }}>
        <CitiesTable
          stateLower={stateLower}
          rows={cities}
          title={`Top Cities in ${stateName}`}
          subtitle={`Top ${TOP_N} by case count`}
        />

        <EmployersTable
          stateLower={stateLower}
          rows={employers}
          title={`Top Employers in ${stateName}`}
          subtitle={`Top ${TOP_N} by case count`}
        />

        <JobsTable
          stateLower={stateLower}
          rows={jobs}
          title={`Top Job Titles in ${stateName}`}
          subtitle={`Top ${TOP_N} by case count`}
        />
      </section>

      {/* Nearby states (internal linking) */}
      {nearbyStates.length > 0 ? (
        <section
          style={{
            marginTop: 22,
            padding: 16,
            border: "1px solid rgba(0,0,0,0.1)",
            borderRadius: 12,
          }}
        >
          <h2 style={{ fontSize: 18, fontWeight: 750, margin: "0 0 12px 0" }}>Compare nearby states</h2>
          <nav style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            {nearbyStates.map((st) => (
              <Link
                key={st}
                href={`/salary/${toLowerState(st)}`}
                style={{
                  padding: "8px 14px",
                  border: "1px solid rgba(0,0,0,0.15)",
                  borderRadius: 8,
                  textDecoration: "none",
                }}
              >
                {getStateName(st)}
              </Link>
            ))}
          </nav>
        </section>
      ) : null}

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
  const pad = { l: 52, r: 12, t: 10, b: 28 };

  const maxY = Math.max(1, ...data.map((d) => d.y));
  const yTicks = [maxY, Math.round(maxY / 2), 0];
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
              y={Math.max(pad.t + 12, y0 - 6)}
              textAnchor="middle"
              fontSize="11"
              fill="rgba(0,0,0,0.8)"
            >
              {formatInt(d.y)}
            </text>
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

      {yTicks.map((v, i) => {
        const y = scaleY(v);
        return (
          <g key={`y-${i}`}>
            <line x1={pad.l} y1={y} x2={W - pad.r} y2={y} stroke="rgba(0,0,0,0.08)" />
            <text x={pad.l - 6} y={y + 4} fontSize="11" fill="rgba(0,0,0,0.7)" textAnchor="end">
              {formatInt(v)}
            </text>
          </g>
        );
      })}
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
  const pad = { l: 64, r: 28, t: 18, b: 28 };

  const years = data.map((d) => d.year);
  const minYear = Math.min(...years);
  const maxYear = Math.max(...years);

  const wagesAll = data.flatMap((d) => [d.wage_p25, d.wage_p50, d.wage_p75]).filter((x) => x > 0);
  const minW = Math.min(...wagesAll);
  const maxW = Math.max(...wagesAll);

  const yMin = Math.max(0, minW * 0.9);
  const yMax = Math.max(yMin + 1, maxW * 1.1);
  const yMid = (yMin + yMax) / 2;

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

      {[yMax, yMid, yMin].map((v, i) => {
        const y = yScale(v);
        return (
          <g key={`y-${i}`}>
            <line x1={pad.l} y1={y} x2={W - pad.r} y2={y} stroke="rgba(0,0,0,0.08)" />
            <text x={pad.l - 6} y={y + 4} textAnchor="end" fontSize="11" fill="rgba(0,0,0,0.75)">
              {formatUSD(v)}
            </text>
          </g>
        );
      })}

      {data.map((d) => {
        const x = xScale(d.year);
        return (
          <text
            key={`x-${d.year}`}
            x={x}
            y={H - 10}
            textAnchor="middle"
            fontSize="11"
            fill="rgba(0,0,0,0.75)"
          >
            {d.year}
          </text>
        );
      })}

      <path d={bandPath()} fill="rgba(0,0,0,0.10)" stroke="none" />
      <path d={linePath(p50)} fill="none" stroke="rgba(0,0,0,0.65)" strokeWidth="2" />

      {p50.map(([x, y], i) => {
        const label = formatUSD(data[i]?.wage_p50);
        const tier = i % 3;
        const aboveY = y - 10 - tier * 8;
        const belowY = y + 12 + tier * 8;
        const labelY = aboveY < pad.t + 10 ? belowY : aboveY;
        const clampedY = Math.min(H - pad.b - 6, Math.max(pad.t + 10, labelY));
        const isFirst = i === 0;
        const isLast = i === p50.length - 1;
        const rawX = isFirst ? x + 6 : isLast ? x - 6 : x;
        const clampedX = Math.max(pad.l + 4, Math.min(W - pad.r - 4, rawX));
        const anchor = isFirst ? "start" : isLast ? "end" : "middle";
        return (
          <g key={i}>
            <circle cx={x} cy={y} r="2.6" fill="rgba(0,0,0,0.65)" />
            <text
              x={clampedX}
              y={clampedY}
              textAnchor={anchor}
              fontSize="10.5"
              fill="rgba(0,0,0,0.9)"
              stroke="rgba(255,255,255,0.9)"
              strokeWidth="3"
              paintOrder="stroke"
            >
              {label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/* --------------------------
   Tables
-------------------------- */
