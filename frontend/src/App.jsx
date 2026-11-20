import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import Navbar from './components/Navbar';
import { ThemeProvider } from './context/ThemeContext';
import LoginPage from './pages/LoginPage';
import ExamLobby from './pages/candidate/ExamLobby';
import ExamPortal from './pages/candidate/ExamPortal';
import AdminDashboard from './pages/invigilator/AdminDashboard';

function MainApp() {
  const { user, loading } = useAuth();
  const [activeSession, setActiveSession] = useState(null);
  useEffect(() => {
    const camera = activeSession?.camera;
    return () => camera?.stop();
  }, [activeSession?.camera, user?.id]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600"></div>
      </div>
    );
  }

  if (!user) {
    return (
      <div>
        <Navbar />
        <LoginPage />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col">
      <Navbar />

      <main className="flex-1">
        {user.role === 'admin' || user.role === 'invigilator' ? (
          <AdminDashboard />
        ) : (
          <div>
            {!activeSession || activeSession.user_id !== user.id ? (
              <ExamLobby key={user.id} onStartExam={(session) => setActiveSession({ ...session, user_id: user.id })} />
            ) : (
              <ExamPortal
                key={`${user.id}:${activeSession.session_id}`}
                initialSession={activeSession}
                onExit={() => setActiveSession(null)}
              />
            )}
          </div>
        )}
      </main>
    </div>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <MainApp />
      </AuthProvider>
    </ThemeProvider>
  );
}

