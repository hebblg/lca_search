// app/sitemap.ts
import type { MetadataRoute } from "next";
import { pgPool } from "@/lib/pgPool";

export const runtime = "nodejs";
export const revalidate = 86400; // regenerate daily

const INDEX_MIN_CASES = 500;

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

  return [...staticEntries, ...stateEntries];
}
