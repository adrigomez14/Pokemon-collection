import { z } from 'zod'
import { requireSupabase } from './supabase'

export const feedbackTopics = { sugerencia: 'Sugerencia de mejora', error: 'He encontrado un error', otro: 'Otro' } as const
export type FeedbackTopic = keyof typeof feedbackTopics

export const feedbackInputSchema = z.object({
  topic: z.enum(['sugerencia', 'error', 'otro']),
  email: z.string().trim().max(200).email('Escribe un correo válido o deja el campo vacío.').optional().or(z.literal('')),
  message: z.string().trim().min(1, 'Escribe un mensaje antes de enviarlo.').max(4000, 'El mensaje es demasiado largo (máximo 4000 caracteres).'),
})
export type FeedbackInput = z.infer<typeof feedbackInputSchema>

function feedbackError(error: { code?: string; message: string }) {
  if (error.code === 'P0001' && error.message.includes('feedback_rate_limit')) return new Error('El buzón ha alcanzado temporalmente su límite de mensajes. Inténtalo más tarde.')
  if (error.code === 'PGRST205' || error.code === 'PGRST204' || error.code === '42P01') return new Error('Falta preparar la base de datos. Ejecuta la migración 003_feedback.sql en Supabase.')
  if (error.code === '23514' || error.code === '22023') return new Error('El mensaje no es válido. Revisa su contenido y su longitud (máximo 4000 caracteres).')
  return new Error('No se ha podido enviar tu mensaje. Comprueba tu conexión e inténtalo de nuevo.')
}

export async function sendFeedback(input: FeedbackInput) {
  const parsed = feedbackInputSchema.parse(input)
  const client = requireSupabase()
  const { error } = await client.from('feedback').insert({
    topic: parsed.topic, email: parsed.email ? parsed.email : null, message: parsed.message,
  })
  if (error) throw feedbackError(error)
}
