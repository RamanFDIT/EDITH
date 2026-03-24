import React, { useState } from 'react';
import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import ErrorBoundary from './components/ErrorBoundary/ErrorBoundary.jsx';
import NavBar from './components/NavBar/NavBar.jsx';
import { NavBarProvider } from './components/NavBar/NavBarContext.jsx';
import { AppProvider, useApp } from './context/AppContext.jsx';
import Settings from './Pages/Settings/Settings.jsx';
import Intro from './Pages/Intro/Intro.jsx';
import Auth from './Pages/Auth/Auth.jsx';
import AuthCallback from './Pages/Auth/AuthCallback.jsx';
import Home from './Pages/Home/Home.jsx';
import ProjectDashboard from './Pages/ProjectDashboard/ProjectDashboard.jsx';
import ProjectModal from './components/ProjectModal/ProjectModal.jsx';
import NotFound from './Pages/NotFound/NotFound.jsx';
import UserSetup from './Pages/UserSetup/UserSetup.jsx';
import { ProtectedRoute } from './components/Navigation/ProtectedRoute.jsx';
import { PublicOnlyRoute } from './components/Navigation/PublicOnlyRoute.jsx';

const hideNavBarRoutes = ['/', '/auth', '/auth/callback', '/setup'];

function AppContent() {
  const location = useLocation();
  const showNavBar = !hideNavBarRoutes.includes(location.pathname);
  const [showProjectModal, setShowProjectModal] = useState(false);

  return (
    <AppProvider>
      <NavBarProvider>
        <div className="min-h-screen bg-[#0a0a0a]">
          {showNavBar && <NavBar onNewProject={() => setShowProjectModal(true)} />}
          <Routes>
            <Route path="/" element={<PublicOnlyRoute><Intro /></PublicOnlyRoute>} />
            <Route path="/auth" element={<PublicOnlyRoute><Auth /></PublicOnlyRoute>} />
            <Route path="/auth/callback" element={<AuthCallback />} />
            <Route path="/setup" element={<ProtectedRoute><UserSetup /></ProtectedRoute>} />

            <Route path="/home" element={<ProtectedRoute><HomeRedirect /></ProtectedRoute>} />
            <Route path="/project/:id" element={<ProtectedRoute><ProjectDashboard /></ProtectedRoute>} />
            <Route path="/project/:id/chat" element={<ProtectedRoute><Home /></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />

            <Route path="*" element={<NotFound />} />
          </Routes>
          {showProjectModal && (
            <ProjectModal onClose={() => setShowProjectModal(false)} />
          )}
        </div>
      </NavBarProvider>
    </AppProvider>
  );
}

// Redirect /home to the active project's chat (General by default)
function HomeRedirect() {
  const { activeProjectId, activeProject } = useApp();
  if (activeProjectId) {
    // General goes to chat, others to dashboard
    if (activeProject?.isDefault) {
      return <Navigate to={`/project/${activeProjectId}/chat`} replace />;
    }
    return <Navigate to={`/project/${activeProjectId}`} replace />;
  }
  // Fallback to Home while projects load
  return <Home />;
}

function App() {
  return (
    <ErrorBoundary>
      <HashRouter>
        <AppContent />
      </HashRouter>
    </ErrorBoundary>
  );
}

export default App;
