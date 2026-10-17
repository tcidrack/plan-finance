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

-- ═════════ Parcelas, fixos e meses (mesmo conteúdo de migration-002.sql) ═════════

-- ───────── Parcelas e recorrência nos lançamentos ─────────
alter table public.transactions add column if not exists group_id uuid;
alter table public.transactions add column if not exists installment_number int;
alter table public.transactions add column if not exists installment_total int;
alter table public.transactions add column if not exists recurrence_id uuid;
alter table public.transactions add column if not exists recurrence_month text; -- 'YYYY-MM': a "vaga" do fixo

-- Garantem que uma parcela ou um fixo nunca seja duplicado.
create unique index if not exists tx_group_installment_uq on public.transactions (group_id, installment_number);
create unique index if not exists tx_recurrence_month_uq on public.transactions (recurrence_id, recurrence_month);

-- ───────── Gastos / receitas fixos ─────────
create table if not exists public.recurrences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  description text not null,
  category text not null default 'Outros',
  type text not null check (type in ('income','expense')),
  amount numeric(12,2) not null check (amount >= 0),
  method text default '',
  notes text default '',
  day int not null check (day between 1 and 31),
  start_month text not null check (start_month ~ '^\d{4}-\d{2}$'),
  end_month text check (end_month ~ '^\d{4}-\d{2}$'), -- null = sem fim
  created_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'transactions_recurrence_fk') then
    alter table public.transactions
      add constraint transactions_recurrence_fk foreign key (recurrence_id)
      references public.recurrences(id) on delete set null;
  end if;
end $$;

-- ───────── Abas de mês ─────────
create table if not exists public.months (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  month text not null check (month ~ '^\d{4}-\d{2}$'),
  primary key (user_id, month)
);

-- ───────── Segurança (cada usuário só vê o que é seu) ─────────
alter table public.recurrences enable row level security;
alter table public.months enable row level security;

drop policy if exists "recurrences_own" on public.recurrences;
create policy "recurrences_own" on public.recurrences
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "months_own" on public.months;
create policy "months_own" on public.months
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
