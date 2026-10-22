import { useCallback, useEffect, useState } from 'react'
import type { ChangeEvent } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import { parseCsv } from '../lib/csv'
import Users from './AdminUsers'

type Tab = 'users' | 'proposals' | 'import' | 'history' | 'audit'

const SENIORITY = ['junior', 'mid', 'senior', 'lead', 'principal']
const FUNCTIONS = ['engineering', 'product', 'design', 'other']
const TEMPLATE =
  'hris_id,full_name,email,role_title,function,seniority,years_experience,education,active,left_at\n' +
  'H100,Jane Example,jane@demo.test,Backend Engineer,engineering,mid,4,BSc Computer Science,true,\n'

export default function Admin() {
  const [tab, setTab] = useState<Tab>('users')
  const [rate, setRate] = useState<number | null>(null)

  useEffect(() => {
    supabase.rpc('unvalidated_rate').then(({ data }) => setRate(data as number | null))
  }, [tab])

  return (
    <div style={{ maxWidth: 920 }}>
      <h1>Admin</h1>
      <div className="card" style={{ marginBottom: 16, display: 'flex', gap: 24 }}>
        <div>
          <div style={{ fontSize: 22, fontWeight: 700 }}>{rate == null ? '–' : `${rate}%`}</div>
          <div className="muted">of skills still unvalidated</div>
        </div>
      </div>
      <div className="tabs">
        {([['users', 'Users'], ['proposals', 'Skill proposals'], ['import', 'HRIS import'], ['history', 'Sync history'], ['audit', 'Audit log']] as [Tab, string][]).map(([id, label]) => (
          <button key={id} className={tab === id ? 'tab on' : 'tab'} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      {tab === 'users' && <Users />}
      {tab === 'proposals' && <Proposals />}
      {tab === 'import' && <Import />}
      {tab === 'history' && <History />}
      {tab === 'audit' && <Audit />}
    </div>
  )
}

/* ---------- skill proposals ---------- */
interface Proposal {
  id: string; name: string; note: string | null; category_id: string | null
  proposer: { full_name: string } | null
}
function Proposals() {
  const { employee } = useAuth()
  const [list, setList] = useState<Proposal[]>([])
  const [cats, setCats] = useState<{ id: string; name: string }[]>([])
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const [p, c] = await Promise.all([
      supabase.from('skill_proposal').select('id, name, note, category_id, proposer:proposed_by(full_name)').eq('status', 'pending').order('created_at'),
      supabase.from('skill_category').select('id, name').order('sort_order'),
    ])
    if (p.error) setError(p.error.message)
    setList((p.data ?? []) as unknown as Proposal[])
    setCats(c.data ?? [])
  }, [])
  useEffect(() => { load() }, [load])

  const setCat = (id: string, category_id: string) =>
    setList((l) => l.map((x) => (x.id === id ? { ...x, category_id } : x)))

  const approve = async (p: Proposal) => {
    setError(null)
    const up = await supabase.from('skill_proposal').update({ category_id: p.category_id }).eq('id', p.id)
    if (up.error) return setError(up.error.message)
    const { error } = await supabase.rpc('approve_skill_proposal', { _id: p.id })
    if (error) setError(error.message)
    await load()
  }
  const reject = async (p: Proposal) => {
    const { error } = await supabase.from('skill_proposal')
      .update({ status: 'rejected', decided_by: employee?.id, decided_at: new Date().toISOString() }).eq('id', p.id)
    if (error) setError(error.message)
    await load()
  }

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div className="thead">Pending proposals · {list.length}</div>
      {error && <div className="error" style={{ margin: 12 }}>{error}</div>}
      {list.length === 0 && <div className="pad muted">Nothing waiting.</div>}
      {list.map((p) => (
        <div className="trow" key={p.id}>
          <div style={{ flex: 1 }}>
            <div style={{ fontWeight: 600 }}>{p.name}</div>
            <div className="muted">proposed by {p.proposer?.full_name ?? 'unknown'}</div>
          </div>
          <select value={p.category_id ?? ''} onChange={(e) => setCat(p.id, e.target.value)}>
            <option value="" disabled>category…</option>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button className="small" disabled={!p.category_id} onClick={() => approve(p)}>Approve</button>
          <button className="ghost small" onClick={() => reject(p)}>Reject</button>
        </div>
      ))}
    </div>
  )
}

/* ---------- HRIS CSV import ---------- */
function Import() {
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [problems, setProblems] = useState<string[]>([])
  const [fileName, setFileName] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    setMsg(null); setError(null)
    const f = e.target.files?.[0]
    if (!f) return
    setFileName(f.name)
    const parsed = parseCsv(await f.text())
    e.target.value = '' // so choosing the same file again fires onChange
    const probs: string[] = []
    const seenIds = new Map<string, number>()
    const seenEmails = new Map<string, number>()
    const out = parsed.map((r, i) => {
      const line = i + 2
      if (!r.hris_id) probs.push(`Line ${line}: hris_id is required`)
      if (!r.full_name) probs.push(`Line ${line}: full_name is required`)
      const seniority = (r.seniority ?? '').toLowerCase()
      const fn = (r.function ?? '').toLowerCase()
      if (seniority && !SENIORITY.includes(seniority)) probs.push(`Line ${line}: seniority must be ${SENIORITY.join('/')}`)
      if (fn && !FUNCTIONS.includes(fn)) probs.push(`Line ${line}: function must be ${FUNCTIONS.join('/')}`)
      // same checks the database would do, but with a readable message and line number
      const years = r.years_experience ?? ''
      if (years && !/^\d{1,2}(\.\d)?$/.test(years)) {
        probs.push(`Line ${line}: years_experience must be a number from 0 to 99.9 (use a dot, e.g. 4.5), got "${years}"`)
      }
      const email = (r.email ?? '').toLowerCase()
      if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) probs.push(`Line ${line}: email "${r.email}" is not valid`)
      const left = r.left_at ?? ''
      if (left && (!/^\d{4}-\d{2}-\d{2}$/.test(left) || Number.isNaN(Date.parse(left)))) {
        probs.push(`Line ${line}: left_at must be a date like 2026-10-31, got "${left}"`)
      }
      const active = (r.active ?? '').toLowerCase()
      if (active && active !== 'true' && active !== 'false') probs.push(`Line ${line}: active must be true or false, got "${r.active}"`)
      if (r.hris_id) {
        const first = seenIds.get(r.hris_id)
        if (first) probs.push(`Line ${line}: hris_id ${r.hris_id} already used on line ${first}`)
        else seenIds.set(r.hris_id, line)
      }
      if (email) {
        const first = seenEmails.get(email)
        if (first) probs.push(`Line ${line}: email ${r.email} already used on line ${first}`)
        else seenEmails.set(email, line)
      }
      return {
        hris_id: r.hris_id, full_name: r.full_name, email: r.email, role_title: r.role_title,
        function: fn, seniority, years_experience: r.years_experience, education: r.education,
        active: r.active === '' ? 'true' : String(r.active).toLowerCase() !== 'false', left_at: r.left_at,
      }
    })
    setRows(out); setProblems(probs)
  }

  const run = async () => {
    setBusy(true); setError(null); setMsg(null)
    const { data: runId, error } = await supabase.rpc('hris_import', { _rows: rows, _source: 'csv' })
    if (error) { setBusy(false); setError(error.message); return }
    // since 0005 a failed import returns normally; the run row says whether it worked
    const { data: run, error: e2 } = await supabase
      .from('hris_sync_run').select('status, rows_upserted, error').eq('id', runId).single()
    setBusy(false)
    if (e2) { setError(e2.message); return }
    if (run.status === 'failed') {
      setError(`Import failed, nothing was saved (sync run #${runId}). ${run.error ?? ''}`)
      return
    }
    setMsg(`Imported ${run.rows_upserted} rows (sync run #${runId}).`); setRows([]); setFileName('')
  }

  const download = () => {
    const url = URL.createObjectURL(new Blob([TEMPLATE], { type: 'text/csv' }))
    const a = document.createElement('a'); a.href = url; a.download = 'employees-template.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="card">
      <p className="muted" style={{ marginTop: 0 }}>
        Upload a CSV exported from your HR system. Existing people (same hris_id) are updated; new ones are added. Running it twice is safe.
      </p>
      <div className="row" style={{ marginBottom: 12 }}>
        <input type="file" accept=".csv,text/csv" onChange={onFile} />
        <button className="ghost small" onClick={download}>Download template</button>
      </div>
      {error && <div className="error">{error}</div>}
      {msg && <div className="ok">{msg}</div>}
      {fileName && <div className="muted">{fileName}: {rows.length} rows</div>}
      {problems.length > 0 && (
        <div className="error" style={{ marginTop: 8 }}>
          {problems.slice(0, 8).map((p) => <div key={p}>{p}</div>)}
          {problems.length > 8 && <div>…and {problems.length - 8} more. Fix these and choose the file again.</div>}
        </div>
      )}
      {rows.length > 0 && (
        <>
          <div className="muted" style={{ margin: '8px 0' }}>Preview (first 5):</div>
          {rows.slice(0, 5).map((r, i) => (
            <div key={i} className="trow" style={{ padding: '6px 0' }}>
              <b style={{ width: 70 }}>{String(r.hris_id)}</b><span style={{ flex: 1 }}>{String(r.full_name)}</span>
              <span className="muted">{String(r.role_title ?? '')}</span>
            </div>
          ))}
          <button style={{ marginTop: 12 }} disabled={busy || problems.length > 0} onClick={run}>
            {busy ? 'Importing…' : `Import ${rows.length} rows`}
          </button>
        </>
      )}
    </div>
  )
}

/* ---------- sync history ---------- */
interface Run { id: number; source: string; started_at: string; status: string; rows_seen: number; rows_upserted: number; error: string | null }
function History() {
  const [runs, setRuns] = useState<Run[]>([])
  useEffect(() => {
    supabase.from('hris_sync_run').select('*').order('started_at', { ascending: false }).limit(20)
      .then(({ data }) => setRuns((data ?? []) as Run[]))
  }, [])
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div className="thead">Recent imports</div>
      {runs.length === 0 && <div className="pad muted">No imports yet.</div>}
      {runs.map((r) => (
        <div className="trow" key={r.id}>
          <span style={{ width: 40 }}>#{r.id}</span>
          <span style={{ flex: 1 }}>{new Date(r.started_at).toLocaleString()} · {r.source}</span>
          <span>{r.rows_upserted}/{r.rows_seen} rows</span>
          <span className={r.status === 'ok' ? 'tag okc' : 'tag bad'}>{r.status}</span>
          {r.error && <span className="muted">{r.error}</span>}
        </div>
      ))}
    </div>
  )
}

/* ---------- audit log ---------- */
type Snapshot = Record<string, unknown> | null
interface Entry {
  id: number; actor_id: string | null; action: string; entity_type: string; at: string
  before: Snapshot; after: Snapshot
}

const ACTION_LABEL: Record<string, string> = {
  'employee_skill.validate': 'Skill validated',
  'employee_skill.delete': 'Skill removed',
  'app_role.insert': 'Role added',
  'app_role.delete': 'Role removed',
  'app_role.update': 'Role changed',
  'employee.update': 'Employee updated',
}

// Turns the before/after row snapshots into "whose" and "what changed"
function describe(x: Entry, people: Record<string, string>, skills: Record<string, string>) {
  const row = x.after ?? x.before ?? {}
  const who = people[String(row.employee_id)] ?? 'unknown person'
  const lvl = (s: Snapshot) => (s?.validated_level ?? '–') as string | number
  if (x.entity_type === 'employee_skill') {
    const skill = skills[String(row.skill_id)] ?? 'unknown skill'
    if (x.action === 'employee_skill.delete') {
      return { who, what: `${skill} removed (was validated ${lvl(x.before)}, self ${x.before?.self_level ?? '–'})` }
    }
    return { who, what: `${skill}: validated ${lvl(x.before)} → ${lvl(x.after)}` }
  }
  if (x.entity_type === 'employee') {
    const changes: string[] = []
    if (x.before?.lead_id !== x.after?.lead_id) {
      const name = (v: unknown) => (v ? people[String(v)] ?? 'unknown' : 'none')
      changes.push(`team lead ${name(x.before?.lead_id)} → ${name(x.after?.lead_id)}`)
    }
    if (x.before?.active !== x.after?.active) changes.push(x.after?.active ? 'reactivated' : 'deactivated')
    return { who: String(x.after?.full_name ?? x.before?.full_name ?? 'unknown person'), what: changes.join(', ') }
  }
  if (x.entity_type === 'app_role') {
    if (x.action === 'app_role.update') return { who, what: `role ${x.before?.role} → ${x.after?.role}` }
    return { who, what: `role ${row.role}` }
  }
  // fallback for tables audited later: list the columns that changed
  const changed = Object.keys(x.after ?? {}).filter(
    (k) => JSON.stringify(x.after?.[k]) !== JSON.stringify(x.before?.[k]) && k !== 'updated_at',
  )
  return { who, what: changed.length ? `changed: ${changed.join(', ')}` : '' }
}

function Audit() {
  const [list, setList] = useState<Entry[]>([])
  const [people, setPeople] = useState<Record<string, string>>({})
  const [skills, setSkills] = useState<Record<string, string>>({})
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    ;(async () => {
      const [a, e, s] = await Promise.all([
        supabase.from('audit_log').select('id, actor_id, action, entity_type, at, before, after')
          .order('at', { ascending: false }).limit(50),
        supabase.from('employee').select('id, full_name'),
        supabase.from('skill').select('id, name'),
      ])
      const err = a.error ?? e.error ?? s.error
      if (err) setError(err.message)
      setList((a.data ?? []) as Entry[])
      setPeople(Object.fromEntries((e.data ?? []).map((x) => [x.id, x.full_name])))
      setSkills(Object.fromEntries((s.data ?? []).map((x) => [x.id, x.name])))
    })()
  }, [])
  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div className="thead trow" style={{ borderBottom: '1px solid var(--line)' }}>
        <div style={{ width: 120 }}>Action</div>
        <div style={{ flex: 1 }}>Person · change</div>
        <div style={{ width: 130 }}>By</div>
        <div style={{ width: 150 }}>When</div>
      </div>
      {error && <div className="error" style={{ margin: 12 }}>{error}</div>}
      {list.length === 0 && <div className="pad muted">Nothing logged yet.</div>}
      {list.map((x) => {
        const d = describe(x, people, skills)
        return (
          <div className="trow" key={x.id}>
            <span style={{ width: 120, fontWeight: 600 }}>{ACTION_LABEL[x.action] ?? x.action}</span>
            <span style={{ flex: 1 }}>
              <b>{d.who}</b>
              {d.what && <span className="muted"> · {d.what}</span>}
            </span>
            <span className="muted" style={{ width: 130 }}>
              {x.actor_id ? people[x.actor_id] ?? 'unknown' : 'system / SQL editor'}
            </span>
            <span className="muted" style={{ width: 150 }}>{new Date(x.at).toLocaleString()}</span>
          </div>
        )
      })}
    </div>
  )
}
