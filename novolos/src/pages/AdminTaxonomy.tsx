import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { findExact } from '../lib/skillNames'

interface Category { id: string; name: string; sort_order: number }
interface Skill { id: string; name: string; category_id: string; active: boolean }
interface Count { people: number; validated: number }

type Editing =
  | { kind: 'skill'; id: string; value: string }
  | { kind: 'category'; id: string; value: string }
  | null

// Turn database errors into plain sentences.
const friendly = (m: string) =>
  m.includes('skill_name_unique') ? 'A skill with this name already exists (capitals and spaces are ignored).'
  : m.includes('skill_category_name_key') ? 'A category with this name already exists.'
  : m.includes('violates foreign key') ? 'This category still has skills. Move or retire them first.'
  : m

export default function Taxonomy() {
  const [cats, setCats] = useState<Category[]>([])
  const [skills, setSkills] = useState<Skill[]>([])
  const [counts, setCounts] = useState<Record<string, Count>>({})
  const [showRetired, setShowRetired] = useState(false)
  const [q, setQ] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [editing, setEditing] = useState<Editing>(null)
  const [newCat, setNewCat] = useState('')
  const [newSkill, setNewSkill] = useState<Record<string, string>>({}) // per category
  const [retiring, setRetiring] = useState<{ id: string; mode: 'remove' | 'move'; target: string } | null>(null)

  const load = useCallback(async () => {
    const [c, s, es] = await Promise.all([
      supabase.from('skill_category').select('id, name, sort_order').order('sort_order').order('name'),
      supabase.from('skill').select('id, name, category_id, active').order('name'),
      supabase.from('employee_skill').select('skill_id, validated_level'),
    ])
    const err = c.error ?? s.error ?? es.error
    if (err) { setError(err.message); return }
    setCats((c.data ?? []) as Category[])
    setSkills((s.data ?? []) as Skill[])
    const byId: Record<string, Count> = {}
    for (const r of es.data ?? []) {
      const k = (byId[r.skill_id] ??= { people: 0, validated: 0 })
      k.people += 1
      if (r.validated_level != null) k.validated += 1
    }
    setCounts(byId)
  }, [])

  useEffect(() => { load() }, [load])

  // run one change, show the result, reload
  const run = async (p: PromiseLike<{ error: { message: string } | null }>, ok: string) => {
    setBusy(true); setError(null); setMsg(null)
    const { error } = await p
    setBusy(false)
    if (error) { setError(friendly(error.message)); return false }
    setMsg(ok)
    await load()
    return true
  }

  const nameOf = (id: string) => skills.find((s) => s.id === id)?.name ?? ''
  const catOf = (id: string) => cats.find((c) => c.id === id)?.name ?? ''
  const people = (id: string) => counts[id]?.people ?? 0

  /* ----- categories ----- */
  const addCategory = async () => {
    const name = newCat.trim().replace(/\s+/g, ' ')
    if (!name) return
    const next = Math.max(0, ...cats.map((c) => c.sort_order)) + 1
    if (await run(supabase.from('skill_category').insert({ name, sort_order: next }), `Category “${name}” added.`)) setNewCat('')
  }
  const renameCategory = async (id: string, value: string) => {
    const name = value.trim().replace(/\s+/g, ' ')
    if (!name || name === catOf(id)) { setEditing(null); return }
    if (await run(supabase.from('skill_category').update({ name }).eq('id', id), `Category renamed to “${name}”.`)) setEditing(null)
  }
  const moveCategory = async (index: number, dir: -1 | 1) => {
    const order = [...cats]
    const j = index + dir
    if (j < 0 || j >= order.length) return
    ;[order[index], order[j]] = [order[j], order[index]]
    setBusy(true); setError(null); setMsg(null)
    for (let i = 0; i < order.length; i++) {
      if (order[i].sort_order !== i) {
        const { error } = await supabase.from('skill_category').update({ sort_order: i }).eq('id', order[i].id)
        if (error) { setBusy(false); setError(friendly(error.message)); await load(); return }
      }
    }
    setBusy(false)
    await load()
  }
  const deleteCategory = (c: Category) => {
    if (!window.confirm(`Delete the empty category “${c.name}”?`)) return
    run(supabase.from('skill_category').delete().eq('id', c.id), `Category “${c.name}” deleted.`)
  }

  /* ----- skills ----- */
  const addSkill = async (categoryId: string) => {
    const name = (newSkill[categoryId] ?? '').trim().replace(/\s+/g, ' ')
    if (!name) return
    const existing = findExact(name, skills)
    if (existing) {
      setError(existing.active
        ? `“${existing.name}” already exists in ${catOf(existing.category_id)}.`
        : `“${existing.name}” exists but is retired. Tick “Show retired” and reactivate it.`)
      return
    }
    if (await run(supabase.from('skill').insert({ category_id: categoryId, name }), `Skill “${name}” added to ${catOf(categoryId)}.`)) {
      setNewSkill((m) => ({ ...m, [categoryId]: '' }))
    }
  }
  const renameSkill = async (id: string, value: string) => {
    const name = value.trim().replace(/\s+/g, ' ')
    if (!name || name === nameOf(id)) { setEditing(null); return }
    const clash = findExact(name, skills.filter((s) => s.id !== id))
    if (clash) { setError(`“${clash.name}” already exists in ${catOf(clash.category_id)}. To combine them, retire one and move its people to the other.`); return }
    const n = people(id)
    if (await run(supabase.from('skill').update({ name }).eq('id', id),
      `Renamed to “${name}”${n ? ` (updated on ${n} ${n === 1 ? 'profile' : 'profiles'})` : ''}.`)) setEditing(null)
  }
  const changeCategory = (s: Skill, categoryId: string) =>
    run(supabase.from('skill').update({ category_id: categoryId }).eq('id', s.id), `“${s.name}” moved to ${catOf(categoryId)}.`)

  const retire = async (s: Skill) => {
    if (!retiring) return
    if (retiring.mode === 'move' && !retiring.target) { setError('Choose the skill to move people to.'); return }
    setBusy(true); setError(null); setMsg(null)
    const { data, error } = await supabase.rpc('retire_skill', {
      _skill: s.id, _move_to: retiring.mode === 'move' ? retiring.target : null,
    })
    setBusy(false)
    if (error) { setError(friendly(error.message)); return }
    setMsg(String(data)); setRetiring(null)
    await load()
  }
  const reactivate = (s: Skill) =>
    run(supabase.from('skill').update({ active: true }).eq('id', s.id), `“${s.name}” is active again and can be added to profiles.`)

  const needle = q.trim().toLowerCase()
  const activeSkills = skills.filter((s) => s.active)
  const retiredCount = skills.length - activeSkills.length

  return (
    <div>
      <div className="row" style={{ marginBottom: 12 }}>
        <input placeholder="Search skills" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 200 }} />
        <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <input type="checkbox" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} />
          Show retired ({retiredCount})
        </label>
        <span className="muted">{activeSkills.length} active skills in {cats.length} categories</span>
        <span style={{ flex: 1 }} />
        <input placeholder="New category" value={newCat} onChange={(e) => setNewCat(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addCategory()} />
        <button className="small" disabled={busy || !newCat.trim()} onClick={addCategory}>Add category</button>
      </div>
      {error && <div className="error">{error}</div>}
      {msg && <div className="ok">{msg}</div>}

      {cats.map((c, i) => {
        const inCat = skills.filter((s) => s.category_id === c.id)
        const shown = inCat.filter((s) => (showRetired || s.active) && (!needle || s.name.toLowerCase().includes(needle)))
        if (needle && shown.length === 0) return null
        const editingCat = editing?.kind === 'category' && editing.id === c.id
        return (
          <div className="card" key={c.id} style={{ padding: 0, overflow: 'hidden', marginBottom: 12 }} data-category={c.name}>
            <div className="thead trow" style={{ borderBottom: '1px solid var(--line)', fontSize: 12 }}>
              {editingCat ? (
                <>
                  <input autoFocus value={editing.value} aria-label="Category name"
                    onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Enter') renameCategory(c.id, editing.value); if (e.key === 'Escape') setEditing(null) }} />
                  <button className="small" disabled={busy} onClick={() => renameCategory(c.id, editing.value)}>Save</button>
                  <button className="ghost small" style={{ marginTop: 0 }} onClick={() => setEditing(null)}>Cancel</button>
                </>
              ) : (
                <>
                  <div style={{ flex: 1, color: 'var(--ink)' }}>{c.name} <span className="muted">· {inCat.filter((s) => s.active).length} skills</span></div>
                  <button className="ghost small" style={{ marginTop: 0, width: 'auto' }} disabled={busy || i === 0} onClick={() => moveCategory(i, -1)} aria-label={`Move ${c.name} up`}>↑</button>
                  <button className="ghost small" style={{ marginTop: 0, width: 'auto' }} disabled={busy || i === cats.length - 1} onClick={() => moveCategory(i, 1)} aria-label={`Move ${c.name} down`}>↓</button>
                  <button className="ghost small" style={{ marginTop: 0, width: 'auto' }} onClick={() => setEditing({ kind: 'category', id: c.id, value: c.name })}>Rename</button>
                  <button className="ghost small" style={{ marginTop: 0, width: 'auto' }} disabled={busy || inCat.length > 0}
                    title={inCat.length > 0 ? 'Only empty categories can be deleted' : ''} onClick={() => deleteCategory(c)}>Delete</button>
                </>
              )}
            </div>

            {shown.map((s) => {
              const n = people(s.id)
              const v = counts[s.id]?.validated ?? 0
              const editingSkill = editing?.kind === 'skill' && editing.id === s.id
              const isRetiring = retiring?.id === s.id
              return (
                <div key={s.id} data-skill={s.name}>
                  <div className="trow" style={{ opacity: s.active ? 1 : 0.55 }}>
                    {editingSkill ? (
                      <div style={{ flex: 1, display: 'flex', gap: 6 }}>
                        <input autoFocus value={editing.value} aria-label="Skill name" style={{ flex: 1 }}
                          onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                          onKeyDown={(e) => { if (e.key === 'Enter') renameSkill(s.id, editing.value); if (e.key === 'Escape') setEditing(null) }} />
                        <button className="small" disabled={busy} onClick={() => renameSkill(s.id, editing.value)}>Save</button>
                        <button className="ghost small" style={{ marginTop: 0, width: 'auto' }} onClick={() => setEditing(null)}>Cancel</button>
                      </div>
                    ) : (
                      <div style={{ flex: 1 }}>
                        <span style={{ fontWeight: 600 }}>{s.name}</span>
                        {!s.active && <span className="tag" style={{ marginLeft: 6 }}>retired</span>}
                      </div>
                    )}
                    <span className="muted" style={{ width: 150 }}>
                      {n} {n === 1 ? 'person' : 'people'}{n ? ` · ${v} validated` : ''}
                    </span>
                    {s.active ? (
                      <>
                        <select value={s.category_id} disabled={busy} onChange={(e) => changeCategory(s, e.target.value)} aria-label={`Category of ${s.name}`}>
                          {cats.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                        </select>
                        <button className="ghost small" style={{ marginTop: 0, width: 'auto' }} disabled={busy} onClick={() => { setRetiring(null); setEditing({ kind: 'skill', id: s.id, value: s.name }) }}>Rename</button>
                        <button className="ghost small" style={{ marginTop: 0, width: 'auto' }} disabled={busy}
                          onClick={() => { setEditing(null); setError(null); setMsg(null); setRetiring(isRetiring ? null : { id: s.id, mode: 'remove', target: '' }) }}>Retire…</button>
                      </>
                    ) : (
                      <button className="small" disabled={busy} onClick={() => reactivate(s)}>Reactivate</button>
                    )}
                  </div>

                  {isRetiring && retiring && (
                    <div className="pad" style={{ background: 'var(--paper)', borderBottom: '1px solid var(--line)', fontSize: 13 }}>
                      <b>Retire “{s.name}”.</b>{' '}
                      {n === 0 ? 'Nobody has it, so no profile changes.' : `${n} ${n === 1 ? 'person has' : 'people have'} it on their profile. What should happen to them?`}
                      {n > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '8px 0' }}>
                          <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6, fontWeight: 400, color: 'var(--ink)' }}>
                            <input type="radio" name="retire-mode" checked={retiring.mode === 'remove'} onChange={() => setRetiring({ ...retiring, mode: 'remove' })} />
                            Remove it from their profiles (their levels for this skill are deleted)
                          </label>
                          <label style={{ flexDirection: 'row', alignItems: 'center', gap: 6, fontWeight: 400, color: 'var(--ink)' }}>
                            <input type="radio" name="retire-mode" checked={retiring.mode === 'move'} onChange={() => setRetiring({ ...retiring, mode: 'move' })} />
                            Move them to another skill (e.g. a duplicate) and keep their levels:
                            <select value={retiring.target} disabled={retiring.mode !== 'move'} aria-label="Move people to"
                              onChange={(e) => setRetiring({ ...retiring, target: e.target.value })}>
                              <option value="">choose a skill…</option>
                              {activeSkills.filter((x) => x.id !== s.id).map((x) => (
                                <option key={x.id} value={x.id}>{x.name} ({catOf(x.category_id)})</option>
                              ))}
                            </select>
                          </label>
                        </div>
                      )}
                      <div className="row" style={{ marginTop: 6 }}>
                        <button className="small" disabled={busy || (retiring.mode === 'move' && !retiring.target)} onClick={() => retire(s)}>
                          {busy ? 'Retiring…' : 'Retire skill'}
                        </button>
                        <button className="ghost small" style={{ marginTop: 0, width: 'auto' }} onClick={() => setRetiring(null)}>Cancel</button>
                        <span className="muted">Retired skills disappear from “Add a skill”, Ask and searches. You can reactivate them later.</span>
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
            {shown.length === 0 && <div className="pad muted">No skills in this category yet.</div>}

            <div className="pad row">
              <input placeholder={`New skill in ${c.name}`} value={newSkill[c.id] ?? ''} style={{ minWidth: 220 }}
                onChange={(e) => setNewSkill((m) => ({ ...m, [c.id]: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && addSkill(c.id)} aria-label={`New skill in ${c.name}`} />
              <button className="small" disabled={busy || !(newSkill[c.id] ?? '').trim()} onClick={() => addSkill(c.id)}>Add skill</button>
            </div>
          </div>
        )
      })}
    </div>
  )
}
