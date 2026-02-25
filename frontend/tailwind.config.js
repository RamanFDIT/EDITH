/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        "bgPrimary" : "#050505",
        "bgComponents" : "#1A1a1a",
        "bgHover" : "#333333",
        "textPrimary" : "#D9D9D9",
        "textCTA" : "#050505",
        "bgCTA" : "#FFFFFF",
        "colorSuccess" : "#4DFF4D",
        "colorFail" : "#DF0000",
      },
      fontFamily: {
        "fontDisplay": ["'Space Grotesk'", "sans-serif"],
        "fontBody": ["'Inter'", "sans-sesrif"],
        "fontMono": ["'Fira Code'", "monospace"],
      }
    },
  },
  plugins: [],
}

