# Controle de Finanças

React + Vite + Supabase, para publicar na Vercel. Abas por mês, marcar como pago/recebido, editar, duplicar, excluir (com desfazer), parcelamentos, gastos fixos, busca e um **Planejador financeiro com IA** (Google Gemini). Cada usuário tem a própria conta e só enxerga os próprios dados.

## 1. Supabase
1. Crie um projeto em https://supabase.com.
2. **SQL Editor → New query**: cole `supabase/schema.sql` e clique em **Run**; depois faça o mesmo com `supabase/migration-003.sql` (Planejador) e `supabase/migration-004.sql` (categorias e formas personalizadas).
3. **Project Settings → API**: copie a `Project URL` e a chave `anon public`.
4. (Opcional, mais simples) **Authentication → Providers → Email**: desligue "Confirm email" para entrar logo após criar a conta.

### Atualizando um projeto que já existe
Rode no **SQL Editor**, nesta ordem, as migrações que ainda não rodou (todas podem rodar mais de uma vez sem problema):
1. `supabase/migration-002.sql`: parcelas, gastos fixos e meses salvos.
2. `supabase/migration-003.sql`: Planejador (histórico, objetivos e limite diário).
3. `supabase/migration-004.sql`: categorias e formas de pagamento personalizadas.
4. `supabase/migration-005.sql`: lançamentos planejados.
5. `supabase/migration-006.sql`: cartões (fechamento/vencimento) e planejado automático.
6. `supabase/migration-007.sql`: remover categorias e formas de pagamento padrão.

Depois faça o deploy da versão nova (push no GitHub; a Vercel publica sozinha). Enquanto uma migração não roda, o app continua funcionando e mostra um aviso.

## 2. Chave da IA (Google Gemini, grátis)
1. Acesse https://aistudio.google.com/apikey, entre com uma conta Google e clique em **Create API key**.
2. Coloque a chave no `.env` (local) como `GEMINI_API_KEY=...` e, na Vercel, em **Settings → Environment Variables**.
3. Opcional: `GEMINI_MODEL` escolhe o primeiro modelo (padrão `gemini-3.8-flash`). Se ele estiver sem cota, sobrecarregado ou indisponível, o planejador tenta os próximos automaticamente: `gemini-3.6-flash`, `gemini-3.5-flash-lite` e `gemini-3.1-flash-lite`. Para usar outra lista, defina `GEMINI_MODELS` separada por vírgula. Os limites do plano gratuito (por modelo) aparecem no AI Studio.

A chave fica só no servidor (`api/planner.js`): **não** use o prefixo `VITE_`, senão ela iria para o navegador.

**Privacidade:** no plano gratuito, o Google pode usar o conteúdo enviado para melhorar os produtos dele. O planejador envia a pergunta e um resumo dos lançamentos do usuário (o chat avisa isso no rodapé). Para evitar, ative o faturamento no AI Studio.

## 3. Rodar local
```
cp .env.example .env     # preencha as variáveis
npm install
npm run dev              # o app e a função /api/planner
npm test                 # testes das regras de parcelas, fixos, saldo e do resumo do planejador
```

## 4. Vercel
1. Suba esta pasta para um repositório no GitHub.
2. Na Vercel: **Add New → Project**, importe o repositório (Framework: Vite, detectado sozinho). A pasta `api/` vira a função do planejador automaticamente.
3. Em **Environment Variables** adicione `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `GEMINI_API_KEY` e (opcionais) `GEMINI_MODEL` / `GEMINI_MODELS`.
4. **Deploy**.

## 5. Primeiro uso
Crie sua conta na tela de login, informe o **Saldo inicial** e comece a adicionar receitas e despesas.

## Planejador (IA)
Botão **Planejador** no canto da tela. Na aba **Meus objetivos** o usuário conta o que quer (reserva, investir, quitar dívidas, comprar algo, organizar gastos), a meta e o prazo; na **Conversa** pergunta o que quiser. A cada pergunta, o servidor monta um resumo dos dados do próprio usuário (saldos dos meses, gastos por categoria, fixos, parcelamentos em aberto, o que vence na semana; sem o Vale iFood no saldo) e envia junto ao Gemini.
- Só aconselha: não cria nem altera lançamentos.
- O histórico e os objetivos ficam salvos por usuário (Supabase, com RLS).
- Limite de **5 mensagens por usuário por dia** (vira à meia-noite de Brasília), controlado no banco; mude `DAILY_LIMIT` em `api/planner.js`.
- Para trocar de modelo ou de provedor de IA, só `api/planner.js` muda.

## Funções
**Parcelamento.** No "Novo lançamento", informe o **Nº de parcelas** e se o valor é o **total** ou **por parcela**. Cada parcela vai para um mês seguido, no mesmo dia (se o mês não tem o dia, usa o último: 31/01 → 28/02 → 31/03). A descrição ganha " – 1/N", " – 2/N"… e a sobra de centavos fica na última. Só a primeira usa o status marcado; as outras nascem pendentes. As abas dos meses seguintes são criadas sozinhas.

**Gastos fixos.** Marque **Repetir todo mês** (vale para despesa e receita, ex.: salário). Com **até** preenchido, gera até esse mês; sem fim, gera 12 meses, e cada mês novo criado no **+** recebe os fixos ativos (sem duplicar). Um lançamento que já existe também pode virar fixo pelo ícone **↻ Tornar fixo** na linha (ou no modal de edição); os lançamentos iguais dos meses seguintes são vinculados em vez de duplicados. O botão **Fixos** lista todos, com **Editar valor** (de hoje em diante) e **Encerrar** (apaga só os futuros pendentes).

**Editar e excluir parcelas/fixos.** Ao mudar valor, descrição, categoria ou forma, ou ao excluir, o app pergunta: **só esta**, **esta e as seguintes** ou **todas**.

**Desfazer.** Toda exclusão mostra um aviso com **Desfazer** por 8 segundos.

**Meses.** As abas ficam salvas (mês vazio não some ao recarregar). O **+** deixa escolher qualquer mês. A lixeira ao lado do nome do mês apaga a aba e seus lançamentos; se houver parcelas ou fixos ligados a outros meses, pergunta se apaga também os futuros. O mês atual fica destacado. Ao lado das abas dá para escolher quantos meses à frente mostrar (3, 6, 12 ou todos; padrão 6, salvo no aparelho); os escondidos ficam num botão "+N meses".

**Busca e filtro.** Acima das tabelas: busca por texto e filtro Todos / Pendentes / Pagos.

**Vence nos próximos 7 dias.** Card no resumo com o total das despesas pendentes que vencem na próxima semana.

**Converter parcelas existentes.** Lançamentos feitos à mão no formato "Nome – 2/6" são detectados (aparece um aviso no topo, ou use **Fixos → Converter parcelas existentes**). A tela de revisão mostra o que será vinculado e quais parcelas faltam (só depois da maior já lançada). Itens sem total, como "Unifor – 1ª mensalidade" ou "Parcela da moto", podem virar parcelados (você informa o total) ou fixos. Pode rodar de novo: nada é duplicado.

## Como o saldo funciona
- Salário e parcela da moto ficam datados no dia 01 do mês que eles pagam (o salário do dia 30 paga o mês seguinte).
- Só lançamentos a partir da data do saldo inicial entram na conta; o que é anterior fica como histórico.
- Lançamentos com forma **Vale iFood** aparecem na lista, mas ficam fora dos saldos e dos totais do resumo (não saem da conta).
- "Saldo previsto" soma tudo (pago e pendente); "Saldo real" soma só o que está marcado como pago/recebido.
- Quando o saldo inicial mudar, ajuste em **Saldo inicial** (valor e data).
