import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from '@/components/layout/AppShell'
import { useAuth } from '@/lib/auth'
import { Login } from '@/pages/Login'
import { Dashboard } from '@/pages/Dashboard'
import { Inbox } from '@/pages/Inbox'
import { TicketDetail } from '@/pages/TicketDetail'
import { Customers, CustomerDetail } from '@/pages/Customers'
import { Agents, Products, Roles, Teams } from '@/pages/Admin'
import { EmailProviders } from '@/pages/EmailProviders'
import { Reports } from '@/pages/Reports'
import { EmptyState } from '@/components/ui/Feedback'

function FullScreenLoader() {
  return (
    <div className="flex h-full items-center justify-center">
      <span className="h-5 w-5 animate-spin rounded-full border-2 border-line border-t-brand" />
    </div>
  )
}

/** Routes behind authentication. A real build also re-checks on the server. */
function Protected({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <FullScreenLoader />
  if (!user) return <Navigate to="/login" replace />
  return <>{children}</>
}

function PublicOnly({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <FullScreenLoader />
  if (user) return <Navigate to="/" replace />
  return <>{children}</>
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />

      <Route element={<Protected><AppShell /></Protected>}>
        <Route index element={<Dashboard />} />
        <Route path="inbox" element={<Inbox />}>
          <Route path=":ticketId" element={<TicketDetail />} />
        </Route>
        <Route path="customers" element={<Customers />} />
        <Route path="customers/:customerId" element={<CustomerDetail />} />
        <Route path="reports" element={<Reports />} />
        <Route path="admin/products" element={<Products />} />
        <Route path="admin/agents" element={<Agents />} />
        <Route path="admin/teams" element={<Teams />} />
        <Route path="admin/roles" element={<Roles />} />
        <Route path="settings/email-providers" element={<EmailProviders />} />
        <Route
          path="*"
          element={<EmptyState className="h-full" title="Page not found" description="That route does not exist." />}
        />
      </Route>
    </Routes>
  )
}
