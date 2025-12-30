begin;

-- Optional: avoid timeouts on big quarters
set local statement_timeout = '0';

with dedup as (
  select distinct on (case_number)
    case_number,
    case_status,
    received_date,
    decision_date,
    employer_name,
    job_title,
    soc_code,
    soc_title,
    worksite_city,
    worksite_state,
    wage_rate_from,
    wage_rate_to,
    wage_unit,
    wage_annual
  from public.lca_cases_stage
  where case_number is not null
  order by
    case_number,
    decision_date desc nulls last,
    received_date desc nulls last
)
insert into public.lca_cases (
  case_number,
  case_status,
  received_date,
  decision_date,
  employer_name,
  job_title,
  soc_code,
  soc_title,
  worksite_city,
  worksite_state,
  wage_rate_from,
  wage_rate_to,
  wage_unit,
  wage_annual
)
select
  case_number,
  case_status,
  received_date,
  decision_date,
  employer_name,
  job_title,
  soc_code,
  soc_title,
  worksite_city,
  worksite_state,
  wage_rate_from,
  wage_rate_to,
  wage_unit,
  wage_annual
from dedup
on conflict (case_number) do update
set
  case_status     = excluded.case_status,
  received_date   = excluded.received_date,
  decision_date   = excluded.decision_date,
  employer_name   = excluded.employer_name,
  job_title       = excluded.job_title,
  soc_code        = excluded.soc_code,
  soc_title       = excluded.soc_title,
  worksite_city   = excluded.worksite_city,
  worksite_state  = excluded.worksite_state,
  wage_rate_from  = excluded.wage_rate_from,
  wage_rate_to    = excluded.wage_rate_to,
  wage_unit       = excluded.wage_unit,
  wage_annual     = excluded.wage_annual,
  updated_at      = now();

commit;
