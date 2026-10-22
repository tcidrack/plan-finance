import { describe, it, expect } from 'vitest'
import { summarize, nextMonth } from './calc.js'

const settings = { opening_balance: 100, opening_date: '2026-10-16' }
const tx = (date, type, amount, extra = {}) => ({ date, type, amount, status: 'pending', method: 'Pix', ...extra })

describe('summarize', () => {
  it('ignora Vale iFood nos totais e no saldo', () => {
    const rows = [tx('2026-11-01', 'income', 1000), tx('2026-11-10', 'expense', 200), tx('2026-11-15', 'expense', 150, { method: 'Vale iFood' })]
    const s = summarize(rows, settings, '2026-11')
    expect(s.expense).toBe(200)
    expect(s.projected).toBe(900)
  })
  it('só conta no saldo o que é a partir da data do saldo inicial', () => {
    const rows = [tx('2026-10-09', 'expense', 50, { status: 'paid' }), tx('2026-10-20', 'expense', 30)]
    const s = summarize(rows, settings, '2026-10')
    expect(s.expense).toBe(80) // aparece no mês
    expect(s.projected).toBe(70) // mas o anterior a 16/10 não mexe no saldo
  })
  it('saldo que veio acumula meses anteriores', () => {
    const rows = [tx('2026-10-20', 'income', 50), tx('2026-11-05', 'expense', 20)]
    expect(summarize(rows, settings, '2026-11').carry).toBe(150)
  })
  it('planejados contam no saldo e aparecem separados', () => {
    const rows = [tx('2026-11-01', 'income', 1000), tx('2026-11-10', 'expense', 200), tx('2026-11-20', 'expense', 300, { planned: true })]
    const s = summarize(rows, settings, '2026-11')
    expect(s.planned).toBe(300)
    expect(s.projected).toBe(600)
  })
})

it('nextMonth vira o ano', () => expect(nextMonth('2026-12')).toBe('2027-01'))
