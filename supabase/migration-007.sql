-- Migração 007: permite remover categorias e formas de pagamento padrão.
-- Uma linha com hidden = true esconde a opção padrão de mesmo nome.
-- Rode este arquivo inteiro no Supabase: SQL Editor > New query > Run.
-- Pode rodar mais de uma vez sem problema (idempotente).

alter table public.user_options add column if not exists hidden boolean not null default false;
