// Utilidades para el punto geográfico (geography) que Supabase devuelve como
// WKB en hexadecimal y acepta como WKT al escribir.

// Decodifica un punto WKB/EWKB hex → { lat, lng }. Soporta con y sin SRID.
export function parseWkbPoint(hex: string | null | undefined): { lat: number; lng: number } | null {
  if (!hex || hex.length < 42) return null
  try {
    const bytes = new Uint8Array(hex.length / 2)
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16)
    const dv = new DataView(bytes.buffer)
    const little = bytes[0] === 1
    const type = dv.getUint32(1, little)
    const hasSrid = (type & 0x20000000) !== 0
    const off = hasSrid ? 9 : 5 // salta byte-order(1) + tipo(4) [+ srid(4)]
    const lng = dv.getFloat64(off, little)
    const lat = dv.getFloat64(off + 8, little)
    if (Number.isNaN(lat) || Number.isNaN(lng)) return null
    return { lat, lng }
  } catch {
    return null
  }
}

// Codifica lat/lng → WKT que PostgREST castea a geography.
export function toWktPoint(lat: number, lng: number): string {
  return `SRID=4326;POINT(${lng} ${lat})`
}
