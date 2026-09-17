import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe.each([
  { file: 'confirm-signup', action: 'Confirmar mi cuenta', title: 'Confirma tu cuenta de Pokéfolio', notice: 'Si no has solicitado esta cuenta', wrongAction: 'Restablecer contraseña' },
  { file: 'reset-password', action: 'Restablecer contraseña', title: 'Restablece tu contraseña de Pokéfolio', notice: 'Tu contraseña no cambiará por recibir este correo.', wrongAction: 'Confirmar mi cuenta' },
])('plantilla $file', ({ file, action, title, notice, wrongAction }) => {
  const template = readFileSync(new URL(`../supabase/templates/${file}.html`, import.meta.url), 'utf8')

  it('conserva el enlace de Supabase en el botón y la alternativa sin introducir tokens', () => {
    expect(template.match(/{{ \.ConfirmationURL }}/g)).toHaveLength(3)
    const links = [...template.matchAll(/href="([^"]+)"/g)].map((match) => match[1])
    expect(links).toEqual(['{{ .ConfirmationURL }}', '{{ .ConfirmationURL }}'])
    expect(template).not.toMatch(/token=|sb_secret_|WEBHOOK_SECRET|SMTP_PASS/)
  })

  it('usa una imagen PNG pública y mantiene el contenido y botón como texto', () => {
    expect(template).toContain('src="https://pokemon-collection-lac.vercel.app/pokefolio-email.png"')
    expect(template).toContain('alt="Emblema de Pokéfolio"')
    expect(template).toContain(`${action}</a>`)
    expect(template).not.toMatch(/<script\b|<form\b|<iframe\b|<svg\b|data:image|@import|onclick=/i)
    expect(template.match(/<img\b/g)).toHaveLength(1)
    const logo = readFileSync(new URL('../public/pokefolio-email.png', import.meta.url))
    expect(logo.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
    expect(logo.readUInt32BE(16)).toBe(168)
    expect(logo.readUInt32BE(20)).toBe(168)
    expect(logo.length).toBeLessThan(30000)
  })

  it('distingue la acción y explica qué hacer si no se ha solicitado', () => {
    expect(template).toContain(`<title>${title}</title>`)
    expect(template).toContain(notice)
    expect(template).not.toContain(wrongAction)
    expect(template).not.toMatch(/\d+\s+(minutos|horas|días)/i)
  })
})