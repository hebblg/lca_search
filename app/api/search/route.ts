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

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const limit = Math.min(Math.max(Number(body.limit ?? 50), 1), 200);
    const page = Math.max(Number(body.page ?? 0), 0);
    const offset = page * limit;

    const employer = trimOrNull(body.employer);
    const job = trimOrNull(body.job);
    const city = trimOrNull(body.city);

    if (tooShort(employer) || tooShort(job) || tooShort(city)) {
      return NextResponse.json(
        { error: "Use at least 3 characters for employer/job/city." },
        { status: 400 }
      );
    }

    const p_state = trimOrNull(body.state)?.toUpperCase() ?? null;
    const p_year = trimOrNull(body.year) ? Number(body.year) : null;
    const p_status = trimOrNull(body.status);
    const p_min = trimOrNull(body.minWage) ? Number(body.minWage) : null;
    const p_max = trimOrNull(body.maxWage) ? Number(body.maxWage) : null;

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
