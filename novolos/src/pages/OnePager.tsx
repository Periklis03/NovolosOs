import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'
import './OnePager.css'

// Employee one-pager (design doc Module G, figure 1).
// Shows only what is already in the database: employee info and validated skills.
// Sections 2, 3 and 4 (added value, projects, proof points) stay empty until
// projects exist in NovolosOS (Phase 2).

interface Person {
  id: string
  full_name: string
  role_title: string | null
  seniority: string | null
  years_experience: number | null
  education: string | null
}
interface SkillRow {
  validated_level: number | null
  skill: { name: string; category: { name: string; sort_order: number | null } | null }
}

const SHEET_W = 1123 // A4 landscape at 96 dpi
const SHEET_H = 794
const LATER = 'Added later, once projects are in NovolosOS.'

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).map((w) => w[0].toUpperCase()).slice(0, 3).join('')
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

export default function OnePager() {
  const { id = '' } = useParams()
  const { employee: me } = useAuth()
  const [person, setPerson] = useState<Person | null>(null)
  const [skills, setSkills] = useState<SkillRow[]>([])
  const [unvalidated, setUnvalidated] = useState(0)
  const [anon, setAnon] = useState(false)
  const [state, setState] = useState<'loading' | 'ready' | 'missing'>('loading')
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setState('loading'); setError(null)
    const [p, s] = await Promise.all([
      supabase.from('employee')
        .select('id, full_name, role_title, seniority, years_experience, education')
        .eq('id', id).maybeSingle(),
      supabase.from('employee_skill')
        .select('validated_level, skill:skill_id(name, category:category_id(name, sort_order))')
        .eq('employee_id', id),
    ])
    const err = p.error ?? s.error
    if (err) { setError(err.message); setState('ready'); return }
    if (!p.data) { setState('missing'); return }
    const rows = (s.data ?? []) as unknown as SkillRow[]
    setPerson(p.data as Person)
    setSkills(rows.filter((r) => r.validated_level != null))
    setUnvalidated(rows.filter((r) => r.validated_level == null).length)
    setState('ready')
  }, [id])

  useEffect(() => { load() }, [load])

  // Section 1: validated skills grouped by category, strongest first
  const byCategory = useMemo(() => {
    const groups = new Map<string, { order: number; items: SkillRow[] }>()
    for (const r of skills) {
      const name = r.skill.category?.name ?? 'Other'
      const g = groups.get(name) ?? { order: r.skill.category?.sort_order ?? 999, items: [] }
      g.items.push(r)
      groups.set(name, g)
    }
    return [...groups.entries()]
      .sort((a, b) => a[1].order - b[1].order || a[0].localeCompare(b[0]))
      .map(([name, g]) => ({
        name,
        skills: g.items
          .sort((a, b) => (b.validated_level ?? 0) - (a.validated_level ?? 0) || a.skill.name.localeCompare(b.skill.name))
          .map((r) => r.skill.name),
      }))
  }, [skills])

  // Snapshot "Core stack": strongest validated skills (level 3+), at most 8
  const coreStack = useMemo(() => {
    const sorted = [...skills].sort((a, b) => (b.validated_level ?? 0) - (a.validated_level ?? 0) || a.skill.name.localeCompare(b.skill.name))
    const strong = sorted.filter((r) => (r.validated_level ?? 0) >= 3)
    return (strong.length ? strong : sorted).slice(0, 8).map((r) => r.skill.name)
  }, [skills])

  // Scale the A4 sheet down to fit the screen (print uses the real size)
  const wrapRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const fit = () => setScale(Math.min(1, el.clientWidth / SHEET_W))
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [state])

  if (state === 'loading') return <div className="muted">Loading</div>
  if (state === 'missing' || !person) {
    return (
      <div>
        <h1>One-pager</h1>
        <div className="error">You can't see this person's one-pager, or they don't exist.</div>
      </div>
    )
  }

  // Anonymised variant: initials instead of the name
  const name = anon ? initials(person.full_name).split('').join('.') + '.' : person.full_name

  const downloadPdf = () => {
    const before = document.title
    document.title = `${name} - One-pager`
    const restore = () => { document.title = before; window.removeEventListener('afterprint', restore) }
    window.addEventListener('afterprint', restore)
    window.print()
  }

  const seniority = [person.seniority ? cap(person.seniority) : null,
    person.years_experience != null ? `(${person.years_experience} ${person.years_experience === 1 ? 'yr' : 'yrs'})` : null]
    .filter(Boolean).join(' ')

  return (
    <div className="op-page">
      <div className="op-toolbar">
        <div>
          <h1 style={{ marginBottom: 4 }}>One-pager · {person.full_name}</h1>
          <div className="muted">
            Built from the profile: validated skills and HR data only
            {unvalidated > 0 && ` (${unvalidated} unvalidated ${unvalidated === 1 ? 'skill is' : 'skills are'} not shown)`}.
          </div>
        </div>
        <div className="row">
          <label className="op-check">
            <input type="checkbox" checked={anon} onChange={(e) => setAnon(e.target.checked)} /> Anonymised (initials only)
          </label>
          <button onClick={downloadPdf}>Download PDF</button>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="op-scale" ref={wrapRef} style={{ height: SHEET_H * scale }}>
        <div className="op-sheet" style={{ transform: `scale(${scale})` }}>
          <header className="op-head">
            <div className="op-avatar">{initials(person.full_name)}</div>
            <div>
              <div className="op-name">{name}</div>
              <div className="op-role">{person.role_title ?? ''}</div>
            </div>
            <div className="op-logo">NOV<span>O</span>L<span>O</span>S</div>
          </header>

          <div className="op-body">
            <section className="op-box op-tech">
              <h2><i>1</i>Tech Suitability - Fit to the Role</h2>
              {byCategory.length === 0 && <p className="op-hint">No validated skills yet.</p>}
              {byCategory.map((g) => (
                <p key={g.name}><b>{g.name}:</b> {g.skills.join(', ')}</p>
              ))}
            </section>

            <section className="op-box op-value">
              <h2><i>2</i>Added Value to the Project</h2>
              <p className="op-hint">{LATER}</p>
            </section>

            <section className="op-box op-contrib">
              <h2><i>3</i>Contribution in Projects</h2>
              <p className="op-hint">{LATER}</p>
            </section>

            <section className="op-box op-proof">
              <h2><i>4</i>Proof Points</h2>
              <p className="op-hint">{LATER}</p>
            </section>

            <section className="op-box op-snap">
              <h2>Profile Snapshot</h2>
              {seniority && <p><b>Seniority:</b> {seniority}</p>}
              {person.education && <p><b>Education:</b> {person.education}</p>}
              {coreStack.length > 0 && <p><b>Core stack:</b> {coreStack.join(', ')}</p>}
            </section>
          </div>
        </div>
      </div>

      <p className="muted op-foot">
        {person.id === me?.id ? <Link to="/me">← Back to My Profile</Link> : <Link to="/people">← Back to People & Skills</Link>}
      </p>
    </div>
  )
}
