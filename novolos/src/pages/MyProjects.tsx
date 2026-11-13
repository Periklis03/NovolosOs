import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { AllocationRow, Timing } from '../lib/projects'
import { STATUS_LABEL, fmtRange } from '../lib/projects'

// My Profile → Teams & Projects: current / future / past, worked out from each booking's dates.

interface Mate { employee_id: string; full_name: string; job_title: string | null; project_role: string | null; timing: Timing }
const TABS: { id: Timing; label: string }[] = [{ id: 'current', label: 'Current' }, { id: 'future', label: 'Future' }, { id: 'past', label: 'Past' }]

export default function MyProjects({ employeeId }: { employeeId: string }) {
  const [rows, setRows] = useState<AllocationRow[]>([])
  const [mates, setMates] = useState<Record<string, Mate[]>>({})
  const [tab, setTab] = useState<Timing>('current')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      const { data, error } = await supabase.from('allocation_overview').select('*').eq('employee_id', employeeId).order('start_date', { ascending: false })
      if (error) { setError(error.message); return }
      const list = (data ?? []) as AllocationRow[]
      setRows(list)
      // teammates (names and roles only) for the projects that are not over yet
      const ids = [...new Set(list.filter((a) => a.timing !== 'past').map((a) => a.project_id))]
      const teams = await Promise.all(ids.map((id) => supabase.rpc('project_team', { _project: id })))
      setMates(Object.fromEntries(ids.map((id, i) => [id, ((teams[i].data ?? []) as Mate[]).filter((m) => m.employee_id !== employeeId && m.timing !== 'past')])))
    })()
  }, [employeeId])

  const shown = rows.filter((a) => a.timing === tab)
  return (
    <div>
      {error && <div className="error">{error}</div>}
      <div className="seg">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'on' : ''} onClick={() => setTab(t.id)}>
            {t.label} <span className="muted">{rows.filter((a) => a.timing === t.id).length}</span>
          </button>
        ))}
      </div>
      {shown.length === 0 && <div className="card muted">No {tab} projects.</div>}
      {shown.map((a) => (
        <div className="card" key={a.id} style={{ marginBottom: 12 }} data-myproject={a.project_name}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>{a.project_name}</div>
              <div className="muted">
                {a.client ?? 'no client'} · {a.role_title ?? 'no role set'} · {fmtRange(a.start_date, a.end_date)}
              </div>
            </div>
            <span className={`st st-${a.project_status}`}>{STATUS_LABEL[a.project_status]}</span>
          </div>
          {a.stage === 'pipeline' && <div className="muted" style={{ marginTop: 8 }}>Not confirmed yet: this booking is tentative.</div>}
          {tab !== 'past' && (
            <div style={{ marginTop: 12 }}>
              <div className="muted" style={{ fontWeight: 700, marginBottom: 6 }}>Team members</div>
              {(mates[a.project_id] ?? []).length === 0 && <span className="muted">No teammates yet.</span>}
              <div className="row">
                {(mates[a.project_id] ?? []).map((m) => (
                  <span className="tag" key={m.employee_id}>
                    <b>{m.full_name}</b> <span className="muted">{m.project_role ?? m.job_title ?? ''}{m.timing === 'future' ? ' · joins later' : ''}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
