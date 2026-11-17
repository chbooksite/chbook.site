import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

// Callout de INSIGHT: una lectura interpretada de los datos (no un dato crudo),
// con una ACCIÓN opcional (enlace a otra vista o acción en la propia página).
// tone: good (positivo) · warn (atención) · info (neutro).
export default function Insight({ tone = 'info', children, action }: {
  tone?: 'info' | 'good' | 'warn'
  children: ReactNode
  action?: { label: string; to?: string; onClick?: () => void }
}) {
  const cls = tone === 'good'
    ? 'bg-sage-light/70 text-sage-dark'
    : tone === 'warn'
      ? 'bg-clay/12 text-clay'
      : 'bg-white text-charcoal ring-1 ring-black/5'
  const linkCls = 'shrink-0 self-center whitespace-nowrap text-sm font-semibold underline-offset-2 hover:underline'
  return (
    <div className={`flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-sm ${cls}`}>
      <svg viewBox="0 0 24 24" className="mt-0.5 h-4 w-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.4c.6.5 1 1.2 1 2v.6h6v-.6c0-.8.4-1.5 1-2A6 6 0 0 0 12 3Z" />
      </svg>
      <span className="flex-1">{children}</span>
      {action && (action.to
        ? <Link to={action.to} className={linkCls}>{action.label} →</Link>
        : <button type="button" onClick={action.onClick} className={linkCls}>{action.label} →</button>)}
    </div>
  )
}
