import { useEffect, useMemo, useState, useCallback } from 'react'
import { supabase, configured } from './supabase.js'
import { SEED, OPENING, CATEGORIES, METHODS } from './seed.js'
import { brl, monthOf, monthLabel, monthShort, nextMonth, fmtDay, summarize } from './calc.js'

const today = () => new Date().toISOString().slice(0, 10)

export default function App() {
  if (!configured) return <Setup />
  return <Auth />
}

function Setup() {
  return (
    <div className="center">
      <div className="card narrow">
        <h1>Falta configurar o Supabase</h1>
        <p>Crie um arquivo <code>.env</code> (local) ou as variáveis de ambiente na Vercel:</p>
        <pre>{`VITE_SUPABASE_URL=...\nVITE_SUPABASE_ANON_KEY=...`}</pre>
        <p>Passo a passo completo no README.</p>
      </div>
    </div>
  )
}

function Auth() {
  const [session, setSession] = useState(undefined)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])
  if (session === undefined) return <div className="center">Carregando…</div>
  if (!session) return <Login />
  return <Main session={session} />
}

function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState('login')
  const [msg, setMsg] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setMsg('')
    const fn = mode === 'login' ? supabase.auth.signInWithPassword : supabase.auth.signUp
    const { error, data } = await fn.call(supabase.auth, { email, password })
    if (error) setMsg(error.message)
    else if (mode === 'signup' && !data.session) setMsg('Conta criada. Confirme o e-mail (se o Supabase pedir) e entre.')
  }

  return (
    <div className="center">
      <form className="card narrow" onSubmit={submit}>
        <h1>💰 Controle de Finanças</h1>
        <label>E-mail<input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label>Senha<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required /></label>
        <button className="btn primary" type="submit">{mode === 'login' ? 'Entrar' : 'Criar conta'}</button>
        <button type="button" className="link" onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}>
          {mode === 'login' ? 'Primeira vez? Criar conta' : 'Já tenho conta'}
        </button>
        {msg && <p className="msg">{msg}</p>}
      </form>
    </div>
  )
}

function Main({ session }) {
  const [rows, setRows] = useState([])
  const [settings, setSettings] = useState({ opening_balance: 0, opening_date: today() })
  const [hasSettings, setHasSettings] = useState(false)
  const [loading, setLoading] = useState(true)
  const [month, setMonth] = useState(null)
  const [extraMonths, setExtraMonths] = useState([])
  const [editing, setEditing] = useState(null)
  const [showSettings, setShowSettings] = useState(false)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const [t, s] = await Promise.all([
      supabase.from('transactions').select('*').order('date', { ascending: true }).order('created_at', { ascending: true }),
      supabase.from('settings').select('*').maybeSingle(),
    ])
    if (t.error) setError(t.error.message)
    else setRows(t.data.map((r) => ({ ...r, amount: Number(r.amount) })))
    if (s.data) { setSettings(s.data); setHasSettings(true) }
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  const months = useMemo(() => {
    const set = new Set([...rows.map((r) => monthOf(r.date)), ...extraMonths])
    return [...set].sort()
  }, [rows, extraMonths])

  useEffect(() => {
    if (!month && months.length) {
      const cur = today().slice(0, 7)
      setMonth(months.includes(cur) ? cur : months[0])
    }
  }, [months, month])

  const run = async (p) => {
    const { error } = await p
    if (error) setError(error.message)
    else { setError(''); await load() }
  }

  const loadSeed = async () => {
    if (rows.length && !confirm('Já existem lançamentos. Adicionar o plano inicial mesmo assim (pode duplicar)?')) return
    await run(supabase.from('transactions').insert(SEED))
    await run(supabase.from('settings').upsert({ ...OPENING, user_id: session.user.id }))
  }

  const togglePaid = (r) => run(supabase.from('transactions').update({ status: r.status === 'paid' ? 'pending' : 'paid' }).eq('id', r.id))
  const remove = (r) => confirm(`Excluir "${r.description}"?`) && run(supabase.from('transactions').delete().eq('id', r.id))

  const save = async (form) => {
    const payload = {
      date: form.date, description: form.description.trim(), category: form.category,
      type: form.type, amount: Number(String(form.amount).replace(',', '.')) || 0,
      status: form.status, method: form.method, notes: form.notes,
    }
    if (form.id) await run(supabase.from('transactions').update(payload).eq('id', form.id))
    else await run(supabase.from('transactions').insert(payload))
    setEditing(null)
  }

  const saveSettings = async (s) => {
    await run(supabase.from('settings').upsert({
      user_id: session.user.id,
      opening_balance: Number(String(s.opening_balance).replace(',', '.')) || 0,
      opening_date: s.opening_date,
    }))
    setShowSettings(false)
  }

  const addMonth = () => {
    const last = months[months.length - 1] || today().slice(0, 7)
    const m = nextMonth(last)
    setExtraMonths([...extraMonths, m]); setMonth(m)
  }

  if (loading) return <div className="center">Carregando…</div>

  const sum = month ? summarize(rows, settings, month) : null
  const list = rows.filter((r) => monthOf(r.date) === month)
  const incomes = list.filter((r) => r.type === 'income')
  const expenses = list.filter((r) => r.type === 'expense')

  return (
    <div className="app">
      <header>
        <h1>💰 Controle de Finanças</h1>
        <div className="hdr-actions">
          <button className="btn" onClick={() => setShowSettings(true)}>Saldo inicial</button>
          <button className="btn" onClick={() => supabase.auth.signOut()}>Sair</button>
        </div>
      </header>

      {error && <div className="error">{error} <button className="link" onClick={() => setError('')}>fechar</button></div>}

      {rows.length === 0 && (
        <div className="card empty">
          <p>Nenhum lançamento ainda.</p>
          <button className="btn primary" onClick={loadSeed}>Carregar plano inicial (out/2026 – jan/2027)</button>
        </div>
      )}

      <nav className="tabs">
        {months.map((m) => (
          <button key={m} className={m === month ? 'tab active' : 'tab'} onClick={() => setMonth(m)}>{monthShort(m)}</button>
        ))}
        <button className="tab add" onClick={addMonth} title="Adicionar mês">+</button>
      </nav>

      {sum && (
        <>
          <h2>{monthLabel(month)}</h2>
          <section className="cards">
            <Stat label="Saldo que veio" value={sum.carry} />
            <Stat label="Receitas" value={sum.income} tone="pos" sub={`Recebido ${brl(sum.receivedIncome)}`} />
            <Stat label="Despesas" value={sum.expense} tone="neg" sub={`Pago ${brl(sum.paidExpense)} · Falta ${brl(sum.pendingExpense)}`} />
            <Stat label="Resultado do mês" value={sum.result} tone={sum.result >= 0 ? 'pos' : 'neg'} />
            <Stat label="Saldo no fim do mês (previsto)" value={sum.projected} tone={sum.projected >= 0 ? 'pos' : 'neg'} strong />
            <Stat label="Saldo real hoje (só pagos)" value={sum.current} />
          </section>

          <Table title="Receitas" rows={incomes} onToggle={togglePaid} onEdit={setEditing} onDelete={remove}
            onAdd={() => setEditing(blank(month, 'income'))} />
          <Table title="Despesas" rows={expenses} onToggle={togglePaid} onEdit={setEditing} onDelete={remove}
            onAdd={() => setEditing(blank(month, 'expense'))} />
        </>
      )}

      {editing && <Modal init={editing} onSave={save} onClose={() => setEditing(null)} />}
      {showSettings && <SettingsModal init={settings} onSave={saveSettings} onClose={() => setShowSettings(false)} exists={hasSettings} />}
    </div>
  )
}

const blank = (month, type) => ({
  date: `${month}-${month === today().slice(0, 7) ? today().slice(8) : '01'}`,
  description: '', category: type === 'income' ? 'Salário' : 'Outros', type, amount: '',
  status: 'pending', method: type === 'income' ? '' : 'Pix', notes: '',
})

function Stat({ label, value, tone, sub, strong }) {
  return (
    <div className={`stat ${strong ? 'strong' : ''}`}>
      <span className="lbl">{label}</span>
      <span className={`val ${tone || ''}`}>{brl(value)}</span>
      {sub && <span className="sub">{sub}</span>}
    </div>
  )
}

function Table({ title, rows, onToggle, onEdit, onDelete, onAdd }) {
  const total = rows.reduce((s, r) => s + r.amount, 0)
  const isInc = title === 'Receitas'
  return (
    <section className="card">
      <div className="card-head">
        <h3>{title} <small>({rows.length})</small></h3>
        <button className="btn primary sm" onClick={onAdd}>+ Adicionar</button>
      </div>
      <div className="tablewrap">
        <table>
          <thead>
            <tr><th></th><th>Dia</th><th>Descrição</th><th>Categoria</th><th>Forma</th><th className="r">Valor</th><th></th></tr>
          </thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan="7" className="muted">Nada lançado.</td></tr>}
            {rows.map((r) => (
              <tr key={r.id} className={r.status === 'paid' ? 'done' : ''}>
                <td><input type="checkbox" checked={r.status === 'paid'} onChange={() => onToggle(r)}
                  title={r.status === 'paid' ? 'Marcar como pendente' : isInc ? 'Marcar como recebido' : 'Marcar como pago'} /></td>
                <td>{fmtDay(r.date)}</td>
                <td>{r.description}{r.notes && <div className="note">{r.notes}</div>}</td>
                <td>{r.category}</td>
                <td>{r.method}</td>
                <td className={`r ${isInc ? 'pos' : 'neg'}`}>{brl(r.amount)}</td>
                <td className="actions">
                  <button className="icon" onClick={() => onEdit(r)} title="Editar">✏️</button>
                  <button className="icon" onClick={() => onDelete(r)} title="Excluir">🗑️</button>
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot><tr><td colSpan="5">Total</td><td className="r"><b>{brl(total)}</b></td><td></td></tr></tfoot>
        </table>
      </div>
    </section>
  )
}

function Modal({ init, onSave, onClose }) {
  const [f, setF] = useState({ ...init, amount: init.amount === '' ? '' : String(init.amount).replace('.', ',') })
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  return (
    <div className="overlay" onClick={onClose}>
      <form className="card modal" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); onSave(f) }}>
        <h3>{f.id ? 'Editar' : 'Novo'} lançamento</h3>
        <label>Tipo
          <select value={f.type} onChange={set('type')}><option value="expense">Despesa</option><option value="income">Receita</option></select>
        </label>
        <label>Descrição<input value={f.description} onChange={set('description')} required autoFocus /></label>
        <div className="row">
          <label>Valor (R$)<input inputMode="decimal" value={f.amount} onChange={set('amount')} required /></label>
          <label>Data<input type="date" value={f.date} onChange={set('date')} required /></label>
        </div>
        <div className="row">
          <label>Categoria
            <select value={f.category} onChange={set('category')}>{CATEGORIES.map((c) => <option key={c}>{c}</option>)}</select>
          </label>
          <label>Forma
            <select value={f.method || ''} onChange={set('method')}><option value=""></option>{METHODS.map((c) => <option key={c}>{c}</option>)}</select>
          </label>
        </div>
        <label>Observação<input value={f.notes || ''} onChange={set('notes')} /></label>
        <label className="check"><input type="checkbox" checked={f.status === 'paid'} onChange={(e) => setF({ ...f, status: e.target.checked ? 'paid' : 'pending' })} /> Já {f.type === 'income' ? 'recebido' : 'pago'}</label>
        <div className="row end">
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn primary">Salvar</button>
        </div>
      </form>
    </div>
  )
}

function SettingsModal({ init, onSave, onClose }) {
  const [s, setS] = useState({ opening_balance: String(init.opening_balance).replace('.', ','), opening_date: init.opening_date })
  return (
    <div className="overlay" onClick={onClose}>
      <form className="card modal" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); onSave(s) }}>
        <h3>Saldo inicial</h3>
        <p className="muted">Quanto você tinha na conta nessa data. Só lançamentos a partir dela entram no saldo.</p>
        <label>Saldo (R$)<input inputMode="decimal" value={s.opening_balance} onChange={(e) => setS({ ...s, opening_balance: e.target.value })} /></label>
        <label>Data<input type="date" value={s.opening_date} onChange={(e) => setS({ ...s, opening_date: e.target.value })} required /></label>
        <div className="row end">
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn primary">Salvar</button>
        </div>
      </form>
    </div>
  )
}
