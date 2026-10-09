import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useAuth } from '../auth/AuthContext'

interface Member { id: string; full_name: string; role_title: string | null }
interface Row {
  id: string
  self_level: number | null
  validated_level: number | null
  validated_at: string | null
  skill: { name: string }
}

export default function TeamValidation() {
  const { employee } = useAuth()
  const [members, setMembers] = useState<Member[]>([])
  const [memberId, setMemberId] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!employee) return
    supabase
      .from('employee')
      .select('id, full_name, role_title')
      .neq('id', employee.id)
      .order('full_name')
      .then(({ data, error }) => {
        if (error) setError(error.message)
        else {
          setMembers(data ?? [])
          setMemberId((cur) => cur || data?.[0]?.id || '')
        }
      })
  }, [employee])

  const loadSkills = useCallback(async () => {
    if (!memberId) { setRows([]); return }
    const { data, error } = await supabase
      .from('employee_skill')
      .select('id, self_level, validated_level, validated_at, skill:skill_id(name)')
      .eq('employee_id', memberId)
    if (error) { setError(error.message); return }
    setRows((data as unknown as Row[]).sort((a, b) => a.skill.name.localeCompare(b.skill.name)))
  }, [memberId])

  useEffect(() => { loadSkills() }, [loadSkills])

  const validate = async (id: string, level: number) => {
    setError(null)
    const { error } = await supabase.from('employee_skill').update({ validated_level: level }).eq('id', id)
    if (error) setError(error.message)
    await loadSkills()
  }

  const pending = rows.filter((r) => r.validated_level == null).length

  return (
    <div style={{ maxWidth: 820 }}>
      <h1>Team validation</h1>
      <p className="muted">Confirm the real level of each skill. Self-assessments stay unvalidated until you do.</p>
      {error && <div className="error">{error}</div>}
      {members.length === 0 ? (
        <div className="card muted">No team members are assigned to you yet.</div>
      ) : (
        <>
          <div className="row" style={{ marginBottom: 12 }}>
            <select value={memberId} onChange={(e) => setMemberId(e.target.value)}>
              {members.map((m) => <option key={m.id} value={m.id}>{m.full_name} · {m.role_title ?? ''}</option>)}
            </select>
            <span className="muted">{pending} of {rows.length} skills not validated</span>
          </div>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="thead">Skills</div>
            {rows.length === 0 && <div className="pad muted">This person has no skills yet.</div>}
            {rows.map((r) => (
              <div className="trow" key={r.id}>
                <div style={{ flex: 1, fontWeight: 600 }}>{r.skill.name}</div>
                <span className="muted">self {r.self_level ?? '–'}</span>
                <select
                  value={r.validated_level ?? ''}
                  onChange={(e) => validate(r.id, Number(e.target.value))}
                >
                  <option value="" disabled>validate…</option>
                  {[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
                {r.validated_level == null && r.self_level != null && (
                  <button className="ghost small" onClick={() => validate(r.id, r.self_level!)}>Confirm self {r.self_level}</button>
                )}
                <span className="muted" style={{ width: 90, textAlign: 'right' }}>
                  {r.validated_at ? new Date(r.validated_at).toLocaleDateString() : ''}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
