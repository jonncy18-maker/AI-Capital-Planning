alter table user_profiles
  add column if not exists min_checking_balance numeric not null default 0;
