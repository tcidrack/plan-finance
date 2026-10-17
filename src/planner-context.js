// Resumo financeiro do usuário enviado ao Planejador (IA) a cada pergunta.
// Função pura, usada pelo servidor (api/planner.js) e coberta por testes.
import { brl, monthOf, monthLabel, summarize } from './calc.js'
import { monthAdd, dueSoon, recurrenceActive, round2 } from './plan.js'

const GOALS = {
  reserva: 'Montar reserva de emergência',
  investir: 'Começar/aumentar investimentos',
  quitar_dividas: 'Quitar dívidas',
  comprar: 'Juntar para uma compra',
  organizar: 'Organizar os gastos',
}
export const GOAL_OPTIONS = Object.entries(GOALS)

const fmtDate = (d) => d.split('-').reverse().join('/')

export function buildPlannerContext({ rows, recs = [], settings, profile, today }) {
  const cur = today.slice(0, 7)
  const lines = []
  const counted = rows.filter((t) => t.method !== 'Vale iFood')

  lines.push(`Hoje: ${fmtDate(today)}.`)
  if (settings) lines.push(`Saldo inicial: ${brl(settings.opening_balance)} em ${fmtDate(settings.opening_date)}.`)

  if (profile && (profile.goal || profile.notes || profile.target_amount)) {
    const p = [`Objetivo: ${GOALS[profile.goal] || profile.goal || 'não informado'}`]
    if (profile.target_amount) p.push(`meta ${brl(profile.target_amount)}`)
    if (profile.target_date) p.push(`até ${fmtDate(profile.target_date)}`)
    lines.push(p.join(', ') + '.')
    if (profile.notes) lines.push(`Observações do usuário: ${profile.notes}`)
  } else {
    lines.push('Objetivo: ainda não informado.')
  }

  if (!rows.length) {
    lines.push('O usuário ainda não tem lançamentos.')
    return lines.join('\n')
  }

  lines.push('', 'Meses (receitas / despesas / resultado / saldo previsto no fim do mês):')
  for (let i = -2; i <= 3; i++) {
    const m = monthAdd(cur, i)
    if (!rows.some((r) => monthOf(r.date) === m)) continue
    const s = summarize(rows, settings || { opening_balance: 0, opening_date: '0000-01-01' }, m)
    lines.push(`- ${monthLabel(m)}${m === cur ? ' (atual)' : ''}: ${brl(s.income)} / ${brl(s.expense)} / ${brl(s.result)} / ${brl(s.projected)}`)
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
    for (const r of fixed) lines.push(`- ${r.type === 'income' ? 'Receita' : 'Despesa'}: ${r.description}, ${brl(r.amount)} todo dia ${r.day}${r.end_month ? ` até ${monthLabel(r.end_month)}` : ''}`)
  }

  const groups = new Map()
  for (const t of counted) {
    if (!t.group_id || t.status === 'paid' || t.date < today) continue
    const g = groups.get(t.group_id) || { name: t.description.replace(/\s*[–-]\s*\d+\/\d+.*$/, ''), left: 0, total: 0, last: t.date }
    g.left += 1
    g.total += Number(t.amount)
    if (t.date > g.last) g.last = t.date
    groups.set(t.group_id, g)
  }
  if (groups.size) {
    lines.push('', 'Parcelamentos em aberto:')
    for (const g of groups.values()) lines.push(`- ${g.name}: ${g.left} parcela(s) restantes, ${brl(round2(g.total))} até ${fmtDate(g.last)}`)
  }

  const due = dueSoon(rows, today)
  if (due.count) lines.push('', `Vence nos próximos 7 dias: ${brl(due.total)} (${due.list.map((t) => `${t.description} ${fmtDate(t.date)}`).join(', ')}).`)

  return lines.join('\n')
}
