// Logo de Chbook. Monograma reconstruido en SVG a partir de las referencias:
// una "C" ligada a una "h" de doble arco (tipo "m" con el primer trazo alto) y una
// cruz latina arriba a la derecha. Se dibuja con currentColor, así el color se
// controla por clase (gris de marca por defecto; dorado sobre fondos oscuros).

export function LogoMark({ size = 40, className = '', badge = true }: { size?: number; className?: string; badge?: boolean }) {
  const svg = (
    <svg
      viewBox="0 0 124 104"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ width: badge ? size * 0.68 : size, height: 'auto' }}
    >
      {/* C */}
      <path d="M48 42 A24 24 0 1 0 48 82" strokeWidth={13} />
      {/* asta alta rematada en cruz (vertical de la cruz = asta) */}
      <path d="M58 12 L58 92" strokeWidth={13} />
      <path d="M45 27 L71 27" strokeWidth={10} />
      {/* primer arco + asta */}
      <path d="M58 54 C58 40 82 40 82 54 L82 92" strokeWidth={13} />
      {/* segundo arco + asta */}
      <path d="M82 54 C82 40 106 40 106 54 L106 92" strokeWidth={13} />
    </svg>
  )
  if (!badge) return <span className={`inline-flex text-graysage ${className}`}>{svg}</span>
  return (
    <div
      className={`flex shrink-0 items-center justify-center bg-sage text-graysage ${className}`}
      style={{ width: size, height: size, borderRadius: size * 0.28 }}
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
        <span className={`font-serif font-semibold tracking-tight ${onDark ? 'text-white' : 'text-graysage'}`} style={{ fontSize: size * 0.45 }}>
          Chbook
        </span>
      )}
    </div>
  )
}
