import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'

interface Skill { id: string; name: string }
interface Person { employee_id: string; full_name: string; role_title: string | null; skill_level: number | null }
interface MapRow { skill_id: string; skill: string; category: string; holders: number; avg_level: number | null }

export default function Ask() {
  const { roles } = useAuth()
  const seesNames = roles.some((r) => r === 'admin' || r === 'manager' || r === 'team_lead')
  const [skills, setSkills] = useState<Skill[]>([])
  const [skill, setSkill] = useState('')
  const [minLevel, setMinLevel] = useState(3)
  const [count, setCount] = useState<number | null>(null)
  const [people, setPeople] = useState<Person[]>([])
  const [map, setMap] = useState<MapRow[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    supabase.from('skill').select('id, name').eq('active', true).order('name').then(({ data }) => {
      setSkills(data ?? [])
      setSkill((cur) => cur || data?.find((s) => s.name === 'PostgreSQL')?.id || data?.[0]?.id || '')
    })
    supabase.rpc('skill_map').then(({ data, error }) => {
      if (error) setError(error.message)
      else setMap((data ?? []) as MapRow[])
    })
  }, [])

  useEffect(() => {
    if (!skill) return
    setError(null)
    supabase.rpc('skill_holder_count', { _skill: skill, _min_level: minLevel }).then(({ data, error }) => {
      if (error) setError(error.message)
      else setCount(data as number)
    })
    if (seesNames) {
      supabase.rpc('search_people', { _q: null, _skill: skill, _min_level: minLevel }).then(({ data, error }) => {
        if (error) setError(error.message)
        else setPeople((data ?? []) as Person[])
      })
    }
  }, [skill, minLevel, seesNames])

  const skillName = skills.find((s) => s.id === skill)?.name ?? ''

  return (
    <div style={{ maxWidth: 820 }}>
      <h1>Ask</h1>
      <p className="muted">Who knows what?</p>
      {error && <div className="error">{error}</div>}
      <div className="row" style={{ marginBottom: 12 }}>
        <select value={skill} onChange={(e) => setSkill(e.target.value)}>
          {skills.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={minLevel} onChange={(e) => setMinLevel(Number(e.target.value))}>
          {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>validated ≥ level {n}</option>)}
        </select>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 28, fontWeight: 700 }}>{count ?? '…'}</div>
        <div className="muted">
          {count === 1 ? 'person knows' : 'people know'} {skillName} at validated level {minLevel} or higher
        </div>
        {seesNames ? (
          <div style={{ marginTop: 12 }}>
            {people.map((p) => (
              <div className="trow" key={p.employee_id} style={{ padding: '8px 0' }}>
                <div style={{ flex: 1, fontWeight: 600 }}>{p.full_name}</div>
                <span className="muted">{p.role_title}</span>
                <b>{p.skill_level}</b>
              </div>
            ))}
            {people.length < (count ?? 0) && (
              <div className="muted" style={{ marginTop: 8 }}>
                You can see {people.length} of them. Others are outside your team.
              </div>
            )}
          </div>
        ) : (
          <div className="muted" style={{ marginTop: 10 }}>Names are visible to team leaders, managers and HR only.</div>
        )}
      </div>

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="thead">Company skill map · validated skills only</div>
        {map.map((m) => (
          <div className="trow" key={m.skill_id}>
            <div style={{ flex: 1, fontWeight: 600 }}>{m.skill}</div>
            <span className="muted" style={{ width: 130 }}>{m.category}</span>
            <span style={{ width: 90 }}>{m.holders} {m.holders === 1 ? 'person' : 'people'}</span>
            <span className="muted" style={{ width: 70 }}>avg {m.avg_level ?? '–'}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
