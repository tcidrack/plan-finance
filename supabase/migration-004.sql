-- Migração 004: categorias e formas de pagamento personalizadas por usuário.
-- Rode este arquivo inteiro no Supabase: SQL Editor > New query > Run.
-- Pode rodar mais de uma vez sem problema (idempotente).

create table if not exists public.user_options (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  kind text not null check (kind in ('category','method')),
  name text not null check (length(trim(name)) between 1 and 40),
  created_at timestamptz not null default now()
);

-- Sem nomes repetidos (ignorando maiúsculas/minúsculas) para o mesmo usuário.
create unique index if not exists user_options_unique_name on public.user_options (user_id, kind, lower(name));

alter table public.user_options enable row level security;

drop policy if exists "user_options_own" on public.user_options;
create policy "user_options_own" on public.user_options
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
