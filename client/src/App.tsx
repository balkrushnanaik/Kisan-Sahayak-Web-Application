import { Navigate, Outlet, Route, Routes, useLocation, useOutletContext } from 'react-router-dom';
import { AppLayout, PublicFooter, PublicHeader } from './components/AppChrome';
import { AuthPage } from './pages/AuthPages';
import { DashboardHome, NewJobPage, MyJobsPage, ApplicationsPage, InvitationsPage, AssignmentsPage } from './pages/DashboardPages';
import { LandingPage, JobsBrowsePage, JobDetailsPage, LabourersBrowsePage, MachineryBrowsePage, InfoPage } from './pages/PublicPages';
import { BookingsPage, MachineryManagePage, NewMachineryPage, NotificationsPage, ProfilePage, AdminPage } from './pages/ExtraPages';
import type { User } from './lib/api';

function PublicLayout() {
  return <><PublicHeader /><Outlet /><PublicFooter /></>;
}

function NotFoundPage() {
  return <main className="mx-auto flex min-h-[60vh] max-w-3xl flex-col items-start justify-center px-4 py-16"><p className="text-xs font-extrabold uppercase tracking-[.18em] text-forest">404 · Page not found</p><h1 className="mt-3 text-3xl font-extrabold text-ink">This page has wandered off the farm.</h1><p className="mt-3 text-sm leading-6 text-muted">The address may be incorrect or the page may have moved.</p><a className="mt-6 inline-flex min-h-11 items-center rounded-xl bg-forest px-4 text-sm font-bold text-white" href="/">Return home</a></main>;
}


function RoleGuard({ roles }: { roles: User['roles'] }) {
  const context = useOutletContext<{ user: User; activeRole: User['roles'][number] }>();
  if (!roles.some((role) => context.user.roles.includes(role))) return <Navigate to="/app/profile" replace />;
  if (!roles.includes(context.activeRole)) return <Navigate to="/app" replace />;
  return <Outlet context={context} />;
}

export function App() {
  return <Routes>
    <Route element={<PublicLayout />}>
      <Route index element={<LandingPage />} />
      <Route path="login" element={<AuthPage mode="login" />} />
      <Route path="register" element={<AuthPage mode="register" />} />
      <Route path="jobs" element={<JobsBrowsePage />} />
      <Route path="jobs/:id" element={<JobDetailsPage />} />
      <Route path="labourers" element={<LabourersBrowsePage />} />
      <Route path="machinery" element={<MachineryBrowsePage />} />
      <Route path="privacy" element={<InfoPage type="privacy" />} />
      <Route path="terms" element={<InfoPage type="terms" />} />
    </Route>
    <Route path="app" element={<AppLayout />}>
      <Route index element={<DashboardHome />} />
      <Route element={<RoleGuard roles={['farmer']} />}>
        <Route path="jobs" element={<MyJobsPage />} />
        <Route path="jobs/new" element={<NewJobPage />} />
      </Route>
      <Route element={<RoleGuard roles={['farmer', 'labourer']} />}>
        <Route path="applications" element={<ApplicationsPage />} />
        <Route path="invitations" element={<InvitationsPage />} />
        <Route path="assignments" element={<AssignmentsPage />} />
      </Route>
      <Route element={<RoleGuard roles={['machinery_provider']} />}>
        <Route path="machinery" element={<MachineryManagePage />} />
        <Route path="machinery/new" element={<NewMachineryPage />} />
      </Route>
      <Route element={<RoleGuard roles={['farmer', 'machinery_provider']} />}>
        <Route path="bookings" element={<BookingsPage />} />
      </Route>
      <Route path="notifications" element={<NotificationsPage />} />
      <Route path="profile" element={<ProfilePage />} />
      <Route element={<RoleGuard roles={['admin']} />}>
        <Route path="admin" element={<AdminPage />} />
      </Route>
    </Route>
    <Route path="*" element={<NotFoundPage />} />
  </Routes>;
}
