import { defineConfig } from 'vitest/config'

// Las pruebas usan servicios simulados; nunca cargar credenciales del entorno local.
export default defineConfig({ envDir: false, test: { include: ['tests/**/*.test.ts'], testTimeout: 20000, hookTimeout: 60000 } })
