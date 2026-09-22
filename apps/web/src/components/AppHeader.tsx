import { NavLink } from 'react-router-dom'
import { useAuth } from '../lib/auth-context'

// Encabezado con navegación, compartido por las páginas protegidas.
export default function AppHeader() {
  const { user, signOut } = useAuth()

  const linkCls = ({ isActive }: { isActive: boolean }) =>
    `text-sm transition ${
      isActive ? 'font-medium text-sage-dark' : 'text-graysage hover:text-sage-dark'
    }`

  return (
    <header className="flex items-center justify-between border-b border-clay-light/30 bg-white px-6 py-4">
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-charcoal">
            <span className="font-serif text-lg text-gold">
              Ch<span className="align-top text-[0.6rem]">+</span>
            </span>
          </div>
          <span className="font-serif text-lg text-sage-dark">ChBook</span>
        </div>
        <nav className="flex items-center gap-4">
          <NavLink to="/" end className={linkCls}>
            Panel
          </NavLink>
          <NavLink to="/miembros" className={linkCls}>
            Miembros
          </NavLink>
        </nav>
      </div>
      <div className="flex items-center gap-4">
        <span className="hidden font-mono text-xs text-graysage sm:inline">{user?.email}</span>
        <button
          type="button"
          onClick={signOut}
          className="rounded-lg border border-graysage/25 px-3 py-1.5 text-sm text-graysage transition hover:bg-cream"
        >
          Salir
        </button>
      </div>
    </header>
  )
}
