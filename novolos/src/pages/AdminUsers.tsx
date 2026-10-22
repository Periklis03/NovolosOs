import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import type { RoleName } from '../auth/AuthContext'

// Roles used in the MVP. 'sales' stays out until its screens exist (Phase 3).
const ROLES: { id: RoleName; label: string }[] = [
  { id: 'user', label: 'User' },
  { id: 'team_lead', label: 'Team lead' },
  { id: 'manager', label: 'Manager' },
  { id: 'admin', label: 'Admin' },
]

// 12 characters without look-alikes (0/O, 1/l/I), so it's easy to read out or type
function randomPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'
  const bytes = crypto.getRandomValues(new Uint8Array(12))
  return Array.from(bytes, (b) => chars[b % chars.length]).join('')
}

interface Person {
  id: string
  full_name: string
  email: string | null
  role_title: string | null
  lead_id: string | null
  active: boolean
  auth_user_id: string | null
}

export default function Users() {
  const { employee: me } = useAuth()
  const [people, setPeople] = useState<Person[]>([])
  const [roles, setRoles] = useState<Record<string, RoleName[]>>({})
  const [q, setQ] = useState('')
  const [showInactive, setShowInactive] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null) // id of the row being saved
  const [loginFor, setLoginFor] = useState<string | null>(null) // row with the "create login" form open
  const [tempPassword, setTempPassword] = useState('')

  const load = useCallback(async () => {
    const [e, r] = await Promise.all([
      supabase.from('employee').select('id, full_name, email, role_title, lead_id, active, auth_user_id').order('full_name'),
      supabase.from('app_role').select('employee_id, role'),
    ])
    const err = e.error ?? r.error
    if (err) { setError(err.message); return }
    setPeople((e.data ?? []) as Person[])
    const byPerson: Record<string, RoleName[]> = {}
    for (const row of r.data ?? []) (byPerson[row.employee_id] ??= []).push(row.role as RoleName)
    setRoles(byPerson)
  }, [])

  useEffect(() => { load() }, [load])

  // run one change, show the database's message if it refuses, then reload
  const save = async (id: string, p: PromiseLike<{ error: { message: string } | null }>, ok: string) => {
    setBusy(id); setError(null); setMsg(null)
    const { error } = await p
    setBusy(null)
    if (error) setError(error.message)
    else setMsg(ok)
    await load()
  }

  const toggleRole = (p: Person, role: RoleName) => {
    const has = (roles[p.id] ?? []).includes(role)
    const label = ROLES.find((r) => r.id === role)?.label ?? role
    if (has) {
      save(p.id, supabase.from('app_role').delete().eq('employee_id', p.id).eq('role', role),
        `${label} role removed from ${p.full_name}.`)
    } else {
      save(p.id, supabase.from('app_role').insert({ employee_id: p.id, role }),
        `${p.full_name} is now ${label}.`)
    }
  }

  const setLead = (p: Person, leadId: string) => {
    const lead = people.find((x) => x.id === leadId)
    save(p.id, supabase.from('employee').update({ lead_id: leadId || null }).eq('id', p.id),
      lead ? `${lead.full_name} now validates ${p.full_name}'s skills.` : `${p.full_name} has no team lead.`)
  }

  const setActive = (p: Person, active: boolean) => {
    if (!active && !window.confirm(`Deactivate ${p.full_name}? They lose access immediately and stop counting in Ask.`)) return
    save(p.id, supabase.from('employee').update({ active }).eq('id', p.id),
      `${p.full_name} is now ${active ? 'active' : 'inactive'}.`)
  }

  const openLoginForm = (p: Person) => {
    setLoginFor(p.id); setTempPassword(randomPassword()); setError(null); setMsg(null)
  }

  // The login is created by the "create-login" Edge Function (it holds the secret key).
  const createLogin = async (p: Person) => {
    setBusy(p.id); setError(null); setMsg(null)
    const { error } = await supabase.functions.invoke('create-login', {
      body: { employee_id: p.id, password: tempPassword },
    })
    setBusy(null)
    if (error) {
      // the function sends a readable reason in the response body
      let reason = error.message
      try {
        const body = await (error as { context?: Response }).context?.json()
        if (body?.error) reason = body.error
      } catch { /* keep error.message */ }
      setError(reason)
      return
    }
    setMsg(`Login created for ${p.full_name}. They sign in with ${p.email} and the temporary password: ${tempPassword}  (give it to them in person, it is not shown again)`)
    setLoginFor(null)
    await load()
  }

  // team leads to choose from: active people with the team_lead role
  const leads = people.filter((x) => x.active && (roles[x.id] ?? []).includes('team_lead'))
  const needle = q.trim().toLowerCase()
  const shown = people.filter((p) =>
    (showInactive || p.active) &&
    (!needle || p.full_name.toLowerCase().includes(needle) || (p.email ?? '').toLowerCase().includes(needle)))
  const noRole = people.filter((p) => p.active && !(roles[p.id] ?? []).length).length

  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <input placeholder="Search name or email" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 220 }} />
        <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
          Show inactive
        </label>
        <span className="muted">{shown.length} {shown.length === 1 ? 'person' : 'people'}</span>
        {loginFor && (() => {
          const p = people.find((x) => x.id === loginFor)
          if (!p) return null
          return (
            <div className="card" style={{ width: '100%', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', padding: 12 }}>
              <span>Create a login for <b>{p.full_name}</b> ({p.email}). Temporary password:</span>
              <input
                value={tempPassword}
                onChange={(e) => setTempPassword(e.target.value)}
                aria-label="Temporary password"
                style={{ fontFamily: 'monospace', minWidth: 180 }}
              />
              <button className="small" disabled={busy === p.id || tempPassword.length < 8} onClick={() => createLogin(p)}>
                {busy === p.id ? 'Creating…' : 'Create login'}
              </button>
              <button className="ghost small" style={{ marginTop: 0 }} onClick={() => setLoginFor(null)}>Cancel</button>
              {tempPassword.length < 8 && <span className="muted">at least 8 characters</span>}
            </div>
          )
        })()}
        {noRole > 0 && <span className="tag bad">{noRole} active without a role</span>}
      </div>
      {error && <div className="error">{error}</div>}
      {msg && <div className="ok">{msg}</div>}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="thead trow" style={{ borderBottom: '1px solid var(--line)' }}>
          <div style={{ flex: 1 }}>Person</div>
          <div style={{ width: 290 }}>Roles</div>
          <div style={{ width: 170 }}>Team lead</div>
          <div style={{ width: 100 }}>Login</div>
          <div style={{ width: 90 }}>Status</div>
        </div>
        {shown.length === 0 && <div className="pad muted">No one matches.</div>}
        {shown.map((p) => {
          const mine = roles[p.id] ?? []
          const isMe = p.id === me?.id
          // keep the current lead in the list even if they lost the team_lead role
          const leadOptions = leads.filter((l) => l.id !== p.id)
          const current = people.find((x) => x.id === p.lead_id)
          if (current && !leadOptions.some((l) => l.id === current.id)) leadOptions.push(current)
          return (
            <div className="trow" key={p.id} style={{ opacity: p.active ? 1 : 0.55 }} data-person={p.full_name}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontWeight: 600 }}>{p.full_name}{isMe && <span className="muted"> (you)</span>}</div>
                <div className="muted">{p.email ?? 'no email'}{p.role_title ? ` · ${p.role_title}` : ''}</div>
              </div>
              <div style={{ width: 290, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {ROLES.map((r) => (
                  <button
                    key={r.id}
                    className={mine.includes(r.id) ? 'chip on' : 'chip'}
                    disabled={busy === p.id || !p.active}
                    onClick={() => toggleRole(p, r.id)}
                    aria-pressed={mine.includes(r.id)}
                  >
                    {r.label}
                  </button>
                ))}
                {/* roles without a button (e.g. sales) are still shown, read-only */}
                {mine.filter((r) => !ROLES.some((x) => x.id === r)).map((r) => (
                  <span key={r} className="tag" title="Not used in the MVP; change it in SQL if needed">{r}</span>
                ))}
              </div>
              <div style={{ width: 170 }}>
                <select
                  value={p.lead_id ?? ''}
                  disabled={busy === p.id || !p.active}
                  onChange={(e) => setLead(p, e.target.value)}
                  style={{ width: '100%' }}
                  aria-label={`Team lead of ${p.full_name}`}
                >
                  <option value="">— none —</option>
                  {leadOptions.map((l) => <option key={l.id} value={l.id}>{l.full_name}</option>)}
                </select>
              </div>
              <div style={{ width: 100 }} className="muted" title={p.auth_user_id ? 'Has a login' : 'No login linked yet'}>
                {p.auth_user_id ? 'yes' : p.active && p.email && loginFor !== p.id ? (
                  <button className="ghost small" style={{ marginTop: 0 }} disabled={busy === p.id} onClick={() => openLoginForm(p)}>
                    Create login
                  </button>
                ) : 'no'}
              </div>
              <div style={{ width: 90 }}>
                <button
                  className={p.active ? 'chip on' : 'chip'}
                  disabled={busy === p.id}
                  onClick={() => setActive(p, !p.active)}
                >
                  {p.active ? 'Active' : 'Inactive'}
                </button>
              </div>
            </div>
          )
        })}
      </div>
      <p className="muted">
        Team lead: who validates this person's skills. Only active people with the Team lead role appear in the list.
      </p>
    </div>
  )
}
