import React from 'react';
import { motion } from 'framer-motion';
import { Download, Terminal } from 'lucide-react';

const Hero = () => {
  return (
    <section className="min-h-screen flex flex-col items-center justify-center text-center px-4 relative">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.8, ease: 'easeOut' }}
        className="z-10 mt-16"
      >
        <div className="inline-block p-[1px] rounded-full border border-[var(--color-bgHover)] bg-[var(--color-bgComponents)] mb-8 shadow-sm">
          <span className="px-4 py-1.5 text-xs text-[var(--color-textPrimary)] tracking-[0.2em] font-mono uppercase flex items-center justify-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[var(--color-colorSuccess)] animate-pulse"></span>
            System Online
          </span>
        </div>
        
        <h1 className="text-5xl md:text-8xl font-bold mb-6 tracking-tight leading-tight font-display">
          Meet EDITH<span className="opacity-30">.</span>
        </h1>
        
        <p className="text-lg md:text-2xl opacity-70 max-w-2xl mx-auto mb-12 font-light leading-relaxed">
          The ultimate chat interface that streamlines your project management and developer workflow into a single, profound experience.
        </p>
        
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <button className="flex items-center justify-center gap-3 bg-[var(--color-bgCTA)] text-[var(--color-textCTA)] px-10 py-5 rounded-full font-semibold text-lg hover:scale-105 transition-transform shadow-lg w-full sm:w-auto">
            <span>Download for Windows</span>
            <Download className="w-5 h-5" />
          </button>
          <button className="flex items-center justify-center gap-3 border border-[var(--color-bgHover)] bg-[var(--color-bgComponents)] hover:bg-[var(--color-bgPrimary)] px-8 py-5 rounded-full font-medium text-lg transition-colors w-full sm:w-auto shadow-sm">
            <span>View Documentation</span>
            <Terminal className="w-5 h-5 opacity-70" />
          </button>
        </div>
      </motion.div>
    </section>
  );
};

export default Hero;
