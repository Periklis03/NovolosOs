import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'

interface Row {
  id: string
  self_level: number | null
  validated_level: number | null
  willing: boolean
  skill: { id: string; name: string; category: { name: string } | null }
}
interface SkillOpt { id: string; name: string }
interface Cat { id: string; name: string }

const LEVELS = [1, 2, 3, 4, 5]

export default function MyProfile() {
  const { employee } = useAuth()
  const [rows, setRows] = useState<Row[]>([])
  const [allSkills, setAllSkills] = useState<SkillOpt[]>([])
  const [cats, setCats] = useState<Cat[]>([])
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const [addSkill, setAddSkill] = useState('')
  const [addLevel, setAddLevel] = useState(3)
  const [propName, setPropName] = useState('')
  const [propCat, setPropCat] = useState('')

  const load = useCallback(async () => {
    if (!employee) return
    const [mine, skills, categories] = await Promise.all([
      supabase
        .from('employee_skill')
        .select('id, self_level, validated_level, willing, skill:skill_id(id, name, category:category_id(name))')
        .eq('employee_id', employee.id),
      supabase.from('skill').select('id, name').eq('active', true).order('name'),
      supabase.from('skill_category').select('id, name').order('sort_order'),
    ])
    const err = mine.error ?? skills.error ?? categories.error
    if (err) { setError(err.message); return }
    const list = (mine.data as unknown as Row[]).sort((a, b) => a.skill.name.localeCompare(b.skill.name))
    setRows(list)
    setAllSkills(skills.data ?? [])
    setCats(categories.data ?? [])
    setPropCat((c) => c || (categories.data?.[0]?.id ?? ''))
  }, [employee])

  useEffect(() => { load() }, [load])

  const run = async (p: PromiseLike<{ error: { message: string } | null }>, ok?: string) => {
    setError(null); setMsg(null)
    const { error } = await p
    if (error) { setError(error.message); return false }
    if (ok) setMsg(ok)
    await load()
    return true
  }

  const setSelf = (id: string, level: number) =>
    run(supabase.from('employee_skill').update({ self_level: level }).eq('id', id))
  const setWilling = (id: string, willing: boolean) =>
    run(supabase.from('employee_skill').update({ willing }).eq('id', id))
  const remove = (id: string) =>
    run(supabase.from('employee_skill').delete().eq('id', id))

  const add = async () => {
    if (!employee || !addSkill) return
    const ok = await run(
      supabase.from('employee_skill').insert({ employee_id: employee.id, skill_id: addSkill, self_level: addLevel, willing: true }),
      'Skill added. A team lead can now validate it.',
    )
    if (ok) setAddSkill('')
  }

  const propose = async () => {
    if (!employee || !propName.trim()) return
    const ok = await run(
      supabase.from('skill_proposal').insert({ proposed_by: employee.id, name: propName.trim(), category_id: propCat || null }),
      'Proposal sent to an admin for approval.',
    )
    if (ok) setPropName('')
  }

  const have = new Set(rows.map((r) => r.skill.id))
  const available = allSkills.filter((s) => !have.has(s.id))

  return (
    <div style={{ maxWidth: 780 }}>
      <h1>My profile</h1>
      <p className="muted">{employee?.full_name} · {employee?.role_title ?? 'no title'}</p>
      {error && <div className="error">{error}</div>}
      {msg && <div className="ok">{msg}</div>}

      <div className="card" style={{ padding: 0, overflow: 'hidden', marginBottom: 16 }}>
        <div className="thead">My skills · self-assessment</div>
        {rows.length === 0 && <div className="pad muted">No skills yet. Add one below.</div>}
        {rows.map((r) => (
          <div className="trow" key={r.id}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600 }}>{r.skill.name}</div>
              <div className="muted">{r.skill.category?.name}</div>
            </div>
            <span className="muted">
              {r.validated_level != null ? `validated ${r.validated_level}` : 'not validated'}
            </span>
            <select value={r.self_level ?? 1} onChange={(e) => setSelf(r.id, Number(e.target.value))}>
              {LEVELS.map((n) => <option key={n} value={n}>self {n}</option>)}
            </select>
            <button className={r.willing ? 'chip on' : 'chip'} onClick={() => setWilling(r.id, !r.willing)}>
              {r.willing ? 'willing' : 'prefers not'}
            </button>
            <button className="ghost small" onClick={() => remove(r.id)} aria-label={`Remove ${r.skill.name}`}>Remove</button>
          </div>
        ))}
        <div className="pad row">
          <select value={addSkill} onChange={(e) => setAddSkill(e.target.value)}>
            <option value="">Add a skill…</option>
            {available.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select value={addLevel} onChange={(e) => setAddLevel(Number(e.target.value))}>
            {LEVELS.map((n) => <option key={n} value={n}>self {n}</option>)}
          </select>
          <button onClick={add} disabled={!addSkill}>Add</button>
        </div>
        <div className="pad muted" style={{ paddingTop: 0 }}>
          Validated levels are confirmed by your team lead. You can only change your own self-assessment.
        </div>
      </div>

      <div className="card">
        <div className="thead" style={{ margin: '-16px -16px 12px' }}>Skill not in the list?</div>
        <div className="row">
          <input placeholder="Skill name" value={propName} onChange={(e) => setPropName(e.target.value)} />
          <select value={propCat} onChange={(e) => setPropCat(e.target.value)}>
            {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button onClick={propose} disabled={!propName.trim()}>Propose</button>
        </div>
      </div>
    </div>
  )
}
