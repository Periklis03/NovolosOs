import type { RoleName } from './AuthContext'

export interface NavItem {
  path: string
  label: string
  roles: RoleName[]
}

// Which role sees which screen (mirrors the prototype's ROLE_VIEWS)
export const NAV: NavItem[] = [
  { path: '/ask', label: 'Ask', roles: ['admin', 'manager', 'team_lead', 'user'] },
  { path: '/me', label: 'My Profile', roles: ['admin', 'team_lead', 'user'] },
  { path: '/people', label: 'People & Skills', roles: ['admin', 'manager', 'team_lead'] },
  { path: '/team', label: 'Team validation', roles: ['admin', 'team_lead'] },
  { path: '/admin', label: 'Admin', roles: ['admin'] },
]

export const canSee = (roles: RoleName[], item: NavItem) =>
  item.roles.some((r) => roles.includes(r))

export const firstAllowedPath = (roles: RoleName[]) =>
  NAV.find((n) => canSee(roles, n))?.path ?? '/ask'
