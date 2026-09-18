import type { SupabaseClient } from '@supabase/supabase-js'

/** El almacenamiento local es opcional (modo privado, permisos o cuota). */
export function readLocalPreference(key: string): string | null {
  try { return window.localStorage.getItem(key) } catch { return null }
}

export function writeLocalPreference(key: string, value: string): void {
  try { window.localStorage.setItem(key, value) } catch { /* La preferencia sigue activa en memoria. */ }
}

/** Serializa parches sin bloquear la UI; descarta los pendientes de identidades anteriores. */
export function createPreferenceQueue() {
  let tail: Promise<unknown> = Promise.resolve()
  return (write: () => Promise<void>, isCurrent: () => boolean): Promise<boolean> => {
    const result = tail.then(async () => {
      if (!isCurrent()) return false
      await write()
      return isCurrent()
    })
    tail = result.catch(() => {})
    return result
  }
}

const enqueue = createPreferenceQueue()

/** Comparte la cola entre tema, preferencias de catálogo y correo. No aplica respuestas a la UI. */
export function saveAccountMetadata(client: SupabaseClient, owner: string, data: Record<string, string | number | boolean>, isCurrent: () => boolean): Promise<boolean> {
  return enqueue(async () => {
    const current = await client.auth.getUser()
    if (!isCurrent()) return
    if (current.error || current.data.user?.id !== owner) throw new Error('No se pudo guardar la preferencia en tu cuenta.')
    const result = await client.auth.updateUser({ data })
    if (result.error || result.data.user?.id !== owner) throw new Error('No se pudo guardar la preferencia en tu cuenta.')
  }, isCurrent)
}
