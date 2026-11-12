import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import type { AllocationRow, ProjectRow, Stage, Status } from '../lib/projects'
import { STATUS_LABEL, fmtRange, projectError, startPassed } from '../lib/projects'

// Projects list: admin creates and sees everything; a team lead sees the projects of their team
// and the ones they lead; managers read. The database decides what each person gets back.

const FILTERS: { id: 'live' | Status | 'all'; label: string }[] = [
  { id: 'live', label: 'Live & upcoming' }, { id: 'pipeline', label: 'Pipeline' },
  { id: 'delivered', label: 'Delivered' }, { id: 'cancelled', label: 'Cancelled' }, { id: 'all', label: 'All' },
]
const LIVE: Status[] = ['active', 'closing', 'upcoming']

export default function Projects() {
  const { employee: me, roles } = useAuth()
  const isAdmin = roles.includes('admin')
  const navigate = useNavigate()
  const [projects, setProjects] = useState<ProjectRow[]>([])
  const [team, setTeam] = useState<AllocationRow[]>([])
  const [names, setNames] = useState<Record<string, string>>({})
  const [filter, setFilter] = useState<(typeof FILTERS)[number]['id']>('live')
  const [q, setQ] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ name: '', client: '', stage: 'pipeline' as Stage, start_date: '', end_date: '', project_lead_id: '' })
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const [p, a, e] = await Promise.all([
      supabase.from('project_overview').select('*').order('start_date', { ascending: false, nullsFirst: true }),
      supabase.from('allocation_overview').select('*'),
      supabase.from('employee').select('id, full_name, active').order('full_name'),
    ])
    const err = p.error ?? a.error ?? e.error
    if (err) { setError(err.message); return }
    setProjects((p.data ?? []) as ProjectRow[])
    setTeam((a.data ?? []) as AllocationRow[])
    setNames(Object.fromEntries((e.data ?? []).map((x) => [x.id, x.full_name])))
  }, [])
  useEffect(() => { load() }, [load])

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return projects.filter((p) =>
      (filter === 'all' || (filter === 'live' ? LIVE.includes(p.status) : p.status === filter)) &&
      (!needle || p.name.toLowerCase().includes(needle) || (p.client ?? '').toLowerCase().includes(needle)))
  }, [projects, filter, q])

  const people = (id: string) => team.filter((a) => a.project_id === id && a.timing !== 'past').length
  const count = (id: (typeof FILTERS)[number]['id']) =>
    id === 'all' ? projects.length : projects.filter((p) => (id === 'live' ? LIVE.includes(p.status) : p.status === id)).length

  const create = async () => {
    if (!form.name.trim()) return
    setBusy(true); setError(null)
    const { data, error } = await supabase.from('project').insert({
      name: form.name.trim().replace(/\s+/g, ' '), client: form.client.trim() || null, stage: form.stage,
      start_date: form.start_date || null, end_date: form.end_date || null, project_lead_id: form.project_lead_id || null,
    }).select('id').single()
    setBusy(false)
    if (error) { setError(projectError(error.message)); return }
    navigate(`/projects/${data.id}`)
  }

  return (
    <div style={{ maxWidth: 980 }}>
      <h1>Projects</h1>
      <p className="muted">
        The status follows the dates: upcoming → active → closing (last 30 days) → delivered.
        {!isAdmin && ' You see the projects of your team and the ones you lead.'}
      </p>
      {error && <div className="error">{error}</div>}

      <div className="row" style={{ marginBottom: 12 }}>
        <div className="seg" style={{ marginBottom: 0 }}>
          {FILTERS.map((f) => (
            <button key={f.id} className={filter === f.id ? 'on' : ''} onClick={() => setFilter(f.id)}>
              {f.label} <span className="muted">{count(f.id)}</span>
            </button>
          ))}
        </div>
        <input placeholder="Search project or client" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 200 }} />
        <span style={{ flex: 1 }} />
        {isAdmin && !creating && <button onClick={() => setCreating(true)}>+ New project</button>}
      </div>

      {creating && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="grid2">
            <label>Name<input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus /></label>
            <label>Client<input value={form.client} onChange={(e) => setForm({ ...form, client: e.target.value })} /></label>
            <label>Stage
              <select value={form.stage} onChange={(e) => setForm({ ...form, stage: e.target.value as Stage })}>
                <option value="pipeline">Pipeline (not won yet)</option>
                <option value="confirmed">Confirmed</option>
              </select>
            </label>
            <label>Project lead
              <select value={form.project_lead_id} onChange={(e) => setForm({ ...form, project_lead_id: e.target.value })}>
                <option value="">None yet</option>
                {Object.entries(names).map(([id, n]) => <option key={id} value={id}>{n}</option>)}
              </select>
            </label>
            <label>Start{form.stage === 'confirmed' && ' (required)'}<input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} /></label>
            <label>End (empty = open-ended)<input type="date" value={form.end_date} onChange={(e) => setForm({ ...form, end_date: e.target.value })} /></label>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button onClick={create} disabled={busy || !form.name.trim() || (form.stage === 'confirmed' && !form.start_date)}>Create project</button>
            <button className="ghost small" style={{ marginTop: 0 }} onClick={() => setCreating(false)}>Cancel</button>
            <span className="muted">You add the required stack and the team on the next screen.</span>
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="thead trow" style={{ borderBottom: '1px solid var(--line)' }}>
          <div style={{ flex: 2 }}>Project</div><div style={{ width: 110 }}>Status</div>
          <div style={{ flex: 1.4 }}>Dates</div><div style={{ flex: 1 }}>Project lead</div><div style={{ width: 70 }}>Team</div>
        </div>
        {shown.length === 0 && <div className="pad muted">No projects here yet.</div>}
        {shown.map((p) => (
          <Link key={p.id} to={`/projects/${p.id}`} className="trow clickable" style={{ textDecoration: 'none', color: 'inherit' }} data-project={p.name}>
            <div style={{ flex: 2 }}>
              <div style={{ fontWeight: 600 }}>{p.name}</div>
              <div className="muted">{p.client ?? 'no client'}{p.project_lead_id === me?.id && ' · you lead this'}</div>
            </div>
            <div style={{ width: 110 }}>
              <span className={`st st-${p.status}`}>{STATUS_LABEL[p.status]}{p.status === 'pipeline' && p.win_probability != null ? ` · ${p.win_probability}%` : ''}</span>
            </div>
            <div style={{ flex: 1.4 }} className="muted">
              {fmtRange(p.start_date, p.end_date)}
              {startPassed(p) && <div style={{ color: '#b07a1f' }}>start date passed: confirm or cancel</div>}
            </div>
            <div style={{ flex: 1 }} className="muted">{p.project_lead_id ? names[p.project_lead_id] ?? 'another lead' : '–'}</div>
            <div style={{ width: 70 }}>{people(p.id)}</div>
          </Link>
        ))}
      </div>
    </div>
  )
}
