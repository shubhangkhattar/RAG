import { Navigate, Route, Routes } from 'react-router-dom';
import { useEffect } from 'react';
import { useAuth } from './auth/AuthContext';
import { setAuthToken } from './api/client';
import LoginPage from './pages/LoginPage';
import ChatPage from './pages/ChatPage';
import AdminPage from './pages/AdminPage';

function RequireAuth({ children }: { children: JSX.Element }) {
  const { accessToken, isLoading, signIn } = useAuth();
  if (isLoading) return <div className="h-screen flex items-center justify-center text-gray-400">Loading…</div>;
  if (!accessToken) { signIn(); return null; }
  return children;
}

function RequireAdmin({ children }: { children: JSX.Element }) {
  const { isAdmin } = useAuth();
  return isAdmin ? children : <Navigate to="/chat" replace />;
}

export default function App() {
  const { accessToken } = useAuth();

  useEffect(() => {
    setAuthToken(accessToken);
  }, [accessToken]);

  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/chat" element={<RequireAuth><ChatPage /></RequireAuth>} />
      <Route path="/admin" element={<RequireAuth><RequireAdmin><AdminPage /></RequireAdmin></RequireAuth>} />
      <Route path="*" element={<Navigate to="/chat" replace />} />
    </Routes>
  );
}
