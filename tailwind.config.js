/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        // Primary — deep navy (brand / sidebar / headers)
        navy: {
          50: '#f1f5f9',
          100: '#e2e8f0',
          200: '#c7d2de',
          300: '#9fb0c4',
          400: '#6f87a3',
          500: '#4d6885',
          600: '#3b526b',
          700: '#2d4157',
          800: '#1e2f42',
          900: '#132131',
          950: '#0b1522',
        },
        // Secondary — clean blue / cyan accent
        brand: {
          50: '#eff9ff',
          100: '#dbf1ff',
          200: '#bfe7ff',
          300: '#93d9ff',
          400: '#60c3ff',
          500: '#3ba7fb',
          600: '#2589f0',
          700: '#1d71dd',
          800: '#1f5bb3',
          900: '#1f4f8d',
          950: '#173156',
        },
      },
      fontFamily: {
        sans: ['Inter', 'Segoe UI', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 2px 0 rgb(15 23 42 / 0.04), 0 1px 3px 0 rgb(15 23 42 / 0.06)',
        'card-hover': '0 4px 12px -2px rgb(15 23 42 / 0.10), 0 2px 6px -2px rgb(15 23 42 / 0.06)',
        pop: '0 10px 30px -10px rgb(15 23 42 / 0.25)',
      },
      keyframes: {
        'fade-in': { '0%': { opacity: '0' }, '100%': { opacity: '1' } },
        'slide-up': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: { '100%': { transform: 'translateX(100%)' } },
      },
      animation: {
        'fade-in': 'fade-in 140ms ease-out',
        'slide-up': 'slide-up 160ms ease-out',
      },
    },
  },
  plugins: [],
};
