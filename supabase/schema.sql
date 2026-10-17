-- Rode este arquivo inteiro no Supabase: SQL Editor > New query > Run

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  date date not null,
  description text not null,
  category text not null default 'Outros',
  type text not null check (type in ('income','expense')),
  amount numeric(12,2) not null check (amount >= 0),
  status text not null default 'pending' check (status in ('paid','pending')),
  method text default '',
  notes text default '',
  created_at timestamptz not null default now()
);

create index if not exists transactions_user_date_idx on public.transactions (user_id, date);

create table if not exists public.settings (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  opening_balance numeric(12,2) not null default 0,
  opening_date date not null default current_date
);

alter table public.transactions enable row level security;
alter table public.settings enable row level security;

drop policy if exists "transactions_own" on public.transactions;
create policy "transactions_own" on public.transactions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "settings_own" on public.settings;
create policy "settings_own" on public.settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
