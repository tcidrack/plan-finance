import { describe, it, expect } from 'vitest'
import {
  splitCents, addMonths, monthAdd, monthRange, buildInstallments, parseInstallment, stripInstallmentSuffix,
  missingRecurring, recurrenceMonths, dueSoon, planConversion, looseToInstallments, looseToRecurring,
  fixedFromRow, visibleMonths, resizeInstallments, dueLevel, openBillDue, withPlanned, sameLater, repeatSet, editChanges, applyRepeat,
} from './plan.js'
import { linkInstallments } from './plan.js'
import { SAMPLE } from './fixtures.test-data.js'

let seq = 0
const id = () => `id-${++seq}`

describe('divisão de parcelas', () => {
  it('joga a sobra do arredondamento na última', () => {
    expect(splitCents(100, 3)).toEqual([33.33, 33.33, 33.34])
    expect(splitCents(0.1, 3)).toEqual([0.03, 0.03, 0.04])
  })
  it('a soma sempre bate com o total', () => {
    for (const [t, n] of [[99.99, 7], [1234.56, 12], [10, 4]]) {
      const cents = splitCents(t, n).reduce((s, v) => s + Math.round(v * 100), 0)
      expect(cents).toBe(Math.round(t * 100))
    }
  })
  it('total exato divide igual', () => expect(splitCents(300, 3)).toEqual([100, 100, 100]))
})

describe('datas', () => {
  it('dia 31 em meses curtos usa o último dia e volta ao 31 depois', () => {
    expect(addMonths('2027-01-31', 1)).toBe('2027-02-28')
    expect(addMonths('2027-01-31', 2)).toBe('2027-03-31')
    expect(addMonths('2027-03-31', 1)).toBe('2027-04-30')
  })
  it('respeita ano bissexto', () => expect(addMonths('2028-01-31', 1)).toBe('2028-02-29'))
  it('vira o ano', () => {
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15')
    expect(addMonths('2026-11-30', 3)).toBe('2027-02-28')
    expect(monthAdd('2026-12', 1)).toBe('2027-01')
    expect(monthAdd('2027-01', -1)).toBe('2026-12')
    expect(monthRange('2026-11', '2027-02')).toEqual(['2026-11', '2026-12', '2027-01', '2027-02'])
  })
})

describe('parcelamento', () => {
  const tx = { date: '2027-01-31', description: 'Notebook', category: 'Outros', type: 'expense', amount: 100, status: 'paid', method: 'Pix', notes: '' }
  it('gera N meses consecutivos com sufixo, grupo e só a 1ª com o status escolhido', () => {
    const rows = buildInstallments(tx, 3, 'total', 'g1')
    expect(rows.map((r) => r.date)).toEqual(['2027-01-31', '2027-02-28', '2027-03-31'])
    expect(rows.map((r) => r.description)).toEqual(['Notebook – 1/3', 'Notebook – 2/3', 'Notebook – 3/3'])
    expect(rows.map((r) => r.amount)).toEqual([33.33, 33.33, 33.34])
    expect(rows.map((r) => r.status)).toEqual(['paid', 'pending', 'pending'])
    expect(new Set(rows.map((r) => r.group_id))).toEqual(new Set(['g1']))
  })
  it('valor por parcela repete o valor', () => {
    expect(buildInstallments(tx, 2, 'parcela', 'g').map((r) => r.amount)).toEqual([100, 100])
  })
  it('reconhece os formatos usados nos lançamentos', () => {
    expect(parseInstallment('Fone – 2/6')).toEqual({ base: 'Fone', number: 2, total: 6 })
    expect(parseInstallment('Empréstimo – parcela 2/2 (última)')).toEqual({ base: 'Empréstimo', number: 2, total: 2 })
    expect(parseInstallment('Óculos - 3/3 (última)')).toEqual({ base: 'Óculos', number: 3, total: 3 })
    expect(parseInstallment('Parcela do carro')).toBeNull()
    expect(parseInstallment('Curso – 1ª mensalidade')).toBeNull()
    expect(stripInstallmentSuffix('Anel – 1/3')).toBe('Anel')
  })
})

describe('mudar o nº de parcelas', () => {
  const tx = { date: '2026-11-01', description: 'Parcela do carro', category: 'Moto', type: 'expense', amount: 400, status: 'paid', method: 'Pix', notes: '' }
  const group = buildInstallments(tx, 15, 'parcela', 'g').map((r, i) => ({ ...r, id: `m${i + 1}` }))

  it('reduzir apaga as que passam do novo total e renumera', () => {
    const { keep, removes, inserts } = resizeInstallments(group, 12)
    expect(keep).toHaveLength(12)
    expect(keep.at(-1)).toMatchObject({ description: 'Parcela do carro – 12/12', installment_total: 12 })
    expect(removes.map((r) => r.installment_number)).toEqual([13, 14, 15])
    expect(inserts).toHaveLength(0)
  })
  it('aumentar cria as que faltam depois da última, no mesmo dia', () => {
    const { keep, removes, inserts } = resizeInstallments(group, 18)
    expect(keep.every((r) => r.installment_total === 18 && r.description.endsWith(`/18`))).toBe(true)
    expect(removes).toHaveLength(0)
    expect(inserts.map((r) => [r.installment_number, r.date, r.status])).toEqual([
      [16, '2028-02-01', 'pending'], [17, '2028-03-01', 'pending'], [18, '2028-04-01', 'pending'],
    ])
    expect(inserts.every((r) => r.group_id === 'g' && r.amount === 400)).toBe(true)
  })
})

describe('fixos', () => {
  const rec = { id: 'r1', description: 'Streaming', category: 'Assinaturas', type: 'expense', amount: 110, method: 'Cartão Nubank', day: 31, start_month: '2026-11', end_month: '2027-02' }

  it('gera a linha do mês com o dia limitado ao fim do mês', () => {
    const [row] = missingRecurring([rec], [], '2027-02')
    expect(row).toMatchObject({ date: '2027-02-28', recurrence_id: 'r1', recurrence_month: '2027-02', status: 'pending' })
  })
  it('não duplica: a vaga já ocupada não é gerada de novo', () => {
    const first = missingRecurring([rec], [], '2026-12')
    expect(first).toHaveLength(1)
    expect(missingRecurring([rec], first, '2026-12')).toHaveLength(0)
    // mesmo se a data foi movida para outro mês, a vaga continua ocupada
    const moved = [{ ...first[0], date: '2027-01-02' }]
    expect(missingRecurring([rec], moved, '2026-12')).toHaveLength(0)
  })
  it('respeita início e fim', () => {
    expect(missingRecurring([rec], [], '2026-10')).toHaveLength(0)
    expect(missingRecurring([rec], [], '2027-03')).toHaveLength(0)
    expect(missingRecurring([{ ...rec, end_month: null }], [], '2030-01')).toHaveLength(1)
  })
  it('sem fim gera 12 meses', () => {
    const ms = recurrenceMonths('2026-11', null)
    expect(ms).toHaveLength(12)
    expect(ms.at(-1)).toBe('2027-10')
  })
})

describe('tornar fixo um lançamento existente', () => {
  const rows = SAMPLE.map((r) => ({ ...r, id: id() }))
  const streamNov = rows.find((r) => r.description === 'Streaming' && r.date.startsWith('2026-11'))

  it('vincula os iguais dos meses seguintes e gera só o que falta (12 meses)', () => {
    const { rec, updates, inserts, linked } = fixedFromRow(streamNov, rows, null, 'r')
    expect(rec).toMatchObject({ start_month: '2026-11', end_month: null, day: 15, amount: 110, category: 'Assinaturas' })
    expect(updates.map((u) => u.patch.recurrence_month)).toEqual(['2026-11', '2026-12', '2027-01'])
    expect(linked.map((r) => r.date)).toEqual(['2026-12-15', '2027-01-15'])
    expect(inserts.map((r) => r.recurrence_month)).toEqual(monthRange('2027-02', '2027-10'))
    expect(updates.length + inserts.length).toBe(12)
  })
  it('com mês final não vincula nem gera depois dele', () => {
    const { updates, inserts } = fixedFromRow(streamNov, rows, '2026-12', 'r')
    expect(updates.map((u) => u.patch.recurrence_month)).toEqual(['2026-11', '2026-12'])
    expect(inserts).toHaveLength(0)
  })
  it('ignora meses anteriores e lançamentos já vinculados', () => {
    const gasDec = rows.find((r) => r.description === 'Gasolina' && r.date.startsWith('2026-12'))
    const withLinked = rows.map((r) => (r.description === 'Gasolina' && r.date.startsWith('2027-01') ? { ...r, recurrence_id: 'x', recurrence_month: '2027-01' } : r))
    const { updates, inserts } = fixedFromRow(gasDec, withLinked, '2027-01', 'r')
    expect(updates.map((u) => u.patch.recurrence_month)).toEqual(['2026-12'])
    expect(inserts.map((r) => r.recurrence_month)).toEqual(['2027-01'])
  })
})

describe('abas visíveis', () => {
  const months = monthRange('2026-08', '2027-10')
  it('mostra passados, atual e até N meses à frente', () => {
    const { shown, hidden } = visibleMonths(months, '2026-10', 6, '2026-10')
    expect(shown[0]).toBe('2026-08')
    expect(shown.at(-1)).toBe('2027-04')
    expect(hidden).toBe(6)
  })
  it('o mês selecionado sempre aparece', () => {
    expect(visibleMonths(months, '2026-10', 3, '2027-09').shown).toContain('2027-09')
  })
  it('"Todos" não esconde nada', () => {
    expect(visibleMonths(months, '2026-10', null, '2026-10')).toEqual({ shown: months, hidden: 0 })
  })
})

describe('cor do vencimento', () => {
  const lvl = (date) => dueLevel(date, '2026-10-30')?.level ?? null
  it('classifica pela distância até a data', () => {
    expect(lvl('2026-10-28')).toBe('late')
    expect(lvl('2026-10-30')).toBe('late')
    expect(lvl('2026-10-31')).toBe('soon3')
    expect(lvl('2026-11-02')).toBe('soon3') // 3 dias, virando o mês
    expect(lvl('2026-11-03')).toBe('soon7')
    expect(lvl('2026-11-06')).toBe('soon7')
    expect(lvl('2026-11-07')).toBeNull()
  })
  it('gera o texto do aviso', () => {
    expect(dueLevel('2026-10-30', '2026-10-30').label).toBe('Vence hoje')
    expect(dueLevel('2026-10-28', '2026-10-30').label).toBe('Atrasado há 2 dias')
    expect(dueLevel('2026-10-31', '2026-10-30').label).toBe('Vence em 1 dia')
  })
})

describe('vence nos próximos 7 dias', () => {
  it('soma só despesas pendentes da janela, sem Vale iFood', () => {
    const rows = [
      { date: '2026-10-20', type: 'expense', status: 'pending', amount: 10, method: 'Pix' },
      { date: '2026-10-24', type: 'expense', status: 'pending', amount: 5, method: 'Pix' },
      { date: '2026-10-25', type: 'expense', status: 'pending', amount: 99, method: 'Pix' },  // fora
      { date: '2026-10-21', type: 'expense', status: 'paid', amount: 99, method: 'Pix' },     // pago
      { date: '2026-10-21', type: 'expense', status: 'pending', amount: 99, method: 'Vale iFood' },
      { date: '2026-10-21', type: 'income', status: 'pending', amount: 99, method: '' },
      { date: '2026-10-16', type: 'expense', status: 'pending', amount: 99, method: 'Pix' },  // antes
    ]
    expect(dueSoon(rows, '2026-10-17')).toMatchObject({ count: 2, total: 15 })
  })
})

describe('conversão das parcelas lançadas à mão', () => {
  const rows = SAMPLE.map((r) => ({ ...r, id: id() }))
  const conv = planConversion(rows, id)
  const group = (base) => conv.groups.find((g) => g.base === base)

  it('gera só as parcelas que faltam depois da maior existente', () => {
    expect(group('Fone').have).toEqual([1, 2])
    expect(group('Fone').inserts.map((r) => [r.description, r.date])).toEqual([
      ['Fone – 3/6', '2027-02-11'], ['Fone – 4/6', '2027-03-11'],
      ['Fone – 5/6', '2027-04-11'], ['Fone – 6/6', '2027-05-11'],
    ])
    expect(group('Anel').inserts.map((r) => r.description)).toEqual(['Anel – 2/3', 'Anel – 3/3'])
    expect(group('Revisão do carro').inserts).toHaveLength(0)
    expect(group('Empréstimo').inserts).toHaveLength(0)
    expect(group('Óculos').have).toEqual([2, 3])
  })
  it('vincula as existentes no mesmo grupo', () => {
    const g = group('Fone')
    const ids = new Set([...g.updates.map((u) => u.patch.group_id), ...g.inserts.map((r) => r.group_id)])
    expect(ids.size).toBe(1)
  })
  it('lista os itens sem total para revisão', () => {
    const names = conv.loose.map((l) => l.description)
    expect(names).toEqual(expect.arrayContaining(['Parcela do carro', 'Parcela do celular', 'Parcela da viagem', 'Curso – 1ª mensalidade']))
  })
  it('rodar de novo depois de converter não gera nada', () => {
    const after = rows.map((r) => {
      for (const g of conv.groups) {
        const u = g.updates.find((x) => x.row.id === r.id)
        if (u) return { ...r, ...u.patch }
      }
      return r
    })
    const all = [...after, ...conv.groups.flatMap((g) => g.inserts)]
    expect(planConversion(all, id).groups).toHaveLength(0)
  })
  it('item solto vira parcelas ou fixo', () => {
    const curso = conv.loose.find((l) => l.description.startsWith('Curso'))
    const inst = looseToInstallments(curso, 3, 'g')
    expect(inst.updates[0].patch.description).toBe('Curso – 1/3')
    expect(inst.inserts.map((r) => [r.description, r.date])).toEqual([['Curso – 2/3', '2027-02-05'], ['Curso – 3/3', '2027-03-05']])

    const moto = conv.loose.find((l) => l.description === 'Parcela do carro')
    const fx = looseToRecurring(moto, '2027-03', 'r')
    expect(fx.updates.map((u) => u.patch.recurrence_month)).toEqual(['2026-11', '2026-12', '2027-01'])
    expect(fx.inserts.map((r) => r.date)).toEqual(['2027-02-01', '2027-03-01'])
  })
  it('vincular em memória completa os grupos', () => {
    const seed = linkInstallments(SAMPLE, id)
    const fones = seed.filter((r) => r.description.startsWith('Fone'))
    expect(fones).toHaveLength(6)
    expect(new Set(fones.map((r) => r.group_id)).size).toBe(1)
    expect(fones.map((r) => r.installment_number).sort()).toEqual([1, 2, 3, 4, 5, 6])
  })
})

describe('cartões e planejados automáticos', () => {
  const nubank = { method: 'Cartão Nubank', closing_day: 3, due_day: 10 }
  const card = (date, extra = {}) => ({ id: id(), date, type: 'expense', amount: 100, status: 'pending', method: 'Cartão Nubank', description: 'x', ...extra })

  it('openBillDue: antes, no dia e depois do fechamento', () => {
    expect(openBillDue(nubank, '2026-10-02')).toBe('2026-10-10')
    expect(openBillDue(nubank, '2026-10-03')).toBe('2026-10-10') // no dia do fechamento ainda entra
    expect(openBillDue(nubank, '2026-10-04')).toBe('2026-11-10')
    expect(openBillDue(nubank, '2026-10-22')).toBe('2026-11-10')
  })
  it('openBillDue: Itaú fecha 26 e vence 02 do mês seguinte, inclusive na virada do ano', () => {
    const itau = { closing_day: 26, due_day: 2 }
    expect(openBillDue(itau, '2026-10-23')).toBe('2026-11-02')
    expect(openBillDue(itau, '2026-10-26')).toBe('2026-11-02')
    expect(openBillDue(itau, '2026-10-27')).toBe('2026-12-02')
    expect(openBillDue(itau, '2026-12-26')).toBe('2027-01-02')
    expect(openBillDue(itau, '2026-12-27')).toBe('2027-02-02')
  })
  it('openBillDue: PicPay fecha 19 e vence 25; Nubank fecha 04 e vence 11', () => {
    const picpay = { closing_day: 19, due_day: 25 }
    expect(openBillDue(picpay, '2026-10-19')).toBe('2026-10-25')
    expect(openBillDue(picpay, '2026-10-20')).toBe('2026-11-25')
    expect(openBillDue(picpay, '2026-12-20')).toBe('2027-01-25')
    const nu = { closing_day: 4, due_day: 11 }
    expect(openBillDue(nu, '2026-12-04')).toBe('2026-12-11')
    expect(openBillDue(nu, '2026-12-05')).toBe('2027-01-11')
    expect(openBillDue(nu, '2026-10-28')).toBe('2026-11-11')
  })
  it('openBillDue: vencimento depois do fechamento no mesmo mês e dia 31', () => {
    expect(openBillDue({ closing_day: 5, due_day: 15 }, '2026-10-01')).toBe('2026-10-15')
    expect(openBillDue({ closing_day: 25, due_day: 31 }, '2027-01-28')).toBe('2027-02-28')
  })

  it('compra que só vence depois da fatura aberta vira planejada', () => {
    const rows = [
      card('2027-01-10', { group_id: 'rev', installment_number: 1 }), card('2027-02-10', { group_id: 'rev', installment_number: 2 }),
      card('2026-11-10'),
    ]
    const out = withPlanned(rows, [nubank], '2026-10-22')
    expect(out.map((r) => r.planned)).toEqual([true, true, false])
    expect(out[0].planned_auto).toBe(true)
  })
  it('parcelamento já começado, parcela paga, Pix e escolha do usuário', () => {
    const rows = [
      card('2026-11-10', { group_id: 'a' }), card('2027-01-10', { group_id: 'a' }),
      card('2026-12-10', { group_id: 'b', status: 'paid' }), card('2027-01-10', { group_id: 'b' }),
      card('2027-03-10', { method: 'Pix' }),
      card('2027-03-10', { planned: false }),
      card('2026-11-10', { planned: true }),
    ]
    const out = withPlanned(rows, [nubank], '2026-10-22')
    expect(out.map((r) => r.planned)).toEqual([false, false, false, false, false, false, true])
    expect(out[5]).toMatchObject({ planned_auto: true, planned_set: false })
    expect(out[0].planned_set).toBe(null)
  })
})

describe('sameLater', () => {
  const r = (date, extra = {}) => ({ id: id(), date, type: 'expense', amount: 300, category: 'Cartão', method: 'Boleto', description: 'Fatura mercado livre', ...extra })
  it('acha os iguais soltos dos meses seguintes, mesmo com outra categoria', () => {
    const row = r('2026-10-15')
    const later = [r('2026-11-15', { amount: 250 }), r('2026-12-15', { description: 'Fatura Mercado Livre ', category: 'Outros' })]
    const rows = [
      row, ...later,
      r('2026-09-15'), // mês anterior
      r('2026-10-20'), // mesmo mês
      r('2027-01-15', { group_id: 'g' }), // vinculado
      r('2027-01-15', { type: 'income' }),
      r('2027-01-15', { description: 'Fatura Nubank' }),
    ]
    expect(sameLater(row, rows)).toEqual(later)
  })
})

describe('repetir edição nos outros meses', () => {
  const r = (date, extra = {}) => ({ id: id(), date, type: 'expense', amount: 100, category: 'Moto', method: 'Pix', notes: '', description: 'Gasolina', status: 'pending', ...extra })
  const pay = (row, extra = {}) => ({
    date: row.date, description: row.group_id ? stripInstallmentSuffix(row.description) : row.description, category: row.category,
    type: row.type, amount: row.amount, status: row.status, method: row.method, notes: row.notes, ...extra,
  })

  it('editChanges: só o que mudou, sem contar mudança só de mês nem sufixo de parcela', () => {
    const row = r('2026-10-10', { description: 'Capacetes – 2/6', group_id: 'g' })
    expect(editChanges(row, pay(row, { notes: 'azul' }))).toEqual([{ field: 'notes', from: '', to: 'azul' }])
    expect(editChanges(row, pay(row, { date: '2026-11-10' }))).toEqual([])
    expect(editChanges(row, pay(row, { date: '2026-10-15', planned: true }))).toEqual([
      { field: 'planned', from: null, to: true }, { field: 'day', from: 10, to: 15 },
    ])
  })

  it('repeatSet: parcelas, fixo e soltos iguais de outros meses', () => {
    const g1 = r('2026-10-10', { group_id: 'g' }), g2 = r('2026-11-10', { group_id: 'g' })
    const f1 = r('2026-10-05', { recurrence_id: 'f' }), f2 = r('2026-11-05', { recurrence_id: 'f' })
    const s0 = r('2026-09-20'), s1 = r('2026-10-20'), s2 = r('2026-11-20', { description: 'GASOLINA' })
    const sameMonth = r('2026-10-28'), income = r('2026-12-20', { type: 'income' })
    const rows = [g1, g2, f1, f2, s0, s1, s2, sameMonth, income]
    expect(repeatSet(g1, rows)).toEqual([g2])
    expect(repeatSet(f2, rows)).toEqual([f1])
    expect(repeatSet(s1, rows)).toEqual([s0, s2])
  })

  it('applyRepeat: leva só os campos alterados, valor só onde era igual e dia no próprio mês', () => {
    const orig = r('2027-01-31', { description: 'Capacetes – 1/3', group_id: 'g', installment_number: 1, installment_total: 3, notes: 'a' })
    const t1 = r('2027-02-28', { description: 'Capacetes – 2/3', group_id: 'g', installment_number: 2, installment_total: 3, notes: 'b', category: 'Outros' })
    const t2 = r('2027-03-31', { description: 'Capacetes – 3/3', group_id: 'g', installment_number: 3, installment_total: 3, amount: 100.02 })
    const payload = pay(orig, { description: 'Capacete', amount: 120, method: 'Cartão Nubank', date: '2027-01-30' })
    const out = applyRepeat(orig, payload, editChanges(orig, payload), [t1, t2])
    expect(out[0]).toMatchObject({ description: 'Capacete – 1/3', amount: 120, date: '2027-01-30', notes: 'a' })
    expect(out[1]).toMatchObject({ description: 'Capacete – 2/3', amount: 120, method: 'Cartão Nubank', date: '2027-02-28', notes: 'b', category: 'Outros' })
    expect(out[2]).toMatchObject({ description: 'Capacete – 3/3', amount: 100.02, method: 'Cartão Nubank', date: '2027-03-30' })
  })
})
