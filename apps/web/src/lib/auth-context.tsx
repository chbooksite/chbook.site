import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react'
import type { Session, User } from '@supabase/supabase-js'
import { supabase } from './supabase'

type AuthResult = { error: string | null; needsEmailConfirm?: boolean }

interface Membership {
  churchId: string
  role: string
  status: string
}

interface AuthContextValue {
  session: Session | null
  user: User | null
  loading: boolean
  membership: Membership | null
  membershipLoading: boolean
  refreshMembership: () => Promise<void>
  signIn: (email: string, password: string) => Promise<AuthResult>
  signUp: (email: string, password: string) => Promise<AuthResult>
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [membership, setMembership] = useState<Membership | null>(null)
  const [membershipLoading, setMembershipLoading] = useState(true)

  const loadMembership = useCallback(async (uid: string | undefined) => {
    if (!uid) {
      setMembership(null)
      setMembershipLoading(false)
      return
    }
    setMembershipLoading(true)
    const { data } = await supabase
      .from('members')
      .select('church_id, role, status')
      .eq('user_id', uid)
      .maybeSingle()
    setMembership(
      data?.church_id
        ? { churchId: data.church_id, role: data.role ?? 'member', status: data.status ?? 'active' }
        : null,
    )
    setMembershipLoading(false)
  }, [])

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setLoading(false)
      loadMembership(data.session?.user?.id)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      loadMembership(next?.user?.id)
    })

    return () => sub.subscription.unsubscribe()
  }, [loadMembership])

  const refreshMembership = useCallback(
    () => loadMembership(session?.user?.id),
    [loadMembership, session],
  )

  const signIn = async (email: string, password: string): Promise<AuthResult> => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error: error?.message ?? null }
  }

  const signUp = async (email: string, password: string): Promise<AuthResult> => {
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) return { error: error.message }
    return { error: null, needsEmailConfirm: !data.session }
  }

  const signOut = async () => {
    await supabase.auth.signOut()
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user ?? null,
        loading,
        membership,
        membershipLoading,
        refreshMembership,
        signIn,
        signUp,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>')
  return ctx
}
