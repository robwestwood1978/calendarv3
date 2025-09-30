import type { Config } from 'tailwindcss'
export default { content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: { colors: { brand: { 50:'#e6f4ff',500:'#1e90ff',600:'#1b6fd6' } } } }, plugins: [] } satisfies Config
