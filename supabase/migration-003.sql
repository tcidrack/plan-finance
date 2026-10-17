-- Migração 003: Planejador Financeiro com IA (histórico, objetivos e cota diária).
-- Rode este arquivo inteiro no Supabase: SQL Editor > New query > Run.
-- Pode rodar mais de uma vez sem problema (idempotente).

-- ───────── Conversa ─────────
create table if not exists public.ai_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  role text not null check (role in ('user','model')),
  content text not null,
  steps jsonb,                 -- resposta completa do modelo, reenviada como veio
  created_at timestamptz not null default now()
);
create index if not exists ai_messages_user_created_idx on public.ai_messages (user_id, created_at);

-- ───────── Objetivos do usuário ─────────
create table if not exists public.ai_profile (
  user_id uuid primary key default auth.uid() references auth.users(id) on delete cascade,
  goal text,                   -- reserva | investir | quitar_dividas | comprar | organizar
  target_amount numeric(12,2),
  target_date date,
  notes text,
  updated_at timestamptz not null default now()
);

-- ───────── Cota diária de mensagens ─────────
create table if not exists public.ai_usage (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null default current_date,
  count int not null default 0,
  primary key (user_id, day)
);

-- Consome 1 mensagem da cota de hoje do usuário logado.
-- Devolve quantas restam depois do consumo, ou -1 se a cota já acabou (nesse caso não consome).
create or replace function public.ai_consume_quota(p_limit int)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
  today date := (now() at time zone 'America/Sao_Paulo')::date; -- o dia vira à meia-noite de Brasília
  used int;
begin
  if uid is null then
    raise exception 'não autenticado';
  end if;
  insert into public.ai_usage (user_id, day, count) values (uid, today, 0)
    on conflict (user_id, day) do nothing;
  update public.ai_usage set count = count + 1
    where user_id = uid and day = today and count < p_limit
    returning count into used;
  if used is null then
    return -1;
  end if;
  return p_limit - used;
end;
$$;

revoke all on function public.ai_consume_quota(int) from public;
grant execute on function public.ai_consume_quota(int) to authenticated;

-- ───────── Segurança ─────────
alter table public.ai_messages enable row level security;
alter table public.ai_profile enable row level security;
alter table public.ai_usage enable row level security;

drop policy if exists "ai_messages_own" on public.ai_messages;
create policy "ai_messages_own" on public.ai_messages
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "ai_profile_own" on public.ai_profile;
create policy "ai_profile_own" on public.ai_profile
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Só leitura: a contagem só muda pela função acima.
drop policy if exists "ai_usage_read_own" on public.ai_usage;
create policy "ai_usage_read_own" on public.ai_usage
  for select using (auth.uid() = user_id);
