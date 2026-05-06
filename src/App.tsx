import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider } from './contexts/AppContext';
import { AppLayout } from './components/layout/AppLayout';
import { ErrorBoundary } from './components/ErrorBoundary';

const Login = lazy(() => import('./pages/Login'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Inbox = lazy(() => import('./pages/Inbox'));
const Contacts = lazy(() => import('./pages/Contacts'));
const Leads = lazy(() => import('./pages/Leads'));
const Properties = lazy(() => import('./pages/Properties'));
const Team = lazy(() => import('./pages/Team'));
const Calendar = lazy(() => import('./pages/Calendar'));
const Analytics = lazy(() => import('./pages/Analytics'));
const Operations = lazy(() => import('./pages/Operations'));
const Negotiations = lazy(() => import('./pages/Negotiations'));
const AssistantChat = lazy(() => import('./pages/AssistantChat'));
const Pipeline = lazy(() => import('./pages/Pipeline'));
const NotificationRules = lazy(() => import('./pages/NotificationRules'));
const Templates = lazy(() => import('./pages/Templates'));
const AutoAssign = lazy(() => import('./pages/AutoAssign'));
const ClientPortalPreview = lazy(() => import('./pages/ClientPortalPreview'));
const ClientPortal = lazy(() => import('./pages/ClientPortal'));
const AuditLog = lazy(() => import('./pages/AuditLog'));
const Payroll = lazy(() => import('./pages/Payroll'));
const MyCommissions = lazy(() => import('./pages/MyCommissions'));
const Finanzas = lazy(() => import('./pages/Finanzas'));
const Vencimientos = lazy(() => import('./pages/Vencimientos'));

// Skeleton de loading que matchea el layout general (no flash blanco)
const PageLoader = () => (
  <div className="p-4 md:p-6 space-y-4 max-w-5xl">
    <div className="skeleton h-8 w-48" />
    <div className="skeleton h-4 w-64" />
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mt-4">
      <div className="skeleton h-24" />
      <div className="skeleton h-24" />
      <div className="skeleton h-24" />
    </div>
    <div className="skeleton h-64 mt-4" />
  </div>
);

export default function App() {
  return (
    <BrowserRouter>
      <AppProvider>
        <ErrorBoundary>
          <Suspense fallback={<PageLoader />}>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/preview/portal" element={<ClientPortalPreview />} />
              <Route path="/c/:token" element={<ClientPortal />} />
              <Route path="/"            element={<AppLayout><Dashboard /></AppLayout>} />
              <Route path="/inbox"       element={<AppLayout><Inbox /></AppLayout>} />
              <Route path="/contacts"    element={<AppLayout><Contacts /></AppLayout>} />
              <Route path="/leads"       element={<AppLayout><Leads /></AppLayout>} />
              <Route path="/properties"  element={<AppLayout><Properties /></AppLayout>} />
              <Route path="/operations"  element={<AppLayout><Operations /></AppLayout>} />
              <Route path="/negotiations" element={<AppLayout><Negotiations /></AppLayout>} />
              <Route path="/pipeline"    element={<AppLayout><Pipeline /></AppLayout>} />
              <Route path="/asistente"   element={<AppLayout><AssistantChat /></AppLayout>} />
              <Route path="/payroll"     element={<AppLayout><Payroll /></AppLayout>} />
              <Route path="/my-commissions" element={<AppLayout><MyCommissions /></AppLayout>} />
              <Route path="/finanzas"    element={<AppLayout><Finanzas /></AppLayout>} />
              <Route path="/vencimientos" element={<AppLayout><Vencimientos /></AppLayout>} />
              <Route path="/team"        element={<AppLayout><Team /></AppLayout>} />
              <Route path="/calendar"    element={<AppLayout><Calendar /></AppLayout>} />
              <Route path="/analytics"   element={<AppLayout><Analytics /></AppLayout>} />
              <Route path="/notifications" element={<AppLayout><NotificationRules /></AppLayout>} />
              <Route path="/templates"   element={<AppLayout><Templates /></AppLayout>} />
              <Route path="/auto-assign" element={<AppLayout><AutoAssign /></AppLayout>} />
              <Route path="/audit"       element={<AppLayout><AuditLog /></AppLayout>} />
              <Route path="*"            element={<Navigate to="/" />} />
            </Routes>
          </Suspense>
        </ErrorBoundary>
      </AppProvider>
    </BrowserRouter>
  );
}
