// Logo de ChBook: "Ch" con la cruz sobre el asta de la h, versión monolínea
// (Propuesta 1 del paquete de logos): trazos redondeados, en dorado plano.
// Se dibuja con currentColor; la insignia es la del app icon: fondo #1C1C1E
// con letras en dorado mate.

const VIEW_W = 348 // ancho del viewBox

// `draw`: el monograma se traza al montarse (ver .logo-trazo en index.css).
export function LogoMark({ size = 40, className = '', badge = true, draw = false }: { size?: number; className?: string; badge?: boolean; draw?: boolean }) {
  const width = badge ? size * 0.7 : size
  // Monolínea de 18 unidades; en tamaños chicos se engrosa para no bajar de ~2px.
  const stroke = Math.max(18, (2.2 * VIEW_W) / width)
  const svg = (
    <svg
      viewBox="6 8 348 304"
      fill="none"
      stroke="currentColor"
      strokeWidth={stroke}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={draw ? 'logo-trazo' : undefined}
      style={{ width, height: 'auto' }}
    >
      <path d="M204.2,132.6 A93,93 0 1 0 204.2,239.4" pathLength={1} />
      <path d="M228,300 L228,116" pathLength={1} />
      <path d="M228,182 C228,150 249,126 276,126 C303,126 324,150 324,182 L324,300" pathLength={1} />
      <path d="M228,116 L228,24" pathLength={1} />
      <path d="M200,52 L256,52" pathLength={1} />
    </svg>
  )
  // Sin insignia: el color lo pone quien lo usa (text-charcoal, text-gold…).
  if (!badge) return <span className={`inline-flex ${className || 'text-charcoal'}`}>{svg}</span>
  return (
    <div
      className={`flex shrink-0 items-center justify-center bg-ink text-gold ${className}`}
      style={{ width: size, height: size, borderRadius: size * 0.24 }}
      aria-hidden
    >
      {svg}
    </div>
  )
}

export default function Logo({ size = 38, showName = true, onDark = false }: { size?: number; showName?: boolean; onDark?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark size={size} />
      {showName && (
        <span className={`font-sans font-semibold tracking-tight ${onDark ? 'text-cream' : 'text-charcoal'}`} style={{ fontSize: size * 0.46 }}>
          ChBook
        </span>
      )}
    </div>
  )
}
