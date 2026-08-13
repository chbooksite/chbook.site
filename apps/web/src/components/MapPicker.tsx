import { useEffect, useState, type FormEvent } from 'react'
import { MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'

// Fix de iconos de Leaflet con bundlers (Vite): apuntar a los assets importados.
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
})

export interface Coords {
  lat: number
  lng: number
}

interface Props {
  value: Coords | null
  onChange: (c: Coords) => void
}

// Vista amplia de Latinoamérica como punto de partida si no hay ubicación.
const DEFAULT_CENTER: [number, number] = [4.6097, -74.0817]
const DEFAULT_ZOOM = 4

// Mueve el mapa cuando cambia el objetivo (búsqueda o "mi ubicación"),
// sin recentrar al arrastrar el pin.
function FlyTo({ target }: { target: Coords | null }) {
  const map = useMap()
  useEffect(() => {
    if (target) map.setView([target.lat, target.lng], 17)
  }, [target, map])
  return null
}

// Al hacer clic en el mapa, coloca el pin ahí.
function ClickToPlace({ onChange }: { onChange: (c: Coords) => void }) {
  useMapEvents({
    click(e) {
      onChange({ lat: e.latlng.lat, lng: e.latlng.lng })
    },
  })
  return null
}

export default function MapPicker({ value, onChange }: Props) {
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [flyTarget, setFlyTarget] = useState<Coords | null>(null)
  const [gps, setGps] = useState<'idle' | 'loading' | 'error'>('idle')
  const [searchError, setSearchError] = useState<string | null>(null)

  const setLocation = (c: Coords) => {
    onChange(c)
    setFlyTarget(c)
  }

  const handleSearch = async (e: FormEvent) => {
    e.preventDefault()
    if (!query.trim()) return
    setSearching(true)
    setSearchError(null)
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`,
      )
      const data: Array<{ lat: string; lon: string }> = await res.json()
      if (data[0]) {
        setLocation({ lat: Number(data[0].lat), lng: Number(data[0].lon) })
      } else {
        setSearchError('No se encontró esa dirección. Ajusta el pin manualmente.')
      }
    } catch {
      setSearchError('No se pudo buscar. Ajusta el pin manualmente.')
    } finally {
      setSearching(false)
    }
  }

  const useMyLocation = () => {
    if (!navigator.geolocation) {
      setGps('error')
      return
    }
    setGps('loading')
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude })
        setGps('idle')
      },
      () => setGps('error'),
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  return (
    <div className="space-y-2">
      <form onSubmit={handleSearch} className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Busca la dirección del templo…"
          className="w-full rounded-lg border border-graysage/25 bg-cream/40 px-3 py-2 text-sm text-charcoal outline-none focus:border-sage focus:ring-2 focus:ring-sage/20"
        />
        <button
          type="submit"
          disabled={searching}
          className="shrink-0 rounded-lg bg-sage px-3 py-2 text-sm font-medium text-cream transition hover:bg-sage-dark disabled:opacity-60"
        >
          {searching ? '…' : 'Buscar'}
        </button>
      </form>

      <div className="overflow-hidden rounded-lg border border-graysage/20">
        <MapContainer
          center={value ? [value.lat, value.lng] : DEFAULT_CENTER}
          zoom={value ? 17 : DEFAULT_ZOOM}
          style={{ height: '260px', width: '100%' }}
        >
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <ClickToPlace onChange={onChange} />
          <FlyTo target={flyTarget} />
          {value && (
            <Marker
              position={[value.lat, value.lng]}
              draggable
              eventHandlers={{
                dragend(e) {
                  const m = e.target as L.Marker
                  const p = m.getLatLng()
                  onChange({ lat: p.lat, lng: p.lng })
                },
              }}
            />
          )}
        </MapContainer>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <button
          type="button"
          onClick={useMyLocation}
          className="rounded-lg border border-sage/40 px-2.5 py-1 text-sage-dark transition hover:bg-sage/10"
        >
          {gps === 'loading' ? 'Obteniendo…' : '📍 Usar mi ubicación'}
        </button>
        {value ? (
          <span className="font-mono text-sage-dark">
            {value.lat.toFixed(5)}, {value.lng.toFixed(5)} ✓
          </span>
        ) : (
          <span className="text-graysage/70">Toca el mapa o busca la dirección para fijar el pin.</span>
        )}
      </div>

      {gps === 'error' && (
        <p className="text-xs text-clay">No se pudo obtener tu ubicación. Usa la búsqueda o toca el mapa.</p>
      )}
      {searchError && <p className="text-xs text-clay">{searchError}</p>}
      <p className="text-[0.7rem] leading-snug text-graysage/70">
        Arrastra el pin para ajustarlo al punto exacto del auditorio. En computadora la ubicación
        automática puede estar a ~200 m; el mapa te deja precisarla.
      </p>
    </div>
  )
}
