import type { Config } from 'tailwindcss';

/**
 * Design system palette — ink/paper/accent (copied from the reference
 * project and re-scoped to this app's src/ layout). The design system's
 * component classes live in globals.css; Tailwind utilities complement them.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: { DEFAULT: '#17181b', 2: '#202226', line: '#3a3b3e' },
        paper: { DEFAULT: '#ede8dc', 2: '#f7f4ec', line: '#d8d2c0' },
        accent: { DEFAULT: '#e8823c', dark: '#b85c1e' },
        approve: { DEFAULT: '#2f7d52', bg: '#e1ebe2' },
        reject: { DEFAULT: '#b23a2a', bg: '#f3e1dc' },
        pending: { DEFAULT: '#b8791c', bg: '#f1e4c7' },
      },
      fontFamily: {
        display: ['Fraunces', 'serif'],
        sans: ['Inter', 'sans-serif'],
        mono: ['IBM Plex Mono', 'monospace'],
      },
    },
  },
  plugins: [],
};

export default config;