import React from 'react';
import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import NavBar from './components/NavBar/NavBar.jsx';
import { NavBarProvider } from './components/NavBar/NavBarContext.jsx';
import { AppProvider } from './context/AppContext.jsx';
import Settings from './Pages/Settings/Settings.jsx';
import Intro from './Pages/Intro/Intro.jsx';
import Onboarding from './Pages/Onboarding/Onboarding.jsx';
import UserSetup from './Pages/UserSetup/UserSetup.jsx';
import ConnectionPage from './Pages/ConnectionPage/ConnectionPage.jsx';
import Home from './Pages/Home/Home.jsx';
import NotFound from './Pages/NotFound/NotFound.jsx';
import { ProtectedRoute } from './components/Navigation/ProtectedRoute.jsx';
import { PublicOnlyRoute } from './components/Navigation/PublicOnlyRoute.jsx';

const hideNavBarRoutes = ['/', '/user-setup', '/onboarding', '/connectionPage'];

function AppContent() {
  const location = useLocation();
  const showNavBar = !hideNavBarRoutes.includes(location.pathname);

  return (
    <AppProvider>
      <NavBarProvider>
        <div className="min-h-screen bg-[#0a0a0a]">
          {showNavBar && <NavBar />}
          <Routes>
            <Route path="/" element={<PublicOnlyRoute><Intro /></PublicOnlyRoute>} />
            <Route path="/user-setup" element={<PublicOnlyRoute><UserSetup /></PublicOnlyRoute>} />
            <Route path="/onboarding" element={<PublicOnlyRoute><Onboarding /></PublicOnlyRoute>} />
            <Route path="/connectionPage" element={<PublicOnlyRoute><ConnectionPage /></PublicOnlyRoute>} />
            
            <Route path="/home" element={<ProtectedRoute><Home /></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute><Settings /></ProtectedRoute>} />
            
            <Route path="*" element={<NotFound />} />
          </Routes>
        </div>
      </NavBarProvider>
    </AppProvider>
  );
}

function App() {
  return (
    <HashRouter>
      <AppContent />
    </HashRouter>
  );
}

export default App;
 