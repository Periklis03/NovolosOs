import { NavLink, Outlet } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { NAV, canSee } from '../auth/permissions'

export default function Shell() {
  const { employee, roles, signOut } = useAuth()
  const items = NAV.filter((n) => canSee(roles, n))

  return (
    <div className="layout">
      <nav className="sidebar">
        <div className="brand">NovolosOS<small>people operating system</small></div>
        {items.map((n) => (
          <NavLink key={n.path} to={n.path} className={({ isActive }) => (isActive ? 'active' : '')}>
            {n.label}
          </NavLink>
        ))}
        <div className="who">
          <b>{employee?.full_name}</b>
          <div className="muted">{roles.join(', ') || 'no role'}</div>
          <button className="ghost" onClick={signOut}>Sign out</button>
        </div>
      </nav>
      <main><Outlet /></main>
    </div>
  )
}
