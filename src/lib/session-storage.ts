export type DeletedSessionCleanup = 'cleared' | 'different-user' | 'unavailable'

/** Solo tras un borrado confirmado: descarta la sesión de ese usuario, nunca otras claves. */
export function discardDeletedSession(storage: Pick<Storage, 'getItem' | 'removeItem'>, storageKey: string, userId: string): DeletedSessionCleanup {
  if (!storageKey || !userId) return 'unavailable'
  try {
    const value = storage.getItem(storageKey)
    if (!value) return 'cleared'
    const session = JSON.parse(value) as { user?: { id?: string } } | null
    if (!session?.user?.id) return 'unavailable'
    if (session.user.id !== userId) return 'different-user'
    storage.removeItem(storageKey)
    return 'cleared'
  } catch {
    // No registrar el contenido del almacenamiento: puede contener credenciales.
    return 'unavailable'
  }
}
