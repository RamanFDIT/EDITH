import React from 'react';
import { motion } from 'framer-motion';
import { AlertCircle, Globe } from 'lucide-react';

const Future = () => {
  return (
    <section className="py-24 px-4 relative z-10" id="vision">
      <div className="max-w-4xl mx-auto space-y-8">
        
        {/* Caveats Section */}
        <motion.div 
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="glass-panel p-8 md:p-12 rounded-3xl border-l-[6px] border-[var(--color-colorFail)] bg-[var(--color-bgComponents)] shadow-sm"
        >
          <div className="flex items-center gap-4 mb-6">
            <div className="text-[var(--color-colorFail)]">
              <AlertCircle className="w-7 h-7" />
            </div>
            <h2 className="text-3xl font-bold font-display tracking-tight">System Caveats</h2>
          </div>
          <p className="text-lg leading-relaxed font-light opacity-80">
            Building a premium assistant comes with real-world constraints. Most enterprise AI APIs are heavily paywalled. I have engineered EDITH to make the absolute most out of the free resources and tiers I had access to, guaranteeing a functional, high-quality experience without breaking the bank.
          </p>
        </motion.div>

        {/* Future Vision Section */}
        <motion.div 
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.2 }}
          className="glass-panel p-8 md:p-12 rounded-3xl relative overflow-hidden group shadow-sm bg-[var(--color-bgComponents)]"
        >
          <div className="absolute top-0 right-0 p-8 opacity-5">
            <Globe className="w-48 h-48" />
          </div>
          
          <div className="flex items-center gap-4 mb-6 relative z-10">
            <div className="p-3 bg-[var(--color-bgHover)] rounded-xl opacity-80">
              <Globe className="w-6 h-6" />
            </div>
            <h2 className="text-3xl font-bold font-display tracking-tight">The Future: Web Platform</h2>
          </div>
          <p className="text-lg leading-relaxed font-light mb-8 relative z-10 opacity-80 max-w-2xl">
            While the Windows App provides deep integration with local files, I am planning a lightweight web version. It might have less desktop-level functionality, but it will seamlessly cater to users who prefer not to download software directly to their PCs.
          </p>
          
          <div className="flex items-center text-sm font-mono tracking-[0.2em] relative z-10 border-t border-[var(--color-bgHover)] pt-6 mt-6 opacity-50 uppercase">
            <span>EDITH PROTOCOL // VERSION 1.0</span>
            <div className="ml-auto w-2 h-2 rounded-full bg-[var(--color-colorSuccess)] animate-pulse"></div>
          </div>
        </motion.div>
        
      </div>
    </section>
  );
};

export default Future;
