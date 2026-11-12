import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { SENIORITY, cap, projectError } from '../lib/projects'

// Role profiles: "Senior Backend Engineer = Java ≥ 4, Spring Boot ≥ 4 …".
// Used as templates for a project's required stack, and in Ask → "Who fits a role?".

interface RoleSkill { id: string; skill_id: string; min_level: number; skill: { name: string } }
interface Role { id: string; name: string; description: string | null; min_seniority: string | null; skills: RoleSkill[] }
interface SkillOpt { id: string; name: string }
const LEVELS = [1, 2, 3, 4, 5]

export default function AdminRoles() {
  const [list, setList] = useState<Role[]>([])
  const [skills, setSkills] = useState<SkillOpt[]>([])
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [newName, setNewName] = useState('')
  const [draft, setDraft] = useState<Record<string, { skill: string; level: number }>>({})
  const [editing, setEditing] = useState<string | null>(null)
  const [edit, setEdit] = useState({ name: '', description: '' })

  const load = useCallback(async () => {
    const [r, s] = await Promise.all([
      supabase.from('role_profile').select('id, name, description, min_seniority, skills:role_profile_skill(id, skill_id, min_level, skill:skill_id(name))').order('name'),
      supabase.from('skill').select('id, name').eq('active', true).order('name'),
    ])
    const err = r.error ?? s.error
    if (err) { setError(err.message); return }
    setList(((r.data ?? []) as unknown as Role[]).map((x) => ({
      ...x, skills: [...x.skills].sort((a, b) => b.min_level - a.min_level || a.skill.name.localeCompare(b.skill.name)),
    })))
    setSkills(s.data ?? [])
  }, [])
  useEffect(() => { load() }, [load])

  const run = async (p: PromiseLike<{ error: { message: string } | null }>, ok: string) => {
    setBusy(true); setError(null); setMsg(null)
    const { error } = await p
    setBusy(false)
    if (error) { setError(projectError(error.message)); return false }
    setMsg(ok)
    await load()
    return true
  }

  const create = async () => {
    const name = newName.trim().replace(/\s+/g, ' ')
    if (!name) return
    if (await run(supabase.from('role_profile').insert({ name }), `Role profile “${name}” added. Now add its skills.`)) setNewName('')
  }
  const saveEdit = async (r: Role) => {
    const name = edit.name.trim().replace(/\s+/g, ' ')
    if (!name) return
    if (await run(supabase.from('role_profile').update({ name, description: edit.description.trim() || null }).eq('id', r.id), `“${name}” saved.`)) setEditing(null)
  }
  const remove = (r: Role) => {
    if (!window.confirm(`Delete the role profile “${r.name}”? Projects that used it keep their stack.`)) return
    run(supabase.from('role_profile').delete().eq('id', r.id), `“${r.name}” deleted.`)
  }
  const addSkill = async (r: Role) => {
    const d = draft[r.id]
    if (!d?.skill) return
    const name = skills.find((s) => s.id === d.skill)?.name
    if (await run(supabase.from('role_profile_skill').insert({ role_profile_id: r.id, skill_id: d.skill, min_level: d.level }),
      `${name} ≥${d.level} added to ${r.name}.`)) setDraft((m) => ({ ...m, [r.id]: { skill: '', level: d.level } }))
  }

  return (
    <div>
      <p className="muted" style={{ marginTop: 0 }}>
        A role profile is a reusable set of skills and minimum levels. Add one to a project to fill its required stack,
        or use it in Ask to see who fits. Changing a role later doesn't change projects that already used it.
      </p>
      {error && <div className="error">{error}</div>}
      {msg && <div className="ok">{msg}</div>}
      <div className="row" style={{ marginBottom: 12 }}>
        <input placeholder="New role profile, e.g. Platform Engineer" value={newName} onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && create()} style={{ minWidth: 280 }} />
        <button onClick={create} disabled={busy || !newName.trim()}>+ Add role</button>
        <span className="muted">{list.length} {list.length === 1 ? 'role profile' : 'role profiles'}</span>
      </div>

      {list.length === 0 && <div className="card muted">No role profiles yet.</div>}
      {list.map((r) => {
        const d = draft[r.id] ?? { skill: '', level: 3 }
        const have = new Set(r.skills.map((s) => s.skill_id))
        return (
          <div className="card" key={r.id} style={{ padding: 0, overflow: 'hidden', marginBottom: 12 }} data-role={r.name}>
            <div className="thead row" style={{ justifyContent: 'space-between' }}>
              {editing === r.id ? (
                <span className="row" style={{ flex: 1 }}>
                  <input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} style={{ minWidth: 220 }} />
                  <input placeholder="Short description (optional)" value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} style={{ flex: 1 }} />
                  <button className="small" disabled={busy} onClick={() => saveEdit(r)}>Save</button>
                  <button className="ghost small" style={{ marginTop: 0 }} onClick={() => setEditing(null)}>Cancel</button>
                </span>
              ) : (
                <>
                  <span style={{ fontSize: 13, color: 'var(--ink)' }}>{r.name}{r.description && <span className="muted"> · {r.description}</span>}</span>
                  <span className="row">
                    <select value={r.min_seniority ?? ''} disabled={busy} title="Minimum seniority"
                      onChange={(e) => run(supabase.from('role_profile').update({ min_seniority: e.target.value || null }).eq('id', r.id),
                        e.target.value ? `${r.name}: ${cap(e.target.value)} or more senior.` : `${r.name}: any seniority.`)}>
                      <option value="">Any seniority</option>
                      {SENIORITY.map((s) => <option key={s} value={s}>{cap(s)}+</option>)}
                    </select>
                    <button className="small" onClick={() => { setEditing(r.id); setEdit({ name: r.name, description: r.description ?? '' }) }}>Rename</button>
                    <button className="ghost small" style={{ marginTop: 0 }} disabled={busy} onClick={() => remove(r)}>Delete</button>
                  </span>
                </>
              )}
            </div>
            {r.skills.length === 0 && <div className="pad muted">No skills yet.</div>}
            {r.skills.map((s) => (
              <div className="trow" key={s.id}>
                <b style={{ flex: 1 }}>{s.skill.name}</b>
                <select value={s.min_level} disabled={busy}
                  onChange={(e) => run(supabase.from('role_profile_skill').update({ min_level: Number(e.target.value) }).eq('id', s.id), `${s.skill.name} in ${r.name}: ≥${e.target.value}.`)}>
                  {LEVELS.map((n) => <option key={n} value={n}>≥ {n}</option>)}
                </select>
                <button className="ghost small" style={{ marginTop: 0 }} disabled={busy}
                  onClick={() => run(supabase.from('role_profile_skill').delete().eq('id', s.id), `${s.skill.name} removed from ${r.name}.`)}>Remove</button>
              </div>
            ))}
            <div className="pad row">
              <select value={d.skill} onChange={(e) => setDraft((m) => ({ ...m, [r.id]: { ...d, skill: e.target.value } }))}>
                <option value="">Add a skill…</option>
                {skills.filter((s) => !have.has(s.id)).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <select value={d.level} onChange={(e) => setDraft((m) => ({ ...m, [r.id]: { ...d, level: Number(e.target.value) } }))}>
                {LEVELS.map((n) => <option key={n} value={n}>≥ {n}</option>)}
              </select>
              <button onClick={() => addSkill(r)} disabled={busy || !d.skill}>Add</button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
