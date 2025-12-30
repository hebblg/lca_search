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
function toFiniteNumberOrNull(v: unknown) {
  const s = trimOrNull(v);
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const limit = Math.min(Math.max(Number(body.limit ?? 50), 1), 100);
    const page = Math.max(Number(body.page ?? 0), 0);
    const offset = page * limit;

    const employer = trimOrNull(body.employer);
    const job = trimOrNull(body.job);
    const city = trimOrNull(body.city);

    // Rule: if text is present but < 3 chars => do not search
    if (tooShort(employer) || tooShort(job) || tooShort(city)) {
      return NextResponse.json(
        { error: "Please enter at least 3 characters for employer/job/city." },
        { status: 400 }
      );
    }

    const p_state = trimOrNull(body.state)?.toUpperCase() ?? null;

    const yearNum = toFiniteNumberOrNull(body.year);
    if (Number.isNaN(yearNum)) {
      return NextResponse.json({ error: "Invalid year." }, { status: 400 });
    }
    const p_year = yearNum as number | null;

    // Keep these for backward compatibility (even if UI doesn't send)
    const p_status = trimOrNull(body.status);

    const minNum = toFiniteNumberOrNull(body.minWage);
    if (Number.isNaN(minNum)) {
      return NextResponse.json({ error: "Invalid minWage." }, { status: 400 });
    }
    const p_min = minNum as number | null;

    const maxNum = toFiniteNumberOrNull(body.maxWage);
    if (Number.isNaN(maxNum)) {
      return NextResponse.json({ error: "Invalid maxWage." }, { status: 400 });
    }
    const p_max = maxNum as number | null;

    // Rule: do not search if empty OR year-only.
    // "Non-year filters" are everything except year.
    const hasNonYearFilter =
      employer !== null ||
      job !== null ||
      city !== null ||
      p_state !== null ||
      p_status !== null ||
      p_min !== null ||
      p_max !== null;

    if (!hasNonYearFilter) {
      // This covers: totally empty search AND year-only search
      return NextResponse.json(
        { error: "Please provide employer/job/city (3+ chars) or state. Year-only search is not allowed." },
        { status: 400 }
      );
    }

    // Optional: keep your anti-scraping rule (large offsets with weak filters)
    // If you want: block high offset unless there is at least one text filter (employer/job/city)
    // const hasTextFilter = employer !== null || job !== null || city !== null;
    // if (!hasTextFilter && offset >= 2000) {
    //   return NextResponse.json({ error: "Offset too large without text filters." }, { status: 400 });
    // }

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
