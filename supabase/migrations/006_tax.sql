-- ── Tax estimator: reference data + user tax profile ────────────────────────
-- Powers the gross→net income estimate in Settings › Income & Taxes.
--
-- Two parts:
--   1. tax_brackets — world-readable reference data (federal brackets + standard
--      deduction, FICA constants, simplified per-state rates), keyed to the
--      budget year so estimates change with the year being planned. Stored in the
--      DB (not hardcoded) so next year's numbers can be updated without a code
--      redeploy. There is no official government API for brackets — values are
--      seeded from the IRS annual Revenue Procedures (2024: Rev. Proc. 2023-34,
--      2025: Rev. Proc. 2024-40 + OBBBA standard deduction, 2026: Rev. Proc.
--      2025-32) and the SSA wage-base announcements.
--   2. user_profiles.tax_profile — the per-user inputs (filing status, state,
--      pre-tax deductions). Also backfills the income/savings columns that the
--      app already reads/writes but were never added to the schema.

-- ── 1. Reference data ───────────────────────────────────────────────────────

create table if not exists tax_brackets (
  id                 bigint generated always as identity primary key,
  year               integer not null,
  jurisdiction       text not null,                 -- 'federal' | 'fica' | 2-letter state code
  filing_status      text not null default 'all',   -- 'single' | 'mfj' | 'mfs' | 'hoh' | 'all'
  brackets           jsonb,                          -- [{ "upTo": 11925, "rate": 0.10 }, … upTo null = top bracket]
  standard_deduction numeric,
  meta               jsonb,                          -- fica constants / flat state rate
  unique (year, jurisdiction, filing_status)
);

alter table tax_brackets enable row level security;
-- Reference data: any authenticated user may read; nobody writes via the client.
create policy "tax_brackets readable" on tax_brackets
  for select to authenticated using (true);

-- Federal ordinary-income brackets + standard deduction, by year & filing status.
insert into tax_brackets (year, jurisdiction, filing_status, brackets, standard_deduction) values
  -- 2024
  (2024,'federal','single','[{"upTo":11600,"rate":0.10},{"upTo":47150,"rate":0.12},{"upTo":100525,"rate":0.22},{"upTo":191950,"rate":0.24},{"upTo":243725,"rate":0.32},{"upTo":609350,"rate":0.35},{"upTo":null,"rate":0.37}]',14600),
  (2024,'federal','mfj','[{"upTo":23200,"rate":0.10},{"upTo":94300,"rate":0.12},{"upTo":201050,"rate":0.22},{"upTo":383900,"rate":0.24},{"upTo":487450,"rate":0.32},{"upTo":731200,"rate":0.35},{"upTo":null,"rate":0.37}]',29200),
  (2024,'federal','mfs','[{"upTo":11600,"rate":0.10},{"upTo":47150,"rate":0.12},{"upTo":100525,"rate":0.22},{"upTo":191950,"rate":0.24},{"upTo":243725,"rate":0.32},{"upTo":365600,"rate":0.35},{"upTo":null,"rate":0.37}]',14600),
  (2024,'federal','hoh','[{"upTo":16550,"rate":0.10},{"upTo":63100,"rate":0.12},{"upTo":100500,"rate":0.22},{"upTo":191950,"rate":0.24},{"upTo":243700,"rate":0.32},{"upTo":609350,"rate":0.35},{"upTo":null,"rate":0.37}]',21900),
  -- 2025 (brackets per Rev. Proc. 2024-40; standard deduction raised by OBBBA)
  (2025,'federal','single','[{"upTo":11925,"rate":0.10},{"upTo":48475,"rate":0.12},{"upTo":103350,"rate":0.22},{"upTo":197300,"rate":0.24},{"upTo":250525,"rate":0.32},{"upTo":626350,"rate":0.35},{"upTo":null,"rate":0.37}]',15750),
  (2025,'federal','mfj','[{"upTo":23850,"rate":0.10},{"upTo":96950,"rate":0.12},{"upTo":206700,"rate":0.22},{"upTo":394600,"rate":0.24},{"upTo":501050,"rate":0.32},{"upTo":751600,"rate":0.35},{"upTo":null,"rate":0.37}]',31500),
  (2025,'federal','mfs','[{"upTo":11925,"rate":0.10},{"upTo":48475,"rate":0.12},{"upTo":103350,"rate":0.22},{"upTo":197300,"rate":0.24},{"upTo":250525,"rate":0.32},{"upTo":375800,"rate":0.35},{"upTo":null,"rate":0.37}]',15750),
  (2025,'federal','hoh','[{"upTo":17000,"rate":0.10},{"upTo":64850,"rate":0.12},{"upTo":103350,"rate":0.22},{"upTo":197300,"rate":0.24},{"upTo":250500,"rate":0.32},{"upTo":626350,"rate":0.35},{"upTo":null,"rate":0.37}]',23625),
  -- 2026 (Rev. Proc. 2025-32)
  (2026,'federal','single','[{"upTo":12400,"rate":0.10},{"upTo":50400,"rate":0.12},{"upTo":105700,"rate":0.22},{"upTo":201775,"rate":0.24},{"upTo":256225,"rate":0.32},{"upTo":640600,"rate":0.35},{"upTo":null,"rate":0.37}]',16100),
  (2026,'federal','mfj','[{"upTo":24800,"rate":0.10},{"upTo":100800,"rate":0.12},{"upTo":211400,"rate":0.22},{"upTo":403550,"rate":0.24},{"upTo":512450,"rate":0.32},{"upTo":768700,"rate":0.35},{"upTo":null,"rate":0.37}]',32200),
  (2026,'federal','mfs','[{"upTo":12400,"rate":0.10},{"upTo":50400,"rate":0.12},{"upTo":105700,"rate":0.22},{"upTo":201775,"rate":0.24},{"upTo":256225,"rate":0.32},{"upTo":384350,"rate":0.35},{"upTo":null,"rate":0.37}]',16100),
  (2026,'federal','hoh','[{"upTo":17700,"rate":0.10},{"upTo":67450,"rate":0.12},{"upTo":105700,"rate":0.22},{"upTo":201775,"rate":0.24},{"upTo":256200,"rate":0.32},{"upTo":640600,"rate":0.35},{"upTo":null,"rate":0.37}]',24150)
on conflict (year, jurisdiction, filing_status) do nothing;

-- FICA constants (Social Security 6.2% to wage base; Medicare 1.45%; Additional
-- Medicare 0.9% over filing-status threshold — thresholds are not inflation-adjusted).
insert into tax_brackets (year, jurisdiction, filing_status, meta) values
  (2024,'fica','all','{"ssRate":0.062,"ssWageBase":168600,"medicareRate":0.0145,"addlMedicareRate":0.009,"addlMedicareThreshold":{"single":200000,"mfj":250000,"mfs":125000,"hoh":200000}}'),
  (2025,'fica','all','{"ssRate":0.062,"ssWageBase":176100,"medicareRate":0.0145,"addlMedicareRate":0.009,"addlMedicareThreshold":{"single":200000,"mfj":250000,"mfs":125000,"hoh":200000}}'),
  (2026,'fica','all','{"ssRate":0.062,"ssWageBase":184500,"medicareRate":0.0145,"addlMedicareRate":0.009,"addlMedicareThreshold":{"single":200000,"mfj":250000,"mfs":125000,"hoh":200000}}')
on conflict (year, jurisdiction, filing_status) do nothing;

-- Simplified per-state effective rates (PHASE 1 — approximate flat rate applied to
-- taxable income; no-tax states are 0). Users can override per-profile. Seeded for
-- each supported year identically since these are rough estimates; refine later
-- with progressive per-state brackets.
insert into tax_brackets (year, jurisdiction, filing_status, meta)
select y.year, s.code, 'all', jsonb_build_object('rate', s.rate)
from (values (2024),(2025),(2026)) as y(year)
cross join (values
  ('AL',0.050),('AK',0.000),('AZ',0.025),('AR',0.039),('CA',0.060),('CO',0.044),
  ('CT',0.050),('DE',0.050),('DC',0.060),('FL',0.000),('GA',0.0539),('HI',0.070),
  ('ID',0.05695),('IL',0.0495),('IN',0.030),('IA',0.038),('KS',0.050),('KY',0.040),
  ('LA',0.030),('ME',0.060),('MD',0.050),('MA',0.050),('MI',0.0425),('MN',0.070),
  ('MS',0.044),('MO',0.047),('MT',0.059),('NE',0.052),('NV',0.000),('NH',0.000),
  ('NJ',0.060),('NM',0.049),('NY',0.060),('NC',0.0425),('ND',0.025),('OH',0.035),
  ('OK',0.0475),('OR',0.0875),('PA',0.0307),('RI',0.0475),('SC',0.064),('SD',0.000),
  ('TN',0.000),('TX',0.000),('UT',0.0455),('VT',0.066),('VA',0.0575),('WA',0.000),
  ('WV',0.051),('WI',0.053),('WY',0.000)
) as s(code, rate)
on conflict (year, jurisdiction, filing_status) do nothing;

-- ── 2. User tax profile + backfill income/savings columns ───────────────────
alter table user_profiles
  add column if not exists annual_income      numeric,
  add column if not exists annual_bonus       numeric,
  add column if not exists savings_goal_amount numeric,
  add column if not exists savings_goal_pct   numeric,
  add column if not exists savings_goal_type  text,
  add column if not exists tax_profile        jsonb;
