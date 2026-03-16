import React from 'react';
import Hero from './components/Hero';
import Story from './components/Story';
import Problem from './components/Problem';
import Solution from './components/Solution';
import Future from './components/Future';
import { useTheme } from './context/ThemeContext';
import { Moon, Sun } from 'lucide-react';

function App() {
  const { theme, toggleTheme } = useTheme();

  return (
    <div className="min-h-screen bg-[var(--color-bgPrimary)] text-[var(--color-textPrimary)] relative font-sans overflow-hidden transition-colors duration-300">
      
      {/* Background Ambient Effects - Cleaned up to be monochromatic */}
      <div className="fixed top-[-50%] left-[-10%] w-[80vw] h-[80vw] rounded-full bg-[var(--color-textPrimary)] opacity-[0.02] blur-[150px] pointer-events-none" />
      <div className="fixed bottom-[-50%] right-[-10%] w-[60vw] h-[60vw] rounded-full bg-[var(--color-textPrimary)] opacity-[0.02] blur-[120px] pointer-events-none" />
      
      {/* Navigation */}
      <nav className="fixed w-full z-50 glass-panel border-b-0 border-x-0 border-t-0 p-4 transition-all duration-300">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/EDITH.svg" alt="EDITH Logo" className={`w-8 h-8 ${theme === 'dark' ? 'invert' : ''}`} />
            <div className="text-xl font-bold tracking-wider font-display">
              EDITH<span className="opacity-50">.</span>
            </div>
          </div>
          
          <div className="hidden md:flex items-center gap-8 text-sm font-medium opacity-70">
            <a href="#story" className="hover:opacity-100 transition-opacity">Origins</a>
            <a href="#solution" className="hover:opacity-100 transition-opacity">Features</a>
            <a href="#vision" className="hover:opacity-100 transition-opacity">Vision</a>
          </div>
          
          <div className="flex items-center gap-4">
            <button 
              onClick={toggleTheme}
              className="p-2 rounded-full hover:bg-[var(--color-bgHover)] transition-colors"
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
            <button className="bg-[var(--color-bgCTA)] text-[var(--color-textCTA)] px-6 py-2 rounded-full font-semibold hover:opacity-90 transition-opacity whitespace-nowrap">
              Download
            </button>
          </div>
        </div>
      </nav>

      {/* Main Assembly */}
      <main className="relative pt-20">
        <Hero />
        <Story />
        <Problem />
        <Solution />
        <Future />
      </main>
      
      {/* Footer */}
      <footer className="border-t border-[var(--color-bgHover)] mt-32 relative z-10 glass-panel border-b-0 border-x-0">
        <div className="max-w-7xl mx-auto px-4 py-8 flex flex-col md:flex-row justify-between items-center text-sm gap-4 opacity-50">
          <div>&copy; {new Date().getFullYear()} EDITH Project. All rights reserved.</div>
          <div className="font-mono text-xs">INITIATING PROTOCOL: STARK</div>
        </div>
      </footer>
    </div>
  );
}

export default App;
