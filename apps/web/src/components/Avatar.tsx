// Avatar de persona: inicial(es) sobre un color estable derivado del nombre.
// En una app de cuidado pastoral, cada miembro debe "tener cara".

// Solo tonos de la paleta oficial (sage y marrón): nada de arcoíris.
const PALETTE = ['var(--sage-dark)', 'var(--sage)', 'var(--sage-water)', '#8B6F47', '#B8956A']

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  const first = parts[0].charAt(0)
  const last = parts.length > 1 ? parts[parts.length - 1].charAt(0) : ''
  return (first + last).toUpperCase()
}

function colorFor(name: string): string {
  let h = 0
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return PALETTE[h % PALETTE.length]
}

export default function Avatar({ name, size = 40, className = '' }: { name: string; size?: number; className?: string }) {
  const c = colorFor(name)
  return (
    <span
      className={`inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.38, backgroundColor: `color-mix(in srgb, ${c} 12%, transparent)`, color: c, boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${c} 20%, transparent)` }}
      aria-hidden
    >
      {initials(name)}
    </span>
  )
}
