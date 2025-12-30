#!/usr/bin/env python3
r"""
Batch-clean DOL LCA disclosure Excel files (FY2020–FY2025, Q1–Q4) into COPY-friendly CSVs.

- Reads each .xlsx in input-dir matching pattern like: LCA_Disclosure_Data_FY2020_Q1.xlsx
- Normalizes columns to your DB fields
- Safe date parsing (strings + Excel serial dates)
- Computes wage_annual from wage_rate_from + wage_unit
- Writes per-file CSV with NULL as \N (good for COPY ... NULL '\N')
- Writes a manifest.csv summary

Run:
  python scripts/backfill_clean_all.py --input-dir data/raw --output-dir output/clean
"""

from __future__ import annotations

import argparse
import os
import re
from typing import Dict, List, Optional, Tuple

import numpy as np
import pandas as pd


def norm_col(name: str) -> str:
    s = str(name).strip().lower()
    s = re.sub(r"[^\w]+", "_", s)
    s = re.sub(r"_+", "_", s).strip("_")
    return s


# Adjust synonyms here if your headers differ.
SOURCE_TO_TARGET: Dict[str, str] = {
    "case_number": "case_number",
    "case_no": "case_number",

    "case_status": "case_status",
    "status": "case_status",

    "received_date": "received_date",
    "case_received_date": "received_date",

    "decision_date": "decision_date",
    "case_decision_date": "decision_date",
    "original_cert_date": "decision_date",

    "employer_name": "employer_name",
    "employer": "employer_name",

    "job_title": "job_title",
    "jobtitle": "job_title",

    "soc_code": "soc_code",
    "soc": "soc_code",

    "soc_title": "soc_title",

    "worksite_city": "worksite_city",
    "worksite_state": "worksite_state",

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
    # keep year in CSV for your own debugging if you want; final table will compute it anyway
    "year",
]


WAGE_FACTORS = {
    "year": 1.0, "yr": 1.0, "annual": 1.0,
    "hour": 2080.0, "hr": 2080.0,
    "week": 52.0, "wk": 52.0,
    "bi_weekly": 26.0, "biweekly": 26.0,
    "semi_monthly": 24.0, "semimonthly": 24.0,
    "month": 12.0, "mo": 12.0,
    "day": 260.0, "daily": 260.0,
}


def clean_text_series(s: pd.Series) -> pd.Series:
    s = s.astype("string")
    s = s.str.strip()
    s = s.replace({"": pd.NA, "nan": pd.NA, "NaN": pd.NA, "NONE": pd.NA, "None": pd.NA})
    return s


def coerce_numeric_series(s: pd.Series) -> pd.Series:
    s = s.astype("string")
    s = s.str.replace(r"[\$,]", "", regex=True).str.strip()
    s = s.replace({"": pd.NA})
    return pd.to_numeric(s, errors="coerce")


def parse_mixed_date_series(s: pd.Series) -> pd.Series:
    ss = s.astype("string").str.strip()
    ss = ss.replace({"": pd.NA, "nan": pd.NA, "NaN": pd.NA})

    is_serial = ss.str.fullmatch(r"\d{4,6}")
    serial_vals = pd.to_numeric(ss.where(is_serial), errors="coerce")

    out = pd.to_datetime(ss, errors="coerce", infer_datetime_format=True)

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
    if u is None or (isinstance(u, float) and np.isnan(u)):
        return None
    s = str(u).strip().lower()
    s = re.sub(r"[^\w]+", "_", s)
    s = re.sub(r"_+", "_", s).strip("_")

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


def compute_wage_annual(wage_from: pd.Series, wage_to: pd.Series, wage_unit: pd.Series) -> pd.Series:
    base = wage_from.where(wage_from.notna(), wage_to)

    unit_norm = wage_unit.apply(normalize_wage_unit).astype("string")
    factors = unit_norm.map(lambda x: WAGE_FACTORS.get(str(x), np.nan))

    annual = base.astype(float) * factors.astype(float)

    # Guardrails: drop absurd values
    annual = annual.where((annual.isna()) | ((annual >= 1000) & (annual <= 5_000_000)), np.nan)
    return annual.round(2)


def coalesce_duplicate_columns(df: pd.DataFrame) -> pd.DataFrame:
    """
    If df has duplicate column names after renaming, coalesce duplicates by first non-null (left-to-right).
    Prevents: AttributeError: 'DataFrame' object has no attribute 'str'
    """
    if df.columns.is_unique:
        return df
    out = {}
    for name in pd.unique(df.columns):
        cols = df.loc[:, df.columns == name]
        if isinstance(cols, pd.Series):
            out[name] = cols
        else:
            out[name] = cols.bfill(axis=1).iloc[:, 0]
    return pd.DataFrame(out)


def infer_usecols_from_xlsx(path: str, sheet: int | str) -> Optional[List[str]]:
    try:
        header_df = pd.read_excel(path, sheet_name=sheet, nrows=0, engine="openpyxl")
    except Exception:
        return None
    norm_map = {c: norm_col(c) for c in header_df.columns}
    needed = set(SOURCE_TO_TARGET.keys())
    keep = [c for c in header_df.columns if norm_map.get(c) in needed]
    return keep or None


def load_and_clean(df: pd.DataFrame) -> pd.DataFrame:
    rename_map: Dict[str, str] = {}
    for c in df.columns:
        nc = norm_col(c)
        if nc in SOURCE_TO_TARGET:
            rename_map[c] = SOURCE_TO_TARGET[nc]

    df = df.rename(columns=rename_map)
    df = coalesce_duplicate_columns(df)

    for col in TARGET_COLS:
        if col not in df.columns:
            df[col] = pd.NA

    df = df[TARGET_COLS].copy()

    # text
    for col in ["case_number", "case_status", "employer_name", "job_title", "soc_code", "soc_title",
                "worksite_city", "worksite_state", "wage_unit"]:
        df[col] = clean_text_series(df[col])

    df["worksite_state"] = df["worksite_state"].astype("string").str.upper().str.strip()
    df["worksite_state"] = df["worksite_state"].replace({"": pd.NA})

    # numerics
    df["wage_rate_from"] = coerce_numeric_series(df["wage_rate_from"])
    df["wage_rate_to"] = coerce_numeric_series(df["wage_rate_to"])

    # dates
    df["received_date"] = parse_mixed_date_series(df["received_date"])
    df["decision_date"] = parse_mixed_date_series(df["decision_date"])

    # derived
    df["year"] = df["decision_date"].dt.year.astype("Int64")
    df["wage_annual"] = compute_wage_annual(df["wage_rate_from"], df["wage_rate_to"], df["wage_unit"])

    # drop rows without PK
    df = df[df["case_number"].notna()].copy()

    return df


def write_copy_csv(df: pd.DataFrame, out_path: str) -> None:
    os.makedirs(os.path.dirname(out_path) or ".", exist_ok=True)

    out = df.copy()
    for dcol in ["received_date", "decision_date"]:
        out[dcol] = out[dcol].dt.strftime("%Y-%m-%d")

    out = out.replace({pd.NA: np.nan})
    out.to_csv(
        out_path,
        index=False,
        encoding="utf-8",
        na_rep="\\N",
        lineterminator="\n",
    )


def parse_fy_q(filename: str) -> Tuple[Optional[int], Optional[int]]:
    m = re.search(r"FY(\d{4})_Q([1-4])", filename, flags=re.IGNORECASE)
    if not m:
        return None, None
    return int(m.group(1)), int(m.group(2))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--input-dir", required=True)
    ap.add_argument("--output-dir", required=True)
    ap.add_argument("--sheet", default=0)
    ap.add_argument("--pattern", default=r".*\.xlsx$", help="regex to match files (default: .*\\.xlsx$)")
    args = ap.parse_args()

    in_dir = args.input_dir
    out_dir = args.output_dir
    sheet = int(args.sheet) if str(args.sheet).isdigit() else args.sheet
    pattern = re.compile(args.pattern, flags=re.IGNORECASE)

    files = [f for f in os.listdir(in_dir) if pattern.match(f)]
    if not files:
        print(f"No files matched in {in_dir}")
        return 1

    # Sort by FY/Q if possible
    def sort_key(f: str):
        fy, q = parse_fy_q(f)
        return (fy if fy is not None else 9999, q if q is not None else 9, f)

    files.sort(key=sort_key)

    manifest_rows = []
    for fname in files:
        in_path = os.path.join(in_dir, fname)
        fy, q = parse_fy_q(fname)

        usecols = infer_usecols_from_xlsx(in_path, sheet=sheet)

        df = pd.read_excel(
            in_path,
            sheet_name=sheet,
            engine="openpyxl",
            dtype="string",
            usecols=usecols,
        )

        cleaned = load_and_clean(df)

        out_name = fname.replace(".xlsx", ".csv").replace(".XLSX", ".csv")
        out_path = os.path.join(out_dir, out_name)
        write_copy_csv(cleaned, out_path)

        min_dd = cleaned["decision_date"].min()
        max_dd = cleaned["decision_date"].max()

        manifest_rows.append({
            "file": fname,
            "fy_in_name": fy,
            "q_in_name": q,
            "input_rows": int(len(df)),
            "output_rows": int(len(cleaned)),
            "decision_date_min": None if pd.isna(min_dd) else str(min_dd.date()),
            "decision_date_max": None if pd.isna(max_dd) else str(max_dd.date()),
            "wage_annual_nonnull": int(cleaned["wage_annual"].notna().sum()),
            "output_csv": out_path,
        })

        print(f"Cleaned {fname}: {len(df):,} -> {len(cleaned):,} | wrote {out_path}")

    os.makedirs(out_dir, exist_ok=True)
    manifest = pd.DataFrame(manifest_rows)
    manifest_path = os.path.join(out_dir, "manifest.csv")
    manifest.to_csv(manifest_path, index=False)
    print(f"Manifest: {manifest_path}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
