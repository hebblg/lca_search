#!/usr/bin/env bash
set -euo pipefail

# REQUIRED: DATABASE_URL must be set (Supabase connection string with sslmode=require)
: "${DATABASE_URL:?Need DATABASE_URL env var, e.g. export DATABASE_URL='postgresql://...'}"

CLEAN_DIR="${1:-output/clean}"
UPSERT_SQL="${2:-scripts/upsert_lca_cases_from_stage.sql}"

if ! command -v psql >/dev/null 2>&1; then
  echo "psql not found. Install Postgres client (macOS: brew install libpq && brew link --force libpq)."
  exit 1
fi

if [ ! -f "$UPSERT_SQL" ]; then
  echo "Upsert SQL not found: $UPSERT_SQL"
  exit 1
fi

shopt -s nullglob
CSV_FILES=("$CLEAN_DIR"/*.csv)

if [ ${#CSV_FILES[@]} -eq 0 ]; then
  echo "No CSV files found in $CLEAN_DIR"
  exit 1
fi

for csv in "${CSV_FILES[@]}"; do
  # Skip manifest.csv
  if [[ "$(basename "$csv")" == "manifest.csv" ]]; then
    continue
  fi

  echo "=============================="
  echo "Loading: $csv"

  # One psql session per file
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 <<SQL
-- Keep stage small per quarter
truncate table public.lca_cases_stage;

-- IMPORTANT: \copy must be one line. Also: we do NOT need to include year here.
\copy public.lca_cases_stage (case_number, case_status, received_date, decision_date, employer_name, job_title, soc_code, soc_title, worksite_city, worksite_state, wage_rate_from, wage_rate_to, wage_unit, wage_annual, year) from '${csv}' with (format csv, header true, null '\N', quote '"', escape '"');

\i ${UPSERT_SQL}

-- Optional: update planner stats after each file (or do once at end)
analyze public.lca_cases;
SQL

  echo "Done: $csv"
done

echo "All files loaded."
