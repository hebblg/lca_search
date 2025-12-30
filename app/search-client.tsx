"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

type SearchForm = {
  employer: string;
  job: string;
  city: string;
  state: string;
  year: string; // "" means Any
};

const DEFAULT_FORM: SearchForm = {
  employer: "",
  job: "",
  city: "",
  state: "",
  year: "",
};

const LIMIT = 50;

// Year dropdown options (dynamic): 2020 -> current year, descending
const YEAR_MIN = 2020;
const YEAR_MAX = new Date().getFullYear();
const YEAR_OPTIONS: string[] = [
  "", // Any year
  ...Array.from({ length: YEAR_MAX - YEAR_MIN + 1 }, (_, i) => String(YEAR_MAX - i)),
];

export default function SearchClient() {
  const router = useRouter();
  const params = useSearchParams();

  const [draft, setDraft] = useState<SearchForm>(DEFAULT_FORM);
  const [applied, setApplied] = useState<SearchForm>(DEFAULT_FORM);

  const [page, setPage] = useState<number>(0);
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string>("");

  // Initialize from URL once on load
  useEffect(() => {
    const initial: SearchForm = {
      employer: params.get("em") ?? "",
      job: params.get("job") ?? "",
      city: params.get("city") ?? "",
      state: params.get("state") ?? "",
      year: params.get("year") ?? "",
    };

    const initialPage = Number(params.get("page") ?? "0");
    const safePage = Number.isFinite(initialPage) && initialPage >= 0 ? initialPage : 0;

    setDraft(initial);
    setApplied(initial);
    setPage(safePage);

    const hasAny = Object.values(initial).some((v) => v.trim() !== "");
    if (hasAny) void runSearch(initial, safePage);

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function updateUrl(nextApplied: SearchForm, nextPage: number) {
    const sp = new URLSearchParams();

    if (nextApplied.employer) sp.set("em", nextApplied.employer);
    if (nextApplied.job) sp.set("job", nextApplied.job);
    if (nextApplied.city) sp.set("city", nextApplied.city);
    if (nextApplied.state) sp.set("state", nextApplied.state);
    if (nextApplied.year) sp.set("year", nextApplied.year);

    sp.set("page", String(nextPage));
    router.replace(`/?${sp.toString()}`);
  }

  async function runSearch(criteria: SearchForm, nextPage: number) {
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
          year: criteria.year, // "" or "2025"
          page: nextPage,
          limit: LIMIT,
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

      setRows(json.rows ?? []);
    } catch (e: any) {
      setRows([]);
      setErrorMsg(e?.message ?? "Network error");
    } finally {
      setLoading(false);
    }
  }

  function onChange<K extends keyof SearchForm>(key: K, val: string) {
    setDraft((prev) => ({ ...prev, [key]: val }));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();

    const nextApplied: SearchForm = {
      ...draft,
      state: draft.state.trim().toUpperCase(),
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
    setDraft(DEFAULT_FORM);
    setApplied(DEFAULT_FORM);
    setPage(0);
    setRows([]);
    setErrorMsg("");
    router.replace("/");
  }

  const dirty = JSON.stringify(draft) !== JSON.stringify(applied);

  return (
    <main style={{ padding: 16 }}>
      <h1>LCA Search</h1>

      {/* All inputs in ONE row */}
      <form onSubmit={onSubmit} style={{ display: "grid", gap: 8, maxWidth: 1100 }}>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.4fr 1.4fr 1.1fr 110px 140px auto",
            gap: 8,
            alignItems: "center",
          }}
        >
          <input
            value={draft.employer}
            onChange={(e) => onChange("employer", e.target.value)}
            placeholder="Employer"
          />

          <input
            value={draft.job}
            onChange={(e) => onChange("job", e.target.value)}
            placeholder="Job Title"
          />

          <input
            value={draft.city}
            onChange={(e) => onChange("city", e.target.value)}
            placeholder="City"
          />

          <input
            value={draft.state}
            onChange={(e) => onChange("state", e.target.value)}
            placeholder="State"
            maxLength={2}
          />

          <select
            value={draft.year}
            onChange={(e) => onChange("year", e.target.value)}
            style={{ height: 30 }}
          >
            {YEAR_OPTIONS.map((y) => (
              <option key={y || "any"} value={y}>
                {y ? y : "Any year"}
              </option>
            ))}
          </select>

          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="submit" disabled={loading}>
              {loading ? "Searching..." : "Search"}
            </button>
            <button type="button" onClick={clearAll} disabled={loading}>
              Clear
            </button>
            {dirty && <span style={{ alignSelf: "center" }}>(Not searched yet)</span>}
          </div>
        </div>
      </form>

      {errorMsg && <p style={{ color: "crimson" }}>Search error: {errorMsg}</p>}

      <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
        <button onClick={goPrev} disabled={loading || page === 0}>
          Prev
        </button>
        <button onClick={goNext} disabled={loading || rows.length < LIMIT}>
          Next
        </button>
        <span style={{ alignSelf: "center" }}>Page: {page + 1}</span>
      </div>

      <table style={{ width: "100%", marginTop: 16, borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <th align="left">Employer</th>
            <th align="left">Job</th>
            <th align="left">City</th>
            <th align="left">State</th>
            <th align="right">Year</th>
            <th align="right">Wage</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.case_number}>
              <td>{r.employer_name}</td>
              <td>{r.job_title}</td>
              <td>{r.worksite_city}</td>
              <td>{r.worksite_state}</td>
              <td align="right">{r.year}</td>
              <td align="right">{r.wage_annual}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
