import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './lib/auth-context'
import { ProtectedRoute } from './components/ProtectedRoute'
import Login from './pages/Login'
import ResetPassword from './pages/ResetPassword'
import Join from './pages/Join'
import Onboarding from './pages/Onboarding'
import Dashboard from './pages/Dashboard'
import People from './pages/People'
import Members from './pages/Members'
import MemberProfile from './pages/MemberProfile'
import Calendar from './pages/Calendar'
import Settings from './pages/Settings'
import Service from './pages/Service'
import ServiceHistory from './pages/ServiceHistory'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/restablecer" element={<ResetPassword />} />
          <Route path="/unirse/:code?" element={<Join />} />

          {/* Rutas protegidas: requieren sesión */}
          <Route element={<ProtectedRoute />}>
            <Route path="/onboarding" element={<Onboarding />} />
            <Route path="/" element={<Dashboard />} />
            <Route path="/personas" element={<People />} />
            <Route path="/miembros" element={<Members />} />
            <Route path="/miembros/:id" element={<MemberProfile />} />
            <Route path="/culto" element={<Service />} />
            <Route path="/culto/historial/:id?" element={<ServiceHistory />} />
            <Route path="/calendario" element={<Calendar />} />
            <Route path="/ajustes" element={<Settings />} />
          </Route>

          {/* Cualquier otra ruta → al inicio */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
