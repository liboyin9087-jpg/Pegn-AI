/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        // App existing colors
        surface: '#ffffff',
        'surface-secondary': '#f7f7f5',
        'surface-tertiary': '#f0f0ee',
        'surface-muted': '#fbfbf9',
        panel: '#fbfbfa',
        'panel-hover': '#f0f0ee',
        border: '#e8e8e5',
        'border-strong': '#d4d4d0',
        'text-primary': '#37352f',
        'text-secondary': '#6b6b6b',
        'text-tertiary': '#9b9b9b',
        'text-quaternary': '#b1b1ad',
        accent: '#2383e2',
        'accent-hover': '#1b6ec2',
        'accent-light': '#e8f2fc',
        'accent-muted': '#d3e6f8',
        success: '#0f7b4e',
        'success-light': '#e6f5ef',
        warning: '#c07d16',
        error: '#d44c47',
        'error-light': '#fde8e7',

        // Agent Dashboard Dark Mode Tokens
        'agent-bg-0': '#09090B',
        'agent-bg-1': '#111113',
        'agent-bg-2': '#1A1A1E',
        'agent-bg-3': '#222226',
        'agent-bg-4': '#2A2A2E',
        'agent-text-primary': 'rgba(255, 255, 255, 0.92)',
        'agent-text-secondary': 'rgba(255, 255, 255, 0.64)',
        'agent-text-tertiary': 'rgba(255, 255, 255, 0.44)',
        'agent-text-disabled': 'rgba(255, 255, 255, 0.28)',
        'agent-border-subtle': 'rgba(255, 255, 255, 0.06)',
        'agent-border-default': 'rgba(255, 255, 255, 0.10)',
        'agent-border-hover': 'rgba(255, 255, 255, 0.15)',
        'agent-border-focus': 'rgba(255, 255, 255, 0.20)',
      },
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'ui-sans-serif', '-apple-system', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"SF Mono"', 'ui-monospace', 'SFMono-Regular', 'monospace'],
      },
      boxShadow: {
        'sm': '0 1px 2px rgba(0,0,0,0.04)',
        'md': '0 2px 8px rgba(0,0,0,0.06)',
        'lg': '0 4px 16px rgba(0,0,0,0.08)',
        'xl': '0 8px 32px rgba(0,0,0,0.1)',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'soft-pulse': {
          '0%, 100%': { opacity: '0.6' },
          '50%': { opacity: '1' },
        },
      },
      animation: {
        'fade-in': 'fade-in 220ms ease-out',
        'soft-pulse': 'soft-pulse 1.4s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
