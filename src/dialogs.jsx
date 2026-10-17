import { useEffect, useState } from 'react'
import { Trash2, AlertTriangle, Undo2, X, Repeat, Wand2, CalendarPlus } from 'lucide-react'
import { brl, monthShort } from './calc.js'
import { fixedFromRow } from './plan.js'

const stop = (e) => e.stopPropagation()

export function useEsc(onClose) {
  useEffect(() => {
    const h = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
}

// Popup de confirmação no visual do app (substitui o confirm() do navegador).
// actions: [{ label, kind: 'danger' | 'primary' | '', onClick }]
export function ConfirmDialog({ tone = 'danger', icon, title, children, actions, onClose }) {
  useEsc(onClose)
  const Icon = icon || (tone === 'danger' ? Trash2 : AlertTriangle)
  return (
    <div className="overlay" onClick={onClose}>
      <div className="card modal dialog" role="alertdialog" aria-modal="true" aria-label={title} onClick={stop}>
        <div className={`dialog-icon ${tone}`}><Icon size={22} /></div>
        <h3>{title}</h3>
        {children && <div className="dialog-body">{children}</div>}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          {actions.map((a) => (
            <button key={a.label} type="button" className={`btn ${a.kind || ''}`} onClick={a.onClick}>{a.label}</button>
          ))}
        </div>
      </div>
    </div>
  )
}

// Aviso no rodapé com "Desfazer"; some sozinho depois de `ms`.
export function Toast({ text, onUndo, onClose, ms }) {
  return (
    <div className="toast" role="status">
      <span>{text}</span>
      <button className="toast-undo" onClick={onUndo}><Undo2 size={16} /> Desfazer</button>
      <button className="icon" onClick={onClose} aria-label="Fechar"><X size={16} /></button>
      <span className="toast-bar" style={{ animationDuration: `${ms}ms` }} />
    </div>
  )
}

export function MonthPicker({ initial, onPick, onClose }) {
  useEsc(onClose)
  const [m, setM] = useState(initial)
  return (
    <div className="overlay" onClick={onClose}>
      <form className="card modal dialog" onClick={stop} onSubmit={(e) => { e.preventDefault(); m && onPick(m) }}>
        <div className="dialog-icon info"><CalendarPlus size={22} /></div>
        <h3>Adicionar mês</h3>
        <label>Mês<input type="month" value={m} onChange={(e) => setM(e.target.value)} required autoFocus /></label>
        <p className="hint">Os gastos fixos ativos nesse mês entram automaticamente.</p>
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn primary">Adicionar</button>
        </div>
      </form>
    </div>
  )
}

// "Tornar fixo" num lançamento existente, com prévia do que será vinculado e criado.
export function MakeFixedDialog({ row, rows, onConfirm, onClose }) {
  useEsc(onClose)
  const [until, setUntil] = useState('')
  const start = row.date.slice(0, 7)
  const valid = !until || until >= start
  const prev = valid ? fixedFromRow(row, rows, until || null, 'preview') : null
  const created = prev ? prev.inserts.map((r) => r.recurrence_month) : []
  const span = (ms) => (ms.length > 2 ? `${monthShort(ms[0])} … ${monthShort(ms.at(-1))}` : ms.map(monthShort).join(', '))

  return (
    <div className="overlay" onClick={onClose}>
      <form className="card modal dialog" onClick={stop} onSubmit={(e) => { e.preventDefault(); valid && onConfirm(until || null) }}>
        <div className="dialog-icon info"><Repeat size={22} /></div>
        <h3>Tornar fixo</h3>
        <div className="dialog-body">
          <p><b>{row.description}</b><br />{brl(row.amount)} todo dia {Number(row.date.slice(8, 10))}, desde {monthShort(start)}</p>
        </div>
        <label>Até (opcional)<input type="month" value={until} min={start} onChange={(e) => setUntil(e.target.value)} /></label>
        {!valid && <p className="hint neg">O mês final precisa ser igual ou depois de {monthShort(start)}.</p>}
        {prev && (
          <p className="hint">
            {prev.linked.length > 0 && `Vai vincular ${prev.linked.length} já lançado(s) (${prev.linked.map((r) => monthShort(r.date.slice(0, 7))).join(', ')}). `}
            {created.length > 0 ? `Vai criar ${created.length} (${span(created)}).` : 'Nenhum mês novo a criar.'}
            {!until && ' Sem fim: cada mês novo criado no "+" também recebe.'}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn primary" disabled={!valid}>Tornar fixo</button>
        </div>
      </form>
    </div>
  )
}

// Painel dos gastos/receitas fixos: editar valor daqui para frente e encerrar.
export function FixosPanel({ recs, rows, today, onSaveAmount, onEnd, onConvert, onClose }) {
  useEsc(onClose)
  const [editing, setEditing] = useState(null) // { id, amount }
  const curMonth = today.slice(0, 7)
  const active = (r) => !r.end_month || r.end_month >= curMonth
  const sorted = [...recs].sort((a, b) => Number(active(b)) - Number(active(a)) || a.description.localeCompare(b.description))

  return (
    <div className="overlay" onClick={onClose}>
      <div className="card modal wide" onClick={stop}>
        <div className="card-head">
          <h3 className="brand"><Repeat size={18} /> Gastos fixos</h3>
          <button className="icon" onClick={onClose} aria-label="Fechar"><X size={18} /></button>
        </div>
        {sorted.length === 0 && <p className="muted">Nenhum fixo ainda. Marque "Repetir todo mês" ao criar um lançamento.</p>}
        <ul className="fixos">
          {sorted.map((r) => {
            const future = rows.filter((t) => t.recurrence_id === r.id && t.status === 'pending' && t.date >= today).length
            const on = active(r)
            return (
              <li key={r.id} className={on ? '' : 'ended'}>
                <div className="fx-main">
                  <b>{r.description}</b>
                  <span className="muted">
                    {r.type === 'income' ? 'Receita' : 'Despesa'} · dia {r.day} · desde {monthShort(r.start_month)}
                    {r.end_month ? ` até ${monthShort(r.end_month)}` : ' · sem fim'} · {future} pendente(s) à frente
                  </span>
                </div>
                {editing?.id === r.id ? (
                  <form className="fx-edit" onSubmit={(e) => { e.preventDefault(); onSaveAmount(r, editing.amount); setEditing(null) }}>
                    <input inputMode="decimal" value={editing.amount} autoFocus
                      onChange={(e) => setEditing({ ...editing, amount: e.target.value })} aria-label="Novo valor" />
                    <button className="btn primary sm">Salvar</button>
                    <button type="button" className="btn sm" onClick={() => setEditing(null)}>Cancelar</button>
                  </form>
                ) : (
                  <div className="fx-actions">
                    <span className={`fx-val ${r.type === 'income' ? 'pos' : 'neg'}`}>{brl(r.amount)}</span>
                    {on && <button className="btn sm" onClick={() => setEditing({ id: r.id, amount: String(r.amount).replace('.', ',') })}>Editar valor</button>}
                    {on ? <button className="btn sm danger-outline" onClick={() => onEnd(r)}>Encerrar</button> : <span className="badge">Encerrado</span>}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
        <p className="hint">"Editar valor" muda a regra e os lançamentos pendentes de hoje em diante. "Encerrar" apaga só os futuros pendentes.</p>
        <div className="row end">
          <button className="btn" onClick={onConvert}><Wand2 size={16} /> Converter parcelas existentes</button>
        </div>
      </div>
    </div>
  )
}

// Revisão do conversor: grupos N/M detectados + itens sem total para decidir.
export function ConvertModal({ conv, onApply, onClose }) {
  useEsc(onClose)
  const [groups, setGroups] = useState(() => Object.fromEntries(conv.groups.map((g) => [g.key, true])))
  const [loose, setLoose] = useState(() =>
    Object.fromEntries(conv.loose.map((l) => [l.key, { choice: 'ignore', n: String(Math.max(2, l.rows.length)), until: '' }])))
  const setL = (key, patch) => setLoose({ ...loose, [key]: { ...loose[key], ...patch } })

  const nothing = conv.groups.length === 0 && conv.loose.length === 0
  const invalid = conv.loose.some((l) => loose[l.key].choice === 'parcelas' && !(Number(loose[l.key].n) >= Math.max(2, l.rows.length)))

  const apply = () => onApply({
    groups: conv.groups.filter((g) => groups[g.key]),
    loose: conv.loose.filter((l) => loose[l.key].choice !== 'ignore').map((l) => ({ l, ...loose[l.key], n: Number(loose[l.key].n) })),
  })

  return (
    <div className="overlay" onClick={onClose}>
      <div className="card modal wide" onClick={stop}>
        <div className="card-head">
          <h3 className="brand"><Wand2 size={18} /> Converter parcelas existentes</h3>
          <button className="icon" onClick={onClose} aria-label="Fechar"><X size={18} /></button>
        </div>
        {nothing && <p className="muted">Nada para converter: todas as parcelas já estão vinculadas.</p>}

        {conv.groups.length > 0 && <>
          <h4>Parcelamentos detectados</h4>
          <ul className="conv">
            {conv.groups.map((g) => (
              <li key={g.key}>
                <label className="check">
                  <input type="checkbox" checked={groups[g.key]} onChange={(e) => setGroups({ ...groups, [g.key]: e.target.checked })} />
                  <span><b>{g.base}</b> <span className="badge">{g.total}x</span><br />
                    <span className="muted">
                      Tem {g.have.map((n) => `${n}/${g.total}`).join(', ')}
                      {g.inserts.length
                        ? ` → cria ${g.inserts.map((r) => `${r.installment_number}/${g.total}`).join(', ')} (até ${monthShort(g.inserts.at(-1).date.slice(0, 7))})`
                        : ' → só vincula, nada a criar'}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </>}

        {conv.loose.length > 0 && <>
          <h4>Sem número de parcelas</h4>
          <ul className="conv">
            {conv.loose.map((l) => {
              const s = loose[l.key]
              return (
                <li key={l.key}>
                  <div><b>{l.description}</b> <span className="muted">· {l.rows.length} lançamento(s), {brl(l.rows.at(-1).amount)} · {l.rows.map((r) => monthShort(r.date.slice(0, 7))).join(', ')}</span></div>
                  <div className="row wrap">
                    <select value={s.choice} onChange={(e) => setL(l.key, { choice: e.target.value })} aria-label="O que fazer">
                      <option value="ignore">Ignorar</option>
                      <option value="parcelas">Parcelado</option>
                      <option value="fixo">Tornar fixo (todo mês)</option>
                    </select>
                    {s.choice === 'parcelas' && (
                      <label className="inline">Total de parcelas
                        <input type="number" min={Math.max(2, l.rows.length)} max="120" value={s.n} onChange={(e) => setL(l.key, { n: e.target.value })} />
                      </label>
                    )}
                    {s.choice === 'fixo' && (
                      <label className="inline">Até (opcional)
                        <input type="month" value={s.until} onChange={(e) => setL(l.key, { until: e.target.value })} />
                      </label>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </>}

        <p className="hint">Só gera as parcelas que faltam depois da maior já lançada. Pode rodar de novo: nada é duplicado.</p>
        <div className="row end">
          <button className="btn" onClick={onClose}>Cancelar</button>
          <button className="btn primary" onClick={apply} disabled={nothing || invalid}>Converter</button>
        </div>
      </div>
    </div>
  )
}
