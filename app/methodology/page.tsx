// app/methodology/page.tsx
import Script from "next/script";

export default function MethodologyPage() {
  const canonical = "https://www.h1bdata.fyi/methodology";

  const datasetJsonLd = {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: "U.S. Department of Labor LCA Disclosure Data (FY2020–FY2025) — summaries on h1bdata.fyi",
    description:
      "This site summarizes public U.S. Department of Labor Labor Condition Application (LCA) disclosure records for FY2020–FY2025. It provides aggregated views by state, city, employer, and job title. Data is informational only; LCA filings do not imply petition approval and may contain errors.",
    url: canonical,
    creator: { "@type": "Organization", name: "h1bdata.fyi" },
    isBasedOn: { "@type": "WebPage", name: "U.S. Department of Labor", url: "https://www.dol.gov/" },
  };

  return (
    <>
      <Script
        id="dataset-jsonld"
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(datasetJsonLd) }}
      />

      <div className="card">
        <h1>Methodology</h1>
        <p>
          This page explains how we transform raw LCA public disclosure files into
          a searchable dataset. The goal is consistency and usability, while
          preserving important context from the original records.
        </p>

        <h2>Key disclaimers</h2>
        <ul>
          <li>
            <strong>Public disclosure data:</strong> Records originate from DOL LCA
            public disclosure datasets.
          </li>
          <li>
            <strong>Not legal advice:</strong> Nothing on this site should be
            interpreted as legal guidance.
          </li>
          <li>
            <strong>LCA does not equal approval:</strong> An LCA record is not the
            same as an approved petition or visa.
          </li>
          <li>
            <strong>Data may contain errors:</strong> We improve consistency, but
            cannot guarantee completeness or accuracy.
          </li>
        </ul>

        <h2>Processing steps (high level)</h2>
        <ol>
          <li>Import the raw disclosure file and normalize column names.</li>
          <li>Trim whitespace and convert blank strings to NULLs.</li>
          <li>Parse dates (e.g., received/decision) using safe parsing rules.</li>
          <li>
            Standardize text for search (case-folding; light cleanup for common
            punctuation/spacing).
          </li>
          <li>
            Compute derived fields such as <strong>year</strong> and (when possible)
            <strong> annualized wage</strong>.
          </li>
          <li>De-duplicate by case number when duplicates exist.</li>
        </ol>

        <h2>Annualized wage (when possible)</h2>
        <p>
          LCAs can report wages in different units. When a wage rate and unit are
          provided, we compute an approximate annual amount using common factors:
        </p>
        <ul>
          <li>Hourly: rate × 2,080 (40 hours/week × 52 weeks)</li>
          <li>Weekly: rate × 52</li>
          <li>Bi-Weekly: rate × 26</li>
          <li>Monthly: rate × 12</li>
          <li>Yearly: rate × 1</li>
        </ul>
        <p className="small">
          Notes: Annualization is an approximation and may not match actual
          compensation structures (bonuses, part-time schedules, unpaid leave,
          hourly assumptions, etc.).
        </p>

        <h2>How “year” is derived</h2>
        <p>
          We typically derive <strong>year</strong> from the decision date when it
          exists. If decision date is missing, we may fall back to another relevant
          date field (such as received date) depending on availability.
        </p>

        <h2>Known limitations</h2>
        <ul>
          <li>Worksite city/state formatting is not fully standardized in source files.</li>
          <li>Employer names may vary across filings for the same organization.</li>
          <li>Some records have missing or non-numeric wage fields.</li>
          <li>
            Search results are best-effort; use the raw fields and verify against
            official sources for decisions.
          </li>
        </ul>
      </div>
    </>
  );
}
