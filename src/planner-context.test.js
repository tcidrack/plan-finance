import { describe, it, expect } from 'vitest'
import { buildPlannerContext as build } from './planner-context.js'
import { withPlanned } from './plan.js'

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
    expect(ctx).toContain('- Fone: 2 parcela(s) restantes, R$ 184,00, ainda não começou: 1ª parcela em 11/11/2026, última em 11/12/2026')
  })

  it('parcelamento já correndo mostra a próxima parcela', () => {
    const rows = [
      tx('2026-10-11', 'expense', 92, { description: 'Fone – 1/3', group_id: 'g', installment_number: 1, installment_total: 3, status: 'paid' }),
      tx('2026-11-11', 'expense', 92, { description: 'Fone – 2/3', group_id: 'g', installment_number: 2, installment_total: 3 }),
      tx('2026-12-11', 'expense', 92, { description: 'Fone – 3/3', group_id: 'g', installment_number: 3, installment_total: 3 }),
    ]
    const ctx = buildPlannerContext({ rows, settings, today: '2026-11-01' })
    expect(ctx).toContain('- Fone: 2 parcela(s) restantes, R$ 184,00, próxima em 11/11/2026, última em 11/12/2026')
  })

  it('separa os planejados das contas assumidas', () => {
    const rows = [
      tx('2026-11-01', 'income', 1000, { category: 'Salário' }),
      tx('2026-11-03', 'expense', 50, { description: 'Gasolina' }),
      tx('2026-11-05', 'expense', 300, { description: 'Buquê', planned: true }),
      tx('2027-01-10', 'expense', 100, { description: 'Revisão – 1/2', group_id: 'r', installment_number: 1, installment_total: 2, planned: true }),
      tx('2027-02-10', 'expense', 100, { description: 'Revisão – 2/2', group_id: 'r', installment_number: 2, installment_total: 2, planned: true }),
    ]
    const ctx = buildPlannerContext({ rows, settings, today: '2026-11-01' })
    expect(ctx).toContain('Novembro 2026 (atual): R$ 1.000,00 / R$ 350,00 / R$ 650,00 / R$ 750,00 (sem os planejados: saldo R$ 1.050,00)')
    expect(ctx).toContain('Planejamentos (ainda NÃO confirmados')
    expect(ctx).toContain('- Buquê (despesa): R$ 300,00 em 05/11/2026')
    expect(ctx).toContain('- Revisão (despesa): 2x, total R$ 200,00, de Jan/27 a Fev/27')
    expect(ctx).not.toContain('Parcelamentos em aberto')
    expect(ctx).toContain('Vence nos próximos 7 dias: R$ 50,00 (Gasolina 03/11/2026).')
  })

  it('mostra cartões e a origem do planejado', () => {
    const nubank = { method: 'Cartão Nubank', closing_day: 3, due_day: 10, credit_limit: 2000 }
    const rows = withPlanned([
      tx('2026-11-10', 'expense', 120, { method: 'Cartão Nubank', description: 'Mercado' }),
      tx('2027-01-10', 'expense', 200, { method: 'Cartão Nubank', description: 'Revisão' }),
      tx('2026-12-20', 'expense', 80, { description: 'Buquê', planned: true }),
    ], [nubank], '2026-10-22')
    const ctx = buildPlannerContext({ rows, cards: [nubank], settings, today: '2026-10-22' })
    expect(ctx).toContain('- Revisão (despesa): R$ 200,00 em 10/01/2027 (automático: no Cartão Nubank ainda não caiu em fatura)')
    expect(ctx).toContain('- Buquê (despesa): R$ 80,00 em 20/12/2026 (marcado pelo usuário)')
    expect(ctx).toContain('- Cartão Nubank: fecha dia 3, vence dia 10; limite R$ 2.000,00; compra feita hoje vence em 10/11/2026 (essa fatura já tem R$ 120,00 lançado); compras a partir de 03/11/2026 só vencem em 10/12/2026')
  })

  it('sem lançamentos avisa', () => {
    expect(buildPlannerContext({ rows: [], settings, today: '2026-11-01' })).toContain('ainda não tem lançamentos')
  })
})
