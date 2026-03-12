import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import NavBar from './components/NavBar/NavBar.jsx';
import { NavBarProvider } from './components/NavBar/NavBarContext.jsx';
import Settings from './Pages/Settings/Settings.jsx';
import Intro from './Pages/Intro/Intro.jsx';
import Onboarding from './Pages/Onboarding/Onboarding.jsx';
import ConnectionPage from './Pages/ConnectionPage/ConnectionPage.jsx';
import Home from './Pages/Home/Home.jsx'

const hideNavBarRoutes = ['/', '/onboarding', '/connectionPage'];

function AppContent() {
  const location = useLocation();
  const showNavBar = !hideNavBarRoutes.includes(location.pathname);

  return (
    <NavBarProvider>
      <div className="min-h-screen bg-[#0a0a0a]">
        {showNavBar && <NavBar />}
        <Routes>
          <Route path="/" element={<Intro />} />
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/connectionPage" element={<ConnectionPage />} />
          <Route path="/home" element={<Home />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </div>
    </NavBarProvider>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppContent />
    </BrowserRouter>
  );
}

export default App;
