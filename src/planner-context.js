// Resumo financeiro do usuário enviado ao Planejador (IA) a cada pergunta.
// Função pura, usada pelo servidor (api/planner.js) e coberta por testes.
import { brl, monthOf, monthLabel, monthShort, summarize } from './calc.js'
import { monthAdd, addMonths, addDays, dateInMonth, dueSoon, recurrenceActive, round2, stripInstallmentSuffix, openBillDue } from './plan.js'

const GOALS = {
  reserva: 'Montar reserva de emergência',
  investir: 'Começar/aumentar investimentos',
  quitar_dividas: 'Quitar dívidas',
  comprar: 'Juntar para uma compra',
  organizar: 'Organizar os gastos',
}
export const GOAL_OPTIONS = Object.entries(GOALS)

const fmtDate = (d) => d.split('-').reverse().join('/')
// Texto livre do usuário entra no prompt: sem tags nem caracteres de controle, e curto.
const clean = (s, max = 80) =>
  String(s ?? '').replace(/[<>\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max)

// `rows` já passou por withPlanned (planned efetivo + origem); `cards` = fechamento/vencimento.
export function buildPlannerContext({ rows, recs = [], cards = [], settings, profile, today }) {
  const cur = today.slice(0, 7)
  const lines = []
  const counted = rows.filter((t) => t.method !== 'Vale iFood')

  const base = settings || { opening_balance: 0, opening_date: '0000-01-01' }

  lines.push(`Hoje: ${fmtDate(today)} (mês atual: ${monthLabel(cur)}).`)
  lines.push("Ciclo: o salário recebido no dia 30 paga o mês seguinte; por isso salário e parcela da moto estão datados no dia 01 do mês pago. O 'saldo previsto' de cada mês é acumulado e é o número de decisão; 'resultado' é só do mês.")
  if (settings) lines.push(`Saldo inicial: ${brl(settings.opening_balance)} em ${fmtDate(settings.opening_date)}.`)
  if (rows.length) {
    const nowS = summarize(rows, base, cur)
    lines.push(`Saldo real hoje (só o que já foi pago/recebido): ${brl(nowS.current)}. Falta pagar este mês: ${brl(nowS.pendingExpense)}.`)
  }

  if (profile && (profile.goal || profile.notes || profile.target_amount)) {
    const p = [`Objetivo: ${GOALS[profile.goal] || clean(profile.goal) || 'não informado'}`]
    if (profile.target_amount) p.push(`meta ${brl(profile.target_amount)}`)
    if (profile.target_date) p.push(`até ${fmtDate(profile.target_date)}`)
    lines.push(p.join(', ') + '.')
    if (profile.notes) lines.push(`Observações do usuário: ${clean(profile.notes, 300)}`)
  } else {
    lines.push('Objetivo: ainda não informado.')
  }

  if (!rows.length) {
    lines.push('O usuário ainda não tem lançamentos.')
    return lines.join('\n')
  }

  // Três visões do saldo acumulado: com tudo (previsto), sem receitas não confirmadas
  // (conservador) e sem nenhum planejado.
  const firm = rows.filter((t) => !(t.planned && t.type === 'income'))
  const noPlan = rows.filter((t) => !t.planned)
  lines.push('', 'Meses (receitas / despesas / resultado / saldo previsto no fim do mês). Os valores já incluem os planejados:')
  for (let i = -1; i <= 6; i++) {
    const m = monthAdd(cur, i)
    if (!rows.some((r) => monthOf(r.date) === m)) continue
    const s = summarize(rows, base, m)
    const cons = summarize(firm, base, m)
    const plain = summarize(noPlan, base, m)
    const inMonth = counted.filter((t) => monthOf(t.date) === m)
    const parc = round2(inMonth.filter((t) => t.type === 'expense' && t.group_id).reduce((a, t) => a + Number(t.amount), 0))
    const firmIncome = round2(inMonth.filter((t) => t.type === 'income' && !t.planned).reduce((a, t) => a + Number(t.amount), 0))
    const when = m === cur ? 'atual' : m < cur ? 'passado' : 'futuro'
    lines.push(`- ${monthLabel(m)} (${when}): receitas ${brl(s.income)} / despesas ${brl(s.expense)} / resultado ${brl(s.result)} / saldo previsto ${brl(s.projected)}; `
      + `saldo conservador (sem receitas não confirmadas) ${brl(cons.projected)}; saldo sem nenhum planejado ${brl(plain.projected)}; `
      + `parcelas do mês ${brl(parc)}; receita firme ${brl(firmIncome)}`)
  }

  const curExp = counted.filter((t) => t.type === 'expense' && monthOf(t.date) === cur)
  if (curExp.length) {
    const byCat = {}
    for (const t of curExp) byCat[t.category] = (byCat[t.category] || 0) + Number(t.amount)
    const top = Object.entries(byCat).sort((a, b) => b[1] - a[1]).slice(0, 8)
    lines.push('', `Despesas de ${monthLabel(cur)} por categoria: ${top.map(([c, v]) => `${c} ${brl(v)}`).join('; ')}.`)
  }

  const fixed = recs.filter((r) => recurrenceActive(r, cur) || (r.start_month > cur && !r.end_month))
  if (fixed.length) {
    lines.push('', 'Fixos ativos:')
    for (const r of fixed) lines.push(`- ${r.type === 'income' ? 'Receita' : 'Despesa'}: ${clean(r.description)}, ${brl(r.amount)} todo dia ${r.day}${r.end_month ? ` até ${monthLabel(r.end_month)}` : ''}`)
  }

  // Parcelamentos já assumidos (os planejados vão para a seção própria).
  const started = new Map()
  for (const t of counted) if (t.group_id && (t.status === 'paid' || t.date < today)) started.set(t.group_id, true)
  const groups = new Map()
  for (const t of counted) {
    if (!t.group_id || t.planned || t.status === 'paid' || t.date < today) continue
    const g = groups.get(t.group_id) || { name: clean(stripInstallmentSuffix(t.description)), left: 0, total: 0, first: t.date, last: t.date }
    g.left += 1
    g.total += Number(t.amount)
    if (t.date < g.first) g.first = t.date
    if (t.date > g.last) g.last = t.date
    groups.set(t.group_id, g)
  }
  if (groups.size) {
    lines.push('', 'Parcelamentos em aberto (já assumidos):')
    for (const [id, g] of groups) {
      const when = started.get(id)
        ? `próxima em ${fmtDate(g.first)}`
        : `ainda não começou: 1ª parcela em ${fmtDate(g.first)}`
      lines.push(`- ${g.name}: ${g.left} parcela(s) restantes, ${brl(round2(g.total))}, ${when}, última em ${fmtDate(g.last)}`)
    }
  }

  // Planejados: previsões do usuário, ainda não confirmadas.
  const plans = new Map()
  for (const t of counted) {
    if (!t.planned || t.status === 'paid' || monthOf(t.date) < cur) continue
    const key = t.group_id || t.recurrence_id || t.id || `${t.description}|${t.date}`
    const p = plans.get(key) || {
      name: clean(t.group_id ? stripInstallmentSuffix(t.description) : t.description), type: t.type, n: 0, total: 0, first: t.date, last: t.date, amount: Number(t.amount),
      origin: t.planned_set == null && t.planned_auto ? `automático: no ${clean(t.method)} ainda não caiu em fatura` : 'marcado pelo usuário',
    }
    p.n += 1
    p.total += Number(t.amount)
    if (t.date < p.first) p.first = t.date
    if (t.date > p.last) p.last = t.date
    plans.set(key, p)
  }
  if (plans.size) {
    lines.push('', 'Planejamentos (ainda NÃO confirmados; o usuário pode mudar de mês, de valor ou cancelar):')
    const sorted = [...plans.values()].sort((a, b) => (a.first < b.first ? -1 : 1))
    for (const p of sorted) {
      const kind = p.type === 'income' ? 'receita NÃO garantida (não sugerir cancelar)' : 'despesa planejada'
      lines.push(p.n === 1
        ? `- ${p.name} (${kind}): ${brl(p.amount)} em ${fmtDate(p.first)} (${p.origin})`
        : `- ${p.name} (${kind}): ${p.n}x, total ${brl(round2(p.total))}, de ${monthShort(monthOf(p.first))} a ${monthShort(monthOf(p.last))} (${p.origin})`)
    }
  }

  if (cards.length) {
    lines.push('', 'Cartões de crédito (compras são lançadas no dia do vencimento da fatura):')
    for (const c of cards) {
      const due = openBillDue(c, today)
      const onBill = counted.filter((t) => t.method === c.method && t.type === 'expense' && !t.planned && monthOf(t.date) === monthOf(due))
      const total = round2(onBill.reduce((s, t) => s + Number(t.amount), 0))
      const nextClose = dateInMonth(monthAdd(monthOf(due), c.due_day <= c.closing_day ? -1 : 0), c.closing_day)
      const parts = [`fecha dia ${c.closing_day}, vence dia ${c.due_day}`]
      if (c.credit_limit != null) parts.push(`limite ${brl(c.credit_limit)}`)
      parts.push(`compra feita hoje vence em ${fmtDate(due)} (essa fatura já tem ${brl(total)} lançado)`)
      parts.push(`compras a partir de ${fmtDate(addDays(nextClose, 1))} só vencem em ${fmtDate(addMonths(due, 1))}`)
      lines.push(`- ${clean(c.method)}: ${parts.join('; ')}`)
    }
  }

  const due = dueSoon(rows, today)
  if (due.count) lines.push('', `Vence nos próximos 7 dias: ${brl(due.total)} (${due.list.map((t) => `${clean(t.description)} ${fmtDate(t.date)}`).join(', ')}).`)

  return lines.join('\n')
}
