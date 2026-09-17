import { clearDeletedAccountSession, requireSupabase } from './supabase'

/** Resultado de un borrado confirmado por la base de datos, aunque falle el cierre local. */
export type DeleteOwnAccountResult = { localSignOutFailed: boolean }

class SafeAccountError extends Error {}

function safeError(cause: unknown, fallback: string): Error {
  return cause instanceof SafeAccountError ? cause : new Error(fallback)
}

async function reauthenticate(currentUserId: string, currentEmail: string, password: string) {
  if (!currentUserId || !currentEmail.trim() || !password) {
    throw new SafeAccountError('Introduce el correo de tu cuenta y tu contraseña actual.')
  }
  const client = requireSupabase()
  const previous = await client.auth.getUser()
  if (previous.error || previous.data.user?.id !== currentUserId) {
    throw new SafeAccountError('La cuenta activa ha cambiado. Cierra este diálogo y vuelve a iniciar sesión.')
  }
  const { data, error } = await client.auth.signInWithPassword({ email: currentEmail.trim(), password })
  if (error || !data.user) {
    throw new SafeAccountError('No se ha podido verificar tu contraseña actual. Comprueba los datos e inténtalo de nuevo.')
  }
  if (data.user.id !== currentUserId) {
    throw new SafeAccountError('La cuenta verificada no coincide con la cuenta abierta. Vuelve a iniciar sesión.')
  }
  // Una reautenticación puede emitir eventos de sesión; verificar de nuevo antes de mutar.
  const current = await client.auth.getUser()
  if (current.error || current.data.user?.id !== currentUserId) {
    throw new SafeAccountError('La cuenta activa ha cambiado. Cierra este diálogo y vuelve a iniciar sesión.')
  }
  return { client, accessToken: data.session?.access_token }
}

/** Reautentica y cambia la contraseña únicamente si coincide la identidad esperada. */
export async function updateOwnPassword(
  currentUserId: string,
  currentEmail: string,
  currentPassword: string,
  newPassword: string,
): Promise<void> {
  try {
    if (newPassword.length < 12) throw new SafeAccountError('La nueva contraseña debe tener al menos 12 caracteres.')
    const { client } = await reauthenticate(currentUserId, currentEmail, currentPassword)
    const { error } = await client.auth.updateUser({ password: newPassword })
    if (error) throw error
  } catch (cause) {
    throw safeError(cause, 'No se ha podido cambiar la contraseña. Comprueba la conexión y vuelve a intentarlo.')
  }
}

/**
 * El ID solo se comprueba en cliente: la RPC no recibe un destinatario y usa auth.uid().
 * Solo resuelve tras confirmar el borrado. El llamador debe limpiar su estado con onDeleted.
 * Nunca registra ni guarda contraseñas; Supabase administra su sesión de autenticación.
 */
export async function deleteOwnAccount(
  currentUserId: string,
  currentEmail: string,
  password: string,
  confirmation: string,
): Promise<DeleteOwnAccountResult> {
  let client: ReturnType<typeof requireSupabase>
  try {
    if (confirmation !== 'ELIMINAR') throw new SafeAccountError('Escribe exactamente ELIMINAR para confirmar.')
    const verified = await reauthenticate(currentUserId, currentEmail, password)
    client = verified.client
    if (!verified.accessToken) throw new SafeAccountError('No se ha podido confirmar la sesión recién verificada. Vuelve a iniciar sesión.')
    // Fijar el JWT de la reautenticación evita borrar otra sesión si cambia en otra pestaña.
    const { error } = await client.rpc('delete_own_account', { confirmation })
      .setHeader('Authorization', `Bearer ${verified.accessToken}`)
    if (error) {
      if (error.code === 'PGRST202' || error.code === '42883') {
        throw new SafeAccountError('El borrado aún no está disponible. El responsable debe aplicar la migración 005 siguiendo la guía CUENTA-PRIVACIDAD.')
      }
      throw error
    }
  } catch (cause) {
    throw safeError(cause, 'No se ha podido confirmar la eliminación. Comprueba la conexión antes de volver a intentarlo.')
  }
  // La eliminación ya está confirmada: un fallo de signOut no debe convertirla en un error.
  try {
    // scope: local también llama a /logout si queda un token. La cuenta ya no existe:
    // retirar primero su sesión evita esperar a esa petición y sobrevivir a una recarga.
    if (clearDeletedAccountSession(currentUserId) === 'different-user') return { localSignOutFailed: false }
    const current = await client.auth.getSession()
    if (current.error) return { localSignOutFailed: true }
    if (current.data.session?.user.id && current.data.session.user.id !== currentUserId) {
      return { localSignOutFailed: false }
    }
    const { error } = await client.auth.signOut({ scope: 'local' })
    return { localSignOutFailed: Boolean(error) }
  } catch {
    return { localSignOutFailed: true }
  }
}
