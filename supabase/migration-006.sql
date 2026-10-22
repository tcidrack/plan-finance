-- Migração 006: cartões (fechamento/vencimento) e "planejado" automático.
-- Rode depois da migration-005. Rode este arquivo inteiro no Supabase: SQL Editor > New query > Run.
-- Pode rodar mais de uma vez sem problema (idempotente).

-- planned: null = o app decide; true/false = escolha do usuário.
alter table public.transactions add column if not exists planned boolean;
-- Só na primeira vez (coluna ainda "not null" da 005): o false de antes era o padrão, não uma escolha.
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'transactions' and column_name = 'planned' and is_nullable = 'NO') then
    alter table public.transactions alter column planned drop not null;
    alter table public.transactions alter column planned drop default;
    update public.transactions set planned = null where planned = false;
  end if;
end $$;

create table if not exists public.cards (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  method text not null, -- nome da forma de pagamento, ex.: "Cartão Nubank"
  closing_day int not null check (closing_day between 1 and 31),
  due_day int not null check (due_day between 1 and 31),
  credit_limit numeric(12,2) check (credit_limit >= 0),
  primary key (user_id, method)
);

alter table public.cards enable row level security;

drop policy if exists "cards_own" on public.cards;
create policy "cards_own" on public.cards
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
