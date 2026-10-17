import { describe, it, expect } from 'vitest'
import { buildPlannerContext as build } from './planner-context.js'

// brl() usa espaço não separável depois de "R$"; normaliza para comparar.
const buildPlannerContext = (args) => build(args).replace(/[  ]/g, ' ')

const tx = (date, type, amount, extra = {}) => ({ date, type, amount, category: 'Outros', description: 'x', status: 'pending', method: 'Pix', ...extra })
const settings = { opening_balance: 100, opening_date: '2026-11-01' }

describe('contexto do planejador', () => {
  it('ignora Vale iFood e respeita o saldo inicial', () => {
    const rows = [
      tx('2026-10-20', 'expense', 999), // antes do saldo inicial: aparece no mês mas não no saldo
      tx('2026-11-01', 'income', 1000, { category: 'Salário' }),
      tx('2026-11-10', 'expense', 200, { category: 'Transporte' }),
      tx('2026-11-12', 'expense', 150, { category: 'Alimentação', method: 'Vale iFood' }),
    ]
    const ctx = buildPlannerContext({ rows, settings, profile: null, today: '2026-11-15' })
    expect(ctx).toContain('Novembro 2026 (atual): R$ 1.000,00 / R$ 200,00 / R$ 800,00 / R$ 900,00')
    expect(ctx).toContain('por categoria: Transporte R$ 200,00.')
    expect(ctx).not.toContain('Alimentação')
    expect(ctx).toContain('Objetivo: ainda não informado.')
  })

  it('inclui objetivo, fixos e parcelamentos em aberto', () => {
    const rows = [
      tx('2026-11-11', 'expense', 92, { description: 'Fone – 2/6', group_id: 'g', installment_number: 2, installment_total: 6 }),
      tx('2026-12-11', 'expense', 92, { description: 'Fone – 3/6', group_id: 'g', installment_number: 3, installment_total: 6 }),
    ]
    const recs = [{ id: 'r', description: 'Streaming', type: 'expense', amount: 40, day: 15, start_month: '2026-01', end_month: null }]
    const profile = { goal: 'reserva', target_amount: 5000, target_date: '2027-06-30', notes: 'Ganho por comissão' }
    const ctx = buildPlannerContext({ rows, recs, settings, profile, today: '2026-11-01' })
    expect(ctx).toContain('Objetivo: Montar reserva de emergência, meta R$ 5.000,00, até 30/06/2027.')
    expect(ctx).toContain('Observações do usuário: Ganho por comissão')
    expect(ctx).toContain('- Despesa: Streaming, R$ 40,00 todo dia 15')
    expect(ctx).toContain('- Fone: 2 parcela(s) restantes, R$ 184,00 até 11/12/2026')
  })

  it('sem lançamentos avisa', () => {
    expect(buildPlannerContext({ rows: [], settings, today: '2026-11-01' })).toContain('ainda não tem lançamentos')
  })
})
