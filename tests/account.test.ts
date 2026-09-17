import { beforeEach, describe, expect, it, vi } from 'vitest'
import { deleteOwnAccount, updateOwnPassword } from '../src/lib/account'

const { client, requireClient, rpcResult } = vi.hoisted(() => {
  const client = {
    auth: { getUser: vi.fn(), getSession: vi.fn(), signInWithPassword: vi.fn(), updateUser: vi.fn(), signOut: vi.fn() },
    rpc: vi.fn(),
  }
  return { client, requireClient: vi.fn(() => client), rpcResult: vi.fn() }
})
// Evita cargar la configuración de Supabase o realizar conexiones reales.
vi.mock('../src/lib/supabase', () => ({ requireSupabase: requireClient }))

const id = '11111111-1111-4111-8111-111111111111'
const email = 'test@example.com'
const currentPassword = 'current-password-test'
const newPassword = 'new-password-test-12'
const change = () => updateOwnPassword(id, email, currentPassword, newPassword)
const remove = () => deleteOwnAccount(id, email, currentPassword, 'ELIMINAR')

beforeEach(() => {
  vi.resetAllMocks()
  requireClient.mockReturnValue(client)
  client.auth.getUser.mockResolvedValue({ data: { user: { id } }, error: null })
  client.auth.signInWithPassword.mockResolvedValue({ data: { user: { id }, session: { access_token: 'fresh-test-token' } }, error: null })
  client.auth.getSession.mockResolvedValue({ data: { session: { user: { id } } }, error: null })
  client.auth.updateUser.mockResolvedValue({ error: null })
  client.rpc.mockReturnValue({ setHeader: rpcResult })
  rpcResult.mockResolvedValue({ error: null })
  client.auth.signOut.mockResolvedValue({ error: null })
})

describe('Gestión de la propia cuenta', () => {
  it('reautentica la identidad y cambia la contraseña sin enviarla a ninguna RPC', async () => {
    await expect(change()).resolves.toBeUndefined()
    expect(client.auth.signInWithPassword).toHaveBeenCalledWith({ email, password: currentPassword })
    expect(client.auth.getUser).toHaveBeenCalledTimes(2)
    expect(client.auth.updateUser).toHaveBeenCalledWith({ password: newPassword })
    expect(client.auth.signInWithPassword.mock.invocationCallOrder[0]).toBeLessThan(client.auth.updateUser.mock.invocationCallOrder[0])
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it('valida los 12 caracteres antes de autenticar', async () => {
    await expect(updateOwnPassword(id, email, currentPassword, '12345678901')).rejects.toThrow('12 caracteres')
    expect(requireClient).not.toHaveBeenCalled()
    await expect(updateOwnPassword(id, email, currentPassword, '123456789012')).resolves.toBeUndefined()
  })

  it.each(['change', 'delete'])('rechaza contraseña actual incorrecta en %s', async (operation) => {
    client.auth.signInWithPassword.mockResolvedValue({ data: { user: null }, error: { message: 'sensitive detail' } })
    await expect(operation === 'change' ? change() : remove()).rejects.toThrow('verificar tu contraseña actual')
    expect(client.rpc).not.toHaveBeenCalled()
    expect(client.auth.updateUser).not.toHaveBeenCalled()
  })

  it.each(['', 'eliminar', ' ELIMINAR', 'ELIMINAR '])('rechaza confirmación no literal: %j', async (confirmation) => {
    await expect(deleteOwnAccount(id, email, currentPassword, confirmation)).rejects.toThrow('exactamente ELIMINAR')
    expect(requireClient).not.toHaveBeenCalled()
  })

  it('requiere contraseña actual y correo antes de conectar', async () => {
    await expect(deleteOwnAccount(id, email, '', 'ELIMINAR')).rejects.toThrow('contraseña actual')
    await expect(updateOwnPassword(id, '', currentPassword, newPassword)).rejects.toThrow('correo')
    expect(requireClient).not.toHaveBeenCalled()
  })

  it('borra solo mediante RPC sin ID objetivo y después cierra la sesión local', async () => {
    await expect(remove()).resolves.toEqual({ localSignOutFailed: false })
    expect(client.rpc).toHaveBeenCalledExactlyOnceWith('delete_own_account', { confirmation: 'ELIMINAR' })
    expect(rpcResult).toHaveBeenCalledWith('Authorization', 'Bearer fresh-test-token')
    expect(client.auth.signInWithPassword.mock.invocationCallOrder[0]).toBeLessThan(client.rpc.mock.invocationCallOrder[0])
    expect(client.auth.signOut).toHaveBeenCalledExactlyOnceWith({ scope: 'local' })
    expect(client.rpc.mock.invocationCallOrder[0]).toBeLessThan(client.auth.signOut.mock.invocationCallOrder[0])
  })

  it.each(['PGRST202', '42883'])('orienta sobre migración 005 si falta la RPC (%s)', async (code) => {
    rpcResult.mockResolvedValue({ error: { code, message: 'private backend detail' } })
    await expect(remove()).rejects.toThrow('migración 005')
    expect(client.auth.signOut).not.toHaveBeenCalled()
  })

  it.each(['change', 'delete'])('no modifica otra identidad devuelta al reautenticar (%s)', async (operation) => {
    client.auth.signInWithPassword.mockResolvedValue({ data: { user: { id: 'other-user' } }, error: null })
    await expect(operation === 'change' ? change() : remove()).rejects.toThrow('no coincide')
    expect(client.rpc).not.toHaveBeenCalled()
    expect(client.auth.updateUser).not.toHaveBeenCalled()
  })

  it('rechaza una cuenta distinta antes de reautenticar', async () => {
    client.auth.getUser.mockResolvedValue({ data: { user: { id: 'other-user' } }, error: null })
    await expect(remove()).rejects.toThrow('cuenta activa ha cambiado')
    expect(client.auth.signInWithPassword).not.toHaveBeenCalled()
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it.each(['change', 'delete'])('detecta cambio de sesión tras reautenticación (%s)', async (operation) => {
    client.auth.getUser.mockResolvedValueOnce({ data: { user: { id } }, error: null })
      .mockResolvedValueOnce({ data: { user: { id: 'other-user' } }, error: null })
    await expect(operation === 'change' ? change() : remove()).rejects.toThrow('cuenta activa ha cambiado')
    expect(client.rpc).not.toHaveBeenCalled()
    expect(client.auth.updateUser).not.toHaveBeenCalled()
  })

  it('no considera correcta una autenticación sin usuario', async () => {
    client.auth.signInWithPassword.mockResolvedValue({ data: { user: null }, error: null })
    await expect(remove()).rejects.toThrow('verificar')
    expect(client.rpc).not.toHaveBeenCalled()
  })

  it.each(['returned', 'thrown'])('el borrado sigue confirmado si falla signOut: %s', async (failure) => {
    if (failure === 'returned') client.auth.signOut.mockResolvedValue({ error: { message: 'private detail' } })
    else client.auth.signOut.mockRejectedValue(new Error('private detail'))
    await expect(remove()).resolves.toEqual({ localSignOutFailed: true })
    expect(client.rpc).toHaveBeenCalledTimes(1)
  })

  it('no cierra sesión ni expone detalles si falla la RPC', async () => {
    rpcResult.mockResolvedValue({ error: { code: '42501', message: 'JWT password secret' } })
    await expect(remove()).rejects.toThrow('No se ha podido confirmar la eliminación.')
    expect(client.auth.signOut).not.toHaveBeenCalled()
  })

  it('sanitiza errores lanzados por red y cambio de contraseña', async () => {
    client.auth.signInWithPassword.mockRejectedValueOnce(new Error('JWT private credential'))
    await expect(change()).rejects.toThrow('No se ha podido cambiar la contraseña.')
    client.auth.updateUser.mockResolvedValueOnce({ error: { message: 'JWT private credential' } })
    await expect(change()).rejects.toThrow('No se ha podido cambiar la contraseña.')
    rpcResult.mockRejectedValueOnce(new Error('JWT private credential'))
    await expect(remove()).rejects.toThrow('No se ha podido confirmar la eliminación.')
  })
  it('no borra si la reautenticación no proporciona una sesión que pueda fijarse', async () => {
    client.auth.signInWithPassword.mockResolvedValue({ data: { user: { id }, session: null }, error: null })
    await expect(remove()).rejects.toThrow('sesión recién verificada')
    expect(client.rpc).not.toHaveBeenCalled()
  })
  it('no cierra una sesión distinta que haya aparecido mientras se borraba la cuenta anterior', async () => {
    client.auth.getSession.mockResolvedValue({ data: { session: { user: { id: 'other-user' } } }, error: null })
    await expect(remove()).resolves.toEqual({ localSignOutFailed: false })
    expect(client.auth.signOut).not.toHaveBeenCalled()
    expect(rpcResult).toHaveBeenCalledWith('Authorization', 'Bearer fresh-test-token')
  })
})
