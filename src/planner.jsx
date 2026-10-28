import { useEffect, useRef, useState } from 'react'
import { Sparkles, X, Send, Trash2, Target, MessageCircle } from 'lucide-react'
import { supabase } from './supabase.js'
import { ConfirmDialog } from './dialogs.jsx'
import { GOAL_OPTIONS } from './planner-context.js'

const SUGGESTIONS = [
  'Como montar minha reserva de emergência?',
  'Onde posso cortar gastos este mês?',
  'Quanto consigo guardar ou investir por mês?',
  'Meu saldo vai fechar positivo nos próximos meses?',
]

// Chamada ao servidor (api/planner.js) com o token do usuário logado.
async function api(method, body) {
  const { data } = await supabase.auth.getSession()
  try {
    const res = await fetch('/api/planner', {
      method,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${data.session?.access_token || ''}` },
      body: body ? JSON.stringify(body) : undefined,
    })
    let payload = {}
    try { payload = await res.json() } catch { /* resposta sem corpo */ }
    return { ok: res.ok, status: res.status, ...payload }
  } catch {
    return { ok: false, status: 0, error: 'Sem conexão com o servidor.' }
  }
}

export function Planner({ uid }) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState('chat')
  const [state, setState] = useState(null) // { configured, messages, profile, limit, remaining } | { error }
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [confirmClear, setConfirmClear] = useState(false)
  const endRef = useRef(null)

  useEffect(() => {
    if (!open || state) return
    api('GET').then((r) => setState(r.ok ? r : { error: r.error === 'migration' ? 'migration' : r.error || 'Não foi possível abrir o planejador.' }))
  }, [open, state])

  useEffect(() => {
    if (!open) return
    const h = (e) => e.key === 'Escape' && !confirmClear && setOpen(false)
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [open, confirmClear])

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [state?.messages?.length, sending, open, tab])

  const ready = state && !state.error && state.configured
  const canSend = ready && !sending && state.remaining > 0

  const send = async (text) => {
    const message = (text ?? draft).trim()
    if (!message || !canSend) return
    setError('')
    setSending(true)
    setDraft('')
    const temp = { id: `tmp-${Date.now()}`, role: 'user', content: message, pending: true }
    setState((s) => ({ ...s, messages: [...s.messages, temp] }))
    const r = await api('POST', { message })
    setSending(false)
    if (r.ok) {
      setState((s) => ({ ...s, remaining: r.remaining, messages: [...s.messages.filter((m) => m.id !== temp.id), ...r.messages] }))
    } else {
      setState((s) => ({ ...s, remaining: r.remaining ?? s.remaining, messages: s.messages.filter((m) => m.id !== temp.id) }))
      setDraft(message)
      setError(r.error || 'Não foi possível enviar.')
    }
  }

  const clear = async () => {
    setConfirmClear(false)
    const r = await api('DELETE')
    if (r.ok) setState((s) => ({ ...s, messages: [] }))
    else setError(r.error || 'Não foi possível limpar.')
  }

  return (
    <>
      {!open && (
        <button className="planner-fab" onClick={() => setOpen(true)} aria-label="Abrir o Planejador financeiro">
          <Sparkles size={18} /> Planejador
        </button>
      )}

      {open && (
        <aside className="planner" role="dialog" aria-label="Planejador financeiro">
          <header className="planner-head">
            <div className="brand"><Sparkles size={18} /> Planejador</div>
            <div className="planner-tabs" role="tablist">
              <button role="tab" aria-selected={tab === 'chat'} className={tab === 'chat' ? 'on' : ''} onClick={() => setTab('chat')}><MessageCircle size={14} /> Conversa</button>
              <button role="tab" aria-selected={tab === 'goals'} className={tab === 'goals' ? 'on' : ''} onClick={() => setTab('goals')}><Target size={14} /> Meus objetivos</button>
            </div>
            <button className="icon" onClick={() => setOpen(false)} aria-label="Fechar"><X size={18} /></button>
          </header>

          {!state && <div className="planner-empty">Carregando…</div>}
          {state?.error === 'migration' && (
            <div className="planner-empty">Para usar o planejador, rode <code>supabase/migration-003.sql</code> no SQL Editor do Supabase.</div>
          )}
          {state?.error && state.error !== 'migration' && <div className="planner-empty">{state.error}</div>}
          {state && !state.error && !state.configured && (
            <div className="planner-empty">O planejador ainda não foi configurado: falta a chave <code>GEMINI_API_KEY</code> no servidor (veja o README).</div>
          )}

          {state && !state.error && tab === 'goals' && (
            <Goals uid={uid} profile={state.profile} onSaved={(profile) => { setState((s) => ({ ...s, profile })); setTab('chat') }} />
          )}

          {ready && tab === 'chat' && (
            <>
              <div className="planner-body">
                {state.messages.length === 0 && (
                  <div className="planner-welcome">
                    <p><b>Olá! Sou seu planejador financeiro.</b> Eu vejo um resumo dos seus lançamentos e te ajudo a montar reserva, cortar gastos e planejar investimentos.</p>
                    {!state.profile?.goal && <p className="muted">Dica: conte seu objetivo na aba <b>Meus objetivos</b> para dicas mais certeiras.</p>}
                    <div className="planner-suggestions">
                      {SUGGESTIONS.map((s) => <button key={s} className="chip" onClick={() => send(s)} disabled={!canSend}>{s}</button>)}
                    </div>
                  </div>
                )}
                {state.messages.map((m) => (
                  <div key={m.id} className={`bubble ${m.role}${m.pending ? ' pending' : ''}`}>
                    {m.role === 'model' ? <Markdown text={m.content} /> : m.content}
                  </div>
                ))}
                {sending && <div className="bubble model typing" aria-label="Pensando"><span /><span /><span /></div>}
                <div ref={endRef} />
              </div>

              {error && <div className="planner-error">{error}</div>}

              <form className="planner-input" onSubmit={(e) => { e.preventDefault(); send() }}>
                <textarea rows={2} value={draft} maxLength={2000} disabled={!canSend && !sending}
                  placeholder={state.remaining > 0 ? 'Pergunte sobre seus gastos, metas, reserva…' : 'Você já usou as mensagens de hoje.'}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }} />
                <button className="btn primary" disabled={!canSend || !draft.trim()} aria-label="Enviar"><Send size={16} /></button>
              </form>
              <div className="planner-foot">
                <span>{state.remaining} de {state.limit} mensagens hoje</span>
                {state.messages.length > 0 && <button className="link" onClick={() => setConfirmClear(true)}><Trash2 size={12} /> Limpar conversa</button>}
              </div>
              <p className="planner-disclaimer">Dicas educativas, não é recomendação de investimento. Suas mensagens e um resumo dos seus dados financeiros são enviados ao Google (Gemini) para gerar as respostas.</p>
            </>
          )}
        </aside>
      )}

      {confirmClear && (
        <ConfirmDialog title="Limpar a conversa?" onClose={() => setConfirmClear(false)}
          actions={[{ label: 'Limpar', kind: 'danger', onClick: clear }]}>
          O histórico do planejador será apagado. Seus objetivos e lançamentos continuam. (Isso não devolve mensagens da cota de hoje.)
        </ConfirmDialog>
      )}
    </>
  )
}

function Goals({ uid, profile, onSaved }) {
  const [f, setF] = useState({
    goal: profile?.goal || '',
    target_amount: profile?.target_amount != null ? String(profile.target_amount).replace('.', ',') : '',
    target_date: profile?.target_date || '',
    notes: profile?.notes || '',
  })
  const [saving, setSaving] = useState(false)
  const [msg, setMsg] = useState('')
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })

  const save = async (e) => {
    e.preventDefault()
    setSaving(true)
    setMsg('')
    const amount = f.target_amount ? Number(String(f.target_amount).replace(/\./g, '').replace(',', '.')) : null
    const row = {
      user_id: uid, goal: f.goal || null, target_amount: Number.isFinite(amount) ? amount : null,
      target_date: f.target_date || null, notes: f.notes.trim() || null, updated_at: new Date().toISOString(),
    }
    const { data, error } = await supabase.from('ai_profile').upsert(row).select().maybeSingle()
    setSaving(false)
    if (error) setMsg(error.message)
    else onSaved(data)
  }

  return (
    <form className="planner-body goals" onSubmit={save}>
      <p className="muted">O planejador usa isto para personalizar as dicas.</p>
      <label>Objetivo principal
        <select value={f.goal} onChange={set('goal')}>
          <option value="">Escolha…</option>
          {GOAL_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </label>
      <div className="row">
        <label>Meta (R$, opcional)<input inputMode="decimal" value={f.target_amount} onChange={set('target_amount')} placeholder="5.000,00" /></label>
        <label>Até quando (opcional)<input type="date" value={f.target_date} onChange={set('target_date')} /></label>
      </div>
      <label>Sobre você (opcional)
        <textarea rows={4} maxLength={1000} value={f.notes} onChange={set('notes')}
          placeholder="Ex.: renda varia com comissão; quero trocar de carro em 2028; tenho perfil conservador." />
      </label>
      {msg && <p className="hint neg">{msg}</p>}
      <div className="row end"><button className="btn primary" disabled={saving}>{saving ? 'Salvando…' : 'Salvar objetivos'}</button></div>
    </form>
  )
}

// Markdown mínimo e seguro (o texto é renderizado como texto, nunca como HTML):
// parágrafos, listas (- * 1.), títulos (#) e **negrito**.
function Markdown({ text }) {
  const blocks = []
  let list = null
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd()
    const item = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line)
    if (item) {
      const ordered = /^\s*\d/.test(line)
      if (!list || list.ordered !== ordered) { list = { type: 'list', ordered, items: [] }; blocks.push(list) }
      list.items.push(item[1])
      continue
    }
    list = null
    if (!line.trim()) continue
    const heading = /^#{1,6}\s+(.*)$/.exec(line)
    blocks.push(heading ? { type: 'h', text: heading[1] } : { type: 'p', text: line })
  }
  return blocks.map((b, i) => {
    if (b.type === 'list') {
      const Tag = b.ordered ? 'ol' : 'ul'
      return <Tag key={i}>{b.items.map((t, j) => <li key={j}><Inline text={t} /></li>)}</Tag>
    }
    if (b.type === 'h') return <p key={i} className="md-h"><Inline text={b.text} /></p>
    return <p key={i}><Inline text={b.text} /></p>
  })
}

function Inline({ text }) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? <b key={i}>{part.slice(2, -2)}</b> : part)
}
