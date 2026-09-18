import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { User } from '@supabase/supabase-js'
import { deleteOwnAccount, updateOwnPassword } from '../lib/account'
import { Modal } from './Modal'

export type AccountPreferences = {
  language: 'es' | 'en' | 'ja'
  catalogLayout: 'grid' | 'list'
  pageSize: 12 | 24 | 48
  darkMode: boolean
}

export type AccountModalProps = {
  user: User
  canExport: boolean
  onClose: () => void
  /** Limpiar usuario, colección, listas de deseos, cachés y cerrar el diálogo tras el borrado confirmado. */
  onDeleted: () => void
  /** Exportar solo la colección actual como JSON, sin listas de deseos ni todos los datos personales. */
  onExport: () => void
  preferences: AccountPreferences
  preferenceError?: string
  preferencePending?: boolean
  onPreferencesChange: (preferences: Partial<AccountPreferences>) => void
}

/** El cambio de identidad remonta el formulario y descarta las contraseñas anteriores. */
export function AccountModal(props: AccountModalProps) {
  return <AccountForm key={`${props.user.id}:${props.user.email ?? ''}`} {...props} />
}

function AccountForm({ user, canExport, onClose, onDeleted, onExport, preferences, preferenceError, preferencePending, onPreferencesChange }: AccountModalProps) {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [deletePassword, setDeletePassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew, setShowNew] = useState(false)
  const [showDelete, setShowDelete] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const inFlight = useRef(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])

  async function submit(event: FormEvent, operation: 'password' | 'delete') {
    event.preventDefault()
    if (inFlight.current) return
    inFlight.current = true
    setBusy(true); setError(''); setMessage('')
    let deleted = false
    try {
      if (operation === 'password') {
        await updateOwnPassword(user.id, user.email ?? '', currentPassword, newPassword)
        if (mounted.current) setMessage('Contraseña actualizada.')
      } else {
        const result = await deleteOwnAccount(user.id, user.email ?? '', deletePassword, confirmation)
        deleted = true
        if (mounted.current) setMessage(result.localSignOutFailed
          ? 'Cuenta eliminada. No se pudo cerrar la sesión local: borra los datos de este sitio en el navegador.'
          : 'Cuenta eliminada.')
      }
    } catch (cause) {
      // Los helpers solo exponen mensajes españoles seguros, nunca errores crudos de Supabase.
      if (mounted.current) setError(cause instanceof Error ? cause.message : 'No se ha podido completar la operación.')
    } finally {
      inFlight.current = false
      if (mounted.current) {
        setCurrentPassword(''); setNewPassword(''); setDeletePassword(''); setConfirmation('')
        setShowCurrent(false); setShowNew(false); setShowDelete(false); setBusy(false)
      }
    }
    // Fuera del catch: un error del callback no debe presentarse como fallo del borrado.
    // signOut puede haber desmontado el diálogo; el estado principal aún debe limpiarse.
    if (deleted) onDeleted()
  }

  return <Modal title="Gestionar cuenta" onClose={onClose} busy={busy}>
    <div className="account-settings stack" aria-busy={busy}>
      <p>Correo de la cuenta: <strong>{user.email ?? 'No disponible'}</strong></p>
      <section className="stack" aria-labelledby="account-preferences-heading">
        <h3 id="account-preferences-heading">Preferencias</h3>
        {preferenceError && <p className="notice error" role="alert">{preferenceError}</p>}
        {preferencePending && <p role="status">Guardando preferencias…</p>}
        <label>Idioma preferido<select value={preferences.language} onChange={(event) => onPreferencesChange({ language: event.target.value as AccountPreferences['language'] })}>
          <option value="es">Español</option><option value="en">Inglés</option><option value="ja">Japonés</option>
        </select></label>
        <label>Vista del catálogo<select value={preferences.catalogLayout} onChange={(event) => onPreferencesChange({ catalogLayout: event.target.value as AccountPreferences['catalogLayout'] })}>
          <option value="grid">Cuadrícula</option><option value="list">Lista</option>
        </select></label>
        <label>Cartas por página<select value={preferences.pageSize} onChange={(event) => onPreferencesChange({ pageSize: Number(event.target.value) as AccountPreferences['pageSize'] })}>
          <option value="12">12 cartas</option><option value="24">24 cartas</option><option value="48">48 cartas</option>
        </select></label>
        <label className="account-preference-check"><input type="checkbox" checked={preferences.darkMode} onChange={(event) => onPreferencesChange({ darkMode: event.target.checked })} /> Activar modo nocturno</label>
        <p className="muted">Estas preferencias se guardan en tu cuenta y se aplican al volver a iniciar sesión.</p>
      </section>
      <section className="stack" aria-labelledby="account-export-heading">
        <h3 id="account-export-heading">Copia de tu colección</h3>
        <p>Descarga tu colección antes de eliminar la cuenta. La copia JSON incluye únicamente la colección, no las listas de deseos ni sus cartas, los mensajes de contacto ni todos los datos de cuenta.</p>
        <button type="button" disabled={busy || !canExport} onClick={onExport}>Exportar copia JSON</button>
        {!canExport && <p>La exportación estará disponible cuando se haya cargado una colección con cartas.</p>}
      </section>
      {error && <p className="notice error" role="alert">{error}</p>}
      {message && <p className="notice success" role="status">{message}</p>}
      {busy && <p role="status">Procesando la solicitud. No cierres esta ventana.</p>}
      <form className="stack" onSubmit={(event) => { void submit(event, 'password') }} aria-labelledby="account-password-heading">
        <h3 id="account-password-heading">Cambiar contraseña</h3>
        <label htmlFor="account-current-password">Contraseña actual</label>
        <input id="account-current-password" type={showCurrent ? 'text' : 'password'} autoComplete="current-password" required disabled={busy} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
        <button type="button" disabled={busy} aria-controls="account-current-password" aria-pressed={showCurrent} onClick={() => setShowCurrent(!showCurrent)}>{showCurrent ? 'Ocultar' : 'Mostrar'} contraseña actual</button>
        <label htmlFor="account-new-password">Nueva contraseña (mínimo 12 caracteres)</label>
        <input id="account-new-password" type={showNew ? 'text' : 'password'} autoComplete="new-password" required minLength={12} maxLength={128} disabled={busy} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
        <button type="button" disabled={busy} aria-controls="account-new-password" aria-pressed={showNew} onClick={() => setShowNew(!showNew)}>{showNew ? 'Ocultar' : 'Mostrar'} nueva contraseña</button>
        <button className="primary" type="submit" disabled={busy || !user.email || !currentPassword || newPassword.length < 12}>Guardar nueva contraseña</button>
      </form>
      <section className="danger stack" aria-labelledby="account-delete-heading">
        <h3 id="account-delete-heading">Eliminar cuenta</h3>
        <p id="account-delete-warning"><strong>Esta acción es irreversible.</strong> Se eliminarán tu cuenta, todas tus colecciones, tus listas de deseos y las cartas de esas listas, y los mensajes de contacto asociados a tu cuenta en la base de datos. Exporta primero tu colección y conserva por separado lo que necesites de tus listas de deseos: no se incluyen en la copia JSON.</p>
        <p>Los mensajes enviados sin sesión, las copias de correo y las copias de seguridad requieren el tratamiento indicado en la información de privacidad. Puedes consultar al responsable en <a href="mailto:pokefolio14@gmail.com">pokefolio14@gmail.com</a>.</p>
        <form className="stack" aria-describedby="account-delete-warning" onSubmit={(event) => { void submit(event, 'delete') }}>
          <label htmlFor="account-delete-password">Contraseña actual para eliminar la cuenta</label>
          <input id="account-delete-password" type={showDelete ? 'text' : 'password'} autoComplete="current-password" required disabled={busy} value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} />
          <button type="button" disabled={busy} aria-controls="account-delete-password" aria-pressed={showDelete} onClick={() => setShowDelete(!showDelete)}>{showDelete ? 'Ocultar' : 'Mostrar'} contraseña de eliminación</button>
          <label htmlFor="account-delete-confirmation">Escribe ELIMINAR para confirmar</label>
          <input id="account-delete-confirmation" autoComplete="off" spellCheck={false} required pattern="ELIMINAR" disabled={busy} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} />
          <button className="danger" type="submit" disabled={busy || !user.email || !deletePassword || confirmation !== 'ELIMINAR'}>Eliminar mi cuenta definitivamente</button>
        </form>
      </section>
    </div>
  </Modal>
}
