import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#0b0f14',
        panel: '#121923',
        surface: '#17202d',
        border: '#223042',
        ink: '#e6edf3',
        muted: '#8b9bb0',
        accent: '#3b82f6',
        'accent-end': '#8b5cf6',
      },
      borderRadius: {
        card: '12px',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      boxShadow: {
        soft: '0 12px 32px -12px rgba(2, 6, 12, 0.65)',
      },
    },
  },
  plugins: [],
};

export default config;
