# Controle de Finanças

React + Vite + Supabase, para publicar na Vercel. Abas por mês, marcar como pago/recebido, editar, excluir e adicionar lançamentos.

## 1. Supabase
1. Crie um projeto em https://supabase.com.
2. **SQL Editor → New query**, cole o conteúdo de `supabase/schema.sql` e clique em **Run**.
3. **Project Settings → API**: copie a `Project URL` e a chave `anon public`.
4. (Opcional, mais simples) **Authentication → Providers → Email**: desligue "Confirm email" para entrar logo após criar a conta.

## 2. Rodar local
```
cp .env.example .env     # preencha as duas variáveis
npm install
npm run dev
```

## 3. Vercel
1. Suba esta pasta para um repositório no GitHub.
2. Na Vercel: **Add New → Project**, importe o repositório (Framework: Vite, detectado sozinho).
3. Em **Environment Variables** adicione `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.
4. **Deploy**.

## 4. Primeiro uso
Crie sua conta na tela de login e clique em **Carregar plano inicial**. Ele lança todas as contas fixas e compras planejadas de out/2026 a jan/2027 e o saldo inicial (R$ 166,65 em 16/10). Depois é só marcar o que for pago, editar valores ou adicionar meses com o botão **+**.

## Como o saldo funciona
- Salário e parcela da moto ficam datados no dia 01 do mês que eles pagam (o salário do dia 30 paga o mês seguinte).
- Só lançamentos a partir da data do saldo inicial entram na conta; o que é anterior fica como histórico.
- "Saldo previsto" soma tudo (pago e pendente); "Saldo real" soma só o que está marcado como pago/recebido.
- Quando o saldo inicial mudar, ajuste em **Saldo inicial** (valor e data).
