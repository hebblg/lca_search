// app/salary/[state]/employer/[slug]/page.tsx
import Link from "next/link";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { unstable_cache } from "next/cache";
import { pgPool } from "@/lib/pgPool";

export const runtime = "nodejs";
export const revalidate = 86400;

const TOP_N = 20;
const INDEX_MIN_CASES = 100;
const STATIC_MIN_CASES = 100;
const STATIC_RANK_MAX = 30;
const SEARCH_YEAR = 2025;

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

function getStateName(stateUpper: string) {
  return STATE_NAME[stateUpper] ?? stateUpper;
}

function isValidStateSlug(s: string) {
  return /^[a-zA-Z]{2}$/.test(s);
}

function slugify(s: string) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .trim();
}

function isValidSlug(s: string) {
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s);
}

function slugVariants(slug: string) {
  const parts = slug.split("-");
  const out = new Set<string>([slug]);

  if (parts.includes("us")) {
    const expanded = parts.flatMap((p) => (p === "us" ? ["u", "s"] : [p])).join("-");
    out.add(expanded);
  }
  if (parts.includes("usa")) {
    const expanded = parts.flatMap((p) => (p === "usa" ? ["u", "s", "a"] : [p])).join("-");
    out.add(expanded);
  }
  if (parts.includes("uk")) {
    const expanded = parts.flatMap((p) => (p === "uk" ? ["u", "k"] : [p])).join("-");
    out.add(expanded);
  }

  return Array.from(out);
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

type EmployerSummaryRow = {
  employer_name: string;
  total_cases: string | number;
  latest_year: number | null;
  latest_decision_date: string | Date | null;
  wage_p50: string | number | null;
  wage_n: string | number | null;
};

type CityRow = {
  city: string;
  case_count: string | number;
};

type JobRow = {
  job_title: string;
  case_count: string | number;
};

const SQL_EMPLOYER_SUMMARY = /* sql */ `
WITH matches AS (
  SELECT
    employer_name,
    COUNT(*)::bigint AS total_cases,
    MAX(year)::int AS latest_year,
    MAX(decision_date) AS latest_decision_date,
    percentile_cont(0.5) WITHIN GROUP (ORDER BY wage_annual)
      FILTER (WHERE wage_annual IS NOT NULL AND wage_annual > 0) AS wage_p50,
    COUNT(*) FILTER (WHERE wage_annual IS NOT NULL AND wage_annual > 0) AS wage_n
  FROM public.lca_cases
  WHERE worksite_state = $1
    AND regexp_replace(regexp_replace(lower(employer_name), '[^a-z0-9]+', '-', 'g'), '(^-|-$)', '', 'g') = ANY($2::text[])
  GROUP BY employer_name
)
SELECT *
FROM matches
ORDER BY total_cases DESC, employer_name ASC
LIMIT 1;
`;

const SQL_TOP_CITIES = /* sql */ `
SELECT
  COALESCE(NULLIF(TRIM(worksite_city), ''), 'Unknown') AS city,
  COUNT(*)::bigint AS case_count
FROM public.lca_cases
WHERE worksite_state = $1 AND employer_name = $2
GROUP BY 1
ORDER BY case_count DESC, city ASC
LIMIT $3;
`;

const SQL_TOP_JOBS = /* sql */ `
SELECT
  COALESCE(NULLIF(TRIM(job_title), ''), 'Unknown') AS job_title,
  COUNT(*)::bigint AS case_count
FROM public.lca_cases
WHERE worksite_state = $1 AND employer_name = $2
GROUP BY 1
ORDER BY case_count DESC, job_title ASC
LIMIT $3;
`;

const getEmployerStateData = unstable_cache(
  async (stateUpper: string, slug: string, topN: number) => {
    const summaryRes = await pgPool.query<EmployerSummaryRow>(SQL_EMPLOYER_SUMMARY, [
      stateUpper,
      slugVariants(slug),
    ]);
    const summary = summaryRes.rows[0] ?? null;
    if (!summary) return { summary: null, cities: [], jobs: [] };

    const [citiesRes, jobsRes] = await Promise.all([
      pgPool.query<CityRow>(SQL_TOP_CITIES, [stateUpper, summary.employer_name, topN]),
      pgPool.query<JobRow>(SQL_TOP_JOBS, [stateUpper, summary.employer_name, topN]),
    ]);

    return {
      summary,
      cities: citiesRes.rows,
      jobs: jobsRes.rows,
    };
  },
  ["state-employer-page-v1"],
  { revalidate: 86400 }
);

export async function generateStaticParams() {
  const sql = /* sql */ `
    SELECT
      lower(state) AS state,
      regexp_replace(regexp_replace(lower(employer_name), '[^a-z0-9]+', '-', 'g'), '(^-|-$)', '', 'g') AS slug
    FROM agg.lca_state_top_employers_mv
    WHERE case_count >= $1 AND rnk <= $2
    ORDER BY state ASC, rnk ASC;
  `;
  const res = await pgPool.query<{ state: string; slug: string }>(sql, [
    STATIC_MIN_CASES,
    STATIC_RANK_MAX,
  ]);

  return res.rows
    .filter((r) => /^[a-z]{2}$/.test(r.state) && typeof r.slug === "string" && r.slug.length > 0)
    .map((r) => ({ state: r.state, slug: r.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ state: string; slug: string }>;
}): Promise<Metadata> {
  const { state, slug } = await params;

  if (!isValidStateSlug(state) || !isValidSlug(slug)) {
    return { title: "Employer H-1B Salary Data", robots: { index: false, follow: false } };
  }

  const stateLower = state.toLowerCase();
  const stateUpper = state.toUpperCase();
  const stateName = getStateName(stateUpper);

  const data = await getEmployerStateData(stateUpper, slug, TOP_N);
  if (!data.summary) {
    return { title: `Employer H-1B Salary Data in ${stateName}`, robots: { index: false, follow: false } };
  }

  const name = data.summary.employer_name;
  const canonicalSlug = slugify(name);
  const totalCases = asNumber(data.summary.total_cases);
  const indexable = totalCases >= INDEX_MIN_CASES;

  const title = `${name} in ${stateName} H-1B Salaries | LCA Wage Data`;
  const description = `Explore ${formatInt(totalCases)} public H-1B LCA filings for ${name} in ${stateName}, including top cities and job titles.`;

  return {
    title,
    description,
    alternates: { canonical: `/salary/${stateLower}/employer/${canonicalSlug}` },
    robots: {
      index: indexable,
      follow: indexable,
      googleBot: { index: indexable, follow: indexable },
    },
  };
}

export default async function EmployerStatePage({
  params,
}: {
  params: Promise<{ state: string; slug: string }>;
}) {
  const { state, slug } = await params;

  if (!isValidStateSlug(state) || !isValidSlug(slug)) notFound();

  const stateLower = state.toLowerCase();
  if (state !== stateLower) redirect(`/salary/${stateLower}/employer/${slug}`);

  const stateUpper = state.toUpperCase();
  const stateName = getStateName(stateUpper);

  const data = await getEmployerStateData(stateUpper, slug, TOP_N);
  if (!data.summary) notFound();

  const name = data.summary.employer_name;
  const canonicalSlug = slugify(name);
  if (slug !== canonicalSlug) redirect(`/salary/${stateLower}/employer/${canonicalSlug}`);

  const totalCases = asNumber(data.summary.total_cases);
  const topCity = data.cities[0]?.city;
  const topJob = data.jobs[0]?.job_title;

  return (
    <main style={{ maxWidth: 1160, margin: "0 auto", padding: "26px 16px" }}>
      <header style={{ marginBottom: 18 }}>
        <div style={{ marginBottom: 10 }}>
          <Link href={`/salary/${stateLower}`} style={{ textDecoration: "none" }}>
            ← {stateName} overview
          </Link>
        </div>

        <h1 style={{ fontSize: 28, fontWeight: 750, margin: "0 0 8px 0" }}>
          {name} H-1B Salary Data in {stateName}
        </h1>
        <p style={{ margin: 0, lineHeight: 1.6 }}>
          Total cases: <strong>{formatInt(totalCases)}</strong>
          {data.summary.latest_year ? (
            <>
              {" "}
              · Latest year: <strong>{data.summary.latest_year}</strong>
            </>
          ) : null}{" "}
          · Updated: <strong>{formatDate(data.summary.latest_decision_date)}</strong>
        </p>
      </header>

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
          {name} wage snapshot in {stateName}
        </h2>
        <p style={{ margin: 0 }}>
          This page summarizes public H-1B LCA filings for <strong>{name}</strong> in{" "}
          <strong>{stateName}</strong>. The median annual wage across filings with valid wage data is{" "}
          <strong>{formatUSD(data.summary.wage_p50)}</strong>
          {asNumber(data.summary.wage_n) > 0 ? (
            <> based on {formatInt(data.summary.wage_n)} wage observations</>
          ) : null}
          .
        </p>

        <ul style={{ margin: "10px 0 0 18px", padding: 0 }}>
          <li>
            <Link href={buildSearchHref({ em: name, state: stateUpper })}>
              Search {SEARCH_YEAR} records for {name} in {stateName}
            </Link>
          </li>
          {topCity ? (
            <li>
              Top city:{" "}
              <Link href={buildCityHref(stateLower, String(topCity))}>{String(topCity)}</Link>
            </li>
          ) : null}
          {topJob ? (
            <li>
              Top job title: <Link href={`/salary/${stateLower}/job/${slugify(String(topJob))}`}>{String(topJob)}</Link>
            </li>
          ) : null}
        </ul>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "1fr", gap: 18 }}>
        <StatTable
          title={`Top cities for ${name} in ${stateName}`}
          columns={[
            {
              key: "city",
              label: "City",
              renderCell: (v: any) => (
                <Link href={buildCityHref(stateLower, String(v))}>{String(v)}</Link>
              ),
            },
            { key: "case_count", label: "Cases", renderCell: (v: any) => formatInt(v) },
          ]}
          rows={data.cities}
          emptyText="No city data available."
        />

        <StatTable
          title={`Top job titles for ${name} in ${stateName}`}
          columns={[
            {
              key: "job_title",
              label: "Job title",
              renderCell: (v: any) => (
                <Link href={`/salary/${stateLower}/job/${slugify(String(v))}`}>{String(v)}</Link>
              ),
            },
            { key: "case_count", label: "Cases", renderCell: (v: any) => formatInt(v) },
          ]}
          rows={data.jobs}
          emptyText="No job title data available."
        />
      </section>
    </main>
  );
}

function StatTable<T extends Record<string, any>>({
  title,
  columns,
  rows,
  emptyText,
}: {
  title: string;
  columns: Array<{
    key: keyof T;
    label: string;
    renderCell?: (value: any, row: T) => React.ReactNode;
  }>;
  rows: T[];
  emptyText: string;
}) {
  return (
    <section style={{ border: "1px solid rgba(0,0,0,0.1)", borderRadius: 12, padding: 16 }}>
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 16, fontWeight: 750 }}>{title}</div>
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
