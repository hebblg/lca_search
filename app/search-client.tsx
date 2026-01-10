"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type SearchForm = {
  employer: string;
  job: string;
  city: string;
  state: string;
  year: string; // UI kept, but we force 2025 in requests
};

const DEFAULT_FORM: SearchForm = {
  employer: "",
  job: "",
  city: "",
  state: "",
  year: "2025",
};

const LIMIT = 50;

// ✅ Force all searches to 2025
const FIXED_YEAR = "2025";

// ✅ If no query params, load a small “sample” set for the homepage
const SAMPLE_LIMIT = 12;

// Year dropdown options: only 2025 (per your requirement)
const YEAR_OPTIONS: string[] = [FIXED_YEAR];

type SortKey = "employer" | "job" | "location" | "year" | "wage";
type SortDir = "asc" | "desc";

export default function SearchClient() {
  const router = useRouter();
  const params = useSearchParams();
  const pathname = usePathname();

  const [draft, setDraft] = useState<SearchForm>(DEFAULT_FORM);
  const [applied, setApplied] = useState<SearchForm>(DEFAULT_FORM);

  const [page, setPage] = useState<number>(0);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string>("");

  // sorting (client-side, per-page)
  const [sortKey, setSortKey] = useState<SortKey>("wage");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const moneyFmt = useMemo(
    () => new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }),
    []
  );

  useEffect(() => {
    const initial: SearchForm = {
      employer: params.get("em") ?? "",
      job: params.get("job") ?? "",
      city: params.get("city") ?? "",
      state: params.get("state") ?? "",
      year: FIXED_YEAR, // force
    };

    const initialPage = Number(params.get("page") ?? "0");
    const safePage = Number.isFinite(initialPage) && initialPage >= 0 ? initialPage : 0;

    setDraft(initial);
    setApplied(initial);
    setPage(safePage);

    const hasAnyQuery =
      (initial.employer ?? "").trim() !== "" ||
      (initial.job ?? "").trim() !== "" ||
      (initial.city ?? "").trim() !== "" ||
      (initial.state ?? "").trim() !== "" ||
      (params.get("year") ?? "").trim() !== ""; // allow existing URLs, but ignored

    if (hasAnyQuery) {
      void runSearch(initial, safePage);
    } else {
      // ✅ Show sample results immediately on homepage
      void runSearch(
        { ...DEFAULT_FORM, year: FIXED_YEAR },
        0,
        { limitOverride: SAMPLE_LIMIT, shuffleSample: true, sample: true }
      );
    }

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateUrl(nextApplied: SearchForm, nextPage: number) {
    const sp = new URLSearchParams();

    if (nextApplied.employer) sp.set("em", nextApplied.employer);
    if (nextApplied.job) sp.set("job", nextApplied.job);
    if (nextApplied.city) sp.set("city", nextApplied.city);
    if (nextApplied.state) sp.set("state", nextApplied.state);

    // keep year in URL for clarity, but it is fixed
    sp.set("year", FIXED_YEAR);

    sp.set("page", String(nextPage));
    router.replace(`/search?${sp.toString()}`);
  }

  async function runSearch(
    criteria: SearchForm,
    nextPage: number,
    opts?: { limitOverride?: number; shuffleSample?: boolean; sample?: boolean }
  ) {
    setLoading(true);
    setErrorMsg("");

    try {
      const res = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employer: criteria.employer,
          job: criteria.job,
          city: criteria.city,
          state: criteria.state,
          year: FIXED_YEAR, // ✅ forced
          page: nextPage,
          limit: opts?.limitOverride ?? LIMIT,
          sample: Boolean(opts?.sample), // ✅ enables server “sample mode”
        }),
      });

      let json: { rows?: any[]; error?: string } = {};
      try {
        json = await res.json();
      } catch {
        // ignore
      }

      if (!res.ok) {
        setRows([]);
        setErrorMsg(json.error ?? `Search failed (HTTP ${res.status})`);
        return;
      }

      let out = json.rows ?? [];

      // Optional: shuffle sample results in UI so it “feels random”
      if (opts?.shuffleSample && out.length > 1) {
        out = shuffle(out);
      }

      setRows(out);
    } catch (e: any) {
      setRows([]);
      setErrorMsg(e?.message ?? "Network error");
    } finally {
      setLoading(false);
    }
  }

  function shuffle<T>(arr: T[]) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function onChange<K extends keyof SearchForm>(key: K, val: string) {
    setDraft((prev) => ({ ...prev, [key]: val }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();

    const nextApplied: SearchForm = {
      ...draft,
      state: draft.state.trim().toUpperCase(),
      year: FIXED_YEAR,
    };
    const nextPage = 0;

    setApplied(nextApplied);
    setPage(nextPage);
    updateUrl(nextApplied, nextPage);
    await runSearch(nextApplied, nextPage);
  }

  async function goPrev() {
    const nextPage = Math.max(0, page - 1);
    setPage(nextPage);
    updateUrl(applied, nextPage);
    await runSearch(applied, nextPage);
  }

  async function goNext() {
    const nextPage = page + 1;
    setPage(nextPage);
    updateUrl(applied, nextPage);
    await runSearch(applied, nextPage);
  }

  function clearAll() {
    const cleared: SearchForm = { ...DEFAULT_FORM, year: FIXED_YEAR };
    setDraft(cleared);
    setApplied(cleared);
    setPage(0);
    setRows([]);
    setErrorMsg("");
    const nextPath = pathname === "/search" ? "/search" : "/";
    router.replace(nextPath);

    // show sample results again after clearing
    void runSearch(cleared, 0, { limitOverride: SAMPLE_LIMIT, shuffleSample: true, sample: true });
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(applied);

  function toggleSort(nextKey: SortKey) {
    if (nextKey === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(nextKey);
      setSortDir(nextKey === "wage" || nextKey === "year" ? "desc" : "asc");
    }
  }

  function sortIndicator(key: SortKey) {
    if (key !== sortKey) return "↕";
    return sortDir === "asc" ? "↑" : "↓";
  }

  const sortedRows = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;

    function toText(v: any) {
      return (v ?? "").toString().trim().toLowerCase();
    }
    function toNum(v: any) {
      const n = typeof v === "number" ? v : Number(v);
      return Number.isFinite(n) ? n : null;
    }

    const copy = [...rows];

    copy.sort((a, b) => {
      let av: any = null;
      let bv: any = null;

      if (sortKey === "employer") {
        av = toText(a.employer_name);
        bv = toText(b.employer_name);
        const c = av.localeCompare(bv);
        if (c !== 0) return c * dir;
      } else if (sortKey === "job") {
        av = toText(a.job_title);
        bv = toText(b.job_title);
        const c = av.localeCompare(bv);
        if (c !== 0) return c * dir;
      } else if (sortKey === "location") {
        const al = toText(a.worksite_city) + " " + toText(a.worksite_state);
        const bl = toText(b.worksite_city) + " " + toText(b.worksite_state);
        const c = al.localeCompare(bl);
        if (c !== 0) return c * dir;
      } else if (sortKey === "year") {
        av = toNum(a.year);
        bv = toNum(b.year);
        if (av === null && bv !== null) return 1;
        if (av !== null && bv === null) return -1;
        if (av !== null && bv !== null && av !== bv) return (av - bv) * dir;
      } else if (sortKey === "wage") {
        av = toNum(a.wage_annual);
        bv = toNum(b.wage_annual);
        if (av === null && bv !== null) return 1;
        if (av !== null && bv === null) return -1;
        if (av !== null && bv !== null && av !== bv) return (av - bv) * dir;
      }

      return toText(a.case_number).localeCompare(toText(b.case_number));
    });

    return copy;
  }, [rows, sortKey, sortDir]);

  return (
    <main className="page">
      <div className="header">
        <h1 className="title">LCA Search (2025)</h1>
        <div className="subtle">
          Limit {LIMIT} per page • Results: {rows.length}
        </div>
      </div>

      <form onSubmit={onSubmit} className="card">
        <div className="inputsRow">
          <div className="field">
            <label>Employer</label>
            <input
              value={draft.employer}
              onChange={(e) => onChange("employer", e.target.value)}
              placeholder="e.g. Google"
            />
          </div>

          <div className="field">
            <label>Job Title</label>
            <input
              value={draft.job}
              onChange={(e) => onChange("job", e.target.value)}
              placeholder="e.g. Software Engineer"
            />
          </div>

          <div className="field">
            <label>City</label>
            <input
              value={draft.city}
              onChange={(e) => onChange("city", e.target.value)}
              placeholder="e.g. Austin"
            />
          </div>

          <div className="field">
            <label>State</label>
            <input
              value={draft.state}
              onChange={(e) => onChange("state", e.target.value)}
              placeholder="CA"
              maxLength={2}
            />
          </div>

          <div className="field yearField">
            <label>Year</label>
            <select value={FIXED_YEAR} disabled>
              {YEAR_OPTIONS.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="actionsRow">
          <div className="leftMeta">
            {dirty ? <span className="pill warn">Not searched yet</span> : <span className="pill ok">In sync</span>}
            {loading && <span className="pill info">Searching…</span>}
          </div>

          <div className="actions">
            <button className="btn primary" type="submit" disabled={loading}>
              {loading ? "Searching..." : "Search"}
            </button>
            <button className="btn" type="button" onClick={clearAll} disabled={loading}>
              Clear
            </button>
          </div>
        </div>

        {errorMsg && <div className="error">Search error: {errorMsg}</div>}
      </form>

      <div className="toolbar">
        <div className="pager">
          <button className="btn" onClick={goPrev} disabled={loading || page === 0}>
            Prev
          </button>
          <button className="btn" onClick={goNext} disabled={loading || rows.length < LIMIT}>
            Next
          </button>
          <span className="muted">Page {page + 1}</span>
        </div>

        <div className="muted">
          Sorting: <b>{sortKey}</b> {sortDir}
        </div>
      </div>

      <div className="tableCard">
        <div className="tableWrap">
          <table className="table">
            <thead>
              <tr>
                <th>
                  <button type="button" className="thBtn" onClick={() => toggleSort("employer")}>
                    Employer <span className="thIcon">{sortIndicator("employer")}</span>
                  </button>
                </th>
                <th>
                  <button type="button" className="thBtn" onClick={() => toggleSort("job")}>
                    Job Title <span className="thIcon">{sortIndicator("job")}</span>
                  </button>
                </th>
                <th>
                  <button type="button" className="thBtn" onClick={() => toggleSort("location")}>
                    Location <span className="thIcon">{sortIndicator("location")}</span>
                  </button>
                </th>
                <th className="num">
                  <button type="button" className="thBtn right" onClick={() => toggleSort("year")}>
                    Year <span className="thIcon">{sortIndicator("year")}</span>
                  </button>
                </th>
                <th className="num">
                  <button type="button" className="thBtn right" onClick={() => toggleSort("wage")}>
                    Wage <span className="thIcon">{sortIndicator("wage")}</span>
                  </button>
                </th>
              </tr>
            </thead>

            <tbody>
              {!loading && sortedRows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="empty">
                    Enter criteria and click Search.
                  </td>
                </tr>
              ) : (
                sortedRows.map((r) => (
                  <tr key={r.case_number}>
                    <td className="cellMain" title={r.employer_name ?? ""}>
                      {r.employer_name ?? ""}
                    </td>
                    <td className="cellMain" title={r.job_title ?? ""}>
                      {r.job_title ?? ""}
                    </td>
                    <td
                      className="cellSub"
                      title={`${r.worksite_city ?? ""}${r.worksite_state ? `, ${r.worksite_state}` : ""}`}
                    >
                      {(r.worksite_city ?? "") + (r.worksite_state ? `, ${r.worksite_state}` : "")}
                    </td>
                    <td className="num">{r.year ?? ""}</td>
                    <td className="num">
                      {typeof r.wage_annual === "number"
                        ? `$${moneyFmt.format(r.wage_annual)}`
                        : r.wage_annual ?? ""}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <style jsx>{`
        .page {
          padding: 20px;
          max-width: 1200px;
          margin: 0 auto;
          font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
          color: #0f172a;
        }

        .header {
          display: flex;
          align-items: baseline;
          justify-content: space-between;
          margin-bottom: 12px;
          gap: 12px;
        }

        .title {
          font-size: 22px;
          line-height: 1.2;
          margin: 0;
        }

        .subtle {
          color: #64748b;
          font-size: 13px;
          white-space: nowrap;
        }

        .card {
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          padding: 14px;
          box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
        }

        .inputsRow {
          display: grid;
          grid-template-columns:
            minmax(160px, 220px) /* employer */
            minmax(220px, 1.4fr) /* job */
            minmax(160px, 1fr) /* city */
            90px /* state */
            minmax(140px, 180px); /* year */
          gap: 10px;
          align-items: end;
          padding-right: 8px;
        }

        .field {
          display: grid;
          gap: 6px;
          min-width: 0;
        }

        .yearField {
          min-width: 140px;
        }

        label {
          font-size: 12px;
          color: #334155;
        }

        input,
        select {
          height: 36px;
          padding: 8px 10px;
          border: 1px solid #cbd5e1;
          border-radius: 10px;
          outline: none;
          background: #fff;
          font-size: 14px;
          box-sizing: border-box;
          width: 100%;
          min-width: 0;
        }

        select {
          padding-right: 34px;
          appearance: auto;
        }

        input:focus,
        select:focus {
          border-color: #94a3b8;
          box-shadow: 0 0 0 3px rgba(148, 163, 184, 0.35);
        }

        .actionsRow {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-top: 12px;
          gap: 12px;
        }

        .leftMeta {
          display: flex;
          gap: 8px;
          align-items: center;
          flex-wrap: wrap;
        }

        .actions {
          display: flex;
          gap: 10px;
          align-items: center;
          justify-content: flex-end;
          flex-shrink: 0;
        }

        .btn {
          height: 36px;
          padding: 0 12px;
          border-radius: 10px;
          border: 1px solid #cbd5e1;
          background: #fff;
          cursor: pointer;
          font-size: 14px;
        }

        .btn:hover {
          background: #f8fafc;
        }

        .btn:disabled {
          cursor: not-allowed;
          opacity: 0.6;
        }

        .primary {
          background: #0f172a;
          border-color: #0f172a;
          color: #fff;
        }

        .primary:hover {
          background: #111c35;
        }

        .pill {
          font-size: 12px;
          padding: 4px 8px;
          border-radius: 999px;
          border: 1px solid #e2e8f0;
          background: #f8fafc;
          color: #334155;
          white-space: nowrap;
        }

        .pill.ok {
          background: #ecfeff;
          border-color: #a5f3fc;
          color: #155e75;
        }

        .pill.warn {
          background: #fffbeb;
          border-color: #fde68a;
          color: #92400e;
        }

        .pill.info {
          background: #eef2ff;
          border-color: #c7d2fe;
          color: #3730a3;
        }

        .error {
          margin-top: 10px;
          padding: 10px 12px;
          border-radius: 10px;
          background: #fff1f2;
          border: 1px solid #fecdd3;
          color: #9f1239;
          font-size: 13px;
        }

        .toolbar {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin: 12px 0;
          gap: 12px;
          flex-wrap: wrap;
        }

        .pager {
          display: flex;
          gap: 10px;
          align-items: center;
        }

        .muted {
          color: #64748b;
          font-size: 13px;
        }

        .tableCard {
          margin-top: 8px;
          background: #ffffff;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
        }

        .tableWrap {
          overflow-x: auto;
          border-radius: 12px;
        }

        .table {
          width: 100%;
          border-collapse: separate;
          border-spacing: 0;
          table-layout: fixed;
          min-width: 860px;
        }

        thead th {
          position: sticky;
          top: 0;
          background: #f8fafc;
          border-bottom: 1px solid #e2e8f0;
          color: #334155;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 0.03em;
          padding: 0;
          text-align: left;
          z-index: 1;
        }

        .thBtn {
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          padding: 10px 12px;
          background: transparent;
          border: 0;
          color: inherit;
          font: inherit;
          text-transform: inherit;
          letter-spacing: inherit;
          cursor: pointer;
        }

        .thBtn:hover {
          background: #eef2f7;
        }

        .thBtn.right {
          justify-content: flex-end;
        }

        .thIcon {
          font-size: 12px;
          color: #64748b;
          flex-shrink: 0;
        }

        tbody td {
          padding: 10px 12px;
          border-bottom: 1px solid #f1f5f9;
          vertical-align: top;
          font-size: 14px;
          color: #0f172a;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        tbody tr:nth-child(even) td {
          background: #fcfcfd;
        }

        tbody tr:hover td {
          background: #f8fafc;
        }

        .num {
          text-align: right;
          font-variant-numeric: tabular-nums;
        }

        .cellMain {
          font-weight: 500;
        }

        .cellSub {
          color: #334155;
        }

        .empty {
          padding: 18px 12px;
          color: #64748b;
          text-align: center;
          white-space: normal;
        }

        @media (max-width: 900px) {
          .inputsRow {
            overflow-x: auto;
            padding-bottom: 6px;
          }
        }
      `}</style>
    </main>
  );
}
