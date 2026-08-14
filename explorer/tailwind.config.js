/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        dle: {
          bg: '#05070d',
          card: '#0a1224',
          ink: '#e8f4ff',
          muted: '#8aa4c2',
          accent: '#00b4ff',
          mint: '#00ffa3',
          line: 'rgba(0, 180, 255, 0.16)',
        },
      },
      boxShadow: {
        capsule: '0 0 24px rgba(0, 180, 255, 0.22)',
        glow: '0 0 28px rgba(0, 163, 255, 0.18)',
      },
    },
  },
  plugins: [],
}
