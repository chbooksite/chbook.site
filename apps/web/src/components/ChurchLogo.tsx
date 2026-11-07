import type { LogoStyle } from '../lib/brand'

// Logo de la iglesia en cualquier tamaño. Si trae su propio fondo ('full') se
// recorta con esquinas redondeadas, sin marco; si es transparente va sobre una
// placa clara para que se lea sobre el verde.
export default function ChurchLogo({ src, style, size, round = false, className = '' }: { src: string; style: LogoStyle; size: number; round?: boolean; className?: string }) {
  const radius = round ? '9999px' : `${Math.round(size * 0.24)}px`
  return style === 'full' ? (
    <img src={src} alt="" width={size} height={size} className={`shrink-0 object-cover ${className}`} style={{ width: size, height: size, borderRadius: radius }} />
  ) : (
    <span className={`flex shrink-0 items-center justify-center bg-white ${className}`} style={{ width: size, height: size, borderRadius: radius, padding: Math.max(2, Math.round(size * 0.1)) }}>
      <img src={src} alt="" className="h-full w-full object-contain" />
    </span>
  )
}
