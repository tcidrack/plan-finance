export const brl = (n) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export const monthOf = (date) => date.slice(0, 7)

const NAMES = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro']
export const monthLabel = (m) => {
  const [y, mo] = m.split('-')
  return `${NAMES[Number(mo) - 1]} ${y}`
}
export const monthShort = (m) => {
  const [y, mo] = m.split('-')
  return `${NAMES[Number(mo) - 1].slice(0, 3)}/${y.slice(2)}`
}
export const nextMonth = (m) => {
  const [y, mo] = m.split('-').map(Number)
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`
}
export const fmtDay = (date) => date.split('-').reverse().slice(0, 2).join('/')

const signed = (t) => (t.type === 'income' ? 1 : -1) * Number(t.amount)

// Só entram no saldo os lançamentos a partir da data do saldo inicial.
export function summarize(allRows, settings, month) {
  // Vale iFood não sai da conta bancária: fica na lista, mas fora do saldo.
  const all = allRows.filter((t) => t.method !== 'Vale iFood')
  const od = settings.opening_date
  const ob = Number(settings.opening_balance || 0)
  const counted = all.filter((t) => t.date >= od)

  const inMonth = all.filter((t) => monthOf(t.date) === month)
  const sum = (arr, f) => arr.reduce((s, t) => s + (f(t) ? Number(t.amount) : 0), 0)

  const income = sum(inMonth, (t) => t.type === 'income')
  const expense = sum(inMonth, (t) => t.type === 'expense')
  const paidExpense = sum(inMonth, (t) => t.type === 'expense' && t.status === 'paid')
  const pendingExpense = expense - paidExpense
  const receivedIncome = sum(inMonth, (t) => t.type === 'income' && t.status === 'paid')

  const upTo = counted.filter((t) => monthOf(t.date) <= month)
  const projected = ob + upTo.reduce((s, t) => s + signed(t), 0)
  const current = ob + upTo.filter((t) => t.status === 'paid').reduce((s, t) => s + signed(t), 0)

  const before = counted.filter((t) => monthOf(t.date) < month)
  const carry = ob + before.reduce((s, t) => s + signed(t), 0)

  return { income, expense, paidExpense, pendingExpense, receivedIncome, projected, current, carry, result: income - expense }
}
