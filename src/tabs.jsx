import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { monthShort } from './calc.js'
import { visibleMonths } from './plan.js'

const LIMITS = [[3, '3 meses à frente'], [6, '6 meses à frente'], [12, '12 meses à frente'], [0, 'Todos os meses']]
const key = (uid) => `pf.tabLimit:${uid}`

// Preferência do aparelho, por conta; sem localStorage (aba anônima etc.) usa o padrão.
const readLimit = (uid) => {
  try {
    const v = localStorage.getItem(key(uid))
    return v !== null && LIMITS.some(([n]) => String(n) === v) ? Number(v) : 6
  } catch { return 6 }
}

export function MonthTabs({ uid, months, month, curMonth, onSelect, onAdd }) {
  const [limit, setLimit] = useState(() => readLimit(uid))
  const [expanded, setExpanded] = useState(false)
  const [edges, setEdges] = useState({ left: false, right: false })
  const ref = useRef(null)
  const { shown, hidden } = visibleMonths(months, curMonth, expanded ? 0 : limit, month)

  const changeLimit = (v) => {
    setLimit(v)
    setExpanded(false)
    try { localStorage.setItem(key(uid), String(v)) } catch { /* só não lembra a escolha */ }
  }

  // Quais bordas ainda têm conteúdo para rolar (setas e esmaecimento).
  const update = useCallback(() => {
    const el = ref.current
    if (!el) return
    setEdges({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 })
  }, [])
  useEffect(() => {
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [update, shown.length])

  useEffect(() => {
    const el = ref.current
    const tab = el?.querySelector('.tab.active')
    if (tab) el.scrollTo({ left: tab.offsetLeft - (el.clientWidth - tab.offsetWidth) / 2, behavior: 'smooth' })
  }, [month, shown.length])

  const scroll = (dir) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.7, behavior: 'smooth' })

  return (
    <div className="tabbar">
      <div className={`tabs-wrap${edges.left ? ' fade-left' : ''}${edges.right ? ' fade-right' : ''}`}>
        {edges.left && <button className="tab-arrow left" onClick={() => scroll(-1)} aria-label="Ver meses anteriores"><ChevronLeft size={18} /></button>}
        <nav className="tabs" ref={ref} onScroll={update}>
          {shown.map((m) => (
            <button key={m} className={`tab${m === month ? ' active' : ''}${m === curMonth ? ' current' : ''}`}
              onClick={() => onSelect(m)} title={m === curMonth ? 'Mês atual' : undefined}>{monthShort(m)}</button>
          ))}
          {hidden > 0 && (
            <button className="tab more" onClick={() => setExpanded(true)} title="Mostrar os meses escondidos">
              +{hidden} {hidden === 1 ? 'mês' : 'meses'}
            </button>
          )}
          {expanded && limit > 0 && <button className="tab more" onClick={() => setExpanded(false)}>Mostrar menos</button>}
          <button className="tab add" onClick={onAdd} title="Adicionar mês" aria-label="Adicionar mês"><Plus size={16} /></button>
        </nav>
        {edges.right && <button className="tab-arrow right" onClick={() => scroll(1)} aria-label="Ver próximos meses"><ChevronRight size={18} /></button>}
      </div>
      <select className="tab-limit" value={limit} onChange={(e) => changeLimit(Number(e.target.value))} aria-label="Quantos meses à frente mostrar nas abas">
        {LIMITS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
      </select>
    </div>
  )
}
