import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), {
    name: 'pokefolio-offline-version',
    apply: 'build',
    generateBundle(_options, bundle) {
      // Cada cambio de la app o del fallback genera un worker distinto, sin cachear la app.
      const hash = createHash('sha256')
      for (const name of Object.keys(bundle).sort()) {
        const output = bundle[name]
        hash.update(name).update(output.type === 'chunk' ? output.code : output.source)
      }
      const directory = new URL('./public/pwa/', import.meta.url)
      for (const name of readdirSync(directory).sort()) hash.update(name).update(readFileSync(new URL(name, directory)))
      const worker = readFileSync(new URL('./public/sw.js', import.meta.url), 'utf8')
      hash.update(worker).update(readFileSync(new URL('./public/manifest.webmanifest', import.meta.url)))
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: worker.replaceAll('__POKEFOLIO_BUILD__', hash.digest('hex').slice(0, 20)) })
    },
  }],
})
