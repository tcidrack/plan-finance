import { describe, it, expect } from 'vitest'
import {
  splitCents, addMonths, monthAdd, monthRange, buildInstallments, parseInstallment, stripInstallmentSuffix,
  missingRecurring, recurrenceMonths, dueSoon, planConversion, looseToInstallments, looseToRecurring,
  fixedFromRow, visibleMonths, resizeInstallments, dueLevel,
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
