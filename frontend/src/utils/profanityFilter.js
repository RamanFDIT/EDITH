const PROFANITY_LIST = new Set([
  'ass', 'asshole', 'bastard', 'bitch', 'bollocks', 'bugger', 'bullshit',
  'cock', 'coon', 'crap', 'cunt', 'damn', 'dick', 'douchebag', 'dyke',
  'fag', 'faggot', 'fuck', 'goddamn', 'hell', 'homo', 'jerk', 'kike',
  'lesbo', 'motherfucker', 'negro', 'nigga', 'nigger', 'piss', 'prick',
  'pussy', 'retard', 'shit', 'slut', 'spic', 'tard', 'tit', 'tits',
  'twat', 'wanker', 'whore', 'anal', 'anus', 'arsehole', 'ballsack',
  'biatch', 'blowjob', 'bollock', 'boner', 'boob', 'buttplug', 'clitoris',
  'dildo', 'fudgepacker', 'jackoff', 'jizz', 'knobend', 'labia', 'muff',
  'penis', 'pube', 'scrotum', 'sex', 'skank', 'smegma', 'spunk', 'tosser',
  'vulva', 'wank'
]);

export function containsProfanity(text) {
  const words = text.toLowerCase().split(/\s+/);
  return words.some(word => PROFANITY_LIST.has(word.replace(/[^a-z]/g, '')));
}

const NAME_REGEX = /^[a-zA-Z\s\-']+$/;

export function validateName(text) {
  if (!text || !text.trim()) {
    return { valid: false, error: 'Please enter your name' };
  }
  const trimmed = text.trim();
  if (trimmed.length < 2) {
    return { valid: false, error: 'Name must be at least 2 characters' };
  }
  if (trimmed.length > 20) {
    return { valid: false, error: 'Name must be 20 characters or less' };
  }
  if (!NAME_REGEX.test(trimmed)) {
    return { valid: false, error: 'Name can only contain letters, spaces, hyphens, and apostrophes' };
  }
  if (containsProfanity(trimmed)) {
    return { valid: false, error: "That name isn't allowed" };
  }
  return { valid: true, error: null };
}
