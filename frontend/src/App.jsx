import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import NavBar from './components/NavBar';
import Settings from './components/Settings';
import Intro from './Pages/Intro/Intro.jsx';
import Onboarding from './Pages/Onboarding/Onboarding.jsx';
import ConnectionPage from './Pages/ConnectionPage/ConnectionPage.jsx';

function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-[#0a0a0a]">
        <NavBar />
        <Routes>
          <Route path="/" element={<Intro />} />
          <Route path="/onboarding" element={<Onboarding />} />
          <Route path="/connectionPage" element={<ConnectionPage />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </div>
    </BrowserRouter>
  );
}

export default App;
