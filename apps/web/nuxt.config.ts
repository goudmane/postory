import tailwindcss from '@tailwindcss/vite'
import Aura from '@primeuix/themes/aura'

export default defineNuxtConfig({
  compatibilityDate: '2026-01-01',
  modules: ['@primevue/nuxt-module', '@pinia/nuxt'],
  css: ['~/assets/main.css'],
  vite: { plugins: [tailwindcss()] },
  primevue: { options: { theme: { preset: Aura } } },
  runtimeConfig: { apiInternal: process.env.API_INTERNAL || 'http://127.0.0.1:3001', public: { apiBase: '/api/v1' } }
})
