-- Migração 005: lançamentos "planejados" (previsões ainda não confirmadas).
-- Rode este arquivo inteiro no Supabase: SQL Editor > New query > Run.
-- Pode rodar mais de uma vez sem problema (idempotente).

alter table public.transactions add column if not exists planned boolean not null default false;
