import { useEffect, useSyncExternalStore } from 'react'
import { supabase } from './supabase'
import { applyPalette, PALETTES, type PaletteKey } from './preferences'
import { remember } from './remember'

// Identidad de la iglesia (logo, foto del templo y color): el panel se viste
// con ella para que se sienta de la iglesia y no de ChBook. Se carga una vez por
// sesión y se comparte entre pantallas; Ajustes la actualiza al guardar.
//
// En churches.settings se guardan, además de la paleta:
//   logo_style  'full' (el logo trae su propio fondo → se recorta, sin marco)
//               | 'transparent' (va sobre una placa clara)
//   logo_color  color principal del logo (para sugerir la paleta)
//   cover_focus { x, y } en %: qué parte de la foto del templo se ve

export type LogoStyle = 'full' | 'transparent'
export interface Focus { x: number; y: number }

export interface Brand {
  churchId: string | null
  name: string | null
  logoUrl: string | null
  logoStyle: LogoStyle
  logoColor: string | null
  coverUrl: string | null
  coverFocus: Focus
  palette: PaletteKey | null
}

export const CENTER: Focus = { x: 50, y: 50 }
const EMPTY: Brand = { churchId: null, name: null, logoUrl: null, logoStyle: 'transparent', logoColor: null, coverUrl: null, coverFocus: CENTER, palette: null }
let state: Brand = EMPTY
let loading: string | null = null
const listeners = new Set<() => void>()

const isPalette = (v: unknown): v is PaletteKey => PALETTES.some((p) => p.key === v)
const readFocus = (v: unknown): Focus => {
  const f = v as Partial<Focus> | null
  return f && Number.isFinite(f.x) && Number.isFinite(f.y) ? { x: f.x!, y: f.y! } : CENTER
}

// Pestaña del navegador con el logo y el nombre de la iglesia.
function applyChrome(b: Brand) {
  document.title = b.name ? `${b.name} · ChBook` : 'ChBook'
  const link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (link) {
    link.dataset.chbook ??= link.href
    link.href = b.logoUrl ?? link.dataset.chbook
  }
}

export function setBrand(patch: Partial<Brand>) {
  state = { ...state, ...patch }
  if ('palette' in patch) applyPalette(state.palette ?? 'salvia')
  applyChrome(state)
  remember({ church: state.name, logo: state.logoUrl, logoStyle: state.logoStyle }) // para el próximo login
  listeners.forEach((l) => l())
}

async function loadBrand(churchId: string) {
  if (loading === churchId) return
  loading = churchId
  // '*' para no fallar si la base aún no tiene logo_url / cover_url.
  const { data } = await supabase.from('churches').select('*').eq('id', churchId).maybeSingle()
  if (!data) return
  const row = data as typeof data & { logo_url?: string | null; cover_url?: string | null }
  const s = (data.settings ?? {}) as { palette?: unknown; logo_style?: unknown; logo_color?: unknown; cover_focus?: unknown }
  const known = s.logo_style === 'full' || s.logo_style === 'transparent'
  setBrand({
    churchId,
    name: row.name,
    logoUrl: row.logo_url ?? null,
    logoStyle: known ? (s.logo_style as LogoStyle) : 'transparent',
    logoColor: typeof s.logo_color === 'string' ? s.logo_color : null,
    coverUrl: row.cover_url ?? null,
    coverFocus: readFocus(s.cover_focus),
    palette: isPalette(s.palette) ? s.palette : null,
  })
  // Logos subidos antes de que existiera el análisis: se analizan aquí (sin guardar).
  if (row.logo_url && !known) {
    const a = await analyzeLogo(row.logo_url).catch(() => null)
    if (a && state.logoUrl === row.logo_url) setBrand({ logoStyle: a.style, logoColor: state.logoColor ?? a.color })
  }
}

export function useBrand(churchId: string | null | undefined): Brand {
  const b = useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
  )
  useEffect(() => {
    if (churchId && state.churchId !== churchId) loadBrand(churchId)
  }, [churchId])
  return b
}

// ---- Análisis del logo ----

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => res(img)
    img.onerror = rej
    img.src = src
  })
}

const toHex = (r: number, g: number, b: number) => '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')

// ¿El logo trae su propio fondo (bordes opacos) o es transparente? Y su color
// principal: el promedio de los píxeles con color (sin blancos, negros ni grises).
export async function analyzeLogo(src: string): Promise<{ style: LogoStyle; color: string | null }> {
  const img = await loadImage(src)
  const N = 48
  const c = document.createElement('canvas')
  c.width = c.height = N
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.drawImage(img, 0, 0, N, N)
  const d = ctx.getImageData(0, 0, N, N).data
  let edge = 0, edgeOpaque = 0
  let r = 0, g = 0, b = 0, w = 0
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const i = (y * N + x) * 4
      const a = d[i + 3] / 255
      // Borde: un anillo de 3 px, sin contar las esquinas (los logos redondeados las dejan vacías).
      const ring = x < 3 || y < 3 || x >= N - 3 || y >= N - 3
      const corner = (x < 8 || x >= N - 8) && (y < 8 || y >= N - 8)
      if (ring && !corner) { edge++; if (a > 0.9) edgeOpaque++ }
      if (a < 0.5) continue
      const mx = Math.max(d[i], d[i + 1], d[i + 2]), mn = Math.min(d[i], d[i + 1], d[i + 2])
      const sat = mx ? (mx - mn) / mx : 0
      if (sat < 0.2 || mx < 40 || mn > 235) continue
      const k = sat * a
      r += d[i] * k; g += d[i + 1] * k; b += d[i + 2] * k; w += k
    }
  }
  return { style: edgeOpaque / edge > 0.85 ? 'full' : 'transparent', color: w > 4 ? toHex(r / w, g / w, b / w) : null }
}

// Paleta más cercana al color del logo (por tono). Sin color claro → Pizarra.
// Si el tono queda lejos de todas (p. ej. un rojo), no hay sugerencia.
const PALETTE_HUE: [PaletteKey, number][] = [['bosque', 150], ['salvia', 166], ['eucalipto', 178], ['petroleo', 197], ['oliva', 82]]
export function suggestPalette(hex: string | null): PaletteKey | null {
  if (!hex) return 'pizarra'
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), dl = mx - mn
  if (mx === 0 || dl / mx < 0.18) return 'pizarra'
  let h = mx === r ? ((g - b) / dl) % 6 : mx === g ? (b - r) / dl + 2 : (r - g) / dl + 4
  h = (h * 60 + 360) % 360
  let best: PaletteKey | null = null, dist = 999
  for (const [k, ph] of PALETTE_HUE) {
    const dd = Math.min(Math.abs(h - ph), 360 - Math.abs(h - ph))
    if (dd < dist) { dist = dd; best = k }
  }
  return dist <= 35 ? best : null
}

// ---- Subida de imágenes (Ajustes → Identidad) ----

export const ASSET_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
export const ASSET_MAX_MB = 2

// Achica la imagen en el navegador antes de subirla (los SVG van tal cual).
async function shrink(file: File, max: number): Promise<Blob> {
  if (file.type === 'image/svg+xml') return file
  const img = await createImageBitmap(file)
  const k = Math.min(1, max / Math.max(img.width, img.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(img.width * k)
  canvas.height = Math.round(img.height * k)
  canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
  return new Promise((res) => canvas.toBlob((b) => res(b ?? file), 'image/webp', 0.88))
}

// Lo que el logo nuevo aporta a settings (estilo y color), para que Ajustes lo guarde.
export type LogoInfo = { logo_style: LogoStyle; logo_color: string | null }

// Sube el logo o la foto a church-assets/<iglesia>/ y guarda la URL en la iglesia.
export async function uploadChurchAsset(churchId: string, kind: 'logo' | 'cover', file: File): Promise<{ error: string | null; logo?: LogoInfo }> {
  if (!ASSET_TYPES.includes(file.type)) return { error: 'Usa una imagen PNG, JPG, WebP o SVG.' }
  const blob = await shrink(file, kind === 'logo' ? 512 : 1600)
  if (blob.size > ASSET_MAX_MB * 1024 * 1024) return { error: `La imagen pesa más de ${ASSET_MAX_MB} MB.` }
  let info: LogoInfo | undefined
  if (kind === 'logo') {
    const local = URL.createObjectURL(blob)
    const a = await analyzeLogo(local).catch(() => null)
    URL.revokeObjectURL(local)
    info = { logo_style: a?.style ?? 'transparent', logo_color: a?.color ?? null }
  }
  const ext = blob.type === 'image/svg+xml' ? 'svg' : 'webp'
  const path = `${churchId}/${kind}-${Date.now()}.${ext}`
  const up = await supabase.storage.from('church-assets').upload(path, blob, { contentType: blob.type, cacheControl: '31536000' })
  if (up.error) return { error: /bucket|not found/i.test(up.error.message) ? 'Falta aplicar la migración church_branding en Supabase.' : up.error.message }
  const url = supabase.storage.from('church-assets').getPublicUrl(path).data.publicUrl
  const prev = kind === 'logo' ? state.logoUrl : state.coverUrl
  const { error } = await supabase.from('churches').update(kind === 'logo' ? { logo_url: url } : { cover_url: url }).eq('id', churchId)
  if (error) return { error: error.message }
  removeOld(prev)
  setBrand(kind === 'logo' ? { logoUrl: url, logoStyle: info!.logo_style, logoColor: info!.logo_color } : { coverUrl: url, coverFocus: CENTER })
  return { error: null, logo: info }
}

export async function clearChurchAsset(churchId: string, kind: 'logo' | 'cover'): Promise<string | null> {
  const prev = kind === 'logo' ? state.logoUrl : state.coverUrl
  const { error } = await supabase.from('churches').update(kind === 'logo' ? { logo_url: null } : { cover_url: null }).eq('id', churchId)
  if (error) return error.message
  removeOld(prev)
  setBrand(kind === 'logo' ? { logoUrl: null, logoColor: null } : { coverUrl: null, coverFocus: CENTER })
  return null
}

// Borra el archivo anterior (si es de nuestro bucket); si falla, solo queda huérfano.
function removeOld(url: string | null) {
  const m = url?.match(/\/church-assets\/(.+)$/)
  if (m) supabase.storage.from('church-assets').remove([decodeURIComponent(m[1])])
}
