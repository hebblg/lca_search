"use client";

import React from "react";

export type SearchValues = {
  employer: string;
  job: string;
  city: string;
  state: string;
  year: string; // keep as string for easy URL sync
  minWage: string;
  maxWage: string;
  status: string;
};

type Props = {
  values: SearchValues;
  disabled?: boolean;
  onChange: (next: SearchValues) => void;
};

export default function SearchForm({ values, disabled, onChange }: Props) {
  function setField<K extends keyof SearchValues>(key: K, value: SearchValues[K]) {
    onChange({ ...values, [key]: value });
  }

  return (
    <form
      onSubmit={(e) => e.preventDefault()}
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, minmax(0, 1fr))",
        gap: 12,
        padding: 12,
        border: "1px solid #ddd",
        borderRadius: 8,
        marginBottom: 12,
      }}
    >
      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        Employer
        <input
          disabled={disabled}
          value={values.employer}
          onChange={(e) => setField("employer", e.target.value)}
          placeholder="e.g., Google"
        />
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        Job Title
        <input
          disabled={disabled}
          value={values.job}
          onChange={(e) => setField("job", e.target.value)}
          placeholder="e.g., Software Engineer"
        />
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        City
        <input
          disabled={disabled}
          value={values.city}
          onChange={(e) => setField("city", e.target.value)}
          placeholder="e.g., Houston"
        />
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        State
        <input
          disabled={disabled}
          value={values.state}
          onChange={(e) => setField("state", e.target.value)}
          placeholder="e.g., TX"
        />
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        Year
        <input
          disabled={disabled}
          type="number"
          value={values.year}
          onChange={(e) => setField("year", e.target.value)}
          placeholder="e.g., 2024"
        />
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        Min Wage (annual)
        <input
          disabled={disabled}
          type="number"
          value={values.minWage}
          onChange={(e) => setField("minWage", e.target.value)}
          placeholder="e.g., 120000"
        />
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        Max Wage (annual)
        <input
          disabled={disabled}
          type="number"
          value={values.maxWage}
          onChange={(e) => setField("maxWage", e.target.value)}
          placeholder="e.g., 200000"
        />
      </label>

      <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        Status
        <input
          disabled={disabled}
          value={values.status}
          onChange={(e) => setField("status", e.target.value)}
          placeholder="e.g., CERTIFIED"
        />
      </label>

      <div style={{ gridColumn: "1 / -1", fontSize: 12, color: "#555" }}>
        Searches run automatically (300ms debounce). URLs update so you can copy/paste the page link.
      </div>
    </form>
  );
}
