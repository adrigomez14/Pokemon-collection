import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL?.trim()
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
const configured = Boolean(url && /^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/i.test(url) && key && !key.includes('REEMPLAZAR'))

// Solo clave pública publishable/anon. Nunca usar service_role en un cliente web.
export const supabase = configured ? createClient(url!, key!, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
}) : null

export function requireSupabase() {
  if (!supabase) throw new Error('Configura Supabase para activar tu cuenta y el guardado en la nube.')
  return supabase
}