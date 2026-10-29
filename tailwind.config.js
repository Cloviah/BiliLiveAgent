/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/**/*.{html,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          900: '#0B1220',
          800: '#121A2B',
          700: '#1B2437',
          600: '#243049',
        },
        neon: {
          teal: '#2BD9C4',
          blue: '#3B82F6',
          orange: '#FF8A4C',
        },
        soft: {
          text: '#E8EEF7',
          sub: '#9AA7BD',
        },
        state: {
          ok: '#22C55E',
          warn: '#F59E0B',
          bad: '#EF4444',
          idle: '#64748B',
        },
      },
      fontFamily: {
        sans: ['PingFang SC', 'Microsoft YaHei', 'Segoe UI', 'system-ui', 'sans-serif'],
        mono: ['JetBrains Mono', 'Consolas', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        glow: '0 0 24px rgba(43, 217, 196, 0.22)',
        card: '0 18px 44px rgba(2, 8, 20, 0.55)',
      },
      backgroundImage: {
        'app-grad': 'linear-gradient(160deg, #0B1220 0%, #121A2B 45%, #161F33 100%)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        breathe: {
          '0%,100%': { opacity: '1' },
          '50%': { opacity: '0.45' },
        },
      },
      animation: {
        'fade-up': 'fade-up 220ms ease-out both',
        breathe: 'breathe 2s ease-in-out infinite',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
