import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

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
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase.from('skill').select('id, name').eq('active', true).order('name')
      .then(({ data }) => setSkills(data ?? []))
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
    const { data } = await supabase
      .from('employee_skill')
      .select('id, self_level, validated_level, skill:skill_id(name)')
      .eq('employee_id', id)
    setDetail(((data ?? []) as unknown as Detail[]).sort((a, b) => (b.validated_level ?? 0) - (a.validated_level ?? 0)))
  }

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
        <span className="muted">{people.length} {people.length === 1 ? 'person' : 'people'}</span>
      </div>
      {error && <div className="error">{error}</div>}
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="thead trow" style={{ borderBottom: '1px solid var(--line)' }}>
          <div style={{ flex: 2 }}>Person</div><div style={{ flex: 1 }}>Seniority</div><div style={{ width: 130 }}>{skill ? 'Skill level' : ''}</div>
        </div>
        {people.length === 0 && <div className="pad muted">No one matches.</div>}
        {people.map((p) => (
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
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
