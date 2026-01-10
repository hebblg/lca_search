"use client";

import { useMemo, useState } from "react";

type SortDir = "asc" | "desc";

export default function SortableHubTable<T extends Record<string, any>>({
  title,
  subtitle,
  columns,
  rows,
  emptyText,
  defaultSortKey,
  defaultSortDir = "desc",
}: {
  title: string;
  subtitle?: string;
  columns: Array<{
    key: keyof T;
    label: string;
    renderCell?: (value: any, row: T) => React.ReactNode;
    sortValue?: (value: any, row: T) => string | number;
  }>;
  rows: T[];
  emptyText: string;
  defaultSortKey: keyof T;
  defaultSortDir?: SortDir;
}) {
  const [sortKey, setSortKey] = useState<keyof T>(defaultSortKey);
  const [sortDir, setSortDir] = useState<SortDir>(defaultSortDir);

  function toggleSort(nextKey: keyof T) {
    if (nextKey === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(nextKey);
      setSortDir(defaultSortDir);
    }
  }

  function sortIndicator(key: keyof T) {
    if (key !== sortKey) return "↕";
    return sortDir === "asc" ? "↑" : "↓";
  }

  function asNumber(v: unknown): number {
    if (typeof v === "number") return Number.isFinite(v) ? v : 0;
    if (typeof v === "string") {
      const n = Number(v);
      return Number.isFinite(n) ? n : 0;
    }
    return 0;
  }

  const sortedRows = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const col = columns.find((c) => c.key === sortKey);
    return [...rows].sort((a, b) => {
      const aRaw = a[sortKey as string];
      const bRaw = b[sortKey as string];
      const aVal = col?.sortValue ? col.sortValue(aRaw, a) : aRaw;
      const bVal = col?.sortValue ? col.sortValue(bRaw, b) : bRaw;
      if (typeof aVal === "number" || typeof bVal === "number") {
        return (asNumber(aVal) - asNumber(bVal)) * dir;
      }
      return String(aVal ?? "").localeCompare(String(bVal ?? ""), undefined, { sensitivity: "base" }) * dir;
    });
  }, [rows, sortDir, sortKey, columns]);

  return (
    <section style={{ border: "1px solid rgba(0,0,0,0.1)", borderRadius: 12, padding: 16 }}>
      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 16, fontWeight: 750 }}>{title}</div>
        {subtitle ? <div style={{ fontSize: 12.5, opacity: 0.8, marginTop: 3 }}>{subtitle}</div> : null}
      </div>

      {sortedRows.length === 0 ? (
        <p style={{ margin: 0 }}>{emptyText}</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                {columns.map((c) => (
                  <th
                    key={String(c.key)}
                    onClick={() => toggleSort(c.key)}
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
                    {c.label} <span style={{ opacity: 0.6 }}>{sortIndicator(c.key)}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sortedRows.map((r, idx) => (
                <tr key={idx}>
                  {columns.map((c) => {
                    const raw = r[c.key as string];
                    const cell = c.renderCell ? c.renderCell(raw, r) : raw ?? "—";
                    return (
                      <td
                        key={String(c.key)}
                        style={{
                          padding: "10px 8px",
                          borderBottom: "1px solid rgba(0,0,0,0.06)",
                          verticalAlign: "top",
                        }}
                      >
                        {cell}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
