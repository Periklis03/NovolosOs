import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import type { AllocationRow, Availability, HeldSkill, ProjectRow, Requirement, Stage } from '../lib/projects'
import {
  STATUS_LABEL, availabilityLabel, availabilityTone, cap, fitScore, fmtDate, fmtRange, projectError,
  startPassed, todayIso,
} from '../lib/projects'

// One project: details, required stack, team, and who fits.
// Admin edits every project; a team lead edits the ones they lead; everyone else only reads.

interface Req extends Requirement { id: string }
interface Person { id: string; full_name: string; role_title: string | null; seniority: string | null; active: boolean }
interface RoleProfile { id: string; name: string; description: string | null; skills: { skill_id: string; min_level: number }[] }
interface SkillOpt { id: string; name: string }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LEVELS = [1, 2, 3, 4, 5]

export default function ProjectDetail() {
  const { id = '' } = useParams()
  const navigate = useNavigate()
  const { employee: me, roles } = useAuth()
  const isAdmin = roles.includes('admin')

  const [project, setProject] = useState<ProjectRow | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading')
  const [reqs, setReqs] = useState<Req[]>([])
  const [team, setTeam] = useState<AllocationRow[]>([])
  const [people, setPeople] = useState<Person[]>([])
  const [held, setHeld] = useState<Record<string, Record<string, HeldSkill>>>({})
  const [avail, setAvail] = useState<Record<string, Availability>>({})
  const [skills, setSkills] = useState<SkillOpt[]>([])
  const [roleProfiles, setRoleProfiles] = useState<RoleProfile[]>([])
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // the day that matters for "who is free": the start date if it's still ahead, otherwise today
  const fitDay = project?.start_date && project.start_date > todayIso() ? project.start_date : todayIso()

  const load = useCallback(async () => {
    if (!UUID.test(id)) { setState('missing'); return }
    const [p, r, t, e, es, s, rp] = await Promise.all([
      supabase.from('project_overview').select('*').eq('id', id).maybeSingle(),
      supabase.from('project_requirement').select('id, skill_id, min_level, headcount, skill:skill_id(name)').eq('project_id', id),
      supabase.from('allocation_overview').select('*').eq('project_id', id).order('start_date'),
      supabase.from('employee').select('id, full_name, role_title, seniority, active').order('full_name'),
      supabase.from('employee_skill').select('employee_id, skill_id, validated_level, willing'),
      supabase.from('skill').select('id, name').eq('active', true).order('name'),
      supabase.from('role_profile').select('id, name, description, skills:role_profile_skill(skill_id, min_level)').order('name'),
    ])
    const err = p.error ?? r.error ?? t.error ?? e.error ?? es.error ?? s.error ?? rp.error
    if (err) { setError(err.message); setState('ready'); return }
    if (!p.data) { setState('missing'); return }
    setProject(p.data as ProjectRow)
    setReqs(((r.data ?? []) as unknown as (Req & { skill: { name: string } })[])
      .map((x) => ({ ...x, skill: x.skill.name }))
      .sort((a, b) => b.min_level - a.min_level || a.skill.localeCompare(b.skill)))
    setTeam((t.data ?? []) as AllocationRow[])
    setPeople((e.data ?? []) as Person[])
    const h: Record<string, Record<string, HeldSkill>> = {}
    for (const x of es.data ?? []) {
      if ((x.validated_level ?? 0) > 0) (h[x.employee_id] ??= {})[x.skill_id] = { level: x.validated_level, willing: x.willing }
    }
    setHeld(h)
    setSkills(s.data ?? [])
    setRoleProfiles((rp.data ?? []) as RoleProfile[])
    setState('ready')
  }, [id])
  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!project) return
    supabase.rpc('availability', { _on: fitDay }).then(({ data }) =>
      setAvail(Object.fromEntries(((data ?? []) as Availability[]).map((a) => [a.employee_id, a]))))
  }, [project, fitDay, team])

  const canEdit = !!project && (isAdmin || project.project_lead_id === me?.id)
  const nameOf = (pid: string) => people.find((x) => x.id === pid)?.full_name ?? 'someone outside your team'

  const run = async (p: PromiseLike<{ error: { message: string } | null }>, ok: string) => {
    setBusy(true); setError(null); setMsg(null)
    const { error } = await p
    setBusy(false)
    if (error) { setError(projectError(error.message)); return false }
    setMsg(ok)
    await load()
    return true
  }

  /* ---------- fit ---------- */
  const onTeamIds = useMemo(() => new Set(team.filter((a) => a.timing !== 'past').map((a) => a.employee_id)), [team])
  const candidates = useMemo(() => people
    .filter((x) => x.active && !onTeamIds.has(x.id))
    .map((x) => ({ person: x, fit: fitScore(held[x.id] ?? {}, reqs, avail[x.id]?.busy ?? false) }))
    .filter((c) => c.fit && c.fit.met > 0)
    .sort((a, b) => (b.fit?.score ?? 0) - (a.fit?.score ?? 0) || a.person.full_name.localeCompare(b.person.full_name)),
  [people, onTeamIds, held, reqs, avail])
  const gaps = reqs.map((r) => {
    const qualified = (pid: string) => (held[pid]?.[r.skill_id]?.level ?? 0) >= r.min_level
    const onTeam = [...onTeamIds].filter(qualified).length
    const free = people.filter((x) => x.active && !onTeamIds.has(x.id) && qualified(x.id) && !avail[x.id]?.busy).length
    return { ...r, onTeam, free, short: Math.max(0, (r.headcount ?? 1) - onTeam) }
  })

  if (state === 'loading') return <div className="muted">Loading</div>
  if (state === 'missing' || !project) {
    return (
      <div>
        <h1>Project</h1>
        <div className="error">You can't see this project, or it doesn't exist.</div>
        <Link className="linkbtn" to="/projects">← All projects</Link>
      </div>
    )
  }

  return (
    <div style={{ maxWidth: 980 }}>
      <p style={{ margin: '0 0 8px' }}><Link className="linkbtn" to="/projects">← All projects</Link></p>
      <div className="row" style={{ marginBottom: 6 }}>
        <h1 style={{ margin: 0 }}>{project.name}</h1>
        <span className={`st st-${project.status}`}>{STATUS_LABEL[project.status]}</span>
      </div>
      <p className="muted">
        {project.client ?? 'No client'} · {fmtRange(project.start_date, project.end_date)}
        {project.project_lead_id && ` · project lead ${nameOf(project.project_lead_id)}`}
        {!canEdit && ' · you can view this project but not change it'}
      </p>
      {startPassed(project) && <div className="warn">The start date has passed but the project is still in the pipeline. Confirm or cancel it.</div>}
      {error && <div className="error">{error}</div>}
      {msg && <div className="ok">{msg}</div>}

      <Details project={project} canEdit={canEdit} isAdmin={isAdmin} people={people} busy={busy} run={run}
        teamSize={team.length} onDeleted={() => navigate('/projects')} setError={setError} />
      <Stack project={project} reqs={reqs} skills={skills} roleProfiles={roleProfiles} canEdit={canEdit} busy={busy} run={run} setBusy={setBusy} setError={setError} setMsg={setMsg} load={load} />
      <Team project={project} team={team} people={people} reqs={reqs} profiles={roleProfiles} held={held} canEdit={canEdit} busy={busy} run={run} />

      {reqs.length > 0 && (
        <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
          <div className="thead">
            Who fits · availability on {fmtDate(fitDay)}{fitDay !== todayIso() && ' (project start)'} · validated levels only
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap' }}>
            <div style={{ flex: '2 1 420px', borderRight: '1px solid var(--line)' }}>
              {candidates.length === 0 && <div className="pad muted">Nobody you can see meets any of the required skills.</div>}
              {candidates.slice(0, 15).map(({ person, fit }) => (
                <div className="trow" key={person.id} data-candidate={person.full_name}>
                  <div className={(fit?.score ?? 0) >= 60 ? 'score hi' : 'score'}>{fit?.score}</div>
                  <div style={{ flex: 1 }}>
                    <Link className="linkbtn" to={`/one-pager/${person.id}`} style={{ color: 'var(--ink)' }}>{person.full_name}</Link>
                    <div className="muted">
                      {person.role_title}{person.seniority && ` · ${cap(person.seniority)}`} · meets {fit?.met}/{fit?.total}
                      {fit && fit.missing.length > 0 && ` · missing ${fit.missing.join(', ')}`}
                    </div>
                  </div>
                  <span className={`tag ${availabilityTone(avail[person.id])}`}>{availabilityLabel(avail[person.id])}</span>
                </div>
              ))}
              {candidates.length > 15 && <div className="pad muted">+{candidates.length - 15} more</div>}
            </div>
            <div style={{ flex: '1 1 260px' }} className="pad">
              <div className="muted" style={{ fontWeight: 700, marginBottom: 8 }}>Required stack vs team</div>
              {gaps.map((g) => (
                <div key={g.id} className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }} data-gap={g.skill}>
                  <div>
                    <b>{g.skill}</b> <span className="muted">≥{g.min_level}</span>
                    <div className="muted">need {g.headcount} · on team {g.onTeam} · {g.free} free & qualified</div>
                  </div>
                  {g.short > 0 ? <span className="tag bad">short {g.short}</span> : <span className="tag okc">covered</span>}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

type Run = (p: PromiseLike<{ error: { message: string } | null }>, ok: string) => Promise<boolean>

/* ---------------- details ---------------- */
function Details({ project, canEdit, isAdmin, people, busy, run, teamSize, onDeleted, setError }: {
  project: ProjectRow; canEdit: boolean; isAdmin: boolean; people: Person[]; busy: boolean; run: Run
  teamSize: number; onDeleted: () => void; setError: (e: string | null) => void
}) {
  const initial = () => ({
    name: project.name, client: project.client ?? '', description: project.description ?? '', stage: project.stage,
    start_date: project.start_date ?? '',
    end_date: project.end_date ?? '', project_lead_id: project.project_lead_id ?? '',
  })
  const [f, setF] = useState(initial)
  const [editing, setEditing] = useState(false)

  const save = async () => {
    const ok = await run(supabase.from('project').update({
      name: f.name.trim().replace(/\s+/g, ' '), client: f.client.trim() || null, description: f.description.trim() || null,
      stage: f.stage,
      start_date: f.start_date || null, end_date: f.end_date || null,
      ...(isAdmin ? { project_lead_id: f.project_lead_id || null } : {}),
    }).eq('id', project.id), 'Project saved.')
    if (ok) setEditing(false)
  }
  const remove = async () => {
    if (!window.confirm(`Delete “${project.name}”? Its required stack goes too. This can't be undone.`)) return
    const { error } = await supabase.from('project').delete().eq('id', project.id)
    if (error) { setError(projectError(error.message)); return }
    onDeleted()
  }

  if (!editing) {
    return (
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <div>
            <div><b>Stage:</b> {project.stage === 'pipeline' ? 'Pipeline (not won yet)' : cap(project.stage)}</div>
            {project.description && <div className="muted" style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{project.description}</div>}
          </div>
          {canEdit && (
            <div className="row">
              <button className="small" onClick={() => { setF(initial()); setEditing(true) }}>Edit details</button>
              {isAdmin && (
                <button className="ghost small" style={{ marginTop: 0 }} onClick={remove} disabled={teamSize > 0}
                  title={teamSize > 0 ? 'This project has team history: set it to Cancelled instead' : 'Delete project'}>Delete</button>
              )}
            </div>
          )}
        </div>
      </div>
    )
  }
  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="grid2">
        <label>Name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label>Client<input value={f.client} onChange={(e) => setF({ ...f, client: e.target.value })} /></label>
        <label>Stage
          <select value={f.stage} onChange={(e) => setF({ ...f, stage: e.target.value as Stage })}>
            <option value="pipeline">Pipeline (not won yet)</option>
            <option value="confirmed">Confirmed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
        <label>Start{f.stage === 'confirmed' && ' (required)'}<input type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} /></label>
        <label>End (empty = open-ended)<input type="date" value={f.end_date} onChange={(e) => setF({ ...f, end_date: e.target.value })} /></label>
        <label>Project lead{!isAdmin && ' (admin only)'}
          <select value={f.project_lead_id} disabled={!isAdmin} onChange={(e) => setF({ ...f, project_lead_id: e.target.value })}>
            <option value="">None</option>
            {people.filter((x) => x.active || x.id === f.project_lead_id).map((x) => <option key={x.id} value={x.id}>{x.full_name}</option>)}
            {f.project_lead_id && !people.some((x) => x.id === f.project_lead_id) && <option value={f.project_lead_id}>(current lead)</option>}
          </select>
        </label>
      </div>
      <label style={{ marginTop: 12 }}>Description<textarea rows={3} maxLength={2000} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
      <div className="row" style={{ marginTop: 12 }}>
        <button onClick={save} disabled={busy || !f.name.trim() || (f.stage === 'confirmed' && !f.start_date)}>Save</button>
        <button className="ghost small" style={{ marginTop: 0 }} onClick={() => setEditing(false)}>Cancel</button>
        <span className="muted">The status (upcoming, active, closing, delivered) follows the dates by itself.</span>
      </div>
    </div>
  )
}

/* ---------------- required stack ---------------- */
function Stack({ project, reqs, skills, roleProfiles, canEdit, busy, run, setBusy, setError, setMsg, load }: {
  project: ProjectRow; reqs: Req[]; skills: SkillOpt[]; roleProfiles: RoleProfile[]; canEdit: boolean; busy: boolean; run: Run
  setBusy: (b: boolean) => void; setError: (e: string | null) => void; setMsg: (m: string | null) => void; load: () => Promise<void>
}) {
  const [add, setAdd] = useState({ skill: '', level: 3, headcount: 1 })
  const [role, setRole] = useState({ id: '', count: 1 })
  const inStack = new Set(reqs.map((r) => r.skill_id))

  const addSkill = async () => {
    if (!add.skill) return
    const name = skills.find((s) => s.id === add.skill)?.name
    if (await run(supabase.from('project_requirement').insert({ project_id: project.id, skill_id: add.skill, min_level: add.level, headcount: add.headcount }),
      `${name} ≥${add.level} × ${add.headcount} added to the stack.`)) setAdd({ skill: '', level: 3, headcount: 1 })
  }
  // A role profile is a template: its skills are copied into the stack (stricter level wins,
  // head-counts add up), and can then be changed freely here.
  const addRole = async () => {
    const rp = roleProfiles.find((r) => r.id === role.id)
    if (!rp) return
    if (rp.skills.length === 0) { setError(`“${rp.name}” has no skills yet. Add them in Admin → Role profiles.`); return }
    setBusy(true); setError(null); setMsg(null)
    for (const s of rp.skills) {
      const cur = reqs.find((r) => r.skill_id === s.skill_id)
      const { error } = cur
        ? await supabase.from('project_requirement').update({ min_level: Math.max(cur.min_level, s.min_level), headcount: (cur.headcount ?? 1) + role.count }).eq('id', cur.id)
        : await supabase.from('project_requirement').insert({ project_id: project.id, skill_id: s.skill_id, min_level: s.min_level, headcount: role.count })
      if (error) { setBusy(false); setError(projectError(error.message)); await load(); return }
    }
    setBusy(false)
    setMsg(`Added ${rp.name} × ${role.count}: ${rp.skills.length} ${rp.skills.length === 1 ? 'skill' : 'skills'} in the stack.`)
    setRole({ id: '', count: 1 })
    await load()
  }

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
      <div className="thead">Required stack · {reqs.length} {reqs.length === 1 ? 'skill' : 'skills'}</div>
      {reqs.length === 0 && <div className="pad muted">No required skills yet.{canEdit && ' Add skills one by one, or add a role profile.'}</div>}
      {reqs.map((r) => (
        <div className="trow" key={r.id} data-req={r.skill}>
          <b style={{ flex: 1 }}>{r.skill}</b>
          {canEdit ? (
            <>
              <select value={r.min_level} disabled={busy} onChange={(e) => run(supabase.from('project_requirement').update({ min_level: Number(e.target.value) }).eq('id', r.id), `${r.skill}: level ≥${e.target.value}.`)}>
                {LEVELS.map((n) => <option key={n} value={n}>≥ {n}</option>)}
              </select>
              <select value={r.headcount} disabled={busy} onChange={(e) => run(supabase.from('project_requirement').update({ headcount: Number(e.target.value) }).eq('id', r.id), `${r.skill}: ${e.target.value} needed.`)}>
                {Array.from({ length: Math.max(10, r.headcount ?? 1) }, (_, i) => i + 1).map((n) => <option key={n} value={n}>× {n}</option>)}
              </select>
              <button className="ghost small" style={{ marginTop: 0 }} disabled={busy}
                onClick={() => run(supabase.from('project_requirement').delete().eq('id', r.id), `${r.skill} removed from the stack.`)}>Remove</button>
            </>
          ) : <span className="muted">≥ {r.min_level} × {r.headcount}</span>}
        </div>
      ))}
      {canEdit && (
        <>
          <div className="pad row">
            <select value={add.skill} onChange={(e) => setAdd({ ...add, skill: e.target.value })}>
              <option value="">Add a skill…</option>
              {skills.filter((s) => !inStack.has(s.id)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            <select value={add.level} onChange={(e) => setAdd({ ...add, level: Number(e.target.value) })}>
              {LEVELS.map((n) => <option key={n} value={n}>≥ {n}</option>)}
            </select>
            <select value={add.headcount} onChange={(e) => setAdd({ ...add, headcount: Number(e.target.value) })}>
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>× {n}</option>)}
            </select>
            <button onClick={addSkill} disabled={busy || !add.skill}>Add</button>
          </div>
          <div className="pad row" style={{ paddingTop: 0 }}>
            <select value={role.id} onChange={(e) => setRole({ ...role, id: e.target.value })}>
              <option value="">Add a role profile…</option>
              {roleProfiles.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.skills.length} skills)</option>)}
            </select>
            <select value={role.count} onChange={(e) => setRole({ ...role, count: Number(e.target.value) })}>
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>× {n}</option>)}
            </select>
            <button onClick={addRole} disabled={busy || !role.id}>Add role</button>
            {roleProfiles.length === 0 && <span className="muted">No role profiles yet (Admin → Role profiles).</span>}
          </div>
        </>
      )}
    </div>
  )
}

/* ---------------- team ---------------- */
// Role on the project: pick one of the role profiles (the description explains it), or write your own.
function RolePick({ value, profiles, onChange }: { value: string; profiles: RoleProfile[]; onChange: (v: string) => void }) {
  const known = profiles.some((p) => p.name === value)
  const [other, setOther] = useState(value !== '' && !known)
  const chosen = profiles.find((p) => p.name === value)
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', gap: 4 }}>
      <span className="row">
        <select value={other ? '__other' : value} title={chosen?.description ?? undefined}
          onChange={(x) => {
            if (x.target.value === '__other') { setOther(true); onChange(known ? '' : value) } else { setOther(false); onChange(x.target.value) }
          }}>
          <option value="">Role on the project…</option>
          {profiles.map((p) => <option key={p.id} value={p.name}>{p.name}</option>)}
          <option value="__other">Other (write it)…</option>
        </select>
        {other && <input placeholder="Role on the project, e.g. Backend" maxLength={80} value={value} onChange={(x) => onChange(x.target.value)} />}
      </span>
      {chosen?.description && <span className="muted" style={{ maxWidth: 320, whiteSpace: 'normal' }}>{chosen.description}</span>}
    </span>
  )
}

function Team({ project, team, people, reqs, profiles, held, canEdit, busy, run }: {
  project: ProjectRow; team: AllocationRow[]; people: Person[]; reqs: Req[]; profiles: RoleProfile[]
  held: Record<string, Record<string, HeldSkill>>; canEdit: boolean; busy: boolean; run: Run
}) {
  const blank = () => ({
    employee_id: '', role_title: '',
    start_date: project.start_date && project.start_date > todayIso() ? project.start_date : todayIso(),
    end_date: project.end_date ?? '',
  })
  const [f, setF] = useState(blank)
  const [editId, setEditId] = useState<string | null>(null)
  const [e, setE] = useState({ role_title: '', start_date: '', end_date: '' })
  const [timing, setTiming] = useState<'now' | 'past'>('now')
  const nameOf = (pid: string) => people.find((x) => x.id === pid)?.full_name ?? 'someone outside your team'
  const inactive = (pid: string) => people.some((x) => x.id === pid && !x.active)

  // Usually a person is on one project at a time: on a confirmed project, warn when the period
  // overlaps another confirmed project of theirs (not counting `skipId`). It's a warning, not a block.
  const okToBook = async (employeeId: string, from: string, to: string | null, skipId?: string) => {
    if (project.stage !== 'confirmed') return true
    const { data } = await supabase.from('allocation_overview')
      .select('id, project_id, project_name, start_date, end_date, stage').eq('employee_id', employeeId)
    const clash = ((data ?? []) as AllocationRow[]).filter((a) => a.id !== skipId && a.stage === 'confirmed'
      && a.project_id !== project.id && a.start_date <= (to ?? '9999-12-31') && (a.end_date ?? '9999-12-31') >= from)
    if (clash.length === 0) return true
    const where = clash.map((a) => `${a.project_name} (${fmtRange(a.start_date, a.end_date)})`).join(', ')
    return window.confirm(`${nameOf(employeeId)} is already on ${where} during these dates. Put them on ${project.name} as well?`)
  }

  const add = async () => {
    if (!f.employee_id || !f.start_date) return
    if (!(await okToBook(f.employee_id, f.start_date, f.end_date || null))) return
    if (await run(supabase.from('allocation').insert({
      project_id: project.id, employee_id: f.employee_id, role_title: f.role_title.trim() || null,
      start_date: f.start_date, end_date: f.end_date || null,
    }), `${nameOf(f.employee_id)} added to the team.`)) setF(blank())
  }
  const saveEdit = async (a: AllocationRow) => {
    if (!(await okToBook(a.employee_id, e.start_date, e.end_date || null, a.id))) return
    if (await run(supabase.from('allocation').update({
      role_title: e.role_title.trim() || null, start_date: e.start_date, end_date: e.end_date || null,
    }).eq('id', a.id), `${nameOf(a.employee_id)} updated.`)) setEditId(null)
  }
  const remove = (a: AllocationRow) => {
    if (!window.confirm(`Remove ${nameOf(a.employee_id)} from ${project.name}? (To keep the history, set an end date instead.)`)) return
    run(supabase.from('allocation').delete().eq('id', a.id), `${nameOf(a.employee_id)} removed from the team.`)
  }

  // when adding someone, show how they match the stack
  const pick = f.employee_id ? fitScore(held[f.employee_id] ?? {}, reqs, false) : null
  const shown = team.filter((a) => (timing === 'past' ? a.timing === 'past' : a.timing !== 'past'))
  const pastCount = team.filter((a) => a.timing === 'past').length

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
      <div className="thead row" style={{ justifyContent: 'space-between' }}>
        <span>Team · {team.length - pastCount} now or upcoming{!canEdit && ' (you see the people you lead)'}</span>
        {pastCount > 0 && (
          <span className="seg" style={{ margin: 0 }}>
            <button className={timing === 'now' ? 'on' : ''} onClick={() => setTiming('now')}>Now & upcoming</button>
            <button className={timing === 'past' ? 'on' : ''} onClick={() => setTiming('past')}>Past {pastCount}</button>
          </span>
        )}
      </div>
      {shown.length === 0 && <div className="pad muted">{timing === 'past' ? 'Nobody has finished on this project yet.' : 'Nobody on this project yet.'}</div>}
      {shown.map((a) => editId === a.id ? (
        <div className="pad row" key={a.id} style={{ borderBottom: '1px solid var(--line)' }}>
          <b>{nameOf(a.employee_id)}</b>
          <RolePick value={e.role_title} profiles={profiles} onChange={(v) => setE({ ...e, role_title: v })} />
          <input type="date" value={e.start_date} onChange={(x) => setE({ ...e, start_date: x.target.value })} />
          <input type="date" value={e.end_date} onChange={(x) => setE({ ...e, end_date: x.target.value })} />
          <button className="small" disabled={busy || !e.start_date} onClick={() => saveEdit(a)}>Save</button>
          <button className="ghost small" style={{ marginTop: 0 }} onClick={() => setEditId(null)}>Cancel</button>
        </div>
      ) : (
        <div className="trow" key={a.id} data-member={nameOf(a.employee_id)}>
          <div style={{ flex: 1.4 }}>
            <Link className="linkbtn" to={`/one-pager/${a.employee_id}`} style={{ color: 'var(--ink)' }}>{nameOf(a.employee_id)}</Link>
            {inactive(a.employee_id) && <span className="tag bad" style={{ marginLeft: 6 }}>inactive</span>}
            <div className="muted">{a.role_title ?? 'no role set'}</div>
          </div>
          <div style={{ flex: 1.4 }} className="muted">{fmtRange(a.start_date, a.end_date)}</div>
          <span className={`tag ${a.timing === 'current' ? 'okc' : ''}`} style={{ width: 70, textAlign: 'center' }}>{a.timing}</span>
          {canEdit && (
            <>
              <button className="small" disabled={busy} onClick={() => { setEditId(a.id); setE({ role_title: a.role_title ?? '', start_date: a.start_date, end_date: a.end_date ?? '' }) }}>Edit</button>
              <button className="ghost small" style={{ marginTop: 0 }} disabled={busy} onClick={() => remove(a)}>Remove</button>
            </>
          )}
        </div>
      ))}
      {canEdit && (
        <div className="pad" style={{ borderTop: '1px solid var(--line)' }}>
          <div className="row">
            <select value={f.employee_id} onChange={(x) => setF({ ...f, employee_id: x.target.value })}>
              <option value="">Add a person…</option>
              {people.filter((x) => x.active).map((x) => <option key={x.id} value={x.id}>{x.full_name}</option>)}
            </select>
            <RolePick value={f.role_title} profiles={profiles} onChange={(v) => setF({ ...f, role_title: v })} />
            <input type="date" value={f.start_date} onChange={(x) => setF({ ...f, start_date: x.target.value })} title="From" />
            <input type="date" value={f.end_date} onChange={(x) => setF({ ...f, end_date: x.target.value })} title="To (empty = open-ended)" />
            <button onClick={add} disabled={busy || !f.employee_id || !f.start_date}>Add to team</button>
          </div>
          {pick && (
            <div className={pick.missing.length ? 'muted' : 'muted'} style={{ marginTop: 8 }}>
              Meets {pick.met} of {pick.total} required skills{pick.missing.length > 0 ? `; below the stack in: ${pick.missing.join(', ')}` : ' — all of them'}.
            </div>
          )}
          {!project.start_date && <div className="muted" style={{ marginTop: 8 }}>Tip: give the project dates so the team's dates default to them.</div>}
          {project.stage === 'pipeline' && <div className="muted" style={{ marginTop: 8 }}>This project is still in the pipeline: people on it show as tentative and still count as free.</div>}
        </div>
      )}
    </div>
  )
}
