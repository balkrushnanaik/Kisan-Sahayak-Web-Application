/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: { colors: { forest: { DEFAULT: '#176B45', dark: '#104B34', light: '#E8F3EA' }, paper: '#FAFAF5', ink: '#1F2933', muted: '#647067', line: '#E4E8E2', gold: '#E6B34A' }, boxShadow: { soft: '0 12px 35px rgba(16, 75, 52, 0.08)' }, borderRadius: { '2xl': '1rem', '3xl': '1.4rem' } } },
  plugins: [],
};
