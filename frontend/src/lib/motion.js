export const ease = [0.22, 0.61, 0.36, 1];

export const durations = {
  fast: 0.18,
  base: 0.22,
  slow: 0.28,
  modal: 0.32,
};

export const fadeUp = {
  initial: { opacity: 0, y: 8 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: 4 },
  transition: { duration: durations.base, ease },
};

export const fadeIn = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: durations.fast, ease },
};

export const popIn = {
  initial: { opacity: 0, scale: 0.96, y: 8 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.97, y: 4 },
  transition: { duration: durations.modal, ease },
};

export const stagger = (childDelay = 0.05, initialDelay = 0) => ({
  initial: {},
  animate: {
    transition: {
      delayChildren: initialDelay,
      staggerChildren: childDelay,
    },
  },
});
