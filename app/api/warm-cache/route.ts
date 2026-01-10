import { NextResponse } from "next/server";
import { pgPool } from "@/lib/pgPool";

export const runtime = "nodejs";

const INDEX_MIN_CASES = 500;
const WARM_STATE_LIMIT = 25;

function getBaseUrl() {
  const canonical = process.env.NEXT_PUBLIC_SITE_URL;
  if (canonical) return canonical.replace(/\/+$/, "");

  const vercel = process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`.replace(/\/+$/, "");

  return "http://localhost:3000";
}

async function getWarmPaths() {
  const stateSql = /* sql */ `
    select lower(state) as state
    from agg.lca_state_summary_mv
    where total_cases >= $1
    order by total_cases desc
    limit $2;
  `;
  const [statesRes] = await Promise.all([
    pgPool.query<{ state: string }>(stateSql, [INDEX_MIN_CASES, WARM_STATE_LIMIT]),
  ]);

  const states = statesRes.rows.filter((r) => /^[a-z]{2}$/.test(r.state)).map((r) => `/salary/${r.state}`);
  return ["/", "/salary", ...states];
}

export async function GET() {
  const baseUrl = getBaseUrl();
  let paths: string[] = [];

  try {
    paths = await getWarmPaths();
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message ?? "Failed to load warm paths." }, { status: 500 });
  }

  for (const path of paths) {
    try {
      await fetch(`${baseUrl}${path}`, { method: "GET" });
    } catch {
      // ignore per-path errors
    }
  }

  return NextResponse.json({ ok: true, warmed: paths.length });
}
