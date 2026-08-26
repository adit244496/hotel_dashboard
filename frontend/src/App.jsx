import { useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './auth/AuthContext'
import TopBar from './components/TopBar'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Upload from './pages/Upload'
import Admin from './pages/Admin'

function AdminRoute({ children }) {
  const { isAdmin } = useAuth()
  return isAdmin ? children : <Navigate to="/" replace />
}

export default function App() {
  const { user, loading } = useAuth()
  const [currency, setCurrency] = useState('L')

  if (loading) return <div className="spinner-wrap">Loading…</div>
  if (!user) return <Login />

  return (
    <>
      <TopBar
        currency={currency}
        setCurrency={setCurrency}
        subtitle="Monthly MIS across the portfolio"
      />
      <Routes>
        <Route path="/" element={<Dashboard currency={currency} />} />
        <Route
          path="/upload"
          element={
            <AdminRoute>
              <Upload currency={currency} />
            </AdminRoute>
          }
        />
        <Route
          path="/admin"
          element={
            <AdminRoute>
              <Admin />
            </AdminRoute>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  )
}
