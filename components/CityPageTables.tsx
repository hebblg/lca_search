"use client";

import Link from "next/link";
import SortableHubTable from "@/components/SortableHubTable";

type EmployerRow = {
  employer_name: string;
  case_count: string | number;
  median_wage: string | number | null;
};

type JobRow = {
  job_title: string;
  case_count: string | number;
  median_wage: string | number | null;
};

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

function slugify(s: string) {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .trim();
}

export function CityEmployersTable({
  stateLower,
  rows,
  cityName,
}: {
  stateLower: string;
  rows: EmployerRow[];
  cityName: string;
}) {
  return (
    <SortableHubTable
      title={`Top employers in ${cityName}`}
      columns={[
        {
          key: "employer_name",
          label: "Employer",
          renderCell: (v: any) => (
            <Link href={`/salary/${stateLower}/employer/${slugify(String(v))}`}>{String(v)}</Link>
          ),
          sortValue: (v: any) => String(v ?? ""),
        },
        {
          key: "case_count",
          label: "Cases",
          renderCell: (v: any) => formatInt(v),
          sortValue: (v: any) => asNumber(v),
        },
        {
          key: "median_wage",
          label: "Median wage",
          renderCell: (v: any) => formatUSD(v),
          sortValue: (v: any) => asNumber(v),
        },
      ]}
      rows={rows}
      emptyText="No employer data available."
      defaultSortKey="case_count"
    />
  );
}

export function CityJobsTable({
  stateLower,
  rows,
  cityName,
}: {
  stateLower: string;
  rows: JobRow[];
  cityName: string;
}) {
  return (
    <SortableHubTable
      title={`Top job titles in ${cityName}`}
      columns={[
        {
          key: "job_title",
          label: "Job title",
          renderCell: (v: any) => (
            <Link href={`/salary/${stateLower}/job/${slugify(String(v))}`}>{String(v)}</Link>
          ),
          sortValue: (v: any) => String(v ?? ""),
        },
        {
          key: "case_count",
          label: "Cases",
          renderCell: (v: any) => formatInt(v),
          sortValue: (v: any) => asNumber(v),
        },
        {
          key: "median_wage",
          label: "Median wage",
          renderCell: (v: any) => formatUSD(v),
          sortValue: (v: any) => asNumber(v),
        },
      ]}
      rows={rows}
      emptyText="No job title data available."
      defaultSortKey="case_count"
    />
  );
}
