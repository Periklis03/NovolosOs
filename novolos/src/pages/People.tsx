import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { AllocationRow, Availability } from '../lib/projects'
import { availabilityLabel, availabilityTone, fmtRange } from '../lib/projects'

interface Person {
  employee_id: string
  full_name: string
  role_title: string | null
  seniority: string | null
  years_experience: number | null
  skill_level: number | null
  self_level: number | null
}
interface Skill { id: string; name: string }
interface Detail { id: string; self_level: number | null; validated_level: number | null; skill: { name: string } }

export default function People() {
  const [skills, setSkills] = useState<Skill[]>([])
  const [q, setQ] = useState('')
  const [skill, setSkill] = useState('')
  const [minLevel, setMinLevel] = useState(1)
  const [people, setPeople] = useState<Person[]>([])
  const [open, setOpen] = useState<string | null>(null)
  const [detail, setDetail] = useState<Detail[]>([])
  const [bookings, setBookings] = useState<AllocationRow[]>([])
  const [avail, setAvail] = useState<Record<string, Availability>>({})
  const [onlyFree, setOnlyFree] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase.from('skill').select('id, name').eq('active', true).order('name')
      .then(({ data }) => setSkills(data ?? []))
    supabase.rpc('availability').then(({ data }) =>
      setAvail(Object.fromEntries(((data ?? []) as Availability[]).map((a) => [a.employee_id, a]))))
  }, [])

  useEffect(() => {
    const t = setTimeout(async () => {
      const { data, error } = await supabase.rpc('search_people', {
        _q: q.trim() || null,
        _skill: skill || null,
        _min_level: minLevel,
      })
      if (error) setError(error.message)
      else { setError(null); setPeople((data ?? []) as Person[]) }
    }, 250)
    return () => clearTimeout(t)
  }, [q, skill, minLevel])

  const toggle = async (id: string) => {
    if (open === id) { setOpen(null); return }
    setOpen(id)
    const [{ data }, b] = await Promise.all([
      supabase.from('employee_skill').select('id, self_level, validated_level, skill:skill_id(name)').eq('employee_id', id),
      supabase.from('allocation_overview').select('*').eq('employee_id', id).neq('timing', 'past').order('start_date'),
    ])
    setBookings((b.data ?? []) as AllocationRow[])
    setDetail(((data ?? []) as unknown as Detail[]).sort((a, b) => (b.validated_level ?? 0) - (a.validated_level ?? 0)))
  }

  const shown = onlyFree ? people.filter((p) => !avail[p.employee_id]?.busy) : people

  return (
    <div style={{ maxWidth: 980 }}>
      <h1>People &amp; Skills</h1>
      <p className="muted">Who knows what. You only see the people your role allows.</p>
      <div className="row" style={{ marginBottom: 12 }}>
        <input placeholder="Search name or role" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 220 }} />
        <select value={skill} onChange={(e) => setSkill(e.target.value)}>
          <option value="">Any skill</option>
          {skills.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={minLevel} disabled={!skill} onChange={(e) => setMinLevel(Number(e.target.value))}>
          {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>validated ≥ {n}</option>)}
        </select>
        <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={onlyFree} onChange={(e) => setOnlyFree(e.target.checked)} /> Available now
        </label>
        <span className="muted">{shown.length} {shown.length === 1 ? 'person' : 'people'}</span>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="thead trow" style={{ borderBottom: '1px solid var(--line)' }}>
          <div style={{ flex: 2 }}>Person</div><div style={{ flex: 1 }}>Seniority</div><div style={{ width: 130 }}>{skill ? 'Skill level' : ''}</div><div style={{ width: 150 }}>Availability</div>
        </div>
        {shown.length === 0 && <div className="pad muted">No one matches.</div>}
        {shown.map((p) => (
          <div key={p.employee_id}>
            <div className="trow clickable" onClick={() => toggle(p.employee_id)}>
              <div style={{ flex: 2 }}>
                <div style={{ fontWeight: 600 }}>{p.full_name}</div>
                <div className="muted">{p.role_title}</div>
              </div>
              <div style={{ flex: 1 }}>{p.seniority ?? '–'}{p.years_experience != null ? ` · ${p.years_experience}y` : ''}</div>
              <div style={{ width: 130 }}>
                {skill ? `validated ${p.skill_level ?? '–'} · self ${p.self_level ?? '–'}` : ''}
              </div>
              <div style={{ width: 150 }}>
                <span className={`tag ${availabilityTone(avail[p.employee_id])}`}>{availabilityLabel(avail[p.employee_id])}</span>
              </div>
            </div>
            {open === p.employee_id && (
              <div className="pad detail">
                {detail.length === 0 && <span className="muted">No skills recorded.</span>}
                {detail.map((d) => (
                  <span className="tag" key={d.id}>
                    {d.skill.name} <b>{d.validated_level ?? '?'}</b>
                    {d.validated_level == null && <small> unvalidated</small>}
                  </span>
                ))}
                <Link className="linkbtn" to={`/one-pager/${p.employee_id}`} style={{ marginLeft: 'auto' }}>Open one-pager →</Link>
                <div style={{ flexBasis: '100%' }} className="muted">
                  {bookings.length === 0 ? 'No current or upcoming projects.' : bookings.map((a, i) => (
                    <span key={a.id}>{i > 0 && ' · '}<Link className="linkbtn" to={`/projects/${a.project_id}`}>{a.project_name}</Link>{a.timing === 'future' ? ` from ${fmtRange(a.start_date, a.end_date).split(' – ')[0]}` : ''}{a.stage === 'pipeline' ? ' (tentative)' : ''}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
