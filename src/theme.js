import { useEffect, useState } from 'react'

// Tema do app: 'auto' (segue o sistema), 'light' ou 'dark'. Preferência do aparelho.
// index.html aplica o tema salvo antes do React carregar, para não piscar.
const KEY = 'pf.theme'
export const THEMES = [['auto', 'Automático'], ['light', 'Claro'], ['dark', 'Escuro']]

export function getTheme() {
  try {
    const t = localStorage.getItem(KEY)
    return THEMES.some(([v]) => v === t) ? t : 'auto'
  } catch { return 'auto' }
}

export function setTheme(theme) {
  if (theme === 'auto') delete document.documentElement.dataset.theme
  else document.documentElement.dataset.theme = theme
  try { localStorage.setItem(KEY, theme) } catch { /* só não lembra a escolha */ }
  window.dispatchEvent(new Event('pf-theme'))
}

// Tema atual, sincronizado entre o botão do cabeçalho e as Configurações.
export function useTheme() {
  const [theme, setState] = useState(getTheme)
  useEffect(() => {
    const h = () => setState(getTheme())
    window.addEventListener('pf-theme', h)
    return () => window.removeEventListener('pf-theme', h)
  }, [])
  return [theme, setTheme]
}
