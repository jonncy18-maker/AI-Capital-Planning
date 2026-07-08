-- AI personalization preferences. One row per user. `preferences` is an
-- intentionally loose JSONB blob so the personalization interview ("grill mode")
-- and any future AI surface can read/extend it without a schema migration:
--   {
--     tone:       'direct' | 'encouraging' | 'analytical' | ...,
--     verbosity:  'brief' | 'standard' | 'detailed',
--     priorities: ['cash flow timing', 'wealth growth', ...],
--     surface:    ['always call out commitment spikes', ...],
--     ignore:     ['day-to-day discretionary noise', ...],
--     notes:      'free-form framing guidance'
--   }
-- `interview` stores the raw transcript + completion time so the interview can be
-- resumed, re-run, or re-synthesized later.

create table if not exists ai_preferences (
  user_id        uuid primary key references auth.users(id) on delete cascade,
  preferences    jsonb not null default '{}'::jsonb,
  interview      jsonb,
  grill_enabled  boolean not null default false,
  updated_at     timestamptz not null default now()
);

alter table ai_preferences enable row level security;

create policy "users manage own ai_preferences" on ai_preferences for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
