import { NavLink } from 'react-router-dom'
import { useAuth } from '../lib/auth-context'
import Logo from './Logo'

// Encabezado con navegación, compartido por las páginas protegidas.
// `dark`: variante sobre fondo oscuro (p. ej. el hero del Panel).
export default function AppHeader({ dark = false }: { dark?: boolean }) {
  const { user, signOut } = useAuth()

  const linkCls = ({ isActive }: { isActive: boolean }) =>
    `rounded-lg px-2.5 py-1.5 text-sm transition ${
      dark
        ? isActive
          ? 'bg-white/15 font-medium text-white'
          : 'text-white/80 hover:bg-white/10 hover:text-white'
        : isActive
          ? 'bg-sage/15 font-medium text-sage-dark'
          : 'text-graysage hover:bg-sage/10 hover:text-sage-dark'
    }`

  return (
    <header className={`flex items-center justify-between px-6 py-3 ${dark ? 'border-b border-white/10 bg-transparent' : 'border-b border-black/5 bg-white'}`}>
      <div className="flex items-center gap-7">
        <Logo size={34} onDark={dark} />
        <nav className="flex items-center gap-1">
          <NavLink to="/" end className={linkCls}>
            Panel
          </NavLink>
          <NavLink to="/miembros" className={linkCls}>
            Miembros
          </NavLink>
          <NavLink to="/calendario" className={linkCls}>
            Calendario
          </NavLink>
          <NavLink to="/ajustes" className={linkCls}>
            Ajustes
          </NavLink>
        </nav>
      </div>
      <div className="flex items-center gap-4">
        <span className={`hidden text-xs sm:inline ${dark ? 'text-white/60' : 'text-graysage'}`}>{user?.email}</span>
        <button
          type="button"
          onClick={signOut}
          className={`rounded-lg border px-3 py-1.5 text-sm transition ${dark ? 'border-white/20 text-white hover:bg-white/10' : 'border-black/10 text-graysage hover:bg-sage/10'}`}
        >
          Salir
        </button>
      </div>
    </header>
  )
}
