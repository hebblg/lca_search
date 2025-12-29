// app/search-client.tsx
"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import SearchForm, { SearchValues } from "./components/SearchForm";
import { supabase } from "../lib/supabaseBrowser";

const LIMIT = 50;

type LcaRow = {
  employer_name: string | null;
  job_title: string | null;
  worksite_city: string | null;
  worksite_state: string | null;
  year: number | null;
  wage_annual: number | null;
  case_status: string | null;
};

function toIntOrNull(s: string): number | null {
  const trimmed = s.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? Math.trunc(n) : null;
}

function toNumberOrNull(s: string): number | null {
  const trimmed = s.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

export default function SearchClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // URL -> state (source of truth on load / back-forward)
  const urlValues: SearchValues = useMemo(() => {
    return {
      employer: searchParams.get("em") ?? "",
      job: searchParams.get("job") ?? "",
      city: searchParams.get("city") ?? "",
      state: searchParams.get("state") ?? "",
      year: searchParams.get("year") ?? "",
      minWage: searchParams.get("min") ?? "",
      maxWage: searchParams.get("max") ?? "",
      status: searchParams.get("status") ?? "",
    };
  }, [searchParams]);

  const urlPage = useMemo(() => {
    const p = Number(searchParams.get("page") ?? "0");
    return Number.isFinite(p) && p > 0 ? Math.trunc(p) : 0;
  }, [searchParams]);

  const [values, setValues] = useState<SearchValues>(urlValues);
  const [page, setPage] = useState<number>(urlPage);

  const [rows, setRows] = useState<LcaRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Keep state synced when URL changes (e.g., user pastes a link, uses back/forward)
  useEffect(() => {
    setValues(urlValues);
    setPage(urlPage);
  }, [urlValues, urlPage]);

  // When user edits filters, reset pagination to page 0
  function handleValuesChange(next: SearchValues) {
    setValues(next);
    setPage(0);
  }

  // Debounced fetch + URL update
  const debounceTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (debounceTimerRef.current) window.clearTimeout(debounceTimerRef.current);

    debounceTimerRef.current = window.setTimeout(async () => {
      // 1) Update URL query params (shareable link)
      const params = new URLSearchParams();

      if (values.employer.trim()) params.set("em", values.employer.trim());
      if (values.job.trim()) params.set("job", values.job.trim());
      if (values.city.trim()) params.set("city", values.city.trim());
      if (values.state.trim()) params.set("state", values.state.trim());
      if (values.year.trim()) params.set("year", values.year.trim());
      if (values.minWage.trim()) params.set("min", values.minWage.trim());
      if (values.maxWage.trim()) params.set("max", values.maxWage.trim());
      if (values.status.trim()) params.set("status", values.status.trim());
      if (page > 0) params.set("page", String(page));

      const nextQueryString = params.toString();
      const currentQueryString =
        window.location.search.replace(/^\?/, "");

      if (nextQueryString !== currentQueryString) {
        router.replace(nextQueryString ? `/?${nextQueryString}` : "/", { scroll: false });
      }

      // 2) Call Supabase RPC
      setLoading(true);
      setErrorMsg(null);

      const offset = page * LIMIT;

      const { data, error } = await supabase.rpc("search_lca_cases_fields", {
        p_employer: values.employer.trim() || null,
        p_job: values.job.trim() || null,
        p_city: values.city.trim() || null,
        p_state: values.state.trim() || null,
        p_year: toIntOrNull(values.year),
        p_status: values.status.trim() || null,
        p_min_wage: toNumberOrNull(values.minWage),
        p_max_wage: toNumberOrNull(values.maxWage),
        p_limit: LIMIT,
        p_offset: offset,
      });

      if (error) {
        setRows([]);
        setErrorMsg(error.message || "Search failed. Please try again.");
        setLoading(false);
        return;
      }

      setRows((data ?? []) as LcaRow[]);
      setLoading(false);
    }, 300);

    return () => {
      if (debounceTimerRef.current) window.clearTimeout(debounceTimerRef.current);
    };
  }, [values, page, router]);

  const canPrev = page > 0;
  const canNext = rows.length === LIMIT;

  return (
    <main style={{ padding: 16, fontFamily: "system-ui, Arial, sans-serif" }}>
      <h1 style={{ marginBottom: 8 }}>LCA Case Search</h1>
      <p style={{ marginTop: 0, color: "#555" }}>
        Multi-field search calling your Supabase RPC <code>search_lca_cases_fields</code>.
      </p>

      <SearchForm values={values} onChange={handleValuesChange} disabled={loading} />

      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={!canPrev || loading}>
          Prev
        </button>
        <button onClick={() => setPage((p) => p + 1)} disabled={!canNext || loading}>
          Next
        </button>

        <span style={{ marginLeft: 8, color: "#555" }}>
          Page: {page} {loading ? "(Loading…)" : ""}
        </span>
      </div>

      {errorMsg && (
        <div
          style={{
            padding: 12,
            border: "1px solid #f5c2c7",
            background: "#f8d7da",
            borderRadius: 8,
            marginBottom: 12,
          }}
        >
          <strong>Search error:</strong> {errorMsg}
        </div>
      )}

      {!errorMsg && !loading && rows.length === 0 && (
        <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 8 }}>
          No results found. Try broadening your filters.
        </div>
      )}

      {rows.length > 0 && (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {["Employer", "Job", "City", "State", "Year", "Wage", "Status"].map((h) => (
                  <th
                    key={h}
                    style={{
                      textAlign: "left",
                      borderBottom: "2px solid #ddd",
                      padding: "8px 6px",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, idx) => (
                <tr key={idx}>
                  <td style={{ borderBottom: "1px solid #eee", padding: "8px 6px" }}>
                    {r.employer_name ?? ""}
                  </td>
                  <td style={{ borderBottom: "1px solid #eee", padding: "8px 6px" }}>
                    {r.job_title ?? ""}
                  </td>
                  <td style={{ borderBottom: "1px solid #eee", padding: "8px 6px" }}>
                    {r.worksite_city ?? ""}
                  </td>
                  <td style={{ borderBottom: "1px solid #eee", padding: "8px 6px" }}>
                    {r.worksite_state ?? ""}
                  </td>
                  <td style={{ borderBottom: "1px solid #eee", padding: "8px 6px" }}>
                    {r.year ?? ""}
                  </td>
                  <td style={{ borderBottom: "1px solid #eee", padding: "8px 6px" }}>
                    {r.wage_annual != null ? r.wage_annual.toLocaleString() : ""}
                  </td>
                  <td style={{ borderBottom: "1px solid #eee", padding: "8px 6px" }}>
                    {r.case_status ?? ""}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ marginTop: 10, color: "#555" }}>
            Showing {rows.length} row(s). {canNext ? "More pages available." : "End of results."}
          </div>
        </div>
      )}
    </main>
  );
}
