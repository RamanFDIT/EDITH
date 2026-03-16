import React, { useRef, useEffect, useState, useMemo } from 'react';
import { motion, useScroll, useTransform, useSpring } from 'framer-motion';
import { Github, Trello, Mail, Calendar, MessageSquare } from 'lucide-react';

const Problem = () => {
  const containerRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ["start center", "end end"]
  });

  const smoothProgress = useSpring(scrollYProgress, {
    stiffness: 70,
    damping: 20,
    restDelta: 0.001
  });

  const pathOpacity = useTransform(smoothProgress, [0, 0.2, 0.8, 1], [0, 1, 1, 0]);
  const ringOpacity = useTransform(smoothProgress, [0, 0.8, 1], [0, 1, 0]);
  const ringScale = useTransform(smoothProgress, [0, 1], [0.8, 1.2]);

  // Calculate layout dimensions for SVG drawing
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.offsetWidth,
          height: containerRef.current.offsetHeight
        });
      }
    };
    updateDimensions();
    // Small delay to ensure layout is done
    const timer = setTimeout(updateDimensions, 100);
    window.addEventListener('resize', updateDimensions);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('resize', updateDimensions);
    };
  }, []);

  const silos = useMemo(() => [
    { id: 'trello', icon: <Trello className="w-5 h-5 md:w-6 md:h-6" />, label: 'Jira / Trello', top: '15%', left: '10%', delay: 0 },
    { id: 'github', icon: <Github className="w-5 h-5 md:w-6 md:h-6" />, label: 'GitHub', top: '35%', left: '30%', delay: 0.2 },
    { id: 'slack', icon: <MessageSquare className="w-5 h-5 md:w-6 md:h-6" />, label: 'Slack', top: '55%', left: '15%', delay: 0.4 },
    { id: 'gmail', icon: <Mail className="w-5 h-5 md:w-6 md:h-6" />, label: 'Gmail', top: '75%', left: '35%', delay: 0.6 },
    { id: 'calendar', icon: <Calendar className="w-5 h-5 md:w-6 md:h-6" />, label: 'Calendar', top: '85%', left: '5%', delay: 0.8 },
  ], []);

  // The center node position (The Compiler / EDITH)
  const isDesktop = dimensions.width > 768;
  const targetX = isDesktop ? dimensions.width * 0.75 : dimensions.width * 0.5;
  const targetY = isDesktop ? dimensions.height * 0.5 : dimensions.height * 0.75;

  return (
    <section className="py-24 px-4 pb-48 md:pb-24 relative z-10 min-h-[90vh] flex flex-col items-center overflow-visible" id="problem" ref={containerRef}>
      
      {/* Title */}
      <div className="text-center z-20 mb-12 md:mb-0 md:absolute md:top-0 md:left-1/2 md:-translate-x-1/2 w-full">
        <motion.h2 
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-4xl md:text-5xl font-bold mb-4 font-display"
        >
          The Problem: <span className="opacity-40">Silos.</span>
        </motion.h2>
        <motion.p 
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.2 }}
          className="text-lg opacity-70 max-w-xl mx-auto font-light"
        >
          Tools sit in their own isolated spaces, causing friction in a developer's workflow. 
        </motion.p>
      </div>

      <div className="w-full max-w-7xl flex-grow relative mt-16 md:mt-32 min-h-[800px] md:min-h-[600px]">
        
        {/* SVG Connection Lines Background */}
        {dimensions.width > 0 && (
          <svg className="absolute inset-0 w-full h-full pointer-events-none z-0 overflow-visible">
            {silos.map((silo, i) => {
              // Parse percentages to pixels for line drawing
              const startX = isDesktop ? (parseFloat(silo.left) / 100) * dimensions.width : dimensions.width * (parseFloat(silo.left) || 50) / 100;
              const startY = isDesktop ? (parseFloat(silo.top) / 100) * dimensions.height : ((i + 1) * dimensions.height) / (silos.length + 3.5);

              // Control points for bezier curves
              const controlPointX = isDesktop ? startX + (targetX - startX) * 0.5 : startX;
              const controlPointY = isDesktop ? startY : startY + (targetY - startY) * 0.5;
              
              const d = isDesktop 
                ? `M ${startX} ${startY} C ${controlPointX} ${startY}, ${controlPointX} ${targetY}, ${targetX} ${targetY}`
                : `M ${startX} ${startY} C ${startX} ${controlPointY}, ${targetX} ${controlPointY}, ${targetX} ${targetY}`;

              return (
                <g key={`path-${i}`}>
                  {/* Subtle background track */}
                  <path
                    d={d}
                    fill="none"
                    stroke="var(--color-textPrimary)"
                    strokeWidth="2"
                    strokeDasharray="4 8"
                    opacity="0.15"
                  />
                  {/* Animated flowing line tied to scroll */}
                  <motion.path
                    d={d}
                    fill="none"
                    stroke="var(--color-textPrimary)"
                    strokeWidth="2"
                    strokeDasharray="4 8"
                    style={{
                      pathLength: smoothProgress,
                      opacity: pathOpacity
                    }}
                  />
                </g>
              );
            })}
          </svg>
        )}

        {/* Scattered Silos (Left Side / Top Side on Mobile) */}
        {silos.map((silo, i) => {
          const startX = isDesktop ? (parseFloat(silo.left) / 100) * dimensions.width : dimensions.width * (parseFloat(silo.left) || 50) / 100;
          const startY = isDesktop ? (parseFloat(silo.top) / 100) * dimensions.height : ((i + 1) * dimensions.height) / (silos.length + 3.5);

          return (
            <div
              key={`wrapper-${silo.id}`}
              style={{
                position: 'absolute',
                top: `${startY}px`,
                left: `${startX}px`,
                transform: 'translate(-50%, -50%)',
                zIndex: 10,
              }}
            >
              <motion.div
                initial={{ opacity: 0, scale: 0 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true, margin: "-50px" }}
                transition={{ type: "spring", stiffness: 100, delay: silo.delay }}
                animate={{ 
                   y: isDesktop ? [0, -10, 0] : 0, 
                   transition: { duration: 4, repeat: Infinity, ease: "easeInOut", delay: silo.delay }
                }}
                className="bg-[var(--color-bgComponents)] border border-[var(--color-bgHover)] rounded-full md:rounded-2xl p-3 md:p-4 flex items-center gap-2 md:gap-3 shadow-sm hover:border-[var(--color-textPrimary)] transition-colors cursor-default"
              >
                <div className="flex-shrink-0 opacity-80">{silo.icon}</div>
                <span className="text-xs md:text-sm font-mono tracking-wide opacity-80 whitespace-nowrap hidden md:block">{silo.label}</span>
              </motion.div>
            </div>
          );
        })}

        {/* The Compiler / EDITH Core (Right Side / Bottom on Mobile) */}
        <div
            style={{
              position: 'absolute',
              top: `${targetY}px`,
              left: `${targetX}px`,
              transform: 'translate(-50%, -50%)',
              zIndex: 20,
            }}
        >
          <motion.div
             initial={{ opacity: 0, scale: 0.8 }}
             whileInView={{ opacity: 1, scale: 1 }}
             viewport={{ once: true }}
             animate={{
              boxShadow: ["0px 0px 0px rgba(0,0,0,0)", "0px 0px 40px rgba(255,255,255,0.05)", "0px 0px 0px rgba(0,0,0,0)"],
              transition: { duration: 3, repeat: Infinity, ease: "easeInOut" }
             }}
             className="p-6 md:p-8 rounded-full md:rounded-[3rem] bg-[var(--color-bgPrimary)] border-2 border-[var(--color-bgHover)] shadow-xl flex flex-col items-center justify-center gap-4 relative"
          >
          {/* Inner pulse ring */}
          <motion.div 
            style={{ opacity: ringOpacity, scale: ringScale }}
            className="absolute inset-0 border border-[var(--color-textPrimary)] rounded-full md:rounded-[3rem] pointer-events-none"
          />

          <div className="w-16 h-16 md:w-20 md:h-20 rounded-full md:rounded-2xl bg-[var(--color-textPrimary)] flex items-center justify-center flex-shrink-0">
            <img src="/EDITH.svg" alt="EDITH Core" className="w-8 h-8 md:w-10 md:h-10 filter" style={{ filter: 'var(--color-bgPrimary) === "#050505" ? "invert(1)" : "none"' }} />
          </div>
          <div className="hidden md:flex flex-col items-center">
            <h3 className="font-display text-2xl font-bold tracking-tight">The Engine</h3>
            <p className="font-mono text-xs opacity-50 tracking-widest text-center uppercase">Data Compiled</p>
          </div>
        </motion.div>
      </div>

      </div>
    </section>
  );
};

export default Problem;
