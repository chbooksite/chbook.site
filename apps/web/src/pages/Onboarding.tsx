import { useMemo, useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth-context'
import { supabase } from '../lib/supabase'
import MapPicker, { type Coords } from '../components/MapPicker'

const COUNTRIES = ['Colombia', 'Venezuela', 'México', 'USA/Europa', 'Otro']

function suggestPlan(members: number): { key: string; label: string } {
  if (members <= 100) return { key: 'semilla', label: 'Semilla · hasta 100 miembros' }
  if (members <= 500) return { key: 'crecimiento', label: 'Crecimiento · hasta 500 miembros' }
  return { key: 'iglesia_mayor', label: 'Iglesia Mayor · hasta 2.000 miembros' }
}

export default function Onboarding() {
  const { membership, membershipLoading, refreshMembership, user } = useAuth()
  const navigate = useNavigate()

  const [name, setName] = useState('')
  const [pastorName, setPastorName] = useState('')
  const [country, setCountry] = useState(COUNTRIES[0])
  const [address, setAddress] = useState('')
  const [members, setMembers] = useState('')
  const [coords, setCoords] = useState<Coords | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const membersNum = Number(members) || 0
  const plan = useMemo(() => suggestPlan(membersNum), [membersNum])

  // Gate: si ya tiene iglesia, no debe estar aquí.
  if (membershipLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cream">
        <p className="font-mono text-sm text-graysage">Cargando…</p>
      </div>
    )
  }
  if (membership) return <Navigate to="/" replace />

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError(null)

    const { error } = await supabase.rpc('create_church_with_pastor', {
      p_name: name.trim(),
      p_pastor_name: pastorName.trim(),
      p_country: country,
      p_address: address.trim() || undefined,
      p_capacity: membersNum || undefined,
      p_lat: coords?.lat,
      p_lng: coords?.lng,
    })

    setSubmitting(false)

    if (error) {
      // La iglesia pudo crearse aunque la respuesta se perdiera en la red
      // ("0 B transferred"). Revalidamos la membresía: si ya existe, el gate
      // de esta página redirige solo al dashboard.
      await refreshMembership()
      setError(
        'No llegó la confirmación del servidor. Si tu iglesia ya aparece te ' +
          'llevaremos al panel; si no, intenta de nuevo en un momento.',
      )
      return
    }
    await refreshMembership()
    navigate('/', { replace: true })
  }

  const inputCls =
    'w-full rounded-lg border border-graysage/25 bg-cream/40 px-3 py-2 text-charcoal outline-none focus:border-sage focus:ring-2 focus:ring-sage/20'

  return (
    <div className="min-h-screen bg-cream px-4 py-10">
      <div className="mx-auto max-w-lg">
        <header className="mb-8 text-center">
          <h1 className="font-serif text-2xl text-sage-dark">Registra tu iglesia</h1>
          <p className="mt-1 text-sm text-graysage">
            Unos datos y quedas listo para empezar.
            {user?.email && (
              <span className="block font-mono text-xs text-graysage/70">{user.email}</span>
            )}
          </p>
        </header>

        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-2xl border border-clay-light/40 bg-white p-6 shadow-sm"
        >
          <div>
            <label className="mb-1 block text-sm font-medium text-graysage" htmlFor="name">
              Nombre de la iglesia
            </label>
            <input id="name" required value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-graysage" htmlFor="pastor">
              Nombre del pastor
            </label>
            <input id="pastor" required value={pastorName} onChange={(e) => setPastorName(e.target.value)} className={inputCls} />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-graysage" htmlFor="country">
                País
              </label>
              <select id="country" value={country} onChange={(e) => setCountry(e.target.value)} className={inputCls}>
                {COUNTRIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-graysage" htmlFor="members">
                Nº de miembros (estimado)
              </label>
              <input
                id="members"
                type="number"
                min={0}
                value={members}
                onChange={(e) => setMembers(e.target.value)}
                className={inputCls}
                placeholder="Ej. 80"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-graysage" htmlFor="address">
              Dirección <span className="text-graysage/60">(opcional)</span>
            </label>
            <input id="address" value={address} onChange={(e) => setAddress(e.target.value)} className={inputCls} />
          </div>

          {/* GPS del auditorio */}
          <div className="rounded-lg border border-graysage/20 bg-cream/40 p-3">
            <p className="mb-2 text-sm font-medium text-graysage">Ubicación del auditorio</p>
            <MapPicker value={coords} onChange={setCoords} />
          </div>

          {/* Plan sugerido */}
          <div className="rounded-lg bg-sage-water/10 px-3 py-2 text-sm text-sage-dark">
            Plan sugerido: <span className="font-medium">{plan.label}</span>
          </div>

          {error && (
            <p className="rounded-lg bg-clay/10 px-3 py-2 text-sm text-clay">{error}</p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-sage-dark px-4 py-2.5 font-medium text-cream transition hover:bg-sage disabled:opacity-60"
          >
            {submitting ? 'Creando…' : 'Crear iglesia'}
          </button>
        </form>
      </div>
    </div>
  )
}
