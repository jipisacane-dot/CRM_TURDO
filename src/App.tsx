import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider } from './contexts/AppContext';
import { AppLayout } from './components/layout/AppLayout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Inbox from './pages/Inbox';
import Contacts from './pages/Contacts';
import Leads from './pages/Leads';
import Properties from './pages/Properties';
import Team from './pages/Team';
import Calendar from './pages/Calendar';
import Analytics from './pages/Analytics';

export default function App() {
  return (
    <BrowserRouter>
      <AppProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/"            element={<AppLayout><Dashboard /></AppLayout>} />
          <Route path="/inbox"       element={<AppLayout><Inbox /></AppLayout>} />
          <Route path="/contacts"    element={<AppLayout><Contacts /></AppLayout>} />
          <Route path="/leads"       element={<AppLayout><Leads /></AppLayout>} />
          <Route path="/properties"  element={<AppLayout><Properties /></AppLayout>} />
          <Route path="/team"        element={<AppLayout><Team /></AppLayout>} />
          <Route path="/calendar"    element={<AppLayout><Calendar /></AppLayout>} />
          <Route path="/analytics"   element={<AppLayout><Analytics /></AppLayout>} />
          <Route path="*"            element={<Navigate to="/" />} />
        </Routes>
      </AppProvider>
    </BrowserRouter>
  );
}
