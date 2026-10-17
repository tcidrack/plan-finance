// Regras de parcelas, gastos fixos e meses. Funções puras (sem React/Supabase),
// cobertas por src/plan.test.js.

const pad = (n) => String(n).padStart(2, '0')
const lastDay = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate() // m = 1..12
const monthOfDate = (date) => date.slice(0, 7)
export const round2 = (n) => Math.round(Number(n || 0) * 100) / 100

// ───────── Datas ─────────
export const monthAdd = (month, n) => {
  const [y, m] = month.split('-').map(Number)
  const t = y * 12 + (m - 1) + n
  return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`
}

// Data no mês `month` com o dia pedido; se o mês não tem esse dia, usa o último.
export const dateInMonth = (month, day) => {
  const [y, m] = month.split('-').map(Number)
  return `${month}-${pad(Math.min(day, lastDay(y, m)))}`
}

// Soma n meses mantendo o dia original (31/01 + 1 → 28/02, 31/01 + 2 → 31/03).
export const addMonths = (date, n) => dateInMonth(monthAdd(monthOfDate(date), n), Number(date.slice(8, 10)))

export const addDays = (date, n) => new Date(Date.parse(date) + n * 864e5).toISOString().slice(0, 10)

export const monthRange = (from, to) => {
  const out = []
  for (let m = from; m <= to; m = monthAdd(m, 1)) out.push(m)
  return out
}

// ───────── Parcelas ─────────
// Divide em centavos; a sobra do arredondamento vai para a última parcela.
export function splitCents(total, n) {
  const cents = Math.round(Number(total) * 100)
  const base = Math.floor(cents / n)
  return Array.from({ length: n }, (_, i) => (i === n - 1 ? cents - base * (n - 1) : base) / 100)
}

// "Capacetes – 2/6", "Empréstimo Nubank – parcela 2/2 (última)", "Óculos - 3/3 (última)"
const SUFFIX = /\s*[–—-]\s*(?:parcela\s+)?(\d{1,3})\s*\/\s*(\d{1,3})\s*(?:\([^)]*\))?\s*$/i

export function parseInstallment(description) {
  const m = SUFFIX.exec(description || '')
  if (!m) return null
  const number = Number(m[1]), total = Number(m[2])
  if (number < 1 || total < 2 || number > total) return null
  return { base: description.slice(0, m.index).trim(), number, total }
}

export const stripInstallmentSuffix = (description) => parseInstallment(description)?.base ?? (description || '').trim()
export const installmentDescription = (base, number, total) => `${base} – ${number}/${total}`

// Lançamento → N parcelas mensais. mode: 'total' (valor é o total) | 'parcela' (valor de cada uma).
export function buildInstallments(tx, n, mode, groupId) {
  const amounts = mode === 'total' ? splitCents(tx.amount, n) : Array(n).fill(round2(tx.amount))
  const base = stripInstallmentSuffix(tx.description)
  return amounts.map((amount, i) => ({
    ...tx,
    description: installmentDescription(base, i + 1, n),
    amount,
    date: addMonths(tx.date, i),
    status: i === 0 ? tx.status : 'pending',
    group_id: groupId,
    installment_number: i + 1,
    installment_total: n,
  }))
}

// Muda o nº de parcelas de um parcelamento: renumera as descrições, apaga as que
// passam do novo total e cria as que faltam depois da última (mesmo dia e valor dela).
export function resizeInstallments(group, newTotal) {
  const sorted = [...group].sort((a, b) => a.installment_number - b.installment_number)
  const relabel = (r) => ({
    ...r, installment_total: newTotal,
    description: installmentDescription(stripInstallmentSuffix(r.description), r.installment_number, newTotal),
  })
  const keep = sorted.filter((r) => r.installment_number <= newTotal).map(relabel)
  const removes = sorted.filter((r) => r.installment_number > newTotal)
  const last = keep[keep.length - 1]
  const inserts = []
  if (last) {
    for (let k = last.installment_number + 1; k <= newTotal; k++) {
      inserts.push({
        ...pick(last),
        description: installmentDescription(stripInstallmentSuffix(last.description), k, newTotal),
        date: addMonths(last.date, k - last.installment_number),
        status: 'pending',
        group_id: last.group_id,
        installment_number: k,
        installment_total: newTotal,
      })
    }
  }
  return { keep, removes, inserts }
}

// ───────── Fixos (recorrências) ─────────
export const recurrenceActive = (rec, month) =>
  month >= rec.start_month && (!rec.end_month || month <= rec.end_month)

// Sem mês final: gera os próximos 12 meses a partir do início.
export const recurrenceMonths = (start, end) => monthRange(start, end || monthAdd(start, 11))

export const recurrenceRow = (rec, month) => ({
  date: dateInMonth(month, rec.day),
  description: rec.description,
  category: rec.category,
  type: rec.type,
  amount: Number(rec.amount),
  status: 'pending',
  method: rec.method || '',
  notes: rec.notes || '',
  recurrence_id: rec.id,
  recurrence_month: month,
})

// Lançamentos fixos que faltam em `month` (nunca repete uma vaga já ocupada).
export function missingRecurring(recs, rows, month) {
  const taken = new Set(rows.filter((r) => r.recurrence_id).map((r) => `${r.recurrence_id}|${r.recurrence_month}`))
  return recs.filter((rec) => recurrenceActive(rec, month) && !taken.has(`${rec.id}|${month}`)).map((rec) => recurrenceRow(rec, month))
}

// ───────── Vencimentos ─────────
export function dueSoon(rows, today, days = 7) {
  const until = addDays(today, days)
  const list = rows.filter((t) => t.type === 'expense' && t.status === 'pending' && t.method !== 'Vale iFood' && t.date >= today && t.date <= until)
  return { list, count: list.length, total: round2(list.reduce((s, t) => s + Number(t.amount), 0)) }
}

// ───────── Conversão de parcelas lançadas à mão ─────────
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
const byDate = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0)
const LOOSE = /parcela|mensalidade|presta[cç][aã]o/i

// Encontra: grupos "N/M" ainda não vinculados (com as parcelas que faltam depois da
// maior existente) e itens "soltos" que parecem recorrentes mas não dizem o total.
export function planConversion(rows, newId = () => crypto.randomUUID()) {
  const free = rows.filter((r) => !r.group_id && !r.recurrence_id)
  const groups = new Map()
  const loose = new Map()

  for (const r of free) {
    const p = parseInstallment(r.description)
    if (p) {
      const key = [norm(p.base), r.type, r.category, p.total].join('|')
      if (!groups.has(key)) groups.set(key, { key, base: p.base, total: p.total, items: [] })
      const g = groups.get(key)
      if (!g.items.some((it) => it.number === p.number)) g.items.push({ row: r, number: p.number })
    } else if (LOOSE.test(r.description)) {
      const key = [norm(r.description), r.type, r.category].join('|')
      if (!loose.has(key)) loose.set(key, { key, description: r.description, rows: [] })
      loose.get(key).rows.push(r)
    }
  }

  return {
    groups: [...groups.values()].map((g) => {
      const items = g.items.sort((a, b) => a.number - b.number)
      const last = items[items.length - 1]
      const groupId = newId()
      const updates = items.map((it) => ({
        row: it.row,
        patch: { group_id: groupId, installment_number: it.number, installment_total: g.total },
      }))
      const inserts = []
      for (let k = last.number + 1; k <= g.total; k++) {
        inserts.push({
          ...pick(last.row),
          description: installmentDescription(g.base, k, g.total),
          date: addMonths(last.row.date, k - last.number),
          status: 'pending',
          group_id: groupId,
          installment_number: k,
          installment_total: g.total,
        })
      }
      return { key: g.key, base: g.base, total: g.total, have: items.map((it) => it.number), updates, inserts }
    }),
    loose: [...loose.values()].map((l) => ({ ...l, rows: l.rows.sort(byDate) })),
  }
}

// Campos copiáveis de um lançamento (sem id, datas de criação e vínculos).
const pick = (r) => ({
  date: r.date, description: r.description, category: r.category, type: r.type,
  amount: Number(r.amount), status: r.status, method: r.method || '', notes: r.notes || '',
})

// "Unifor – 1ª mensalidade" → "Unifor"
const looseBase = (description) => description.replace(/\s*[–—-]\s*\d+\s*[ªºa°]?\s*(mensalidade|parcela)\b.*$/i, '').trim()

// Item solto → parcelas 1..total (as existentes viram as primeiras, por data).
export function looseToInstallments(loose, total, groupId) {
  const rows = loose.rows.slice(0, total)
  const base = looseBase(loose.description)
  const last = rows[rows.length - 1]
  const updates = rows.map((r, i) => ({
    row: r,
    patch: { description: installmentDescription(base, i + 1, total), group_id: groupId, installment_number: i + 1, installment_total: total },
  }))
  const inserts = []
  for (let k = rows.length + 1; k <= total; k++) {
    inserts.push({
      ...pick(last),
      description: installmentDescription(base, k, total),
      date: addMonths(last.date, k - rows.length),
      status: 'pending',
      group_id: groupId,
      installment_number: k,
      installment_total: total,
    })
  }
  return { updates, inserts }
}

// Linhas existentes (por data) → fixo mensal com os dados de `template`.
// Vincula uma por mês (dentro do intervalo) e gera os meses que faltam.
function recurringFrom(rows, template, endMonth, recId) {
  const start = monthOfDate(rows[0].date)
  const rec = {
    id: recId,
    description: template.description, category: template.category, type: template.type,
    amount: Number(template.amount), method: template.method || '', notes: template.notes || '',
    day: Number(template.date.slice(8, 10)),
    start_month: start,
    end_month: endMonth || null,
  }
  const taken = new Set()
  const updates = []
  for (const r of rows) {
    const m = monthOfDate(r.date)
    if (taken.has(m) || (endMonth && m > endMonth)) continue
    taken.add(m)
    updates.push({ row: r, patch: { recurrence_id: recId, recurrence_month: m } })
  }
  const lastMonth = monthOfDate(rows[rows.length - 1].date)
  let to = endMonth || monthAdd(start, 11)
  if (!endMonth && lastMonth > to) to = lastMonth
  const inserts = monthRange(start, to).filter((m) => !taken.has(m)).map((m) => recurrenceRow(rec, m))
  return { rec, updates, inserts }
}

// Item solto do conversor → fixo (modelo: o lançamento mais recente).
export const looseToRecurring = (loose, endMonth, recId) =>
  recurringFrom(loose.rows, loose.rows[loose.rows.length - 1], endMonth, recId)

// "Tornar fixo" num lançamento existente. Também vincula os lançamentos iguais
// (mesma descrição, tipo e categoria, sem vínculo) dos meses seguintes, para não duplicar.
export function fixedFromRow(row, rows, endMonth, recId) {
  const month = monthOfDate(row.date)
  const key = norm(row.description)
  const same = rows
    .filter((r) => r.id !== row.id && !r.group_id && !r.recurrence_id && r.type === row.type && r.category === row.category &&
      norm(r.description) === key && monthOfDate(r.date) > month)
    .sort(byDate)
  const res = recurringFrom([row, ...same], row, endMonth, recId)
  return { ...res, linked: res.updates.map((u) => u.row).filter((r) => r.id !== row.id) }
}

// ───────── Abas ─────────
// Passados + atual + até `limit` meses à frente (null = todos). O selecionado sempre aparece.
export function visibleMonths(months, curMonth, limit, selected) {
  if (!limit) return { shown: months, hidden: 0 }
  const max = monthAdd(curMonth, limit)
  const shown = months.filter((m) => m <= max || m === selected)
  return { shown, hidden: months.length - shown.length }
}

// Aplica a conversão dos grupos N/M a uma lista em memória (usado pelo plano inicial).
export function linkInstallments(rows, newId) {
  const withIds = rows.map((r, i) => ({ ...r, _i: i }))
  const { groups } = planConversion(withIds, newId)
  const patches = new Map()
  for (const g of groups) for (const u of g.updates) patches.set(u.row._i, u.patch)
  const linked = withIds.map(({ _i, ...r }) => ({ ...r, ...patches.get(_i) }))
  return [...linked, ...groups.flatMap((g) => g.inserts)]
}
