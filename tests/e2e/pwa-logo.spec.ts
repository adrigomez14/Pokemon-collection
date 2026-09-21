import { readFileSync } from 'node:fs'
import { test as base, expect } from '@playwright/test'

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8')
const source = read('public/pwa/icon-source.svg')
const favicon = read('public/pokefolio.svg')
const pngs = [['icon-192.png', 192], ['icon-512.png', 512], ['apple-touch-icon.png', 180]] as const
const png = (name: string) => readFileSync(new URL(`../../public/pwa/${name}`, import.meta.url))
const dataUrl = (type: string, data: string | Buffer) => `data:${type};base64,${Buffer.from(data).toString('base64')}`

const test = base.extend({
  page: async ({ browser }, providePage) => {
    // Contexto propio: no heredar viewport móvil, escala ni emulación de los proyectos.
    // El browser pertenece a Playwright y no se cierra desde esta fixture.
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, serviceWorkers: 'block' })
    try {
      await page.route('**/*', route => route.abort())
      // CSS real, sin fuentes remotas. No se inicia la aplicación ni se cargan credenciales.
      const css = `${read('src/index.css')}\n${read('src/theme.css')}`.replace(/@import\s+url\([^)]*\);/g, '')
      await page.setContent(`<style>${css}
        html,body { background: #f5f8fc !important; background-image: none !important; }
        .brand-mark { position: absolute; left: 58px; top: 58px; display: block; }
        .brand-mark .pokeball { transform: scale(11); transform-origin: top left; }
        </style><span class="brand-mark"><span class="pokeball"></span></span>`)
      await providePage(page)
    } finally {
      await page.close()
    }
  },
})

test.describe('marca PWA coherente con la cabecera', () => {
  test('respeta el border-box de la bola y el content-box del pseudoelemento real', async ({ page }) => {
    const geometry = await page.locator('.pokeball').evaluate(element => {
      const ball = getComputedStyle(element)
      const button = getComputedStyle(element, '::after')
      return {
        width: ball.width, height: ball.height, box: ball.boxSizing, border: ball.borderTopWidth,
        origin: ball.backgroundOrigin, gradient: ball.backgroundImage,
        buttonWidth: button.width, buttonHeight: button.height, buttonBox: button.boxSizing,
        buttonBorder: button.borderTopWidth, buttonTop: button.top, buttonLeft: button.left,
      }
    })
    expect(geometry).toMatchObject({
      width: '36px', height: '36px', box: 'border-box', border: '3px', origin: 'padding-box',
      buttonWidth: '9.59375px', buttonHeight: '9.59375px', buttonBox: 'content-box',
      buttonBorder: '3px', buttonTop: '15px', buttonLeft: '15px',
    })
    expect(geometry.gradient).toContain('rgb(237, 72, 84) 44%')
    expect(geometry.gradient).toContain('rgb(23, 50, 77) 56%')
  })

  test('comparte primitivas y proporciones entre SVG, con radio 198 dentro de la zona segura', () => {
    const mark = (svg: string) => svg.slice(svg.indexOf('<g id="pokeball"')).replace(/ transform="[^"]*"/, '').replace(/>\s+</g, '><').trim()
    expect(mark(source)).toBe(mark(favicon))
    for (const svg of [source, favicon]) {
      expect(svg).toContain('<clipPath id="ball-interior"><circle cx="18" cy="18" r="15"/></clipPath>')
      expect(svg).toContain('r="18" fill="#17324d"')
      expect(svg).toContain('height="13.2" fill="#ed4854"')
      expect(svg).toContain('y="16.2" width="30" height="3.6" fill="#17324d"')
      expect(svg).toContain('r="7.796875" fill="#17324d"')
      expect(svg).toContain('r="4.796875" fill="#fff"')
      expect(svg).not.toMatch(/<(?:image|script|foreignObject)\b|\bhref=/)
    }
    expect(source).toContain('viewBox="0 0 512 512"')
    expect(source).toContain('transform="translate(58 58) scale(11)"')
    expect(source).toContain('<rect width="512" height="512" fill="#f5f8fc"/>')
    expect(58 + 18 * 11).toBe(256)
    expect(18 * 11).toBeLessThan(512 * 0.4)
  })

  for (const [name, size] of pngs) {
    test(`${name} conserva tamaño, opacidad total, colores, contorno y margen maskable`, async ({ page }) => {
      const bytes = png(name)
      expect(bytes.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
      expect(bytes.toString('ascii', 12, 16)).toBe('IHDR')
      expect(bytes.readUInt32BE(16)).toBe(size)
      expect(bytes.readUInt32BE(20)).toBe(size)
      expect(bytes[24]).toBe(8)
      expect([2, 6]).toContain(bytes[25]) // RGB o RGBA, sin asumir un codificador concreto.
      const result = await page.evaluate(async ({ url, size }) => {
        const image = new Image()
        image.src = url
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = size
        const context = canvas.getContext('2d')!
        context.drawImage(image, 0, 0)
        const { data } = context.getImageData(0, 0, size, size)
        let transparent = 0
        let unsafe = 0
        for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
          const offset = (y * size + x) * 4
          if (data[offset + 3] !== 255) transparent++
          if (Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2) > size * 0.4
            && (data[offset] !== 245 || data[offset + 1] !== 248 || data[offset + 2] !== 252)) unsafe++
        }
        // Coordenadas de la cabecera antes de escalar; lejos de los bordes suavizados.
        const sample = (x: number, y: number) => {
          const offset = (Math.floor((58 + y * 11) * size / 512) * size + Math.floor((58 + x * 11) * size / 512)) * 4
          return Array.from(data.slice(offset, offset + 4))
        }
        return { width: image.naturalWidth, height: image.naturalHeight, transparent, unsafe,
          corner: Array.from(data.slice(0, 4)), samples: [[18, 1.5], [18, 6], [18, 11.5], [18, 18], [18, 24.5], [18, 30], [6, 18]].map(([x, y]) => sample(x, y)) }
      }, { url: dataUrl('image/png', bytes), size })
      expect(result).toEqual({ width: size, height: size, transparent: 0, unsafe: 0,
        corner: [245, 248, 252, 255], samples: [
          [23, 50, 77, 255], [237, 72, 84, 255], [23, 50, 77, 255], [255, 255, 255, 255],
          [23, 50, 77, 255], [255, 255, 255, 255], [23, 50, 77, 255],
        ] })
    })
  }

  test('el PNG 512 reproduce los píxeles del logo CSS ampliado, salvo suavizado de bordes', async ({ page }) => {
    // zoom recalcula el layout a resolución final; transform ampliaría también el
    // redondeo previo de Chromium a píxeles enteros del botón original de 15.59375px.
    await page.locator('.pokeball').evaluate(element => {
      const style = (element as HTMLElement).style
      style.transform = 'none'
      style.zoom = '11'
      style.verticalAlign = 'top'
    })
    const reference = await page.screenshot({ clip: { x: 0, y: 0, width: 512, height: 512 } })
    await page.locator('.pokeball').evaluate(element => element.removeAttribute('style'))
    const comparison = await page.evaluate(async ({ reference, generated }) => {
      const pixels = async (url: string) => {
        const image = new Image()
        image.src = url
        await image.decode()
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = 512
        const context = canvas.getContext('2d')!
        context.drawImage(image, 0, 0)
        return context.getImageData(0, 0, 512, 512).data
      }
      const [a, b] = await Promise.all([pixels(reference), pixels(generated)])
      let checked = 0
      let different = 0
      let interiorDifferent = 0
      for (let y = 0; y < 512; y++) for (let x = 0; x < 512; x++) {
        const offset = (y * 512 + x) * 4
        const delta = Math.max(...[0, 1, 2, 3].map(c => Math.abs(a[offset + c] - b[offset + c])))
        if (delta > 8) different++
        const radius = Math.hypot(x + 0.5 - 256, y + 0.5 - 256) / 11
        const localY = (y + 0.5 - 58) / 11
        // CSS y SVG suavizan las curvas de forma distinta; comparar también todo el interior.
        if ([18, 15, 7.796875, 4.796875].some(edge => Math.abs(radius - edge) < 0.2)
          || [16.2, 19.8].some(edge => Math.abs(localY - edge) < 0.2)) continue
        checked++
        if (delta > 8) interiorDifferent++
      }
      return { checked, different, interiorDifferent }
    }, { reference: dataUrl('image/png', reference), generated: dataUrl('image/png', png('icon-512.png')) })
    expect(comparison.checked).toBeGreaterThan(240000)
    expect(comparison.interiorDifferent).toBe(0)
    expect(comparison.different / (512 * 512)).toBeLessThan(0.02)
  })

  test('el favicon mantiene el exterior transparente y el mismo dibujo que la PWA', async ({ page }) => {
    expect(favicon).toContain('viewBox="0 0 36 36"')
    const pixels = await page.evaluate(async url => {
      const image = new Image()
      image.src = url
      await image.decode()
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = 36
      const context = canvas.getContext('2d')!
      context.drawImage(image, 0, 0, 36, 36)
      return [[0, 0], [18, 1], [18, 6], [18, 18], [18, 30]].map(([x, y]) => Array.from(context.getImageData(x, y, 1, 1).data))
    }, dataUrl('image/svg+xml', favicon))
    expect(pixels).toEqual([[0, 0, 0, 0], [23, 50, 77, 255], [237, 72, 84, 255], [255, 255, 255, 255], [255, 255, 255, 255]])
  })

  test('mantiene las referencias, tamaños y MIME existentes del manifiesto y de Apple', () => {
    const manifest = JSON.parse(read('public/manifest.webmanifest'))
    expect(manifest.icons).toEqual([
      { src: '/pwa/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
      { src: '/pwa/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
    ])
    expect(read('index.html')).toMatch(/<link\b[^>]*rel="apple-touch-icon"[^>]*href="\/pwa\/apple-touch-icon.png"/)
    expect(read('index.html')).toMatch(/<link\b[^>]*type="image\/svg\+xml"[^>]*href="\/pokefolio.svg"/)
  })
})
