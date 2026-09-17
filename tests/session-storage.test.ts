import { describe, expect, it, vi } from 'vitest'
import { discardDeletedSession } from '../src/lib/session-storage'

describe('Descartar únicamente la sesión de una cuenta eliminada', () => {
  const key = 'sb-test-auth-token'
  it('elimina solo su token y conserva otras preferencias y proyectos', () => {
    const values = new Map([[key, JSON.stringify({ user: { id: 'deleted-user' } })], ['preference', 'keep'], ['sb-other-auth-token', 'keep']])
    const storage = { getItem: (name: string) => values.get(name) ?? null, removeItem: (name: string) => { values.delete(name) } }
    expect(discardDeletedSession(storage, key, 'deleted-user')).toBe('cleared')
    expect([...values.keys()]).toEqual(['preference', 'sb-other-auth-token'])
  })
  it('no borra una identidad distinta', () => {
    const storage = { getItem: () => JSON.stringify({ user: { id: 'another-user' } }), removeItem: vi.fn() }
    expect(discardDeletedSession(storage, key, 'deleted-user')).toBe('different-user')
    expect(storage.removeItem).not.toHaveBeenCalled()
  })
  it('admite que el SDK ya haya retirado la sesión', () => {
    const storage = { getItem: () => null, removeItem: vi.fn() }
    expect(discardDeletedSession(storage, key, 'deleted-user')).toBe('cleared')
    expect(storage.removeItem).not.toHaveBeenCalled()
  })
  it.each(['invalid-json', 'null', '{}', '{"user":{}}'])('no elimina datos sin poder verificar su identidad: %s', (value) => {
    const storage = { getItem: () => value, removeItem: vi.fn() }
    expect(discardDeletedSession(storage, key, 'deleted-user')).toBe('unavailable')
    expect(storage.removeItem).not.toHaveBeenCalled()
  })
  it('tolera restricciones del almacenamiento sin exponer el contenido', () => {
    const storage = { getItem: () => { throw new Error('storage blocked') }, removeItem: vi.fn() }
    expect(discardDeletedSession(storage, key, 'deleted-user')).toBe('unavailable')
  })
})
