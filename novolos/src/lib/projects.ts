// Shared by Projects, My Profile, People, Ask and the one-pager, so every screen shows
// project status, availability and fit the same way.

export type Stage = 'pipeline' | 'confirmed' | 'cancelled'
export type Status = 'pipeline' | 'upcoming' | 'active' | 'closing' | 'delivered' | 'cancelled'
export type Timing = 'current' | 'future' | 'past'

export interface ProjectRow {
  id: string
  name: string
  client: string | null
  description: string | null
  stage: Stage
  start_date: string | null
  end_date: string | null
  project_lead_id: string | null
  status: Status
}
export interface AllocationRow {
  id: string
  project_id: string
  employee_id: string
  role_title: string | null
  start_date: string
  end_date: string | null
  project_name: string
  client: string | null
  stage: Stage
  project_status: Status
  timing: Timing
}
// busy = on a confirmed project that day; tentative = on a pipeline project that day (doesn't make them busy)
export interface Availability { employee_id: string; busy: boolean; tentative: boolean; free_from: string | null }

export const STATUS_LABEL: Record<Status, string> = {
  pipeline: 'Pipeline', upcoming: 'Upcoming', active: 'Active', closing: 'Closing', delivered: 'Delivered', cancelled: 'Cancelled',
}
export const STAGE_LABEL: Record<Stage, string> = { pipeline: 'Pipeline (not won yet)', confirmed: 'Confirmed', cancelled: 'Cancelled' }

export const SENIORITY = ['junior', 'mid', 'senior', 'lead', 'principal'] as const
export const senRank = (s: string | null | undefined) => (s ? SENIORITY.indexOf(s as (typeof SENIORITY)[number]) + 1 : 0)
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

// Dates come from the database as 'YYYY-MM-DD'. Read them as local dates so they never shift a day.
export const parseDate = (d: string) => { const [y, m, day] = d.split('-').map(Number); return new Date(y, m - 1, day) }
export const fmtDate = (d: string | null) =>
  d ? parseDate(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''
export const fmtRange = (from: string | null, to: string | null) =>
  !from && !to ? 'no dates yet' : `${from ? fmtDate(from) : '?'} – ${to ? fmtDate(to) : 'open-ended'}`
export const todayIso = () => {
  const t = new Date()
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
}

export function availabilityLabel(a: Availability | undefined) {
  if (!a) return '–'
  const main = !a.busy ? 'Free now' : a.free_from ? `Busy · free from ${fmtDate(a.free_from)}` : 'Busy, no end date'
  return a.tentative ? `${main} · tentative` : main
}
export const availabilityTone = (a: Availability | undefined) =>
  !a ? '' : a.busy ? 'bad' : a.tentative ? 'warnc' : 'okc'

// "Pipeline project whose start date has passed": the system never confirms it on its own.
export const startPassed = (p: Pick<ProjectRow, 'stage' | 'start_date'>) =>
  p.stage === 'pipeline' && !!p.start_date && p.start_date < todayIso()

/* ---------- fit score (same weights as the prototype; validated levels only) ----------
   52% how many required skills they meet · 18% how strong they are in those · 20% free (not on a
   confirmed project) on the day the work starts · 10% how many of those skills they're willing to use. */
export interface Requirement { skill_id: string; skill: string; min_level: number; headcount?: number }
export interface HeldSkill { level: number | null; willing: boolean }
export interface Fit { score: number; met: number; total: number; missing: string[] }

export function fitScore(held: Record<string, HeldSkill>, reqs: Requirement[], busy: boolean): Fit | null {
  if (reqs.length === 0) return null
  const met = reqs.filter((r) => (held[r.skill_id]?.level ?? 0) >= r.min_level)
  const coverage = met.length / reqs.length
  const strength = met.length ? met.reduce((s, r) => s + (held[r.skill_id]?.level ?? 0), 0) / met.length / 5 : 0
  const free = busy ? 0 : 1
  const willing = met.length ? met.filter((r) => held[r.skill_id]?.willing !== false).length / met.length : 0
  const missing = reqs
    .filter((r) => (held[r.skill_id]?.level ?? 0) < r.min_level)
    .map((r) => `${r.skill} ${r.min_level}${held[r.skill_id]?.level ? ` (has ${held[r.skill_id]?.level})` : ''}`)
  return {
    score: Math.min(99, Math.round(52 * coverage + 18 * strength + 20 * free + 10 * willing)),
    met: met.length, total: reqs.length, missing,
  }
}

// Friendly text for the database's refusals on projects and roles
export function projectError(message: string) {
  if (message.includes('project_name_unique')) return 'A project with this name already exists.'
  if (message.includes('role_profile_name_unique')) return 'A role profile with this name already exists.'
  if (message.includes('project_confirmed_start')) return 'A confirmed project needs a start date.'
  if (message.includes('project_dates') || message.includes('allocation_dates')) return 'The end date is before the start date.'
  if (message.includes('project_requirement_project_id_skill_id_key')) return 'That skill is already in the stack.'
  if (message.includes('role_profile_skill_role_profile_id_skill_id_key')) return 'That skill is already in this role.'
  if (message.includes('allocation_project_id_fkey')) return 'This project has team history, so it can’t be deleted. Set it to Cancelled instead.'
  if (message.includes('row-level security')) return 'You don’t have permission to do that.'
  return message
}
