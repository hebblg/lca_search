"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

type StateRow = {
  state: string;
  total_cases: string | number;
  latest_year: number | null;
  wage_p50: string | number | null;
  wage_p25: string | number | null;
  wage_p75: string | number | null;
};

type SortKey = "state" | "total_cases" | "latest_year" | "wage_p50" | "wage_range" | "search";
type SortDir = "asc" | "desc";

const STATE_NAME: Record<string, string> = {
  AL: "Alabama",
  AK: "Alaska",
  AZ: "Arizona",
  AR: "Arkansas",
  CA: "California",
  CO: "Colorado",
  CT: "Connecticut",
  DE: "Delaware",
  FL: "Florida",
  GA: "Georgia",
  HI: "Hawaii",
  ID: "Idaho",
  IL: "Illinois",
  IN: "Indiana",
  IA: "Iowa",
  KS: "Kansas",
  KY: "Kentucky",
  LA: "Louisiana",
  ME: "Maine",
  MD: "Maryland",
  MA: "Massachusetts",
  MI: "Michigan",
  MN: "Minnesota",
  MS: "Mississippi",
  MO: "Missouri",
  MT: "Montana",
  NE: "Nebraska",
  NV: "Nevada",
  NH: "New Hampshire",
  NJ: "New Jersey",
  NM: "New Mexico",
  NY: "New York",
  NC: "North Carolina",
  ND: "North Dakota",
  OH: "Ohio",
  OK: "Oklahoma",
  OR: "Oregon",
  PA: "Pennsylvania",
  RI: "Rhode Island",
  SC: "South Carolina",
  SD: "South Dakota",
  TN: "Tennessee",
  TX: "Texas",
  UT: "Utah",
  VT: "Vermont",
  VA: "Virginia",
  WA: "Washington",
  WV: "West Virginia",
  WI: "Wisconsin",
  WY: "Wyoming",
  DC: "District of Columbia",
};

function getStateName(stateUpper: string) {
  return STATE_NAME[stateUpper] ?? stateUpper;
}

function asNumber(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function formatInt(v: unknown) {
  return asNumber(v).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function formatUSD(v: unknown) {
  const n = typeof v === "string" || typeof v === "number" ? Number(v) : NaN;
  if (!Number.isFinite(n) || n <= 0) return "—";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

const td: React.CSSProperties = {
  padding: "10px 8px",
  borderBottom: "1px solid rgba(0,0,0,0.06)",
  verticalAlign: "top",
};

export default function StateTable({ rows }: { rows: StateRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("total_cases");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function toggleSort(nextKey: SortKey) {
    if (nextKey === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(nextKey);
      setSortDir(nextKey === "state" || nextKey === "search" ? "asc" : "desc");
    }
  }

  function sortIndicator(key: SortKey) {
    if (key !== sortKey) return "↕";
    return sortDir === "asc" ? "↑" : "↓";
  }

  const sortedRows = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      switch (sortKey) {
        case "state": {
          const an = getStateName(a.state).toLowerCase();
          const bn = getStateName(b.state).toLowerCase();
          return an.localeCompare(bn) * dir;
        }
        case "total_cases":
          return (asNumber(a.total_cases) - asNumber(b.total_cases)) * dir;
        case "latest_year":
          return (asNumber(a.latest_year) - asNumber(b.latest_year)) * dir;
        case "wage_p50":
          return (asNumber(a.wage_p50) - asNumber(b.wage_p50)) * dir;
        case "wage_range": {
          const aMid = (asNumber(a.wage_p25) + asNumber(a.wage_p75)) / 2;
          const bMid = (asNumber(b.wage_p25) + asNumber(b.wage_p75)) / 2;
          return (aMid - bMid) * dir;
        }
        case "search": {
          const an = getStateName(a.state).toLowerCase();
          const bn = getStateName(b.state).toLowerCase();
          return an.localeCompare(bn) * dir;
        }
        default:
          return 0;
      }
    });
  }, [rows, sortDir, sortKey]);

  return (
    <div style={{ overflowX: "auto", marginTop: 10 }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr>
            <SortableTh label="State" sortKey="state" onSort={toggleSort} indicator={sortIndicator("state")} />
            <SortableTh
              label="Total cases"
              sortKey="total_cases"
              onSort={toggleSort}
              indicator={sortIndicator("total_cases")}
            />
            <SortableTh
              label="Latest year"
              sortKey="latest_year"
              onSort={toggleSort}
              indicator={sortIndicator("latest_year")}
            />
            <SortableTh
              label="Median wage (latest)"
              sortKey="wage_p50"
              onSort={toggleSort}
              indicator={sortIndicator("wage_p50")}
            />
            <SortableTh
              label="P25–P75 (latest)"
              sortKey="wage_range"
              onSort={toggleSort}
              indicator={sortIndicator("wage_range")}
            />
            <SortableTh
              label="Search"
              sortKey="search"
              onSort={toggleSort}
              indicator={sortIndicator("search")}
            />
          </tr>
        </thead>
        <tbody>
          {sortedRows.map((r) => {
            const stLower = r.state.toLowerCase();
            const name = getStateName(r.state);
            return (
              <tr key={r.state}>
                <td style={td}>
                  <Link href={`/salary/${stLower}`} style={{ textDecoration: "none" }}>
                    <strong>{name}</strong> <span style={{ opacity: 0.75 }}>({r.state})</span>
                  </Link>
                </td>
                <td style={td}>{formatInt(r.total_cases)}</td>
                <td style={td}>{r.latest_year ?? "—"}</td>
                <td style={td}>{formatUSD(r.wage_p50)}</td>
                <td style={td}>
                  {formatUSD(r.wage_p25)} – {formatUSD(r.wage_p75)}
                </td>
                <td style={td}>
                  <Link href={`/?state=${encodeURIComponent(r.state)}`}>Search</Link>
                </td>
              </tr>
            );
          })}
          {sortedRows.length === 0 ? (
            <tr>
              <td style={td} colSpan={6}>
                No states returned. Confirm your materialized views are refreshed and contain data.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function SortableTh({
  label,
  sortKey,
  onSort,
  indicator,
}: {
  label: string;
  sortKey: SortKey;
  onSort: (key: SortKey) => void;
  indicator: string;
}) {
  return (
    <th
      onClick={() => onSort(sortKey)}
      style={{
        textAlign: "left",
        fontSize: 13,
        padding: "10px 8px",
        borderBottom: "1px solid rgba(0,0,0,0.12)",
        whiteSpace: "nowrap",
        cursor: "pointer",
        userSelect: "none",
      }}
    >
      {label} <span style={{ opacity: 0.6 }}>{indicator}</span>
    </th>
  );
}
