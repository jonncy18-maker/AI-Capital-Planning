-- Bills marked exclude_from_schedule are tracked as cash outflows (visible in
-- Cash Flow and Trends tabs) but suppressed in the Period 1 / Period 2 pay
-- period planning cards. Use for transfers done organically (e.g. remittances)
-- where a specific scheduled pay date is not needed.

alter table bills
  add column if not exists exclude_from_schedule boolean not null default false;
