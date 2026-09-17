import { createClient } from '@supabase/supabase-js'
import { discardDeletedSession, type DeletedSessionCleanup } from './session-storage'

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
const configured = Boolean(url && /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url) && key && !key.includes('REEMPLAZAR'))
// La misma clave predeterminada del SDK conserva las sesiones de instalaciones anteriores.
const storageKey = configured ? `sb-${new URL(url!).hostname.split('.')[0]}-auth-token` : undefined

// Solo clave pública publishable/anon. Nunca usar service_role en un cliente web.
export const supabase = configured ? createClient(url!, key!, {
  auth: { storageKey, persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
}) : null

export function requireSupabase() {
  if (!supabase) throw new Error('Configura Supabase para activar tu cuenta y el guardado en la nube.')
  return supabase
}

/** Quita el token de una cuenta ya eliminada antes de notificar SIGNED_OUT mediante el SDK. */
export function clearDeletedAccountSession(userId: string): DeletedSessionCleanup {
  try {
    if (!storageKey || typeof window === 'undefined') return 'unavailable'
    return discardDeletedSession(window.localStorage, storageKey, userId)
  } catch { return 'unavailable' }
}
