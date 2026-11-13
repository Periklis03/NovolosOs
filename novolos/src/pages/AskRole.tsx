import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import type { Availability, HeldSkill, Requirement } from '../lib/projects'
import { availabilityLabel, availabilityTone, cap, fitScore, senRank } from '../lib/projects'

// Ask → "Who fits a role?": ranks the people you can see against a role profile, with the same
// score as a project's "Who fits" (validated levels only, availability today).

interface Role { id: string; name: string; min_seniority: string | null; skills: { skill_id: string; min_level: number; skill: { name: string } }[] }
interface Person { id: string; full_name: string; role_title: string | null; seniority: string | null; active: boolean }

export default function AskRole() {
  const [roles, setRoles] = useState<Role[]>([])
  const [roleId, setRoleId] = useState('')
  const [people, setPeople] = useState<Person[]>([])
  const [held, setHeld] = useState<Record<string, Record<string, HeldSkill>>>({})
  const [avail, setAvail] = useState<Record<string, Availability>>({})
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      const [r, e, es, a] = await Promise.all([
        supabase.from('role_profile').select('id, name, min_seniority, skills:role_profile_skill(skill_id, min_level, skill:skill_id(name))').order('name'),
        supabase.from('employee').select('id, full_name, role_title, seniority, active').eq('active', true),
        supabase.from('employee_skill').select('employee_id, skill_id, validated_level, willing'),
        supabase.rpc('availability'),
      ])
      const err = r.error ?? e.error ?? es.error ?? a.error
      if (err) { setError(err.message); return }
      const list = (r.data ?? []) as unknown as Role[]
      setRoles(list)
      setRoleId((cur) => cur || list[0]?.id || '')
      setPeople((e.data ?? []) as Person[])
      const h: Record<string, Record<string, HeldSkill>> = {}
      for (const x of es.data ?? []) if ((x.validated_level ?? 0) > 0) (h[x.employee_id] ??= {})[x.skill_id] = { level: x.validated_level, willing: x.willing }
      setHeld(h)
      setAvail(Object.fromEntries(((a.data ?? []) as Availability[]).map((x) => [x.employee_id, x])))
    })()
  }, [])

  const role = roles.find((r) => r.id === roleId)
  const reqs: Requirement[] = useMemo(() => (role?.skills ?? []).map((s) => ({ skill_id: s.skill_id, skill: s.skill.name, min_level: s.min_level })), [role])
  const ranked = useMemo(() => people
    .map((p) => ({ p, fit: fitScore(held[p.id] ?? {}, reqs, avail[p.id]?.busy ?? false), senior: senRank(p.seniority) >= senRank(role?.min_seniority) }))
    .filter((x) => x.fit && x.fit.met > 0)
    .sort((a, b) => Number(b.senior) - Number(a.senior) || (b.fit?.score ?? 0) - (a.fit?.score ?? 0) || a.p.full_name.localeCompare(b.p.full_name)),
  [people, held, reqs, avail, role])

  if (error) return <div className="error">{error}</div>
  if (roles.length === 0) return <div className="card muted">No role profiles yet. An admin creates them in Admin → Role profiles.</div>

  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <select value={roleId} onChange={(e) => setRoleId(e.target.value)}>
          {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        {role && (
          <span className="muted">
            {role.skills.map((s) => `${s.skill.name} ≥${s.min_level}`).join(', ') || 'no skills yet'}
            {role.min_seniority && ` · ${cap(role.min_seniority)} or more senior`}
          </span>
        )}
      </div>
      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        <div className="thead">Best fits you can see · score from validated skills and availability today</div>
        {reqs.length === 0 && <div className="pad muted">This role has no skills yet.</div>}
        {reqs.length > 0 && ranked.length === 0 && <div className="pad muted">Nobody you can see meets any of these skills.</div>}
        {ranked.slice(0, 15).map(({ p, fit, senior }) => (
          <div className="trow" key={p.id} data-fit={p.full_name}>
            <div className={(fit?.score ?? 0) >= 60 ? 'score hi' : 'score'}>{fit?.score}</div>
            <div style={{ flex: 1 }}>
              <Link className="linkbtn" to={`/one-pager/${p.id}`} style={{ color: 'var(--ink)' }}>{p.full_name}</Link>
              <div className="muted">
                {p.role_title}{p.seniority && ` · ${cap(p.seniority)}`} · meets {fit?.met}/{fit?.total}
                {fit && fit.missing.length > 0 && ` · missing ${fit.missing.join(', ')}`}
                {!senior && ' · below the seniority of this role'}
              </div>
            </div>
            <span className={`tag ${availabilityTone(avail[p.id])}`}>{availabilityLabel(avail[p.id])}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
