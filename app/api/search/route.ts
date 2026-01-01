// app/api/search/route.ts
import { NextResponse } from "next/server";
import { pgPool } from "@/lib/pgPool";

export const runtime = "nodejs";

const FIXED_YEAR = 2025;

// caps
const LIMIT_MAX = 50;
const SAMPLE_LIMIT_MAX = 12;

// timeouts (ms)
const STATEMENT_TIMEOUT_MS = 2000;
const SAMPLE_TIMEOUT_MS = 800;

function trimOrNull(v: unknown): string | null {
  const s = String(v ?? "").trim();
  return s.length ? s : null;
}

function asInt(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

function isValidState2(s: string): boolean {
  return /^[A-Z]{2}$/.test(s);
}

function tooShort3(s: string | null): boolean {
  return s !== null && s.length > 0 && s.length < 3;
}

// “Featured 2025” sample query: index-friendly (no ORDER BY random())
const SQL_SAMPLE_2025 = /* sql */ `
SELECT
  case_number,
  employer_name,
  job_title,
  worksite_city,
  worksite_state,
  year,
  wage_annual
FROM public.lca_cases
WHERE year = $1
  AND decision_date IS NOT NULL
  AND wage_annual IS NOT NULL
  AND wage_annual > 0
ORDER BY decision_date DESC
LIMIT $2;
`;

// Main search query (still fast if you have trigram indexes on *_lc columns)
const SQL_SEARCH_2025 = /* sql */ `
SELECT
  case_number,
  employer_name,
  job_title,
  worksite_city,
  worksite_state,
  year,
  wage_annual
FROM public.lca_cases
WHERE year = $1
  AND ($2::text IS NULL OR worksite_state = $2)
  AND ($3::text IS NULL OR employer_name ILIKE $3)
  AND ($4::text IS NULL OR job_title ILIKE $4)
  AND ($5::text IS NULL OR worksite_city ILIKE $5)
ORDER BY wage_annual DESC NULLS LAST, case_number ASC
LIMIT $6 OFFSET $7;
`;

export async function POST(req: Request) {
  const client = await pgPool.connect();
  try {
    const body = await req.json().catch(() => ({} as any));

    const rawEmployer = trimOrNull(body.employer);
    const rawJob = trimOrNull(body.job);
    const rawCity = trimOrNull(body.city);

    const rawState = trimOrNull(body.state);
    const state = rawState ? rawState.toUpperCase() : null;

    const page = Math.max(0, asInt(body.page, 0));
    const limitReq = asInt(body.limit, LIMIT_MAX);

    const sample = Boolean(body.sample);

    // Normalize limit + offset
    const limit = Math.min(Math.max(limitReq, 1), sample ? SAMPLE_LIMIT_MAX : LIMIT_MAX);
    const offset = sample ? 0 : page * limit;

    // Basic validation for text inputs
    if (tooShort3(rawEmployer) || tooShort3(rawJob) || tooShort3(rawCity)) {
      return NextResponse.json(
        { error: "Use at least 3 characters for employer/job/city." },
        { status: 400 }
      );
    }

    if (state && !isValidState2(state)) {
      return NextResponse.json({ error: "State must be a 2-letter code (e.g., CA)." }, { status: 400 });
    }

    // If this is the homepage sample load: allow empty filters
    if (sample) {
      await client.query("BEGIN");
      await client.query(`SET LOCAL statement_timeout = '${SAMPLE_TIMEOUT_MS}ms'`);

      const res = await client.query(SQL_SAMPLE_2025, [FIXED_YEAR, limit]);

      await client.query("COMMIT");
      return NextResponse.json({ rows: res.rows });
    }

    // Normal search: require employer/job/city (3+ chars) OR state
    const hasText =
      (rawEmployer ?? "").length >= 3 ||
      (rawJob ?? "").length >= 3 ||
      (rawCity ?? "").length >= 3;

    if (!hasText && !state) {
      return NextResponse.json(
        { error: "Please provide employer/job/city (3+ chars) or state. Year-only search is not allowed." },
        { status: 400 }
      );
    }

    // Build ILIKE patterns (only when provided)
    const employerLike = rawEmployer ? `%${rawEmployer}%` : null;
    const jobLike = rawJob ? `%${rawJob}%` : null;
    const cityLike = rawCity ? `%${rawCity}%` : null;

    await client.query("BEGIN");
    await client.query(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT_MS}ms'`);

    const res = await client.query(SQL_SEARCH_2025, [
      FIXED_YEAR,
      state,
      employerLike,
      jobLike,
      cityLike,
      limit,
      offset,
    ]);

    await client.query("COMMIT");
    return NextResponse.json({ rows: res.rows });
  } catch (e: any) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore
    }
    const msg = e?.message ?? "Server error";
    return NextResponse.json({ error: msg }, { status: 500 });
  } finally {
    client.release();
  }
}
