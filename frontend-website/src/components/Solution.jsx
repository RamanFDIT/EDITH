import React from 'react';
import { motion } from 'framer-motion';
import { MessageSquare, FileText, Search, Zap } from 'lucide-react';

const Solution = () => {
  return (
    <section className="py-24 px-4 relative z-10" id="solution">
      <div className="max-w-6xl mx-auto">
        <div className="text-center mb-16">
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            className="inline-block p-1 rounded-full border border-[var(--color-bgHover)] bg-[var(--color-bgComponents)] mb-6 shadow-sm"
          >
            <span className="px-4 py-1 text-sm opacity-80 font-mono uppercase tracking-[0.2em] font-medium">
              The Solution
            </span>
          </motion.div>
          
          <motion.h2 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-4xl md:text-6xl font-bold mb-6 font-display"
          >
            A Unified Chat Interface<span className="opacity-30">.</span>
          </motion.h2>
          
          <motion.p 
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
            className="text-xl max-w-3xl mx-auto leading-relaxed opacity-70 font-light"
          >
            EDITH collapses the fragmented workspace into a single intuitive chat. It sits at the center of your workflow, seamlessly interacting with Jira, GitHub, Slack, and your calendar.
          </motion.p>
        </div>

        {/* Feature Cards Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          
          {/* Card 1: Chat Interface */}
          <motion.div 
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6 }}
            className="glass-panel p-8 md:p-10 rounded-[2rem] flex flex-col gap-6 relative overflow-hidden group border border-[var(--color-bgHover)] hover:border-[var(--color-textPrimary)] transition-colors"
          >
            <div className="bg-[var(--color-bgHover)] w-14 h-14 rounded-2xl flex items-center justify-center">
              <MessageSquare className="w-6 h-6" />
            </div>
            <h3 className="text-3xl font-bold font-display tracking-tight">Centralized Context</h3>
            <p className="opacity-70 text-lg leading-relaxed flex-grow font-light">
              No more context switching. Ask EDITH to summarize a Jira ticket, draft an email, or check your schedule without ever leaving the conversation.
            </p>
          </motion.div>

          {/* Card 2: Local File Access */}
          <motion.div 
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="glass-panel p-8 md:p-10 rounded-[2rem] flex flex-col gap-6 relative overflow-hidden group border border-[var(--color-bgHover)] hover:border-[var(--color-textPrimary)] transition-colors"
          >
            <div className="bg-[var(--color-bgHover)] w-14 h-14 rounded-2xl flex items-center justify-center">
              <Search className="w-6 h-6" />
            </div>
            <h3 className="text-3xl font-bold font-display tracking-tight">Local Ecosystem</h3>
            <p className="opacity-70 text-lg leading-relaxed flex-grow font-light">
              EDITH can look into your local system. Say <span className="font-medium opacity-100">"EDITH, what is my last downloaded file?"</span> and it will identify it. If it's a document, it summarizes the content right in the chat.
            </p>
            
            {/* Visual Chat Mockup */}
            <div className="mt-4 border border-[var(--color-bgHover)] rounded-2xl p-4 bg-[var(--color-bgPrimary)] shadow-inner">
              <div className="flex items-start gap-4 mb-4">
                <div className="w-8 h-8 rounded-full bg-[var(--color-bgHover)] flex-shrink-0"></div>
                <div className="border border-[var(--color-bgHover)] bg-[var(--color-bgComponents)] px-4 py-2 rounded-2xl rounded-tl-sm text-sm">
                  EDITH, what's my last downloaded file?
                </div>
              </div>
              <div className="flex items-start gap-4 flex-row-reverse">
                <div className="w-8 h-8 rounded-full border border-[var(--color-bgHover)] flex items-center justify-center flex-shrink-0 bg-[var(--color-bgCurrent)]">
                  <Zap className="w-4 h-4 opacity-70" />
                </div>
                <div className="border border-[var(--color-bgHover)] bg-[var(--color-bgComponents)] px-4 py-3 rounded-2xl rounded-tr-sm text-sm">
                  <div className="flex items-center gap-2 mb-2 pb-2 border-b border-[var(--color-bgHover)]">
                    <FileText className="w-4 h-4" /> 
                    <span className="font-mono text-xs opacity-70 tracking-widest">QuarterlyReport.pdf</span>
                  </div>
                  <span className="opacity-80">Found it. This document is a 12-page PDF outlining Q3 revenue growth and...</span>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
};

export default Solution;
