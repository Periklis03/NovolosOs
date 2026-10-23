// Compare skill names the same way the database does (0007): ignore capitals and extra spaces.
export const skillKey = (name: string) => name.trim().replace(/\s+/g, ' ').toLowerCase()

interface Named { name: string }

// The skill with exactly this name (after tidying), if any.
export function findExact<T extends Named>(name: string, skills: T[]): T | undefined {
  const key = skillKey(name)
  return key ? skills.find((s) => skillKey(s.name) === key) : undefined
}

// Small edit distance, for typos like "Postgress" vs "PostgreSQL" or "Kubernets".
function distance(a: string, b: string) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const tmp = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1))
      prev = tmp
    }
  }
  return row[b.length]
}

// Names that look alike but aren't identical: one contains the other, or a typo away.
// Synonyms ("JS" / "JavaScript") can't be detected this way; that stays a human check.
export function findSimilar<T extends Named>(name: string, skills: T[], max = 3): T[] {
  const key = skillKey(name).replace(/[^a-z0-9+#]/g, '')
  if (key.length < 2) return []
  return skills
    .map((s) => {
      const other = skillKey(s.name).replace(/[^a-z0-9+#]/g, '')
      if (!other || other === key) return null
      const contains = key.length >= 3 && other.length >= 3 && (other.includes(key) || key.includes(other))
      const d = distance(key, other)
      const close = d <= (Math.min(key.length, other.length) >= 6 ? 2 : 1)
      return contains || close ? { s, d } : null
    })
    .filter((x): x is { s: T; d: number } => x !== null)
    .sort((a, b) => a.d - b.d)
    .slice(0, max)
    .map((x) => x.s)
}
