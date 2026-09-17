import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { PrivacyPage } from '../src/components/PrivacyPage'
import { pageFromPath, pagePaths } from '../src/lib/navigation'

describe('Preparación pública', () => {
  it('identifica las secciones públicas sin convertir rutas desconocidas en datos privados', () => {
    expect(pageFromPath('/')).toBe('catalog')
    for (const [view, path] of Object.entries(pagePaths)) expect(pageFromPath(`${path}/`)).toBe(view)
    expect(pageFromPath('/unknown')).toBe('catalog')
  })
  it('publica contacto, derechos, proveedores y límites reales de conservación sin prometer borrado de Gmail', () => {
    const html = renderToStaticMarkup(createElement(PrivacyPage))
    for (const text of ['PokefolioTCG', 'pokefolio14@gmail.com', 'seis meses', 'Supabase', 'Vercel', 'Google Fonts', 'Gmail', 'Cardmarket', 'AEPD', 'copias de seguridad']) expect(html).toContain(text)
    expect(html).toContain('no desaparecen al borrar la base de datos')
    expect(html).not.toContain('service_role')
  })
  it('incluye imagen social PNG 1200×630, descripción y dominio canónico', () => {
    const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8')
    const png = readFileSync(new URL('../public/social-preview.png', import.meta.url))
    expect(png.subarray(1, 4).toString()).toBe('PNG')
    expect(png.readUInt32BE(16)).toBe(1200)
    expect(png.readUInt32BE(20)).toBe(630)
    expect(html).toContain('https://www.pokefoliotcg.es/social-preview.png')
    expect(html).toContain('property="og:description"')
    expect(html).toContain('name="twitter:card" content="summary_large_image"')
    expect(html).toContain('rel="canonical" href="https://www.pokefoliotcg.es/"')
  })
  it('sirve las rutas de la aplicación sin reescribir la API y excluye colecciones de descubrimiento', () => {
    const config = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
    expect(config.rewrites.map((rule: { source: string }) => rule.source)).toEqual(Object.values(pagePaths))
    expect(config.headers.some((rule: { source: string; headers: { key: string; value: string }[] }) => rule.source === '/coleccion' && rule.headers.some((header) => header.key === 'X-Robots-Tag' && header.value.includes('noindex')))).toBe(true)
    const robots = readFileSync(new URL('../public/robots.txt', import.meta.url), 'utf8')
    expect(robots).toContain('Disallow: /coleccion')
    const sitemap = readFileSync(new URL('../public/sitemap.xml', import.meta.url), 'utf8')
    expect(sitemap).not.toContain('/coleccion')
    expect(sitemap).not.toContain('supabase')
  })
})
