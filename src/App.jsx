import { useEffect, useMemo, useState, useCallback } from 'react'
import { Wallet, Pencil, Trash2, Plus, Copy, Repeat, Search, Wand2, Check, AlertCircle, Settings, Sun, Moon, Monitor, X, Eye, EyeOff } from 'lucide-react'
import { THEMES, useTheme } from './theme.js'
import { supabase, configured } from './supabase.js'
import { CATEGORIES, METHODS } from './constants.js'
import { brl, monthOf, monthLabel, monthShort, nextMonth, fmtDay, summarize } from './calc.js'
import {
  buildInstallments, stripInstallmentSuffix, splitCents, recurrenceMonths, recurrenceRow,
  missingRecurring, monthAdd, dateInMonth, addMonths, addDays, dueSoon, openBillDue, withPlanned, repeatSet, editChanges, applyRepeat, dueLevel, planConversion, looseToInstallments, looseToRecurring, fixedFromRow, resizeInstallments, round2,
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

// Rótulo de uma mudança no popup "Repetir esta edição…": "Forma: Boleto → Cartão Nubank".
const PLAN_LABEL = { null: 'automático', true: 'planejado', false: 'gasto certo' }
const changeLabel = ({ field, from, to }, orig, others) => {
  const show = (v) => (v === '' ? '(vazio)' : v)
  if (field === 'amount') {
    const skip = others.filter((x) => Number(x.amount) !== Number(orig.amount)).length
    return `Valor: ${brl(from)} → ${brl(to)}${skip ? ` (só nos meses que estavam com ${brl(from)}; ${skip} com outro valor ficam como estão)` : ''}`
  }
  if (field === 'planned') return `Planejamento: ${PLAN_LABEL[from]} → ${PLAN_LABEL[to]}`
  const name = { description: 'Descrição', category: 'Categoria', method: 'Forma', notes: 'Observação', day: 'Dia' }[field]
  return `${name}: ${show(from)} → ${show(to)}`
}
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
  if (error && /hidden/.test(error.message || '')) throw new Error('Rode supabase/migration-007.sql no Supabase para poder remover as opções padrão.')
  if (error && /planned|cards/.test(error.message || '')) throw new Error('Rode supabase/migration-005.sql e depois migration-006.sql no Supabase para ativar planejados e cartões.')
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

// Último e-mail usado neste navegador (a senha fica a cargo do gerenciador de senhas do navegador).
const EMAIL_KEY = 'pf.lastEmail'
const readEmail = () => { try { return localStorage.getItem(EMAIL_KEY) || '' } catch { return '' } }
const AUTH_ERRORS = [
  [/invalid login credentials/i, 'E-mail ou senha incorretos.'],
  [/already registered|already exists/i, 'Este e-mail já tem conta. Use "Já tenho conta" para entrar.'],
  [/email not confirmed/i, 'Confirme seu e-mail antes de entrar (veja sua caixa de entrada).'],
  [/password should be at least/i, 'A senha precisa ter pelo menos 6 caracteres.'],
  [/rate limit|too many/i, 'Muitas tentativas. Aguarde um pouco e tente de novo.'],
]
const authMessage = (m) => AUTH_ERRORS.find(([re]) => re.test(m))?.[1] || m

function Login() {
  const [email, setEmail] = useState(readEmail)
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)
  const [showPw, setShowPw] = useState(false)
  const [mode, setMode] = useState('login')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setMsg('')
    setBusy(true)
    const fn = mode === 'login' ? supabase.auth.signInWithPassword : supabase.auth.signUp
    const { error, data } = await fn.call(supabase.auth, { email, password })
    setBusy(false)
    if (error) return setMsg(authMessage(error.message))
    try { remember ? localStorage.setItem(EMAIL_KEY, email.trim()) : localStorage.removeItem(EMAIL_KEY) } catch { /* sem armazenamento */ }
    if (mode === 'signup' && !data.session) setMsg('Conta criada. Confirme o e-mail (se o Supabase pedir) e entre.')
  }

  return (
    <div className="center">
      <div className="corner"><ThemeButton /></div>
      {/* name/autocomplete fazem o navegador reconhecer o login e oferecer para salvar a senha */}
      <form className="card narrow" method="post" autoComplete="on" onSubmit={submit}>
        <h1 className="brand"><Wallet size={22} /> Controle de Finanças</h1>
        <label htmlFor="email">E-mail
          <input id="email" name="email" type="email" inputMode="email" autoComplete="username"
            value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label htmlFor="password">Senha
          <span className="pw-field">
            <input id="password" name="password" type={showPw ? 'text' : 'password'}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required />
            <button type="button" className="pw-toggle" onClick={() => setShowPw(!showPw)}
              aria-label={showPw ? 'Ocultar senha' : 'Mostrar senha'} aria-pressed={showPw} title={showPw ? 'Ocultar senha' : 'Mostrar senha'}>
              {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </span>
        </label>
        <label className="check"><input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} /> Lembrar meu e-mail</label>
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? (mode === 'login' ? 'Entrando…' : 'Criando…') : mode === 'login' ? 'Entrar' : 'Criar conta'}
        </button>
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
  const [cards, setCards] = useState([]) // null = migração 006 ainda não rodou
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
  const [options, setOptions] = useState([]) // categorias e formas criadas pelo usuário
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const [t, s, r, m, o, c] = await Promise.all([
      supabase.from('transactions').select('*').order('date', { ascending: true }).order('created_at', { ascending: true }),
      supabase.from('settings').select('*').maybeSingle(),
      supabase.from('recurrences').select('*').order('created_at', { ascending: true }),
      supabase.from('months').select('month'),
      supabase.from('user_options').select('*').order('name', { ascending: true }),
      supabase.from('cards').select('*'),
    ])
    setOptions(o.error ? null : o.data) // null = migração 004 ainda não rodou
    setCards(c.error ? null : c.data.map((x) => ({ ...x, credit_limit: x.credit_limit == null ? null : Number(x.credit_limit) })))
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
    const orig = f.id ? rows.find((x) => x.id === f.id) : null
    // "Planejado" só vai para o banco quando o usuário mexeu (null = o app decide).
    const plannedSet = f.planned_set ?? null
    if (plannedSet !== (orig?.planned ?? null)) payload.planned = plannedSet
    if (!orig) return create(f, payload)

    // Marcou/desmarcou "Repetir todo mês": salva este lançamento e liga ou desliga o fixo.
    if (!orig.group_id && f.fixed !== undefined && Boolean(f.fixed) !== Boolean(orig.recurrence_id)) {
      if (f.fixed) return applyEdit(orig, payload, 'one', []).then(() => setFixing({ ...orig, ...payload }))
      return askStopFixed(orig, payload)
    }

    // Novo nº de parcelas (só em parcelamentos).
    const newTotal = orig.group_id ? parseInt(f.newTotal, 10) : null
    if (orig.group_id && !(newTotal >= 2 && newTotal <= 120)) return setError('O nº de parcelas precisa ficar entre 2 e 120.')
    const resize = orig.group_id && newTotal !== orig.installment_total ? newTotal : null
    const removed = resize ? siblings(orig).filter((x) => x.installment_number > resize) : []
    const resizeNote = resize && (removed.length
      ? `Vai passar para ${resize}x e apagar ${plural(removed.length, 'parcela', 'parcelas')} (${removed.map((x) => `${x.installment_number}/${orig.installment_total}`).join(', ')})${removed.some((x) => x.status === 'paid') ? ', incluindo pagas' : ''}.`
      : `Vai passar para ${resize}x e criar as parcelas que faltam.`)

    // Tudo que se repete (parcela, fixo ou lançamento igual em outros meses) pergunta se leva a edição.
    const changes = editChanges(orig, payload)
    const others = repeatSet(orig, rows)
    if (!changes.length || !others.length) {
      if (!removed.length) return applyEdit(orig, payload, 'one', changes, resize)
      return setDialog({
        title: `Reduzir para ${resize} parcelas?`, body: resizeNote,
        actions: [{ label: 'Reduzir', kind: 'danger', onClick: () => { setDialog(null); applyEdit(orig, payload, 'one', changes, resize) } }],
      })
    }

    const next = editTargets(orig, 'next').length
    const what = orig.group_id ? `um parcelamento em ${orig.installment_total}x`
      : orig.recurrence_id ? 'um gasto fixo'
        : `${plural(others.length, 'lançamento igual', 'lançamentos iguais')} ("${orig.description}") em outros meses`
    const go = (scope) => { setDialog(null); applyEdit(orig, payload, scope, changes, resize) }
    setDialog({
      tone: 'info', icon: Pencil, title: 'Repetir esta edição nos outros meses?',
      body: <>
        <p>Este lançamento {orig.group_id || orig.recurrence_id ? 'faz parte de' : 'tem'} {what}. O que mudou:</p>
        <ul>{changes.map((c) => <li key={c.field}>{changeLabel(c, orig, others)}</li>)}</ul>
        <p className="muted">Nos outros meses muda só isso; o resto fica como está.</p>
        {resizeNote && <p><b>{resizeNote}</b></p>}
      </>,
      actions: [
        { label: 'Só esta', onClick: () => go('one') },
        ...(next ? [{ label: `Esta e as seguintes (${next + 1})`, kind: 'primary', onClick: () => go('next') }] : []),
        ...(next < others.length ? [{ label: `Todas (${others.length + 1})`, kind: 'primary', onClick: () => go('all') }] : []),
      ],
    })
  }

  // Outras linhas que recebem a edição: nenhuma, as seguintes ou todas.
  const editTargets = (orig, scope) => {
    if (scope === 'one') return []
    const pos = (x) => (x.group_id ? x.installment_number : x.recurrence_month || monthOf(x.date))
    return repeatSet(orig, rows).filter((x) => scope === 'all' || pos(x) > pos(orig))
  }

  const applyEdit = (orig, payload, scope, changes, resize = null) => exec(async () => {
    let list = applyRepeat(orig, payload, changes, editTargets(orig, scope))

    if (resize) {
      // Renumera o grupo inteiro (já com as alterações), apaga as excedentes e cria as que faltam.
      const edited = new Map(list.map((x) => [x.id, x]))
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
      // A regra do fixo também muda só no que foi alterado (para os meses criados depois no "+").
      const rule = {}
      for (const { field, to } of changes) if (field !== 'planned') rule[field] = to
      if (Object.keys(rule).length) await q(supabase.from('recurrences').update(rule).eq('id', orig.recurrence_id))
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
      const list = recurrenceMonths(start, end).map((m) => ({ ...recurrenceRow(rec, m), ...('planned' in payload ? { planned: payload.planned } : {}) }))
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
    ...(r.planned_set != null ? { planned_set: r.planned_set } : {}),
  })

  const saveSettings = (s) => exec(() => q(supabase.from('settings').upsert({
    user_id: uid,
    opening_balance: parseAmount(s.opening_balance),
    opening_date: s.opening_date,
  })))

  // Categorias e formas de pagamento: as padrão (menos as que o usuário removeu) + as criadas por ele.
  // Remover uma padrão grava uma linha `hidden`; adicionar o mesmo nome de novo apaga essa linha.
  const custom = (kind) => (options || []).filter((x) => x.kind === kind && !x.hidden)
  const hiddenOpt = (kind, name) => (options || []).find((x) => x.kind === kind && x.hidden && norm(x.name) === norm(name))
  const listOf = (kind, defaults) => [...defaults.filter((d) => !hiddenOpt(kind, d)), ...custom(kind).map((x) => x.name)]
  const categories = listOf('category', CATEGORIES)
  const methods = listOf('method', METHODS)
  const insertOption = async (kind, name) => {
    const hidden = hiddenOpt(kind, name)
    if (hidden) await q(supabase.from('user_options').delete().eq('id', hidden.id))
    else await q(supabase.from('user_options').insert({ kind, name }))
  }
  const addOption = (kind, name) => {
    const list = kind === 'category' ? categories : methods
    if (list.some((x) => norm(x) === norm(name))) return setError(`"${name}" já existe na lista.`)
    return exec(() => insertOption(kind, name))
  }
  const removeOption = (kind, name) => exec(async () => {
    const mine = custom(kind).find((x) => x.name === name)
    if (mine) await q(supabase.from('user_options').delete().eq('id', mine.id))
    else await q(supabase.from('user_options').insert({ kind, name, hidden: true }))
  })

  // Cartões de crédito: fechamento e vencimento de cada forma de pagamento "Cartão …".
  const saveCardRow = (c) => q(supabase.from('cards').upsert({
    user_id: uid, method: c.method, closing_day: Number(c.closing_day), due_day: Number(c.due_day),
    credit_limit: String(c.credit_limit ?? '').trim() ? round2(parseAmount(c.credit_limit)) : null,
  }, { onConflict: 'user_id,method' }))
  const saveCard = (c) => exec(() => saveCardRow(c))
  const removeCard = (method) => exec(() => q(supabase.from('cards').delete().eq('method', method)))
  // Cartão novo: se o nome ainda não é forma de pagamento, cria (ou restaura) a forma também.
  const addCard = (c) => {
    const method = c.method.trim().replace(/\s+/g, ' ')
    if ((cards || []).some((x) => norm(x.method) === norm(method))) return setError(`O cartão "${method}" já está configurado.`)
    const existing = methods.find((m) => norm(m) === norm(method))
    return exec(async () => {
      if (!existing) await insertOption('method', method)
      await saveCardRow({ ...c, method: existing || method })
    })
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

  // Botões on/off da tabela. Fixo: liga pelo "Tornar fixo" e desliga pelo "Parar de repetir".
  const toggleFixed = (r) => (r.recurrence_id ? askStopFixed(r) : setFixing(r))
  // Planejado: passa pelo save(), então o que se repete pergunta se leva para os outros meses.
  // `r` vem com o planejado efetivo; clicar num automático grava "gasto certo".
  const togglePlanned = (r) => save({
    ...r,
    description: r.group_id ? stripInstallmentSuffix(r.description) : r.description,
    amount: String(r.amount),
    newTotal: r.installment_total ? String(r.installment_total) : '',
    planned_set: !r.planned,
  })

  // Desmarcou "Repetir todo mês" num fixo: este mês (e os anteriores) ficam; os pendentes seguintes saem.
  const askStopFixed = (orig, payload = orig) => {
    const rec = recs.find((x) => x.id === orig.recurrence_id)
    const later = rows.filter((t) => t.recurrence_id === orig.recurrence_id && t.recurrence_month > orig.recurrence_month)
    const pending = later.filter((t) => t.status === 'pending')
    const paid = later.length - pending.length
    setDialog({
      tone: 'warn', icon: Repeat, title: `Parar de repetir "${orig.description}"?`,
      body: <>
        <p>Este mês fica. Deixa de ser gerado depois de {monthShort(orig.recurrence_month)}
          {pending.length ? ` e ${plural(pending.length, 'lançamento pendente dos meses seguintes será apagado', 'lançamentos pendentes dos meses seguintes serão apagados')}` : ''}.</p>
        {paid > 0 && <p className="muted">{plural(paid, 'lançamento já pago fica', 'lançamentos já pagos ficam')}.</p>}
      </>,
      actions: [{
        label: 'Parar de repetir', kind: 'danger', onClick: () => {
          setDialog(null)
          exec(async () => {
            await q(supabase.from('transactions').upsert(applyRepeat(orig, payload, [], [])))
            if (pending.length) await q(supabase.from('transactions').delete().in('id', pending.map((x) => x.id)))
            if (rec) await endRecurrence(rec, monthAdd(orig.recurrence_month, 1))
            offerUndo(`"${orig.description}" não repete mais`, { tx: pending, recs: rec ? [rec] : [] })
            setEditing(null)
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
  // Lançamentos com o "planejado" efetivo (escolha do usuário ou automático pelo cartão). Só para exibir:
  // as gravações continuam saindo de `rows`, que tem só as colunas da tabela.
  const view = useMemo(() => withPlanned(rows, cards || [], today()), [rows, cards])
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

  const sum = month ? summarize(view, settings, month) : null
  const nq = norm(search.trim())
  const visible = (r) =>
    (statusFilter === 'all' || r.status === statusFilter) &&
    (!nq || norm(`${r.description} ${r.category} ${r.method} ${r.notes}`).includes(nq))
  const list = view.filter((r) => monthOf(r.date) === month && visible(r))
  // Ações que gravam a linha de volta recebem a versão crua (sem os campos calculados).
  const raw = (fn) => (r) => fn(rows.find((x) => x.id === r.id))
  const incomes = list.filter((r) => r.type === 'income')
  const expenses = list.filter((r) => r.type === 'expense')

  return (
    <div className="app">
      <header>
        <h1 className="brand"><Wallet size={22} /> Controle de Finanças</h1>
        <div className="hdr-actions">
          <button className="btn" onClick={() => setShowFixos(true)} disabled={needsMigration}><Repeat size={16} /> Fixos</button>
          <button className="btn" onClick={() => setShowSettings(true)}><Settings size={16} /> Configurações</button>
          <ThemeButton />
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
          <section className="cards hero">
            <Stat hero label="Resultado do mês" value={sum.result} tone={sum.result >= 0 ? 'pos' : 'neg'}
              sub={sum.planned > 0 ? `Receitas − despesas · inclui ${brl(sum.planned)} planejado` : 'Receitas − despesas deste mês'} />
            <Stat hero label="Saldo no fim do mês (previsto)" value={sum.projected} tone={sum.projected >= 0 ? 'pos' : 'neg'} strong
              sub="Saldo que veio + resultado do mês" />
          </section>
          <section className="cards compact">
            <Stat label="Saldo que veio" value={sum.carry} />
            <Stat label="Receitas" value={sum.income} tone="pos" sub={`Recebido ${brl(sum.receivedIncome)}`} />
            <Stat label="Despesas" value={sum.expense} tone="neg" sub={`Pago ${brl(sum.paidExpense)} · Falta ${brl(sum.pendingExpense)}`} />
            <Stat label="Saldo real hoje" value={sum.current} sub="Só o que já foi pago/recebido" />
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

          <Table title="Receitas" rows={incomes} onToggle={togglePaid} onEdit={setEditing} onDelete={raw(askDelete)} onDuplicate={duplicate}
            onToggleFixed={needsMigration ? null : raw(toggleFixed)} onTogglePlanned={togglePlanned} onAdd={() => setEditing(blank(month, 'income'))} />
          <Table title="Despesas" rows={expenses} onToggle={togglePaid} onEdit={setEditing} onDelete={raw(askDelete)} onDuplicate={duplicate}
            onToggleFixed={needsMigration ? null : raw(toggleFixed)} onTogglePlanned={togglePlanned} onAdd={() => setEditing(blank(month, 'expense'))} />
        </>
      )}

      {editing && <Modal init={editing} canRepeat={!needsMigration} categories={categories} methods={methods} cards={cards} onSave={save} onClose={() => setEditing(null)} />}
      {fixing && <MakeFixedDialog row={fixing} rows={rows} onConfirm={(until) => makeFixed(fixing, until)} onClose={() => setFixing(null)} />}
      {showSettings && (
        <SettingsPanel settings={settings} onSaveBalance={saveSettings} options={options}
          categories={categories} methods={methods} cards={cards} onSaveCard={saveCard} onAddCard={addCard} onRemoveCard={removeCard}
          onAddOption={addOption} onRemoveOption={removeOption} onClose={() => setShowSettings(false)} />
      )}
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

function Stat({ label, value, tone, sub, strong, hero, icon: Icon, onClick }) {
  return (
    <div className={`stat ${strong ? 'strong' : ''} ${hero ? 'hero' : ''} ${onClick ? 'clickable' : ''}`} onClick={onClick}
      role={onClick ? 'button' : undefined} tabIndex={onClick ? 0 : undefined}
      onKeyDown={onClick ? (e) => e.key === 'Enter' && onClick() : undefined}>
      <span className="lbl">{Icon && <Icon size={13} />}{label}</span>
      <span className={`val ${tone || ''}`}>{brl(value)}</span>
      {sub && <span className="sub">{sub}</span>}
    </div>
  )
}

function Table({ title, rows, onToggle, onEdit, onDelete, onDuplicate, onToggleFixed, onTogglePlanned, onAdd }) {
  const total = rows.reduce((s, r) => s + r.amount, 0)
  const isInc = title === 'Receitas'
  const todayStr = today()
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
            {rows.length === 0 && <tr className="empty-row"><td colSpan="7" className="muted">Nada lançado.</td></tr>}
            {rows.map((r) => {
              const paid = r.status === 'paid'
              const label = paid ? 'Marcar como pendente' : isInc ? 'Marcar como recebido' : 'Marcar como pago'
              // Só despesas pendentes ganham a cor de vencimento.
              const due = !isInc && !paid ? dueLevel(r.date, todayStr) : null
              const day = (
                <span className={`due${due ? ` ${due.level}` : ''}`} title={due?.label}>
                  {due?.level === 'late' && <AlertCircle size={11} />}{fmtDay(r.date)}
                </span>
              )
              return (
                <tr key={r.id} className={paid ? 'done' : ''}>
                  <td className="c-chk">
                    <button className={`check-btn${paid ? ' on' : ''}${isInc ? ' inc' : ''}`} onClick={() => onToggle(r)}
                      aria-pressed={paid} title={label} aria-label={`${label}: ${r.description}`}>
                      <Check size={15} strokeWidth={3} />
                    </button>
                  </td>
                  <td className="c-day">{day}</td>
                  <td className="c-desc">
                    <span className="desc-text">{r.group_id ? stripInstallmentSuffix(r.description) : r.description}</span>
                    {r.group_id && <span className="badge" title="Parcela">{r.installment_number}/{r.installment_total}</span>}
                    <span className="chips-row">
                      {onToggleFixed && !r.group_id && (
                        <button type="button" className={`chip-toggle fix${r.recurrence_id ? ' on' : ''}`} aria-pressed={Boolean(r.recurrence_id)}
                          onClick={() => onToggleFixed(r)} title={r.recurrence_id ? 'Fixo: repete todo mês (clique para parar)' : 'Não repete (clique para tornar fixo)'}>
                          <Repeat size={11} /> Fixo
                        </button>
                      )}
                      <button type="button" className={`chip-toggle plan${r.planned ? ' on' : ''}${r.planned && r.planned_set == null ? ' auto' : ''}`}
                        aria-pressed={Boolean(r.planned)} onClick={() => onTogglePlanned(r)}
                        title={!r.planned ? 'Confirmado (clique para marcar como só planejamento)'
                          : r.planned_set == null ? 'Planejado automaticamente: ainda não caiu em nenhuma fatura do cartão (clique para marcar como gasto certo)'
                            : 'Só planejamento, ainda não confirmado (clique para confirmar)'}>
                        Planejado
                      </button>
                    </span>
                    <div className="meta-m">{day}{[r.category, r.method].filter(Boolean).map((t) => <span key={t}> · {t}</span>)}</div>
                    {r.notes && <div className="note">{r.notes}</div>}
                  </td>
                  <td className="c-cat">{r.category}</td>
                  <td className="c-met">{r.method}</td>
                  <td className={`c-val r ${isInc ? 'pos' : 'neg'}`}>{brl(r.amount)}</td>
                <td className="actions">
                  <button className="icon" onClick={() => onDuplicate(r)} title="Duplicar" aria-label="Duplicar"><Copy size={16} /></button>
                  <button className="icon" onClick={() => onEdit(r)} title="Editar" aria-label="Editar"><Pencil size={16} /></button>
                  <button className="icon danger" onClick={() => onDelete(r)} title="Excluir" aria-label="Excluir"><Trash2 size={16} /></button>
                </td>
              </tr>
              )
            })}
          </tbody>
          <tfoot><tr className="total-row"><td colSpan="5">Total</td><td className="r"><b>{brl(total)}</b></td><td className="total-pad"></td></tr></tfoot>
        </table>
      </div>
    </section>
  )
}

// Mantém no select o valor atual do lançamento, mesmo que tenha saído da lista.
const withCurrent = (list, value) => (value && !list.includes(value) ? [value, ...list] : list)

function Modal({ init, canRepeat, categories, methods, cards, onSave, onClose }) {
  useEsc(onClose)
  const [f, setF] = useState({
    n: '1', amountMode: 'total', repeat: false, until: '',
    ...init,
    ...(init.id ? { fixed: Boolean(init.recurrence_id) } : {}),
    newTotal: init.installment_total ? String(init.installment_total) : '',
    description: init.group_id ? stripInstallmentSuffix(init.description) : init.description,
    amount: init.amount === '' ? '' : String(init.amount).replace('.', ','),
    buyDate: init.date, cardDue: false,
  })
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  // Despesa no cartão: a data vira o vencimento da fatura em que cai a compra (buyDate).
  const withCardDate = (g) => {
    if (g.group_id) return g
    const c = g.type === 'expense' && (cards || []).find((x) => x.method === g.method)
    if (c) return { ...g, date: openBillDue(c, g.buyDate), cardDue: true }
    return g.cardDue ? { ...g, date: g.buyDate, cardDue: false } : g
  }
  const setCardField = (k) => (e) => setF(withCardDate({ ...f, [k]: e.target.value }))
  const setDate = (e) => setF({ ...f, date: e.target.value, buyDate: e.target.value, cardDue: false })
  const isNew = !f.id
  const n = Math.max(1, parseInt(f.n, 10) || 1)
  const amt = parseAmount(f.amount)
  const parts = n > 1 ? (f.amountMode === 'total' ? splitCents(amt, n) : Array(n).fill(round2(amt))) : []
  const partsTotal = parts.reduce((s, v) => s + v, 0)
  // "Planejado" automático: no cartão, 1ª parcela vencendo depois da fatura aberta.
  const card = (cards || []).find((c) => c.method === f.method)
  const billDue = card ? openBillDue(card, today()) : null
  const auto = f.id && f.method === init.method && f.date === init.date ? Boolean(init.planned_auto)
    : Boolean(card && f.type === 'expense' && f.status === 'pending' && monthOf(f.date) > monthOf(billDue))
  const planned = f.planned_set ?? auto

  return (
    <div className="overlay" onClick={onClose}>
      <form className="card modal" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); onSave(f) }}>
        <h3>{f.id ? 'Editar' : 'Novo'} lançamento</h3>
        {f.group_id && <p className="hint"><span className="badge">{f.installment_number}/{f.installment_total}</span> Parcela de um parcelamento</p>}
        {f.id && !f.group_id && canRepeat && (
          <>
            <label className="check">
              <input type="checkbox" checked={Boolean(f.fixed)} onChange={(e) => setF({ ...f, fixed: e.target.checked })} />
              <span className="badge fix"><Repeat size={11} /> Fixo</span> Repetir todo mês
            </label>
            {Boolean(f.fixed) !== Boolean(init.recurrence_id) && (
              <p className="hint">{f.fixed
                ? 'Ao salvar, você escolhe até quando repetir; os iguais dos meses seguintes são vinculados.'
                : 'Ao salvar, para de repetir depois deste mês e os pendentes dos meses seguintes são apagados (dá para desfazer).'}</p>
            )}
          </>
        )}
        <label>Tipo
          <select value={f.type} onChange={setCardField('type')}><option value="expense">Despesa</option><option value="income">Receita</option></select>
        </label>
        <label>Descrição<input value={f.description} onChange={set('description')} required autoFocus /></label>
        <div className="row">
          <label>{n > 1 && f.amountMode === 'parcela' ? 'Valor da parcela (R$)' : 'Valor (R$)'}<input inputMode="decimal" value={f.amount} onChange={set('amount')} required /></label>
          <label>Data<input type="date" value={f.date} onChange={setDate} required /></label>
        </div>
        {f.cardDue && <p className="hint">Compra em {fmtDay(f.buyDate)} no {f.method} → fatura vence em {fmtDay(f.date)}.</p>}
        <div className="row">
          <label>Categoria
            <select value={f.category} onChange={set('category')}>{withCurrent(categories, f.category).map((c) => <option key={c}>{c}</option>)}</select>
          </label>
          <label>Forma
            <select value={f.method || ''} onChange={setCardField('method')}><option value=""></option>{withCurrent(methods, f.method).map((c) => <option key={c}>{c}</option>)}</select>
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

        <label className="check"><input type="checkbox" checked={planned} onChange={(e) => setF({ ...f, planned_set: e.target.checked })} /> Só planejamento (ainda não confirmado)</label>
        {(planned || f.planned_set != null) && (
          <p className="hint">
            {f.planned_set == null
              ? `Marcado automaticamente: no ${f.method} vence só depois da fatura aberta (${fmtDay(billDue)}). Desmarque se o gasto já é certo.`
              : planned ? 'Entra no saldo previsto, mas o Planejador entende que pode mudar de mês, de valor ou ser cancelado.' : 'Marcado por você como gasto certo.'}
            {f.planned_set != null && card && <button type="button" className="link" onClick={() => setF({ ...f, planned_set: null })}>Deixar o app decidir</button>}
          </p>
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

const THEME_ICONS = { auto: Monitor, light: Sun, dark: Moon }

// Alterna Automático → Claro → Escuro.
function ThemeButton() {
  const [theme, setTheme] = useTheme()
  const order = THEMES.map(([v]) => v)
  const next = order[(order.indexOf(theme) + 1) % order.length]
  const Icon = THEME_ICONS[theme]
  const name = (v) => THEMES.find(([k]) => k === v)[1]
  return (
    <button className="btn icon-only" onClick={() => setTheme(next)}
      title={`Tema: ${name(theme)} (clique para ${name(next).toLowerCase()})`} aria-label={`Tema ${name(theme)}`}>
      <Icon size={16} />
    </button>
  )
}

function SettingsPanel({ settings, onSaveBalance, options, categories, methods, cards, onSaveCard, onAddCard, onRemoveCard, onAddOption, onRemoveOption, onClose }) {
  useEsc(onClose)
  const [theme, setTheme] = useTheme()
  const [s, setS] = useState({ opening_balance: String(settings.opening_balance).replace('.', ','), opening_date: settings.opening_date })
  const [saved, setSaved] = useState(false)
  const saveBalance = async (e) => {
    e.preventDefault()
    await onSaveBalance(s)
    setSaved(true)
  }

  return (
    <div className="overlay" onClick={onClose}>
      <div className="card modal wide settings" onClick={(e) => e.stopPropagation()}>
        <div className="card-head">
          <h3 className="brand"><Settings size={18} /> Configurações</h3>
          <button className="icon" onClick={onClose} aria-label="Fechar"><X size={18} /></button>
        </div>

        <section>
          <h4>Saldo inicial</h4>
          <p className="hint">Quanto você tinha na conta nessa data. Só lançamentos a partir dela entram no saldo.</p>
          <form className="row wrap" onSubmit={saveBalance}>
            <label>Saldo (R$)<input inputMode="decimal" value={s.opening_balance} onChange={(e) => { setSaved(false); setS({ ...s, opening_balance: e.target.value }) }} /></label>
            <label>Data<input type="date" value={s.opening_date} onChange={(e) => { setSaved(false); setS({ ...s, opening_date: e.target.value }) }} required /></label>
            <button className="btn primary">{saved ? <><Check size={16} /> Salvo</> : 'Salvar'}</button>
          </form>
        </section>

        <section>
          <h4>Tema</h4>
          <div className="segmented" role="group" aria-label="Tema">
            {THEMES.map(([v, l]) => {
              const Icon = THEME_ICONS[v]
              return <button key={v} className={theme === v ? 'on' : ''} onClick={() => setTheme(v)}><Icon size={14} /> {l}</button>
            })}
          </div>
        </section>

        <OptionList title="Categorias" kind="category" items={categories} options={options} onAdd={onAddOption} onRemove={onRemoveOption} />
        <OptionList title="Formas de pagamento" kind="method" items={methods} options={options} onAdd={onAddOption} onRemove={onRemoveOption} />
        <CardList methods={methods} cards={cards} onSave={onSaveCard} onAdd={onAddCard} onRemove={onRemoveCard} />
      </div>
    </div>
  )
}

const BLANK_CARD = { method: '', closing_day: '', due_day: '', credit_limit: '' }
const limitText = (c) => (c.credit_limit == null ? '' : String(c.credit_limit).replace('.', ','))

// Mostra a regra do cartão com datas reais: "Compras até 26/10 vencem em 03/11; a partir de 27/10, em 03/12."
function billRule(c) {
  const close = Number(c.closing_day), due = Number(c.due_day)
  if (!(close >= 1 && close <= 31 && due >= 1 && due <= 31)) return ''
  const first = openBillDue({ closing_day: close, due_day: due }, today())
  const closeDate = dateInMonth(monthAdd(monthOf(first), due <= close ? -1 : 0), close)
  return `Compras até ${fmtDay(closeDate)} vencem em ${fmtDay(first)}; a partir de ${fmtDay(addDays(closeDate, 1))}, em ${fmtDay(addMonths(first, 1))}.`
}

// Cartões: fechamento/vencimento usados no "planejado" automático e pelo Planejador.
function CardList({ methods, cards, onSave, onAdd, onRemove }) {
  const [edit, setEdit] = useState({}) // method → campos em edição
  const [novo, setNovo] = useState(BLANK_CARD)
  const configured = new Set((cards || []).map((c) => norm(c.method)))
  const suggestions = methods.filter((m) => norm(m).includes('cartao') && !configured.has(norm(m)))
  const val = (c) => edit[c.method] || { closing_day: c.closing_day, due_day: c.due_day, credit_limit: limitText(c) }
  const set = (c, k) => (e) => setEdit({ ...edit, [c.method]: { ...val(c), [k]: e.target.value } })
  const setN = (k) => (e) => setNovo({ ...novo, [k]: e.target.value })
  const save = async (e, c) => {
    e.preventDefault()
    await onSave({ method: c.method, ...val(c) })
    setEdit(({ [c.method]: _, ...rest }) => rest)
  }
  const add = async (e) => {
    e.preventDefault()
    if (!novo.method.trim()) return
    await onAdd(novo)
    setNovo(BLANK_CARD)
  }

  return (
    <section>
      <h4>Cartões de crédito</h4>
      {cards === null ? (
        <p className="hint">Para configurar os cartões, rode <code>supabase/migration-006.sql</code> no SQL Editor do Supabase.</p>
      ) : (
        <>
          <p className="hint">Com o fechamento e o vencimento, compras cuja 1ª parcela vence depois da fatura aberta viram planejadas automaticamente, e o Planejador indica qual cartão usar.</p>
          <ul className="cards-cfg">
            {cards.map((c) => {
              const v = val(c)
              const dirty = Boolean(edit[c.method])
              return (
                <li key={c.method}>
                  <form className="row wrap" onSubmit={(e) => save(e, c)}>
                    <span className="cc-name"><b>{c.method}</b>
                      <button type="button" className="icon danger" onClick={() => onRemove(c.method)}
                        title="Remover cartão (a forma de pagamento continua)" aria-label={`Remover ${c.method}`}><X size={14} /></button>
                    </span>
                    <label className="inline">Fecha dia<input type="number" min="1" max="31" value={v.closing_day} onChange={set(c, 'closing_day')} required /></label>
                    <label className="inline">Vence dia<input type="number" min="1" max="31" value={v.due_day} onChange={set(c, 'due_day')} required /></label>
                    <label className="inline">Limite (opcional)<input inputMode="decimal" value={v.credit_limit} onChange={set(c, 'credit_limit')} /></label>
                    <button className="btn sm primary" disabled={!dirty}>{dirty ? 'Salvar' : <><Check size={14} /> Salvo</>}</button>
                  </form>
                  <p className="hint">{billRule(v)}</p>
                </li>
              )
            })}
            {cards.length === 0 && <li className="muted">Nenhum cartão ainda.</li>}
          </ul>
          <form className="row wrap cards-add" onSubmit={add}>
            <label className="inline cc-new">Novo cartão
              <input list="card-suggestions" value={novo.method} maxLength={40} onChange={setN('method')} placeholder="Ex.: Cartão Inter" required />
            </label>
            <datalist id="card-suggestions">{suggestions.map((m) => <option key={m} value={m} />)}</datalist>
            <label className="inline">Fecha dia<input type="number" min="1" max="31" value={novo.closing_day} onChange={setN('closing_day')} required /></label>
            <label className="inline">Vence dia<input type="number" min="1" max="31" value={novo.due_day} onChange={setN('due_day')} required /></label>
            <label className="inline">Limite (opcional)<input inputMode="decimal" value={novo.credit_limit} onChange={setN('credit_limit')} /></label>
            <button className="btn"><Plus size={16} /> Adicionar</button>
          </form>
          {novo.method && <p className="hint">{billRule(novo)}</p>}
        </>
      )}
    </section>
  )
}

function OptionList({ title, kind, items, options, onAdd, onRemove }) {
  const [name, setName] = useState('')
  const mine = new Set((options || []).filter((x) => x.kind === kind && !x.hidden).map((x) => x.name))
  const add = async (e) => {
    e.preventDefault()
    const v = name.trim().replace(/\s+/g, ' ')
    if (!v) return
    await onAdd(kind, v)
    setName('')
  }
  return (
    <section>
      <h4>{title}</h4>
      {options === null ? (
        <p className="hint">Para editar a lista, rode <code>supabase/migration-004.sql</code> no SQL Editor do Supabase.</p>
      ) : (
        <>
          <div className="chips">
            {items.map((n) => (
              <span key={n} className={`opt-chip${mine.has(n) ? ' mine' : ''}`}>{n}
                <button onClick={() => onRemove(kind, n)} aria-label={`Remover ${n}`} title="Remover da lista (lançamentos que já usam continuam com o nome)"><X size={12} /></button>
              </span>
            ))}
          </div>
          <p className="hint">Remover só tira da lista; os lançamentos que já usam continuam com o nome.</p>
          <form className="row" onSubmit={add}>
            <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder={kind === 'category' ? 'Nova categoria (ex.: Pets)' : 'Nova forma (ex.: Cartão Inter)'} aria-label={`Nova ${kind === 'category' ? 'categoria' : 'forma de pagamento'}`} />
            <button className="btn" disabled={!name.trim()}><Plus size={16} /> Adicionar</button>
          </form>
        </>
      )}
    </section>
  )
}
