// app/sitemap.ts
import type { MetadataRoute } from "next";
import { pgPool } from "@/lib/pgPool";

export const runtime = "nodejs";
export const revalidate = 86400; // regenerate daily

const INDEX_MIN_CASES = 500;
const STATE_EMPLOYER_MIN_CASES = 100;
const STATE_JOB_MIN_CASES = 100;
const STATE_ENTITY_RANK_MAX = 30;
const STATE_CITY_MIN_CASES = 100;
const STATE_CITY_RANK_MAX = 30;

function getBaseUrl() {
  const canonical = process.env.NEXT_PUBLIC_SITE_URL;
  if (canonical) return canonical.replace(/\/+$/, "");

  // Hard fail so you don't accidentally publish vercel.app URLs in production
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "Missing NEXT_PUBLIC_SITE_URL in production. Set it to https://yourdomain.com"
    );
  }

  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`.replace(/\/+$/, "");

  return "http://localhost:3000";
}


const STATIC_PATHS = ["/", "/salary", "/about", "/methodology", "/privacy", "/terms", "/contact"] as const;

const ALL_50_STATES = [
  "al","ak","az","ar","ca","co","ct","de","fl","ga",
  "hi","id","il","in","ia","ks","ky","la","me","md",
  "ma","mi","mn","ms","mo","mt","ne","nv","nh","nj",
  "nm","ny","nc","nd","oh","ok","or","pa","ri","sc",
  "sd","tn","tx","ut","vt","va","wa","wv","wi","wy",
] as const;

type StateRow = {
  state: string; // already lowercase
  refreshed_at: string | Date | null;
};

type StateSlugRow = {
  state: string;
  slug: string;
};

async function getIndexableStatesFromDb(): Promise<StateRow[]> {
  // Uses your MV design. Make sure the MV is refreshed; otherwise it will return 0 rows.
  const sql = /* sql */ `
    select
      lower(state) as state,
      refreshed_at
    from agg.lca_state_summary_mv
    where total_cases >= $1
    order by state asc
  `;
  const res = await pgPool.query<StateRow>(sql, [INDEX_MIN_CASES]);
  return res.rows
    .filter((r) => typeof r.state === "string" && /^[a-z]{2}$/.test(r.state));
}

async function getStateEmployerSlugs(): Promise<StateSlugRow[]> {
  const sql = /* sql */ `
    SELECT
      lower(state) AS state,
      regexp_replace(regexp_replace(lower(employer_name), '[^a-z0-9]+', '-', 'g'), '(^-|-$)', '', 'g') AS slug
    FROM agg.lca_state_top_employers_mv
    WHERE case_count >= $1 AND rnk <= $2
    ORDER BY state ASC, rnk ASC;
  `;
  const res = await pgPool.query<StateSlugRow>(sql, [STATE_EMPLOYER_MIN_CASES, STATE_ENTITY_RANK_MAX]);
  return res.rows.filter(
    (r) =>
      typeof r.state === "string" &&
      /^[a-z]{2}$/.test(r.state) &&
      typeof r.slug === "string" &&
      r.slug.length > 0
  );
}

async function getStateJobSlugs(): Promise<StateSlugRow[]> {
  const sql = /* sql */ `
    SELECT
      lower(state) AS state,
      regexp_replace(regexp_replace(lower(job_title), '[^a-z0-9]+', '-', 'g'), '(^-|-$)', '', 'g') AS slug
    FROM agg.lca_state_top_jobs_mv
    WHERE case_count >= $1 AND rnk <= $2
    ORDER BY state ASC, rnk ASC;
  `;
  const res = await pgPool.query<StateSlugRow>(sql, [STATE_JOB_MIN_CASES, STATE_ENTITY_RANK_MAX]);
  return res.rows.filter(
    (r) =>
      typeof r.state === "string" &&
      /^[a-z]{2}$/.test(r.state) &&
      typeof r.slug === "string" &&
      r.slug.length > 0
  );
}

async function getStateCitySlugs(): Promise<StateSlugRow[]> {
  const sql = /* sql */ `
    SELECT
      lower(state) AS state,
      regexp_replace(regexp_replace(lower(COALESCE(NULLIF(TRIM(city), ''), 'Unknown')), '[^a-z0-9]+', '-', 'g'), '(^-|-$)', '', 'g') AS slug
    FROM agg.lca_state_top_cities_mv
    WHERE case_count >= $1 AND rnk <= $2
    ORDER BY state ASC, rnk ASC;
  `;
  const res = await pgPool.query<StateSlugRow>(sql, [STATE_CITY_MIN_CASES, STATE_CITY_RANK_MAX]);
  return res.rows.filter(
    (r) =>
      typeof r.state === "string" &&
      /^[a-z]{2}$/.test(r.state) &&
      typeof r.slug === "string" &&
      r.slug.length > 0
  );
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = getBaseUrl();
  const now = new Date();

  // 1) Static pages
  const staticEntries: MetadataRoute.Sitemap = STATIC_PATHS.map((path) => ({
    url: `${baseUrl}${path}`,
    lastModified: now,
    changeFrequency: path === "/" ? "daily" : "monthly",
    priority: path === "/" ? 1.0 : 0.6,
  }));

  // 2) State pages (prefer DB-driven + indexable)
  let stateRows: StateRow[] = [];
  try {
    stateRows = await getIndexableStatesFromDb();
  } catch {
    // If DB is unavailable during sitemap generation, fall back to all states
    stateRows = [];
  }

  const stateEntries: MetadataRoute.Sitemap =
    stateRows.length > 0
      ? stateRows.map((r) => ({
          url: `${baseUrl}/salary/${r.state}`,
          lastModified: r.refreshed_at ? new Date(r.refreshed_at) : now,
          changeFrequency: "daily",
          priority: 0.7,
        }))
      : (ALL_50_STATES as readonly string[]).map((st) => ({
          url: `${baseUrl}/salary/${st}`,
          lastModified: now,
          changeFrequency: "weekly",
          priority: 0.5,
        }));

  // 3) Employer + job pages (top slugs only)
  let stateEmployerSlugs: StateSlugRow[] = [];
  let stateJobSlugs: StateSlugRow[] = [];
  let stateCitySlugs: StateSlugRow[] = [];
  try {
    [stateEmployerSlugs, stateJobSlugs, stateCitySlugs] = await Promise.all([
      getStateEmployerSlugs(),
      getStateJobSlugs(),
      getStateCitySlugs(),
    ]);
  } catch {
    stateEmployerSlugs = [];
    stateJobSlugs = [];
    stateCitySlugs = [];
  }

  const stateEmployerEntries: MetadataRoute.Sitemap = stateEmployerSlugs.map((r) => ({
    url: `${baseUrl}/salary/${r.state}/employer/${r.slug}`,
    lastModified: now,
    changeFrequency: "weekly",
    priority: 0.65,
  }));

  const stateJobEntries: MetadataRoute.Sitemap = stateJobSlugs.map((r) => ({
    url: `${baseUrl}/salary/${r.state}/job/${r.slug}`,
    lastModified: now,
    changeFrequency: "weekly",
    priority: 0.65,
  }));

  const stateCityEntries: MetadataRoute.Sitemap = stateCitySlugs.map((r) => ({
    url: `${baseUrl}/salary/${r.state}/city/${r.slug}`,
    lastModified: now,
    changeFrequency: "weekly",
    priority: 0.65,
  }));

  return [
    ...staticEntries,
    ...stateEntries,
    ...stateEmployerEntries,
    ...stateJobEntries,
    ...stateCityEntries,
  ];
}
