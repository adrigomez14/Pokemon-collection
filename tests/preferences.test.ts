import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createPreferenceQueue, readLocalPreference, saveAccountMetadata, writeLocalPreference } from '../src/lib/preferences'

afterEach(() => vi.unstubAllGlobals())

describe('Preferencias locales opcionales', () => {
  it('tolera SSR y almacenamiento bloqueado tanto al leer como escribir', () => {
    expect(readLocalPreference('theme')).toBeNull()
    expect(() => writeLocalPreference('theme', 'dark')).not.toThrow()
    vi.stubGlobal('window', { get localStorage() { throw new Error('blocked') } })
    expect(readLocalPreference('theme')).toBeNull()
    expect(() => writeLocalPreference('theme', 'dark')).not.toThrow()
  })
  it('tolera cuota y conserva lecturas válidas', () => {
    vi.stubGlobal('window', { localStorage: { getItem: () => 'ja', setItem: () => { throw new Error('quota') } } })
    expect(readLocalPreference('language')).toBe('ja')
    expect(() => writeLocalPreference('language', 'es')).not.toThrow()
  })
})

describe('Cola de preferencias por identidad', () => {
  it('serializa cambios rápidos y continúa después de un rechazo', async () => {
    const enqueue = createPreferenceQueue()
    const calls: number[] = []
    let release!: () => void
    const first = enqueue(async () => { calls.push(1); await new Promise<void>((resolve) => { release = resolve }); throw new Error('offline') }, () => true)
    const assertion = expect(first).rejects.toThrow('offline')
    const second = enqueue(async () => { calls.push(2) }, () => true)
    await Promise.resolve()
    expect(calls).toEqual([1])
    release()
    await assertion
    await expect(second).resolves.toBe(true)
    expect(calls).toEqual([1, 2])
  })
  it('descarta pendientes y resultados anteriores incluso al volver a la misma cuenta', async () => {
    const enqueue = createPreferenceQueue()
    let scope = 1
    let release!: () => void
    const first = enqueue(() => new Promise<void>((resolve) => { release = resolve }), () => scope === 1)
    const write = vi.fn(async () => {})
    const second = enqueue(write, () => scope === 1)
    await Promise.resolve()
    scope = 2
    release()
    await expect(first).resolves.toBe(false)
    await expect(second).resolves.toBe(false)
    expect(write).not.toHaveBeenCalled()
    await expect(enqueue(write, () => scope === 2)).resolves.toBe(true)
  })
  it('comprueba identidad al ejecutar sin enviar parches a otro usuario', async () => {
    const updateUser = vi.fn()
    const client = { auth: { getUser: vi.fn(async () => ({ data: { user: { id: 'bob' } }, error: null })), updateUser } } as unknown as SupabaseClient
    await expect(saveAccountMetadata(client, 'alice', { theme: 'dark' }, () => true)).rejects.toThrow('No se pudo guardar')
    expect(updateUser).not.toHaveBeenCalled()
  })
  it('no escribe si cambia el scope durante la comprobación de identidad', async () => {
    let active = true
    const updateUser = vi.fn()
    const client = { auth: { getUser: vi.fn(async () => { active = false; return { data: { user: { id: 'alice' } }, error: null } }), updateUser } } as unknown as SupabaseClient
    await expect(saveAccountMetadata(client, 'alice', { theme: 'dark' }, () => active)).resolves.toBe(false)
    expect(updateUser).not.toHaveBeenCalled()
  })
})
