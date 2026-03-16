import React from 'react';
import { motion, useInView } from 'framer-motion';
import { useRef } from 'react';
import { Sparkles, TerminalSquare } from 'lucide-react';

const Story = () => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  const storyText = "When I was in 10th grade I was inspired by Iron man's J.A.R.V.I.S. and I wanted to make it real so bad. But at that time there was no technology remotely similar to what JARVIS did, and neither did I have the required skills. But now that we have AI, and I have the skills, why not fulfill the dream of that child in me who still craves something cool and exciting? Therefore the idea for an app which mimics Jarvis arose, and this is Version 1 of that.";
  const words = storyText.split(" ");

  const container = {
    hidden: { opacity: 0 },
    visible: (i = 1) => ({
      opacity: 1,
      transition: { staggerChildren: 0.05, delayChildren: 0.2 * i },
    }),
  };

  const child = {
    visible: { opacity: 1, y: 0, filter: "blur(0px)" },
    hidden: { opacity: 0, y: 10, filter: "blur(4px)" },
  };

  return (
    <section className="py-32 px-4 relative z-10" id="story">
      <div className="max-w-4xl mx-auto">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="flex items-center gap-4 mb-8"
        >
          <div className="w-12 h-[1px] bg-[var(--color-bgHover)]"></div>
          <p className="font-mono tracking-widest uppercase text-sm flex items-center gap-2 opacity-60">
            <Sparkles className="w-4 h-4" /> Personal Log
          </p>
        </motion.div>
        
        <div ref={ref} className="glass-panel p-8 md:p-12 rounded-3xl relative overflow-hidden">
          <div className="absolute top-0 right-0 p-6 opacity-5">
            <TerminalSquare className="w-32 h-32" />
          </div>
          
          <motion.h2 
            initial={{ opacity: 0 }}
            animate={isInView ? { opacity: 1 } : { opacity: 0 }}
            transition={{ duration: 1 }}
            className="text-3xl md:text-5xl font-bold mb-8 font-display max-w-2xl relative z-10"
          >
            The Childhood Dream of J.A.R.V.I.S.
          </motion.h2>

          <motion.div
            style={{ display: "flex", flexWrap: "wrap", gap: "0.4rem" }}
            variants={container}
            initial="hidden"
            animate={isInView ? "visible" : "hidden"}
            className="text-lg md:text-2xl opacity-80 font-light leading-relaxed relative z-10"
          >
            {words.map((word, index) => (
              <motion.span variants={child} key={index}>
                {word}
              </motion.span>
            ))}
          </motion.div>
          
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0 }}
            transition={{ delay: 3, duration: 1 }}
            className="mt-12 opacity-60 font-mono text-sm border-l-2 border-[var(--color-bgHover)] pl-4"
          >
            "I know there might be some bugs in it, but I am planning to go on even further in this process and get this project to match the standards of Tony Stark."
          </motion.div>
        </div>
      </div>
    </section>
  );
};

export default Story;
