// Genera únicamente PNG binarios desde el SVG de marca; no modifica archivos de texto.
import { readFile } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'

const svg = await readFile(new URL('../public/pwa/icon-source.svg', import.meta.url), 'utf8')
const output = process.argv[2] ? resolve(process.argv[2]) : fileURLToPath(new URL('../public/pwa/', import.meta.url))
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 })
  for (const [name, size] of [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]]) {
    await page.setViewportSize({ width: size, height: size })
    await page.setContent(`<html><head><style>html,body{margin:0;background:#17324d}svg{display:block;width:100vw;height:100vh}</style></head><body>${svg}</body></html>`)
    await page.screenshot({ path: join(output, name), omitBackground: false })
    console.log(`${name}: ${size}x${size}`)
  }
} finally { await browser.close() }
