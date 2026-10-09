import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

export type RoleName = 'admin' | 'manager' | 'team_lead' | 'user' | 'sales'

export interface Employee {
  id: string
  full_name: string
  email: string | null
  role_title: string | null
}

interface AuthState {
  loading: boolean
  session: Session | null
  employee: Employee | null
  roles: RoleName[]
  error: string | null
  signIn: (email: string, password: string) => Promise<string | null>
  signOut: () => Promise<void>
}

const Ctx = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [roles, setRoles] = useState<RoleName[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // 1) keep the Supabase session in state
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      if (!data.session) setLoading(false)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s)
      if (!s) {
        setEmployee(null)
        setRoles([])
        setLoading(false)
      }
    })
    return () => data.subscription.unsubscribe()
  }, [])

  // 2) when logged in, load the employee row and roles (RLS lets you read your own)
  const userId = session?.user.id
  useEffect(() => {
    if (!userId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    ;(async () => {
      const { data: emp, error: e1 } = await supabase
        .from('employee')
        .select('id, full_name, email, role_title')
        .eq('auth_user_id', userId)
        .maybeSingle()
      if (cancelled) return
      if (e1) {
        setError(e1.message)
        setLoading(false)
        return
      }
      if (!emp) {
        setError('Your login is not linked to an employee. Ask an admin to link your email.')
        setEmployee(null)
        setRoles([])
        setLoading(false)
        return
      }
      const { data: rows, error: e2 } = await supabase
        .from('app_role')
        .select('role')
        .eq('employee_id', emp.id)
      if (cancelled) return
      if (e2) setError(e2.message)
      setEmployee(emp as Employee)
      setRoles((rows ?? []).map((r) => r.role as RoleName))
      setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [userId])

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return error ? error.message : null
  }
  const signOut = async () => {
    await supabase.auth.signOut()
  }

  return (
    <Ctx.Provider value={{ loading, session, employee, roles, error, signIn, signOut }}>
      {children}
    </Ctx.Provider>
  )
}

export function useAuth() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth must be used inside AuthProvider')
  return v
}
