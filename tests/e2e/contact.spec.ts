import { test, expect } from '@playwright/test'

test('contacto guarda sin sesión y muestra el límite sin prometer entrega de correo', async ({ page }) => {
  await page.route('https://api.tcgdex.net/**', (route) => route.fulfill({ json: [] }))
  let limited = false
  let submitted: unknown
  await page.route('https://pokefolio-test.supabase.co/rest/v1/feedback', (route) => {
    submitted = route.request().postDataJSON()
    return limited
      ? route.fulfill({ status: 400, json: { code: 'P0001', message: 'feedback_rate_limit' } })
      : route.fulfill({ status: 201, body: '' })
  })
  await page.goto('/')
  await page.getByRole('button', { name: 'Contacto', exact: true }).click()
  await page.getByLabel('Tu correo (opcional)').fill('visitor@example.com')
  await page.getByRole('textbox', { name: 'Mensaje', exact: true }).fill('Una sugerencia de prueba')
  await page.getByRole('button', { name: 'Enviar mensaje', exact: true }).click()
  await expect(page.getByRole('status')).toContainText('Hemos recibido tu mensaje')
  expect(submitted).toEqual({ topic: 'sugerencia', email: 'visitor@example.com', message: 'Una sugerencia de prueba' })
  limited = true
  await page.getByRole('textbox', { name: 'Mensaje', exact: true }).fill('Otro mensaje')
  await page.getByRole('button', { name: 'Enviar mensaje', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('límite de mensajes')
  await expect(page.getByRole('textbox', { name: 'Mensaje', exact: true })).toHaveValue('Otro mensaje')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})