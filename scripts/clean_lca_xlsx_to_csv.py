#!/usr/bin/env python3
r"""
Clean a DOL LCA disclosure Excel (.xlsx) "case-only" file into a COPY-friendly CSV for Supabase/Postgres.

Features
- Reads .xlsx (optionally only needed columns to reduce memory)
- Normalizes column names to your DB fields
- Safely parses dates (handles strings AND Excel serial dates)
- Computes year from decision_date
- Computes wage_annual from wage_rate_from (or other strategy) + wage_unit
- Outputs CSV using \N for NULL (ideal for COPY ... NULL '\N')

Usage examples
  python clean_lca_xlsx_to_csv.py --input data/LCA_Disclosure.xlsx --output output/clean_lca_cases.csv
  python clean_lca_xlsx_to_csv.py --input data/LCA_Disclosure.xlsx --sheet 0 --wage-strategy avg
  python clean_lca_xlsx_to_csv.py --input data/LCA_Disclosure.csv --output output/clean_lca_cases.csv --chunksize 250000
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd


# -----------------------------
# Column normalization / mapping
# -----------------------------

def norm_col(name: str) -> str:
    """Normalize a source column name to a canonical token."""
    s = str(name).strip().lower()
    s = re.sub(r"[^\w]+", "_", s)        # non-word -> underscore
    s = re.sub(r"_+", "_", s).strip("_")
    return s


# Map normalized source columns -> target DB columns
# Add/adjust synonyms here if your file differs.
SOURCE_TO_TARGET: Dict[str, str] = {
    # Keys from DOL disclosure files (common)
    "case_number": "case_number",
    "case_no": "case_number",

    "case_status": "case_status",
    "status": "case_status",

    "received_date": "received_date",
    "case_received_date": "received_date",

    "decision_date": "decision_date",
    "case_decision_date": "decision_date",
    "original_cert_date": "decision_date",  # sometimes present; keep decision_date preferred if both exist

    "employer_name": "employer_name",
    "employer": "employer_name",
    "employer_company_name": "employer_name",

    "job_title": "job_title",
    "jobtitle": "job_title",

    "soc_code": "soc_code",
    "soc": "soc_code",

    "soc_title": "soc_title",

    "worksite_city": "worksite_city",
    "employer_city": "worksite_city",  # sometimes worksite is separate; adjust if needed

    "worksite_state": "worksite_state",
    "employer_state": "worksite_state",

    # Wage columns in DOL disclosure files (common)
    "wage_rate_of_pay_from": "wage_rate_from",
    "wage_rate_from": "wage_rate_from",

    "wage_rate_of_pay_to": "wage_rate_to",
    "wage_rate_to": "wage_rate_to",

    "wage_unit_of_pay": "wage_unit",
    "wage_unit": "wage_unit",
}

TARGET_COLS: List[str] = [
    "case_number",
    "case_status",
    "received_date",
    "decision_date",
    "employer_name",
    "job_title",
    "soc_code",
    "soc_title",
    "worksite_city",
    "worksite_state",
    "wage_rate_from",
    "wage_rate_to",
    "wage_unit",
    "wage_annual",
    "year",
]


# -----------------------------
# Parsing helpers
# -----------------------------

WAGE_FACTORS = {
    "year": 1.0,
    "yr": 1.0,
    "annual": 1.0,

    "hour": 2080.0,          # 40 * 52
    "hr": 2080.0,

    "week": 52.0,
    "wk": 52.0,

    "bi_weekly": 26.0,
    "biweekly": 26.0,

    "semi_monthly": 24.0,
    "semimonthly": 24.0,

    "month": 12.0,
    "mo": 12.0,

    "day": 260.0,            # approx business days
    "daily": 260.0,
}


def clean_text_series(s: pd.Series) -> pd.Series:
    """Trim strings; convert empty/whitespace-only to NaN."""
    if s is None:
        return s
    s = s.astype("string")
    s = s.str.strip()
    s = s.replace({"": pd.NA, "nan": pd.NA, "NaN": pd.NA, "NONE": pd.NA, "None": pd.NA})
    return s


def coerce_numeric_series(s: pd.Series) -> pd.Series:
    """Convert to float; remove commas, $; invalid -> NaN."""
    if s is None:
        return s
    s = s.astype("string")
    s = s.str.replace(r"[\$,]", "", regex=True).str.strip()
    s = s.replace({"": pd.NA})
    return pd.to_numeric(s, errors="coerce")


def parse_mixed_date_series(s: pd.Series) -> pd.Series:
    """
    Parse dates robustly:
    - standard date strings
    - Excel serial dates (e.g., 45234)
    Returns pandas datetime64[ns] with NaT for invalid.
    """
    if s is None:
        return s

    # Work with strings to avoid pandas interpreting numeric as unix ns
    ss = s.astype("string").str.strip()
    ss = ss.replace({"": pd.NA, "nan": pd.NA, "NaN": pd.NA})

    # Detect likely Excel serial numbers (roughly year 1950-2050)
    # Excel date origin for Windows: 1899-12-30
    is_serial = ss.str.fullmatch(r"\d{4,6}")  # 4-6 digits
    serial_vals = pd.to_numeric(ss.where(is_serial), errors="coerce")

    out = pd.to_datetime(ss, errors="coerce", infer_datetime_format=True)

    # Convert serials where normal parsing failed
    needs_serial = out.isna() & serial_vals.notna() & serial_vals.between(18000, 60000)
    if needs_serial.any():
        out.loc[needs_serial] = pd.to_datetime(
            serial_vals.loc[needs_serial],
            unit="D",
            origin="1899-12-30",
            errors="coerce",
        )

    return out


def normalize_wage_unit(u: Optional[str]) -> Optional[str]:
    """Normalize wage unit tokens to keys used in WAGE_FACTORS."""
    if u is None or (isinstance(u, float) and np.isnan(u)):
        return None
    s = str(u).strip().lower()
    s = re.sub(r"[^\w]+", "_", s)
    s = re.sub(r"_+", "_", s).strip("_")

    # Common DOL variants
    # e.g., "BI-WEEKLY", "Bi-Weekly", "BI_WEEKLY"
    if s in ("bi_weekly", "biweekly"):
        return "bi_weekly"
    if s in ("semi_monthly", "semi_month"):
        return "semi_monthly"
    if s in ("hour", "hr", "per_hour"):
        return "hour"
    if s in ("week", "wk", "per_week"):
        return "week"
    if s in ("month", "mo", "per_month"):
        return "month"
    if s in ("year", "yr", "per_year", "annual"):
        return "year"
    if s in ("day", "daily", "per_day"):
        return "day"

    return s or None


def compute_wage_annual(
    wage_from: pd.Series,
    wage_to: pd.Series,
    wage_unit: pd.Series,
    strategy: str = "from",
) -> pd.Series:
    """
    strategy:
      - from: wage_rate_from annualized
      - avg:  average of from/to (when both present) annualized
      - max:  max(from,to) annualized
    """
    unit_norm = wage_unit.apply(normalize_wage_unit).astype("string")

    if strategy == "avg":
        base = wage_from.where(wage_from.notna(), np.nan)
        both = wage_from.notna() & wage_to.notna()
        base = base.astype(float)
        base.loc[both] = ((wage_from.loc[both] + wage_to.loc[both]) / 2.0).astype(float)
        base = pd.Series(base, index=wage_from.index)
    elif strategy == "max":
        base = pd.concat([wage_from, wage_to], axis=1).max(axis=1, skipna=True)
    else:
        base = wage_from.where(wage_from.notna(), wage_to)

    # Apply factor
    factors = unit_norm.map(lambda x: WAGE_FACTORS.get(str(x), np.nan))
    annual = base.astype(float) * factors.astype(float)

    # Guardrails: drop absurd values (tune as you like)
    annual = annual.where((annual.isna()) | ((annual >= 1000) & (annual <= 5_000_000)), np.nan)
    return annual


# -----------------------------
# I/O strategies (xlsx vs csv chunks)
# -----------------------------

def infer_usecols_from_xlsx(path: str, sheet: int | str = 0) -> Tuple[Optional[List[str]], Dict[str, str]]:
    """
    Peek at header row using openpyxl (via pandas) to select only relevant columns.
    Returns (usecols_list_or_None, normalized_header_map).
    """
    try:
        header_df = pd.read_excel(path, sheet_name=sheet, nrows=0, engine="openpyxl")
        original_cols = list(header_df.columns)
    except Exception:
        return None, {}

    norm_map = {c: norm_col(c) for c in original_cols}

    needed_norm_sources = set(SOURCE_TO_TARGET.keys())
    keep_cols = [c for c in original_cols if norm_map.get(c) in needed_norm_sources]

    # If we somehow found nothing, fall back to reading all columns
    if not keep_cols:
        return None, norm_map

    return keep_cols, norm_map
def coalesce_duplicate_columns(df: pd.DataFrame) -> pd.DataFrame:
    """
    If df has duplicate column names, coalesce duplicates by taking the first non-null value
    across the duplicate columns, left to right.
    """
    if df.columns.is_unique:
        return df

    out = {}
    # pd.unique preserves first-seen order
    for name in pd.unique(df.columns):
        cols = df.loc[:, df.columns == name]
        # cols is a DataFrame when duplicates exist; a Series when unique
        if isinstance(cols, pd.Series):
            out[name] = cols
        else:
            out[name] = cols.bfill(axis=1).iloc[:, 0]
    return pd.DataFrame(out)


def load_and_clean_dataframe(df: pd.DataFrame, wage_strategy: str) -> pd.DataFrame:
    # Build a rename map: source_col -> target_col
    rename_map: Dict[str, str] = {}
    for c in df.columns:
        nc = norm_col(c)
        if nc in SOURCE_TO_TARGET:
            rename_map[c] = SOURCE_TO_TARGET[nc]

    df = df.rename(columns=rename_map)
    dups = df.columns[df.columns.duplicated()].tolist()
    print("Duplicate columns after rename:", dups)

    df = coalesce_duplicate_columns(df)

    # Ensure all target columns exist
    for col in TARGET_COLS:
        if col not in df.columns:
            df[col] = pd.NA

    # Keep only the columns we care about (plus duplicates will be handled later in SQL)
    df = df[TARGET_COLS].copy()

    # Basic text cleanup
    for col in ["case_number", "case_status", "employer_name", "job_title", "soc_code", "soc_title", "worksite_city", "worksite_state", "wage_unit"]:
        df[col] = clean_text_series(df[col])

    # State normalization (2-letter upper if present)
    df["worksite_state"] = df["worksite_state"].astype("string").str.upper().str.strip()
    df["worksite_state"] = df["worksite_state"].replace({"": pd.NA})

    # Numerics
    df["wage_rate_from"] = coerce_numeric_series(df["wage_rate_from"])
    df["wage_rate_to"] = coerce_numeric_series(df["wage_rate_to"])

    # Dates
    df["received_date"] = parse_mixed_date_series(df["received_date"])
    df["decision_date"] = parse_mixed_date_series(df["decision_date"])

    # Compute year from decision_date
    df["year"] = df["decision_date"].dt.year.astype("Int64")

    # Compute wage_annual
    df["wage_annual"] = compute_wage_annual(
        df["wage_rate_from"],
        df["wage_rate_to"],
        df["wage_unit"],
        strategy=wage_strategy,
    ).round(2)

    # Final cleanup: empty strings -> NA across object/string cols
    for col in ["case_number", "case_status", "employer_name", "job_title", "soc_code", "soc_title", "worksite_city", "worksite_state", "wage_unit"]:
        df[col] = clean_text_series(df[col])

    # Drop rows without case_number (cannot upsert)
    df = df[df["case_number"].notna()].copy()

    return df


def write_csv_copy_friendly(df: pd.DataFrame, output_path: str) -> None:
    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)

    # Convert datetime to date strings; keep NULL as \N
    out = df.copy()

    for dcol in ["received_date", "decision_date"]:
        # Keep as YYYY-MM-DD; NaT -> NA
        out[dcol] = out[dcol].dt.strftime("%Y-%m-%d")

    # Ensure pandas treats missing as NaN so na_rep works
    out = out.replace({pd.NA: np.nan})

    out.to_csv(
        output_path,
        index=False,
        encoding="utf-8",
        na_rep="\\N",
        lineterminator="\n",
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", required=True, help="Path to input .xlsx or .csv")
    ap.add_argument("--output", required=True, help="Path to output clean CSV")
    ap.add_argument("--sheet", default=0, help="Excel sheet name or 0-based index (default: 0)")
    ap.add_argument("--wage-strategy", choices=["from", "avg", "max"], default="from",
                    help="How to choose base wage before annualizing (default: from)")
    ap.add_argument("--chunksize", type=int, default=200000,
                    help="If input is CSV, process in chunks (default: 200000 rows)")
    args = ap.parse_args()

    in_path = args.input
    out_path = args.output

    if in_path.lower().endswith(".csv"):
        # Chunked path (recommended for very large files)
        first = True
        os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)

        for chunk in pd.read_csv(in_path, dtype="string", chunksize=args.chunksize, low_memory=False):
            cleaned = load_and_clean_dataframe(chunk, wage_strategy=args.wage_strategy)

            # Convert dates to string before writing
            for dcol in ["received_date", "decision_date"]:
                cleaned[dcol] = cleaned[dcol].dt.strftime("%Y-%m-%d")

            cleaned = cleaned.replace({pd.NA: np.nan})

            cleaned.to_csv(
                out_path,
                mode="w" if first else "a",
                header=first,
                index=False,
                encoding="utf-8",
                na_rep="\\N",
                lineterminator="\n",
            )
            first = False

        print(f"Done. Wrote: {out_path}")
        return 0

    # Excel path (loads sheet; we try to only read relevant columns)
    sheet = args.sheet
    try:
        # If numeric string provided, treat as index
        if isinstance(sheet, str) and sheet.isdigit():
            sheet = int(sheet)
    except Exception:
        pass

    usecols, _ = infer_usecols_from_xlsx(in_path, sheet=sheet)

    # Read as strings to avoid type surprises; we will coerce ourselves.
    df = pd.read_excel(
        in_path,
        sheet_name=sheet,
        engine="openpyxl",
        dtype="string",
        usecols=usecols,   # None => all columns
    )

    cleaned = load_and_clean_dataframe(df, wage_strategy=args.wage_strategy)
    write_csv_copy_friendly(cleaned, out_path)

    print(f"Done. Input rows: {len(df):,} | Output rows: {len(cleaned):,} | Wrote: {out_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
