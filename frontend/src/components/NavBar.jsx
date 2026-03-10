import React from 'react';
import { NavLink } from 'react-router-dom';
import { Settings, Home } from 'lucide-react';

const NavBar = () => {
  return (
    <nav className="bg-gray-950 border-b border-gray-800 px-6 py-3">
      <div className="max-w-4xl mx-auto flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-lg font-bold text-white tracking-wide">E.D.I.T.H.</span>
          <span className="text-xs text-gray-500 border border-gray-700 px-2 py-0.5 rounded">Settings</span>
        </div>
        <div className="flex items-center gap-1">
          <NavLink
            to="/settings"
            className={({ isActive }) =>
              `flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors ${
                isActive
                  ? 'bg-gray-800 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-gray-800/50'
              }`
            }
          >
            <Settings className="w-4 h-4" />
            Settings
          </NavLink>
        </div>
      </div>
    </nav>
  );
};

export default NavBar;