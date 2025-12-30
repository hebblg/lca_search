import { NextResponse } from "next/server";
import { pgPool } from "@/lib/pgPool";

export const runtime = "nodejs";

function trimOrNull(v: unknown) {
  const s = String(v ?? "").trim();
  return s.length ? s : null;
}

function tooShort(s: string | null) {
  return s !== null && s.length > 0 && s.length < 3;
}

function toNumberOrNull(v: unknown) {
  const s = trimOrNull(v);
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    // Keep a hard cap (recommend 100 max)
    const limit = Math.min(Math.max(Number(body.limit ?? 50), 1), 100);
    const page = Math.max(Number(body.page ?? 0), 0);
    const offset = page * limit;

    const employer = trimOrNull(body.employer);
    const job = trimOrNull(body.job);
    const city = trimOrNull(body.city);

    // Optional anti-noise: require 3+ chars for text fields
    if (tooShort(employer) || tooShort(job) || tooShort(city)) {
      return NextResponse.json(
        { error: "Use at least 3 characters for employer/job/city." },
        { status: 400 }
      );
    }

    const p_state = trimOrNull(body.state)?.toUpperCase() ?? null;

    const yearNum = toNumberOrNull(body.year);
    if (Number.isNaN(yearNum)) {
      return NextResponse.json({ error: "Invalid year." }, { status: 400 });
    }
    const p_year = yearNum as number | null;

    // Keep these for backward compatibility (even if your new UI doesn't send them)
    const p_status = trimOrNull(body.status);

    const minNum = toNumberOrNull(body.minWage);
    if (Number.isNaN(minNum)) {
      return NextResponse.json({ error: "Invalid minWage." }, { status: 400 });
    }
    const p_min = minNum as number | null;

    const maxNum = toNumberOrNull(body.maxWage);
    if (Number.isNaN(maxNum)) {
      return NextResponse.json({ error: "Invalid maxWage." }, { status: 400 });
    }
    const p_max = maxNum as number | null;

    // ✅ Do not search if nothing input
    const hasAnyFilter =
      employer !== null ||
      job !== null ||
      city !== null ||
      p_state !== null ||
      p_year !== null ||
      p_status !== null ||
      p_min !== null ||
      p_max !== null;

    if (!hasAnyFilter) {
      // Option A: return empty (recommended UX)
      // Also blocks "page 10 empty search" scraping.
      if (offset > 0) {
        return NextResponse.json(
          { error: "Empty search is not allowed with pagination." },
          { status: 400 }
        );
      }
      return NextResponse.json({ rows: [], page, limit }, { status: 200 });
    }

    const sql = `
      select *
      from public.search_lca_cases_fields_v2(
        $1::text, $2::text, $3::text, $4::text,
        $5::int,  $6::text,
        $7::numeric, $8::numeric,
        $9::int, $10::int
      )
    `;

    const t0 = Date.now();
    const result = await pgPool.query(sql, [
      employer,
      job,
      city,
      p_state,
      p_year,
      p_status,
      p_min,
      p_max,
      limit,
      offset,
    ]);
    const totalMs = Date.now() - t0;

    console.log("PG total ms:", totalMs, "rows:", result.rowCount);

    return NextResponse.json(
      { rows: result.rows, page, limit },
      { headers: { "x-total-ms": String(totalMs) } }
    );
  } catch (e: any) {
    return NextResponse.json({ error: e?.message ?? "Unknown error" }, { status: 500 });
  }
}
