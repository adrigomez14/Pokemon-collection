import { useState, type FormEvent } from 'react'
import { KeyRound, ShieldCheck } from 'lucide-react'
import { requireSupabase, supabase } from '../lib/supabase'
import { Modal } from './Modal'

export function AuthModal({ onClose, recovery = false }: { onClose: () => void; recovery?: boolean }) {
  const [mode, setMode] = useState<'login' | 'register' | 'reset' | 'password'>(recovery ? 'password' : 'login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const titles = { login: 'Tu colección te espera', register: 'Empieza tu colección', reset: 'Recuperar contraseña', password: 'Nueva contraseña' }
  async function submit(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setMessage('')
    try {
      const auth = requireSupabase().auth
      const redirect = window.location.origin + window.location.pathname
      if (mode === 'login') {
        const { error } = await auth.signInWithPassword({ email: email.trim(), password })
        if (error) throw error
        onClose()
      } else if (mode === 'register') {
        const { data, error } = await auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: redirect } })
        if (error) throw error
        if (data.session) onClose()
        else setMessage('Revisa tu correo y confirma la cuenta antes de iniciar sesión. Si ya tienes cuenta, inicia sesión o recupera tu contraseña.')
      } else if (mode === 'reset') {
        const { error } = await auth.resetPasswordForEmail(email.trim(), { redirectTo: redirect })
        if (error) throw error
        setMessage('Si existe una cuenta para ese correo, recibirás un enlace de recuperación.')
      } else {
        const { error } = await auth.updateUser({ password })
        if (error) throw error
        onClose()
      }
    } catch (cause) {
      const code = (cause as { code?: string }).code
      setError(code === 'invalid_credentials' ? 'Correo o contraseña incorrectos.' : code === 'email_not_confirmed' ? 'Confirma tu correo antes de iniciar sesión.' : 'No se ha podido completar la operación. Comprueba la conexión, la configuración y los datos. Si has hecho varios intentos, espera unos minutos.')
    } finally { setBusy(false) }
  }
  return <Modal title={supabase ? titles[mode] : 'Activa tu colección en la nube'} onClose={onClose} busy={busy}>
    {!supabase ? <div className="setup-content"><div className="feature-icon"><ShieldCheck /></div><p>El catálogo ya funciona. Para guardar tu colección y abrirla desde cualquier dispositivo, conecta tu propio proyecto de Supabase.</p><ol><li>Crea un proyecto gratuito en Supabase.</li><li>Ejecuta la migración de la carpeta <strong>supabase</strong> en su editor SQL.</li><li>Añade la URL y la clave pública en la configuración local y reinicia la aplicación.</li></ol><p className="muted">La guía README incluida explica cada paso. Nunca introduzcas una clave secreta o service_role.</p><a className="button primary" href="https://supabase.com/dashboard" target="_blank" rel="noopener noreferrer">Abrir Supabase ↗</a></div> : <>
      <p className="muted auth-intro"><ShieldCheck size={17} /> Tu colección es privada y se guarda en tu cuenta.</p>
      <form onSubmit={submit} className="stack">
        {mode !== 'password' && <label>Correo electrónico<input type="email" autoComplete="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} /></label>}
        {mode !== 'reset' && <label>Contraseña<input type="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} minLength={mode === 'login' ? 1 : 12} maxLength={128} required value={password} onChange={(e) => setPassword(e.target.value)} />{mode !== 'login' && <small>Al menos 12 caracteres.</small>}</label>}
        {error && <p className="notice error" role="alert">{error}</p>}{message && <p className="notice success" role="status">{message}</p>}
        <button className="primary" disabled={busy}><KeyRound size={17} />{busy ? 'Conectando…' : mode === 'login' ? 'Iniciar sesión' : mode === 'register' ? 'Crear cuenta' : mode === 'reset' ? 'Enviar enlace' : 'Guardar contraseña'}</button>
      </form>
      {mode !== 'password' && <div className="auth-options"><button className="text-button" disabled={busy} onClick={() => { setMode(mode === 'register' ? 'login' : 'register'); setError(''); setMessage('') }}>{mode === 'register' ? 'Ya tengo cuenta' : 'Crear una cuenta'}</button><button className="text-button" disabled={busy} onClick={() => { setMode(mode === 'reset' ? 'login' : 'reset'); setError(''); setMessage('') }}>{mode === 'reset' ? 'Volver a iniciar sesión' : 'Olvidé mi contraseña'}</button></div>}
    </>}
  </Modal>
}