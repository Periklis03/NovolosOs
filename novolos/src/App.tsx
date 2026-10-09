import type { ReactElement } from 'react'
import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth/AuthContext'
import { NAV, canSee, firstAllowedPath } from './auth/permissions'
import Login from './pages/Login'
import MyProfile from './pages/MyProfile'
import People from './pages/People'
import Ask from './pages/Ask'
import TeamValidation from './pages/TeamValidation'
import Admin from './pages/Admin'
import Shell from './components/Shell'

const PAGES: Record<string, ReactElement> = {
  '/ask': <Ask />,
  '/me': <MyProfile />,
  '/people': <People />,
  '/team': <TeamValidation />,
  '/admin': <Admin />,
}

function Gate() {
  const { loading, session, employee, roles, error, signOut } = useAuth()

  if (loading) return <div className="center muted">Loadingâ€¦</div>
  if (!session) return <Login />
  if (!employee) {
    return (
      <div className="center">
        <div className="card login">
          <h1>Account not linked</h1>
          <div className="error">{error ?? 'No employee found for this login.'}</div>
          <button onClick={signOut}>Sign out</button>
        </div>
      </div>
    )
  }

  return (
    <Routes>
      <Route element={<Shell />}>
        {NAV.filter((n) => canSee(roles, n)).map((n) => (
          <Route
            key={n.path}
            path={n.path}
            element={PAGES[n.path]}
          />
        ))}
        <Route path="*" element={<Navigate to={firstAllowedPath(roles)} replace />} />
      </Route>
    </Routes>
  )
}

export default function App() {
  return (
    <HashRouter>
      <AuthProvider>
        <Gate />
      </AuthProvider>
    </HashRouter>
  )
}
