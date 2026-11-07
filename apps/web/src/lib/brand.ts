import { useEffect, useSyncExternalStore } from 'react'
import { supabase } from './supabase'
import { applyPalette, PALETTES, type PaletteKey } from './preferences'
import { remember } from './remember'

// Identidad de la iglesia (logo, foto del templo y color): el panel se viste
// con ella para que se sienta de la iglesia y no de ChBook. Se carga una vez por
// sesión y se comparte entre pantallas; Ajustes la actualiza al guardar.

export interface Brand {
  churchId: string | null
  name: string | null
  logoUrl: string | null
  coverUrl: string | null
  palette: PaletteKey | null
}

const EMPTY: Brand = { churchId: null, name: null, logoUrl: null, coverUrl: null, palette: null }
let state: Brand = EMPTY
let loading: string | null = null
const listeners = new Set<() => void>()

const isPalette = (v: unknown): v is PaletteKey => PALETTES.some((p) => p.key === v)

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
  remember({ church: state.name, logo: state.logoUrl }) // para el próximo login
  listeners.forEach((l) => l())
}

async function loadBrand(churchId: string) {
  if (loading === churchId) return
  loading = churchId
  // '*' para no fallar si la base aún no tiene logo_url / cover_url.
  const { data } = await supabase.from('churches').select('*').eq('id', churchId).maybeSingle()
  if (!data) return
  const row = data as typeof data & { logo_url?: string | null; cover_url?: string | null }
  const palette = (data.settings as { palette?: unknown } | null)?.palette
  setBrand({
    churchId,
    name: row.name,
    logoUrl: row.logo_url ?? null,
    coverUrl: row.cover_url ?? null,
    palette: isPalette(palette) ? palette : null,
  })
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

// Sube el logo o la foto a church-assets/<iglesia>/ y guarda la URL en la iglesia.
export async function uploadChurchAsset(churchId: string, kind: 'logo' | 'cover', file: File): Promise<string | null> {
  if (!ASSET_TYPES.includes(file.type)) return 'Usa una imagen PNG, JPG, WebP o SVG.'
  const blob = await shrink(file, kind === 'logo' ? 512 : 1600)
  if (blob.size > ASSET_MAX_MB * 1024 * 1024) return `La imagen pesa más de ${ASSET_MAX_MB} MB.`
  const ext = blob.type === 'image/svg+xml' ? 'svg' : 'webp'
  const path = `${churchId}/${kind}-${Date.now()}.${ext}`
  const up = await supabase.storage.from('church-assets').upload(path, blob, { contentType: blob.type, cacheControl: '31536000' })
  if (up.error) return /bucket|not found/i.test(up.error.message) ? 'Falta aplicar la migración church_branding en Supabase.' : up.error.message
  const url = supabase.storage.from('church-assets').getPublicUrl(path).data.publicUrl
  const prev = kind === 'logo' ? state.logoUrl : state.coverUrl
  const { error } = await supabase.from('churches').update(kind === 'logo' ? { logo_url: url } : { cover_url: url }).eq('id', churchId)
  if (error) return error.message
  removeOld(prev)
  setBrand(kind === 'logo' ? { logoUrl: url } : { coverUrl: url })
  return null
}

export async function clearChurchAsset(churchId: string, kind: 'logo' | 'cover'): Promise<string | null> {
  const prev = kind === 'logo' ? state.logoUrl : state.coverUrl
  const { error } = await supabase.from('churches').update(kind === 'logo' ? { logo_url: null } : { cover_url: null }).eq('id', churchId)
  if (error) return error.message
  removeOld(prev)
  setBrand(kind === 'logo' ? { logoUrl: null } : { coverUrl: null })
  return null
}

// Borra el archivo anterior (si es de nuestro bucket); si falla, solo queda huérfano.
function removeOld(url: string | null) {
  const m = url?.match(/\/church-assets\/(.+)$/)
  if (m) supabase.storage.from('church-assets').remove([decodeURIComponent(m[1])])
}
