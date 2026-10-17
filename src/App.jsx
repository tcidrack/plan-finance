import { useEffect, useMemo, useState, useCallback } from 'react'
import { Wallet, Pencil, Trash2, Plus, Copy, Repeat, Search, Wand2, CalendarClock } from 'lucide-react'
import { supabase, configured } from './supabase.js'
import { CATEGORIES, METHODS } from './constants.js'
import { brl, monthOf, monthLabel, monthShort, nextMonth, fmtDay, summarize } from './calc.js'
import {
  buildInstallments, stripInstallmentSuffix, installmentDescription, splitCents, recurrenceMonths, recurrenceRow,
  missingRecurring, monthAdd, dueSoon, planConversion, looseToInstallments, looseToRecurring, fixedFromRow, resizeInstallments, round2,
} from './plan.js'
import { ConfirmDialog, Toast, MonthPicker, FixosPanel, ConvertModal, MakeFixedDialog, useEsc } from './dialogs.jsx'
import { MonthTabs } from './tabs.jsx'
import { Planner } from './planner.jsx'

const today = () => new Date().toISOString().slice(0, 10)
// Aceita o formato brasileiro: "3.253,18", "3253,18", "3.500" (milhar) e "3253.18".
const parseAmount = (v) => {
  let s = String(v).trim().replace(/[R$\s]/g, '')
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.')
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '')
  return Number(s) || 0
}
const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const UNDO_MS = 8000
// Preferências do navegador separadas por conta.
const monthKey = (uid) => `pf.month:${uid}`
const readMonth = (uid) => {
  try {
    const m = localStorage.getItem(monthKey(uid))
    return /^\d{4}-\d{2}$/.test(m || '') ? m : null
  } catch { return null }
}

// Erro do Supabase vira exceção, para as operações em várias etapas.
const q = async (p) => {
  const { data, error } = await p
  if (error) throw error
  return data
}

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
        <h1 className="brand"><Wallet size={22} /> Controle de Finanças</h1>
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
  const uid = session.user.id
  const [rows, setRows] = useState([])
  const [recs, setRecs] = useState([])
  const [savedMonths, setSavedMonths] = useState([])
  const [extraMonths, setExtraMonths] = useState([]) // só usado se a migração 002 ainda não rodou
  const [settings, setSettings] = useState({ opening_balance: 0, opening_date: today() })
  const [hasSettings, setHasSettings] = useState(false)
  const [needsMigration, setNeedsMigration] = useState(false)
  const [loading, setLoading] = useState(true)
  const [month, setMonth] = useState(() => readMonth(uid)) // volta na aba em que o usuário estava
  const [editing, setEditing] = useState(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showFixos, setShowFixos] = useState(false)
  const [showConvert, setShowConvert] = useState(false)
  const [picker, setPicker] = useState(false)
  const [fixing, setFixing] = useState(null) // lançamento sendo transformado em fixo
  const [dialog, setDialog] = useState(null)
  const [toast, setToast] = useState(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const [t, s, r, m] = await Promise.all([
      supabase.from('transactions').select('*').order('date', { ascending: true }).order('created_at', { ascending: true }),
      supabase.from('settings').select('*').maybeSingle(),
      supabase.from('recurrences').select('*').order('created_at', { ascending: true }),
      supabase.from('months').select('month'),
    ])
    if (t.error) setError(t.error.message)
    else setRows(t.data.map((x) => ({ ...x, amount: Number(x.amount) })))
    if (s.data) { setSettings(s.data); setHasSettings(true) }
    setNeedsMigration(Boolean(r.error || m.error))
    if (!r.error) setRecs(r.data.map((x) => ({ ...x, amount: Number(x.amount) })))
    if (!m.error) setSavedMonths(m.data.map((x) => x.month))
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), UNDO_MS)
    return () => clearTimeout(t)
  }, [toast])

  useEffect(() => {
    if (month) try { localStorage.setItem(monthKey(uid), month) } catch { /* só não lembra a aba */ }
  }, [month, uid])

  const curMonth = today().slice(0, 7)
  const months = useMemo(() => {
    const set = new Set([...rows.map((r) => monthOf(r.date)), ...savedMonths, ...extraMonths])
    return [...set].sort()
  }, [rows, savedMonths, extraMonths])

  useEffect(() => {
    if ((!month || !months.includes(month)) && months.length) {
      setMonth(months.includes(curMonth) ? curMonth : months.find((m) => m > curMonth) || months[months.length - 1])
    }
  }, [months, month, curMonth])

  // Executa uma operação de várias etapas, mostra o erro (se houver) e recarrega.
  const exec = async (fn) => {
    try { await fn(); setError('') } catch (e) { setError(e.message || String(e)) }
    await load()
  }

  const saveMonths = async (list) => {
    const ms = [...new Set(list)].filter((m) => !savedMonths.includes(m))
    if (needsMigration || !ms.length) return
    await q(supabase.from('months').upsert(ms.map((month) => ({ user_id: uid, month })), { onConflict: 'user_id,month', ignoreDuplicates: true }))
  }
  const insertRows = async (list, onConflict) => {
    if (!list.length) return
    await q(onConflict
      ? supabase.from('transactions').upsert(list, { onConflict, ignoreDuplicates: true })
      : supabase.from('transactions').insert(list))
    await saveMonths(list.map((r) => monthOf(r.date)))
  }

  // Linhas do mesmo parcelamento/fixo e o recorte "só esta / seguintes / todas".
  const siblings = (r) =>
    r.group_id ? rows.filter((x) => x.group_id === r.group_id)
      : r.recurrence_id ? rows.filter((x) => x.recurrence_id === r.recurrence_id) : [r]
  const position = (x) => (x.group_id ? x.installment_number : x.recurrence_month || monthOf(x.date))
  const scoped = (r, scope) => (scope === 'one' ? [r] : siblings(r).filter((x) => scope === 'all' || position(x) >= position(r)))

  // Fixo deixa de valer a partir de `fromMonth` (null ou desde o início = apaga a regra).
  const endRecurrence = async (rec, fromMonth) => {
    if (!fromMonth || fromMonth <= rec.start_month) await q(supabase.from('recurrences').delete().eq('id', rec.id))
    else await q(supabase.from('recurrences').update({ end_month: monthAdd(fromMonth, -1) }).eq('id', rec.id))
  }

  // ───────── Desfazer ─────────
  const offerUndo = (text, snap) => setToast({ key: Date.now(), text, snap })
  const undo = (snap) => {
    setToast(null)
    exec(async () => {
      if (snap.recs?.length) await q(supabase.from('recurrences').upsert(snap.recs))
      if (snap.tx?.length) await q(supabase.from('transactions').upsert(snap.tx))
      if (snap.months?.length) {
        await q(supabase.from('months').upsert(snap.months.map((month) => ({ user_id: uid, month })), { onConflict: 'user_id,month', ignoreDuplicates: true }))
      }
    })
  }
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`

  // ───────── Lançamentos ─────────

  const togglePaid = (r) => exec(() => q(supabase.from('transactions').update({ status: r.status === 'paid' ? 'pending' : 'paid' }).eq('id', r.id)))

  const askDelete = (r) => {
    const linked = r.group_id || r.recurrence_id
    const go = (scope) => { setDialog(null); deleteTx(r, scope) }
    const n = (scope) => scoped(r, scope).length
    setDialog({
      title: 'Excluir lançamento?',
      body: <>
        <p><b>{r.description}</b><br /><span className="muted">{fmtDay(r.date)} · {brl(r.amount)}</span></p>
        {linked && <p className="muted">Faz parte de {r.group_id ? `um parcelamento em ${r.installment_total}x` : 'um gasto fixo'}. O que excluir?</p>}
      </>,
      actions: linked
        ? [
            { label: 'Só esta', kind: '', onClick: () => go('one') },
            { label: `Esta e as seguintes (${n('next')})`, kind: 'danger', onClick: () => go('next') },
            { label: `Todas (${n('all')})`, kind: 'danger', onClick: () => go('all') },
          ]
        : [{ label: 'Excluir', kind: 'danger', onClick: () => go('one') }],
    })
  }

  const deleteTx = (r, scope) => exec(async () => {
    const targets = scoped(r, scope)
    const rec = r.recurrence_id && scope !== 'one' ? recs.find((x) => x.id === r.recurrence_id) : null
    await q(supabase.from('transactions').delete().in('id', targets.map((x) => x.id)))
    if (rec) await endRecurrence(rec, scope === 'all' ? null : r.recurrence_month)
    offerUndo(`${plural(targets.length, 'lançamento excluído', 'lançamentos excluídos')}`, { tx: targets, recs: rec ? [rec] : [] })
  })

  const save = (f) => {
    const payload = {
      date: f.date, description: f.description.trim(), category: f.category,
      type: f.type, amount: round2(parseAmount(f.amount)),
      status: f.status, method: f.method || '', notes: f.notes || '',
    }
    if (!f.id) return create(f, payload)

    const orig = rows.find((x) => x.id === f.id)
    const baseDesc = orig.group_id ? stripInstallmentSuffix(orig.description) : orig.description
    const sharedChanged = payload.description !== baseDesc || payload.amount !== orig.amount ||
      payload.category !== orig.category || payload.method !== (orig.method || '')

    // Novo nº de parcelas (só em parcelamentos).
    const newTotal = orig.group_id ? parseInt(f.newTotal, 10) : null
    if (orig.group_id && !(newTotal >= 2 && newTotal <= 120)) return setError('O nº de parcelas precisa ficar entre 2 e 120.')
    const resize = orig.group_id && newTotal !== orig.installment_total ? newTotal : null
    const removed = resize ? siblings(orig).filter((x) => x.installment_number > resize) : []
    const resizeNote = resize && (removed.length
      ? `Vai passar para ${resize}x e apagar ${plural(removed.length, 'parcela', 'parcelas')} (${removed.map((x) => `${x.installment_number}/${orig.installment_total}`).join(', ')})${removed.some((x) => x.status === 'paid') ? ', incluindo pagas' : ''}.`
      : `Vai passar para ${resize}x e criar as parcelas que faltam.`)

    if (!(orig.group_id || orig.recurrence_id) || !sharedChanged) {
      if (!removed.length) return applyEdit(orig, payload, 'one', resize)
      return setDialog({
        title: `Reduzir para ${resize} parcelas?`, body: resizeNote,
        actions: [{ label: 'Reduzir', kind: 'danger', onClick: () => { setDialog(null); applyEdit(orig, payload, 'one', resize) } }],
      })
    }

    const go = (scope) => { setDialog(null); applyEdit(orig, payload, scope, resize) }
    setDialog({
      tone: 'info', icon: Pencil, title: 'Aplicar a alteração em…',
      body: <>
        <p>Este lançamento faz parte de {orig.group_id ? `um parcelamento em ${orig.installment_total}x` : 'um gasto fixo'}. Valor, descrição, categoria e forma podem valer para as outras também.</p>
        {resizeNote && <p><b>{resizeNote}</b></p>}
      </>,
      actions: [
        { label: 'Só esta', onClick: () => go('one') },
        { label: 'Esta e as seguintes', kind: 'primary', onClick: () => go('next') },
        { label: 'Todas', kind: 'primary', onClick: () => go('all') },
      ],
    })
  }

  const applyEdit = (orig, payload, scope, resize = null) => exec(async () => {
    const descFor = (x) => (x.group_id ? installmentDescription(payload.description, x.installment_number, x.installment_total) : payload.description)
    const edited = new Map(scoped(orig, scope).map((x) => [x.id, {
      ...x,
      category: payload.category, method: payload.method, amount: payload.amount, description: descFor(x),
      ...(x.id === orig.id ? { date: payload.date, status: payload.status, notes: payload.notes, type: payload.type } : {}),
    }]))
    let list = [...edited.values()]

    if (resize) {
      // Renumera o grupo inteiro (já com as alterações), apaga as excedentes e cria as que faltam.
      const before = siblings(orig)
      const { keep, removes, inserts } = resizeInstallments(before.map((x) => edited.get(x.id) || x), resize)
      if (removes.length) await q(supabase.from('transactions').delete().in('id', removes.map((x) => x.id)))
      await q(supabase.from('transactions').upsert(keep))
      await insertRows(inserts, 'group_id,installment_number')
      if (removes.length) offerUndo(`${plural(removes.length, 'parcela apagada', 'parcelas apagadas')}`, { tx: before })
      list = []
    }

    if (list.length) await q(supabase.from('transactions').upsert(list))
    if (orig.recurrence_id && scope !== 'one') {
      await q(supabase.from('recurrences').update({
        description: payload.description, amount: payload.amount, category: payload.category, method: payload.method,
      }).eq('id', orig.recurrence_id))
    }
    await saveMonths([monthOf(payload.date)])
    setEditing(null)
  })

  const create = (f, payload) => exec(async () => {
    const n = Math.max(1, parseInt(f.n, 10) || 1)
    if (n > 1) {
      await insertRows(buildInstallments(payload, n, f.amountMode, crypto.randomUUID()))
    } else if (f.repeat) {
      const start = monthOf(payload.date)
      const end = f.until || null
      if (end && end < start) throw new Error('O mês final do fixo precisa ser igual ou depois do mês do lançamento.')
      const [rec] = await q(supabase.from('recurrences').insert({
        description: payload.description, category: payload.category, type: payload.type, amount: payload.amount,
        method: payload.method, notes: payload.notes, day: Number(payload.date.slice(8, 10)), start_month: start, end_month: end,
      }).select())
      const list = recurrenceMonths(start, end).map((m) => recurrenceRow(rec, m))
      list[0] = { ...list[0], date: payload.date, status: payload.status }
      await insertRows(list, 'recurrence_id,recurrence_month')
    } else {
      await insertRows([payload])
    }
    setEditing(null)
  })

  const duplicate = (r) => setEditing({
    date: r.date, description: r.group_id ? stripInstallmentSuffix(r.description) : r.description,
    category: r.category, type: r.type, amount: r.amount, status: 'pending', method: r.method, notes: r.notes,
  })

  const saveSettings = async (s) => {
    await exec(() => q(supabase.from('settings').upsert({
      user_id: uid,
      opening_balance: parseAmount(s.opening_balance),
      opening_date: s.opening_date,
    })))
    setShowSettings(false)
  }

  // ───────── Meses ─────────
  const ensureMonth = (m) => {
    setPicker(false)
    if (months.includes(m)) return setMonth(m)
    setExtraMonths((xs) => [...xs, m])
    setMonth(m)
    exec(async () => {
      await saveMonths([m])
      await insertRows(missingRecurring(recs, rows, m), 'recurrence_id,recurrence_month')
    })
  }

  const askDeleteMonth = () => {
    const inMonth = rows.filter((r) => monthOf(r.date) === month)
    const linked = inMonth.filter((r) => r.group_id || r.recurrence_id)
    const futureIds = new Set(inMonth.map((r) => r.id))
    const futures = linked.flatMap((r) => siblings(r).filter((x) => monthOf(x.date) > month)).filter((x) => !futureIds.has(x.id) && futureIds.add(x.id))
    const fixedRecs = [...new Set(linked.map((r) => r.recurrence_id).filter(Boolean))]
    const go = (withFuture) => { setDialog(null); deleteMonth(inMonth, withFuture ? futures : [], withFuture ? fixedRecs : []) }

    setDialog({
      title: `Excluir ${monthLabel(month)}?`,
      body: <>
        <p>{inMonth.length ? `${plural(inMonth.length, 'lançamento será apagado', 'lançamentos serão apagados')} junto com a aba.` : 'A aba está vazia.'}</p>
        {linked.length > 0 && (futures.length > 0 || fixedRecs.length > 0) && (
          <p className="muted">{plural(linked.length, 'deles faz', 'deles fazem')} parte de parcelamentos ou fixos que continuam em outros meses
            ({plural(futures.length, 'lançamento futuro', 'lançamentos futuros')}).</p>
        )}
      </>,
      actions: linked.length > 0 && (futures.length > 0 || fixedRecs.length > 0)
        ? [
            { label: 'Só este mês', kind: 'danger', onClick: () => go(false) },
            { label: 'Também os futuros dos grupos', kind: 'danger', onClick: () => go(true) },
          ]
        : [{ label: 'Excluir mês', kind: 'danger', onClick: () => go(false) }],
    })
  }

  const deleteMonth = (inMonth, futures, recIds) => {
    const m = month
    const idx = months.indexOf(m)
    setMonth(months[idx + 1] || months[idx - 1] || null)
    setExtraMonths((xs) => xs.filter((x) => x !== m))
    exec(async () => {
      const tx = [...inMonth, ...futures]
      if (tx.length) await q(supabase.from('transactions').delete().in('id', tx.map((x) => x.id)))
      const affected = recs.filter((r) => recIds.includes(r.id))
      for (const rec of affected) await endRecurrence(rec, m)
      const hadMonth = savedMonths.includes(m)
      if (hadMonth) await q(supabase.from('months').delete().eq('month', m))
      offerUndo(`${monthLabel(m)} excluído${tx.length ? ` (${plural(tx.length, 'lançamento', 'lançamentos')})` : ''}`,
        { tx, recs: affected, months: hadMonth ? [m] : [] })
    })
  }

  // ───────── Fixos ─────────
  const saveRecAmount = (rec, value) => exec(async () => {
    const amount = round2(parseAmount(value))
    await q(supabase.from('recurrences').update({ amount }).eq('id', rec.id))
    await q(supabase.from('transactions').update({ amount }).eq('recurrence_id', rec.id).eq('status', 'pending').gte('date', today()))
  })

  const askEndRec = (rec) => {
    const futures = rows.filter((t) => t.recurrence_id === rec.id && t.status === 'pending' && t.date > today())
    setDialog({
      tone: 'warn', icon: Repeat, title: `Encerrar "${rec.description}"?`,
      body: `Ele para de ser gerado nos próximos meses e ${plural(futures.length, 'lançamento pendente futuro será apagado', 'lançamentos pendentes futuros serão apagados')}. Os já pagos ficam.`,
      actions: [{
        label: 'Encerrar', kind: 'danger', onClick: () => {
          setDialog(null)
          exec(async () => {
            if (futures.length) await q(supabase.from('transactions').delete().in('id', futures.map((x) => x.id)))
            await q(supabase.from('recurrences').update({ end_month: curMonth }).eq('id', rec.id))
            offerUndo(`"${rec.description}" encerrado`, { tx: futures, recs: [rec] })
          })
        },
      }],
    })
  }

  // Lançamento existente → fixo (vincula os iguais dos meses seguintes e gera o resto).
  const makeFixed = (row, until) => exec(async () => {
    const { rec, updates, inserts } = fixedFromRow(row, rows, until, crypto.randomUUID())
    await q(supabase.from('recurrences').insert(rec))
    await q(supabase.from('transactions').upsert(updates.map((u) => ({ ...u.row, ...u.patch }))))
    await insertRows(inserts, 'recurrence_id,recurrence_month')
    setFixing(null)
  })

  // ───────── Conversor ─────────
  const conv = useMemo(() => planConversion(rows), [rows])
  const applyConversion = (sel) => exec(async () => {
    const updates = [], groupInserts = [], recInserts = [], newRecs = []
    for (const g of sel.groups) { updates.push(...g.updates); groupInserts.push(...g.inserts) }
    for (const { l, choice, n, until } of sel.loose) {
      if (choice === 'parcelas') {
        const r = looseToInstallments(l, n, crypto.randomUUID())
        updates.push(...r.updates); groupInserts.push(...r.inserts)
      } else if (choice === 'fixo') {
        const r = looseToRecurring(l, until || null, crypto.randomUUID())
        newRecs.push(r.rec); updates.push(...r.updates); recInserts.push(...r.inserts)
      }
    }
    if (newRecs.length) await q(supabase.from('recurrences').insert(newRecs))
    if (updates.length) await q(supabase.from('transactions').upsert(updates.map((u) => ({ ...u.row, ...u.patch }))))
    await insertRows(groupInserts, 'group_id,installment_number')
    await insertRows(recInserts, 'recurrence_id,recurrence_month')
    setShowConvert(false)
    setShowFixos(false)
  })

  if (loading) return <div className="center">Carregando…</div>

  const sum = month ? summarize(rows, settings, month) : null
  const due = dueSoon(rows, today())
  const nq = norm(search.trim())
  const visible = (r) =>
    (statusFilter === 'all' || r.status === statusFilter) &&
    (!nq || norm(`${r.description} ${r.category} ${r.method} ${r.notes}`).includes(nq))
  const list = rows.filter((r) => monthOf(r.date) === month && visible(r))
  const incomes = list.filter((r) => r.type === 'income')
  const expenses = list.filter((r) => r.type === 'expense')

  return (
    <div className="app">
      <header>
        <h1 className="brand"><Wallet size={22} /> Controle de Finanças</h1>
        <div className="hdr-actions">
          <button className="btn" onClick={() => setShowFixos(true)} disabled={needsMigration}><Repeat size={16} /> Fixos</button>
          <button className="btn" onClick={() => setShowSettings(true)}>Saldo inicial</button>
          <button className="btn" onClick={() => supabase.auth.signOut()}>Sair</button>
        </div>
      </header>

      {error && <div className="error floating" role="alert">Erro: {error} <button className="link" onClick={() => setError('')}>fechar</button></div>}
      {needsMigration && (
        <div className="banner warn">
          Rode <code>supabase/migration-002.sql</code> no SQL Editor do Supabase para ativar parcelas, gastos fixos e meses salvos.
        </div>
      )}
      {!needsMigration && conv.groups.length > 0 && (
        <div className="banner">
          <span><Wand2 size={16} /> Encontrei {plural(conv.groups.length, 'parcelamento lançado', 'parcelamentos lançados')} à mão (ex.: "{conv.groups[0].base}").</span>
          <button className="btn sm primary" onClick={() => setShowConvert(true)}>Revisar e converter</button>
        </div>
      )}

      {rows.length === 0 && (
        <div className="card empty">
          <p>Nenhum lançamento ainda. Comece informando seu <b>saldo inicial</b> e adicionando receitas e despesas.</p>
          <div className="row center-row">
            <button className="btn" onClick={() => setShowSettings(true)}>Saldo inicial</button>
            <button className="btn primary" onClick={() => setEditing(blank(month || curMonth, 'expense'))}><Plus size={16} /> Adicionar primeiro lançamento</button>
          </div>
        </div>
      )}

      <MonthTabs uid={uid} months={months} month={month} curMonth={curMonth} onSelect={setMonth} onAdd={() => setPicker(true)} />

      {sum && (
        <>
          <div className="month-head">
            <h2>{monthLabel(month)}</h2>
            <button className="icon danger" onClick={askDeleteMonth} title="Excluir mês" aria-label="Excluir mês"><Trash2 size={16} /></button>
          </div>
          <section className="cards">
            <Stat label="Saldo que veio" value={sum.carry} />
            <Stat label="Receitas" value={sum.income} tone="pos" sub={`Recebido ${brl(sum.receivedIncome)}`} />
            <Stat label="Despesas" value={sum.expense} tone="neg" sub={`Pago ${brl(sum.paidExpense)} · Falta ${brl(sum.pendingExpense)}`} />
            <Stat label="Resultado do mês" value={sum.result} tone={sum.result >= 0 ? 'pos' : 'neg'} />
            <Stat label="Saldo no fim do mês (previsto)" value={sum.projected} tone={sum.projected >= 0 ? 'pos' : 'neg'} strong />
            <Stat label="Saldo real hoje (só pagos)" value={sum.current} />
            <Stat icon={CalendarClock} label="Vence nos próximos 7 dias" value={due.total} tone={due.count ? 'neg' : ''}
              sub={due.count ? `${plural(due.count, 'conta', 'contas')}: ${due.list.slice(0, 3).map((t) => `${t.description} (${fmtDay(t.date)})`).join(', ')}${due.count > 3 ? '…' : ''}` : 'Nada vencendo'}
              onClick={due.count ? () => { setStatusFilter('pending'); if (months.includes(curMonth)) setMonth(curMonth) } : undefined} />
          </section>

          <div className="toolbar">
            <label className="search">
              <Search size={16} />
              <input type="search" placeholder="Buscar no mês…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar" />
            </label>
            <div className="segmented" role="group" aria-label="Filtrar por status">
              {[['all', 'Todos'], ['pending', 'Pendentes'], ['paid', 'Pagos']].map(([v, l]) => (
                <button key={v} className={statusFilter === v ? 'on' : ''} onClick={() => setStatusFilter(v)}>{l}</button>
              ))}
            </div>
          </div>

          <Table title="Receitas" rows={incomes} onToggle={togglePaid} onEdit={setEditing} onDelete={askDelete} onDuplicate={duplicate}
            onMakeFixed={needsMigration ? null : setFixing} onAdd={() => setEditing(blank(month, 'income'))} />
          <Table title="Despesas" rows={expenses} onToggle={togglePaid} onEdit={setEditing} onDelete={askDelete} onDuplicate={duplicate}
            onMakeFixed={needsMigration ? null : setFixing} onAdd={() => setEditing(blank(month, 'expense'))} />
        </>
      )}

      {editing && <Modal init={editing} canRepeat={!needsMigration} onSave={save} onClose={() => setEditing(null)}
        onMakeFixed={() => { setFixing(rows.find((r) => r.id === editing.id)); setEditing(null) }} />}
      {fixing && <MakeFixedDialog row={fixing} rows={rows} onConfirm={(until) => makeFixed(fixing, until)} onClose={() => setFixing(null)} />}
      {showSettings && <SettingsModal init={settings} onSave={saveSettings} onClose={() => setShowSettings(false)} exists={hasSettings} />}
      {picker && <MonthPicker initial={nextMonth(months[months.length - 1] || curMonth)} onPick={ensureMonth} onClose={() => setPicker(false)} />}
      {showFixos && <FixosPanel recs={recs} rows={rows} today={today()} onSaveAmount={saveRecAmount} onEnd={askEndRec}
        onConvert={() => setShowConvert(true)} onClose={() => setShowFixos(false)} />}
      {showConvert && <ConvertModal conv={conv} onApply={applyConversion} onClose={() => setShowConvert(false)} />}
      {dialog && (
        <ConfirmDialog tone={dialog.tone} icon={dialog.icon} title={dialog.title} actions={dialog.actions} onClose={() => setDialog(null)}>
          {dialog.body}
        </ConfirmDialog>
      )}
      <Planner uid={uid} />
      {toast && <Toast key={toast.key} text={toast.text} ms={UNDO_MS} onUndo={() => undo(toast.snap)} onClose={() => setToast(null)} />}
    </div>
  )
}

const blank = (month, type) => ({
  date: `${month}-${month === today().slice(0, 7) ? today().slice(8) : '01'}`,
  description: '', category: type === 'income' ? 'Salário' : 'Outros', type, amount: '',
  status: 'pending', method: type === 'income' ? '' : 'Pix', notes: '',
})

function Stat({ label, value, tone, sub, strong, icon: Icon, onClick }) {
  return (
    <div className={`stat ${strong ? 'strong' : ''} ${onClick ? 'clickable' : ''}`} onClick={onClick}
      role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick() : undefined}>
      <span className="lbl">{Icon && <Icon size={13} />}{label}</span>
      <span className={`val ${tone || ''}`}>{brl(value)}</span>
      {sub && <span className="sub">{sub}</span>}
    </div>
  )
}

function Table({ title, rows, onToggle, onEdit, onDelete, onDuplicate, onMakeFixed, onAdd }) {
  const total = rows.reduce((s, r) => s + r.amount, 0)
  const isInc = title === 'Receitas'
  return (
    <section className="card">
      <div className="card-head">
        <h3>{title} <small>({rows.length})</small></h3>
        <button className="btn primary sm" onClick={onAdd}><Plus size={14} /> Adicionar</button>
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
                <td>
                  {r.group_id ? stripInstallmentSuffix(r.description) : r.description}
                  {r.group_id && <span className="badge" title="Parcela">{r.installment_number}/{r.installment_total}</span>}
                  {r.recurrence_id && <span className="badge fix" title="Gasto fixo"><Repeat size={11} /> Fixo</span>}
                  {r.notes && <div className="note">{r.notes}</div>}
                </td>
                <td>{r.category}</td>
                <td>{r.method}</td>
                <td className={`r ${isInc ? 'pos' : 'neg'}`}>{brl(r.amount)}</td>
                <td className="actions">
                  {onMakeFixed && !r.group_id && !r.recurrence_id && (
                    <button className="icon" onClick={() => onMakeFixed(r)} title="Tornar fixo (repetir todo mês)" aria-label="Tornar fixo"><Repeat size={16} /></button>
                  )}
                  <button className="icon" onClick={() => onDuplicate(r)} title="Duplicar" aria-label="Duplicar"><Copy size={16} /></button>
                  <button className="icon" onClick={() => onEdit(r)} title="Editar" aria-label="Editar"><Pencil size={16} /></button>
                  <button className="icon danger" onClick={() => onDelete(r)} title="Excluir" aria-label="Excluir"><Trash2 size={16} /></button>
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

function Modal({ init, canRepeat, onSave, onClose, onMakeFixed }) {
  useEsc(onClose)
  const [f, setF] = useState({
    n: '1', amountMode: 'total', repeat: false, until: '',
    ...init,
    newTotal: init.installment_total ? String(init.installment_total) : '',
    description: init.group_id ? stripInstallmentSuffix(init.description) : init.description,
    amount: init.amount === '' ? '' : String(init.amount).replace('.', ','),
  })
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const isNew = !f.id
  const n = Math.max(1, parseInt(f.n, 10) || 1)
  const amt = parseAmount(f.amount)
  const parts = n > 1 ? (f.amountMode === 'total' ? splitCents(amt, n) : Array(n).fill(round2(amt))) : []
  const partsTotal = parts.reduce((s, v) => s + v, 0)

  return (
    <div className="overlay" onClick={onClose}>
      <form className="card modal" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); onSave(f) }}>
        <h3>{f.id ? 'Editar' : 'Novo'} lançamento</h3>
        {f.group_id && <p className="hint"><span className="badge">{f.installment_number}/{f.installment_total}</span> Parcela de um parcelamento</p>}
        {f.recurrence_id && <p className="hint"><span className="badge fix"><Repeat size={11} /> Fixo</span> Lançamento de um gasto fixo</p>}
        {f.id && !f.group_id && !f.recurrence_id && canRepeat && (
          <button type="button" className="link hint-link" onClick={onMakeFixed}><Repeat size={14} /> Tornar fixo (repetir nos outros meses)…</button>
        )}
        <label>Tipo
          <select value={f.type} onChange={set('type')}><option value="expense">Despesa</option><option value="income">Receita</option></select>
        </label>
        <label>Descrição<input value={f.description} onChange={set('description')} required autoFocus /></label>
        <div className="row">
          <label>{n > 1 && f.amountMode === 'parcela' ? 'Valor da parcela (R$)' : 'Valor (R$)'}<input inputMode="decimal" value={f.amount} onChange={set('amount')} required /></label>
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

        {f.group_id && (() => {
          const nt = parseInt(f.newTotal, 10)
          const changed = nt >= 2 && nt !== f.installment_total
          return (
            <div className="repeat-box">
              <label>Nº de parcelas do parcelamento
                <input type="number" min="2" max="120" value={f.newTotal} onChange={set('newTotal')} required />
              </label>
              <p className="hint">
                {!changed ? `Esta é a parcela ${f.installment_number} de ${f.installment_total}.`
                  : nt > f.installment_total ? `Vai criar as parcelas ${f.installment_total + 1} a ${nt}, uma por mês depois da última.`
                    : `Vai apagar as parcelas ${nt + 1} a ${f.installment_total} (dá para desfazer).`}
              </p>
            </div>
          )
        })()}

        {isNew && canRepeat && (
          <div className="repeat-box">
            <div className="row">
              <label>Nº de parcelas
                <input type="number" min="1" max="120" value={f.n} disabled={f.repeat} onChange={set('n')} />
              </label>
              {n > 1 && (
                <label>Valor informado é
                  <select value={f.amountMode} onChange={set('amountMode')}>
                    <option value="total">Total</option>
                    <option value="parcela">Por parcela</option>
                  </select>
                </label>
              )}
            </div>
            {n > 1 && (
              <p className="hint">
                {f.amountMode === 'total' && parts[0] !== parts[n - 1]
                  ? `${n - 1}x de ${brl(parts[0])} + 1x de ${brl(parts[n - 1])}`
                  : `${n}x de ${brl(parts[0])}`} · total {brl(partsTotal)} · uma por mês a partir de {fmtDay(f.date)}
              </p>
            )}
            <label className="check">
              <input type="checkbox" checked={f.repeat} disabled={n > 1}
                onChange={(e) => setF({ ...f, repeat: e.target.checked })} /> Repetir todo mês (fixo)
            </label>
            {f.repeat && (
              <>
                <label>Até (opcional)<input type="month" value={f.until} min={f.date.slice(0, 7)} onChange={set('until')} /></label>
                <p className="hint">{f.until ? `Gera de ${monthShort(f.date.slice(0, 7))} até ${monthShort(f.until)}.` : 'Sem fim: gera os próximos 12 meses, e cada mês novo criado no "+" recebe o fixo.'}</p>
              </>
            )}
          </div>
        )}

        <label className="check"><input type="checkbox" checked={f.status === 'paid'} onChange={(e) => setF({ ...f, status: e.target.checked ? 'paid' : 'pending' })} /> Já {f.type === 'income' ? 'recebido' : 'pago'}{isNew && (n > 1 || f.repeat) ? ' (só o primeiro)' : ''}</label>
        <div className="row end">
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn primary">Salvar</button>
        </div>
      </form>
    </div>
  )
}

function SettingsModal({ init, onSave, onClose }) {
  useEsc(onClose)
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
