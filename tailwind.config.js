/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Orbitron', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
        display: ['Syncopate', 'sans-serif'],
        cyber: ['Russo One', 'sans-serif'],
        exo: ['Exo 2', 'sans-serif'],
        audio: ['Audiowide', 'sans-serif'],
        bruno: ['Bruno Ace SC', 'sans-serif'],
        wall: ['Wallpoet', 'sans-serif'],
      },
      colors: {
        'neon-green': '#39FF14',
        'crimson-red': '#FF003C',
        'cyber-black': '#050505',
        'cyber-gray': '#121212',
        'neon-blue': '#00F0FF',
        'neon-purple': '#BC13FE',
        'neon-yellow': '#FFEA00',
      },
      animation: {
        'glitch': 'glitch 0.3s cubic-bezier(.25, .46, .45, .94) both infinite',
        'float-up': 'floatUp 3s ease-out forwards',
        'pulse-fast': 'pulse 1s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'scanline': 'scanline 10s linear infinite',
        'text-shimmer': 'textShimmer 3s ease-in-out infinite',
        'glitch-text': 'glitchText 5s infinite',
        'data-stream': 'dataStream 20s linear infinite',
        'scanning': 'scanning 8s linear infinite',
        'spin-slow': 'spin 10s linear infinite',
      },
      keyframes: {
        scanning: {
          '0%': { top: '0%' },
          '100%': { top: '100%' },
        },
        dataStream: {
          '0%': { backgroundPosition: '0% 0%' },
          '100%': { backgroundPosition: '0% 100%' },
        },
        glitch: {
          '0%': { transform: 'translate(0)' },
          '20%': { transform: 'translate(-2px, 2px)' },
          '40%': { transform: 'translate(-2px, -2px)' },
          '60%': { transform: 'translate(2px, 2px)' },
          '80%': { transform: 'translate(2px, -2px)' },
          '100%': { transform: 'translate(0)' },
        },
        glitchText: {
          '0%, 100%': { transform: 'skew(0deg)' },
          '20%': { transform: 'skew(-1deg)' },
          '21%': { transform: 'skew(10deg)' },
          '22%': { transform: 'skew(0deg)' },
          '60%': { transform: 'skew(0deg)' },
          '61%': { transform: 'skew(-15deg)' },
          '62%': { transform: 'skew(0deg)' },
        },
        floatUp: {
          '0%': { transform: 'translateY(0)', opacity: '0' },
          '10%': { opacity: '1' },
          '100%': { transform: 'translateY(-100px)', opacity: '0' },
        },
        scanline: {
          '0%': { transform: 'translateY(0)' },
          '100%': { transform: 'translateY(100vh)' },
        },
        textShimmer: {
          '0%, 100%': { opacity: '1', filter: 'brightness(1)' },
          '50%': { opacity: '0.8', filter: 'brightness(1.5)' },
        },
      },
    },
  },
  plugins: [],
}
