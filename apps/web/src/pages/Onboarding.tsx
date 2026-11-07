import { useMemo, useState, type FormEvent } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useAuth } from '../lib/auth-context'
import { supabase } from '../lib/supabase'
import MapPicker, { type Coords } from '../components/MapPicker'
import { PageLoading } from '../components/PageShell'
import { LogoMark } from '../components/Logo'
import InviteQR from '../components/InviteQR'
import { btnPrimary } from '../lib/ui'

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
  const [city, setCity] = useState('')
  const [denomination, setDenomination] = useState('')
  const [capacity, setCapacity] = useState('')
  const [members, setMembers] = useState('')
  const [coords, setCoords] = useState<Coords | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<{ name: string; code: string } | null>(null)

  const membersNum = Number(members) || 0
  const plan = useMemo(() => suggestPlan(membersNum), [membersNum])

  // Gate: si ya tiene iglesia, no debe estar aquí.
  if (membershipLoading) {
    return <PageLoading />
  }
  if (membership && !created) return <Navigate to="/" replace />

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    // REQ-05: la iglesia no se registra sin la ubicación del templo.
    if (!coords) {
      setError('Marca en el mapa dónde queda el templo: se usa para el Check-in de los miembros.')
      return
    }
    setSubmitting(true)
    setError(null)

    const { data, error } = await supabase.rpc('create_church_with_pastor', {
      p_name: name.trim(),
      p_pastor_name: pastorName.trim(),
      p_country: country,
      p_address: address.trim() || undefined,
      p_capacity: Number(capacity) || undefined,
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
    // Datos que la función de alta no recibe (REQ-04).
    if (data?.id && (city.trim() || denomination.trim())) {
      await supabase.from('churches').update({ city: city.trim() || null, denomination: denomination.trim() || null }).eq('id', data.id)
    }
    // Último paso (flujo #6): mostrar el código y el QR antes de entrar.
    if (data?.code) setCreated({ name: data.name, code: data.code })
    await refreshMembership()
    if (!data?.code) navigate('/', { replace: true })
  }

  if (created) {
    return (
      <div className="con-aura min-h-screen px-4 py-10">
        <div className="aura" aria-hidden />
        <div className="relative mx-auto max-w-2xl">
          <header className="subir mb-8 text-center">
            <p className="text-[0.7rem] font-semibold uppercase tracking-wider text-sage-dark">Iglesia creada</p>
            <h1 className="mt-2 font-serif text-3xl text-charcoal">Invita a tu gente</h1>
            <p className="mt-1 text-graysage">Imprime el QR y pégalo en el templo, o compártelo por WhatsApp.</p>
          </header>
          <section className="subir tarjeta p-6 sm:p-8">
            <InviteQR code={created.code} churchName={created.name} />
          </section>
          <div className="mt-6 text-center">
            <button type="button" onClick={() => navigate('/', { replace: true })} className={`${btnPrimary} px-6`}>
              Ir al Dashboard →
            </button>
            <p className="mt-3 text-sm text-graysage">Siempre lo encuentras en Ajustes.</p>
          </div>
        </div>
      </div>
    )
  }

  const inputCls =
    'w-full rounded-xl border border-clay-light bg-white px-3.5 py-2.5 text-base text-charcoal outline-none transition placeholder:text-faint focus:border-sage-dark focus:ring-4 focus:ring-sage-light'

  return (
    <div className="con-aura min-h-screen px-4 py-10">
      <div className="aura" aria-hidden />
      <div className="relative mx-auto max-w-lg">
        <header className="subir mb-8 flex flex-col items-center text-center">
          <LogoMark size={56} draw className="mb-5" />
          <h1 className="font-serif text-3xl text-charcoal">Registra tu iglesia</h1>
          <p className="mt-1 text-graysage">
            Unos datos y quedas listo para empezar.
            {user?.email && (
              <span className="block font-mono text-xs text-graysage/70">{user.email}</span>
            )}
          </p>
        </header>

        <form
          onSubmit={handleSubmit}
          className="tarjeta subir space-y-5 p-5 sm:p-7"
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

          <div>
            <label className="mb-1 block text-sm font-medium text-graysage" htmlFor="denomination">
              Denominación <span className="text-graysage/60">(opcional)</span>
            </label>
            <input id="denomination" value={denomination} onChange={(e) => setDenomination(e.target.value)} className={inputCls} placeholder="Ej. Bautista, Pentecostal, independiente" />
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
              <label className="mb-1 block text-sm font-medium text-graysage" htmlFor="city">
                Ciudad
              </label>
              <input id="city" value={city} onChange={(e) => setCity(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-graysage" htmlFor="capacity">
                Capacidad del templo
              </label>
              <input id="capacity" type="number" min={0} value={capacity} onChange={(e) => setCapacity(e.target.value)} className={inputCls} placeholder="Sillas, ej. 120" />
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
          <div className="rounded-lg border border-graysage/20 bg-cream p-3">
            <p className="mb-2 text-sm font-medium text-graysage">Ubicación del auditorio</p>
            <MapPicker value={coords} onChange={setCoords} />
          </div>

          {/* Plan sugerido */}
          <div className="rounded-lg bg-sage-water/10 px-3 py-2 text-sm text-sage-dark">
            Plan sugerido: <span className="font-medium">{plan.label}</span>
          </div>

          {error && (
            <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>
          )}

          <button
            type="submit"
            disabled={submitting}
            className={`${btnPrimary} w-full`}
          >
            {submitting ? 'Creando…' : 'Crear iglesia'}
          </button>
        </form>
      </div>
    </div>
  )
}
