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
  inactive: boolean
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
  const [inactive, setInactive] = useState(false)
  // which login the employee/roles below belong to (avoids an "Account not linked" flash)
  const [loadedFor, setLoadedFor] = useState<string | null>(null)

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
        setLoadedFor(null)
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
    setInactive(false)
    const done = () => { setLoading(false); setLoadedFor(userId) }
    ;(async () => {
      const { data: emp, error: e1 } = await supabase
        .from('employee')
        .select('id, full_name, email, role_title')
        .eq('auth_user_id', userId)
        .maybeSingle()
      if (cancelled) return
      if (e1) {
        setError(e1.message)
        done()
        return
      }
      if (!emp) {
        // RLS hides inactive employees, so ask the database which case this is
        const { data: status } = await supabase.rpc('my_account_status')
        if (cancelled) return
        setError(
          status === 'inactive'
            ? 'Your account is inactive. If this is a mistake, contact HR.'
            : 'Your login is not linked to an employee. Ask an admin to link your email.',
        )
        setInactive(status === 'inactive')
        setEmployee(null)
        setRoles([])
        done()
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
      done()
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

  // still loading while a session exists but its employee hasn't been loaded yet
  const busy = loading || (!!userId && loadedFor !== userId)

  return (
    <Ctx.Provider value={{ loading: busy, session, employee, roles, error, inactive, signIn, signOut }}>
      {children}
    </Ctx.Provider>
  )
}

export function useAuth() {
  const v = useContext(Ctx)
  if (!v) throw new Error('useAuth must be used inside AuthProvider')
  return v
}
