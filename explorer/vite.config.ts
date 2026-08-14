import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 27121,
    proxy: {
      '/archive': {
        target: 'http://127.0.0.1:27101',
        changeOrigin: true,
        rewrite: (pathname) => pathname.replace(/^\/archive/, ''),
      },
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 27121,
  },
  build: {
    target: ['es2020', 'edge88', 'firefox78', 'chrome87', 'safari14'],
  },
})
