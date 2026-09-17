import { useState, type FormEvent } from 'react'
import { Mail, MessageCircleHeart, Send, ShieldCheck } from 'lucide-react'
import { feedbackTopics, sendFeedback, type FeedbackTopic } from '../lib/feedback'
import { supabase } from '../lib/supabase'

export function ContactPage({ defaultEmail = '' }: { defaultEmail?: string }) {
  const [topic, setTopic] = useState<FeedbackTopic>('sugerencia')
  const [email, setEmail] = useState(defaultEmail)
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [sent, setSent] = useState(false)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true); setError(''); setSent(false)
    try {
      await sendFeedback({ topic, email, message })
      setMessage(''); setSent(true)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se ha podido enviar tu mensaje.')
    } finally { setBusy(false) }
  }

  return <section className="catalog-section contact-section">
    <div className="section-heading"><div><p className="eyebrow">HABLEMOS</p><h2>Contacto y feedback</h2></div></div>
    <div className="search-panel contact-panel">
      <p className="muted contact-intro"><MessageCircleHeart size={17} />¿Falta algo, algo no funciona o se te ocurre una mejora? Cuéntamelo, leo todos los mensajes.</p>
      {!supabase ? <div className="setup-content"><p>El formulario necesita Supabase configurado para guardar los mensajes. Configúralo desde «Mi cuenta» y ejecuta la migración <strong>003_feedback.sql</strong>.</p></div> : <>
        <form onSubmit={submit} className="stack">
          <div className="form-row">
            <label>Motivo<select value={topic} onChange={(e) => setTopic(e.target.value as FeedbackTopic)}>{Object.entries(feedbackTopics).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label>Tu correo (opcional)<input type="email" placeholder="Para poder responderte" maxLength={200} value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          </div>
          <label>Mensaje<textarea required rows={6} maxLength={4000} placeholder="Escribe aquí tu sugerencia, el error que has visto, o lo que quieras contarme…" value={message} onChange={(e) => setMessage(e.target.value)} /></label>
          {error && <p className="notice error" role="alert">{error}</p>}
          {sent && <p className="notice success" role="status">¡Gracias! Hemos recibido tu mensaje.</p>}
          <button className="primary" disabled={busy}><Send size={16} />{busy ? 'Enviando…' : 'Enviar mensaje'}</button>
        </form>
        <p className="muted contact-note"><ShieldCheck size={14} />Tu mensaje se guarda de forma privada; solo yo puedo leerlo. <Mail size={14} />Si quieres respuesta, deja tu correo.</p>
      </>}
    </div>
  </section>
}
