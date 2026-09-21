/* Pantalla pública independiente: no consultar sesiones, almacenamiento ni la URL de navegación. */
(() => {
  const retry = document.getElementById('retry')
  const status = document.getElementById('connection-status')
  if (!retry || !status) return
  let checking = false

  async function reconnect() {
    if (checking) return
    checking = true
    retry.disabled = true
    retry.setAttribute('aria-busy', 'true')
    status.textContent = 'Comprobando la conexión…'
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8_000)
    let removeAbortListener = () => {}
    try {
      // El límite también cubre la lectura del JSON y evita navegar por respuestas tardías.
      const aborted = new Promise((_, reject) => {
        const onAbort = () => reject(new Error('Comprobación cancelada'))
        controller.signal.addEventListener('abort', onAbort, { once: true })
        removeAbortListener = () => controller.signal.removeEventListener('abort', onAbort)
      })
      const probe = async () => {
        const response = await fetch('/manifest.webmanifest', {
          cache: 'no-store', credentials: 'omit', redirect: 'error', mode: 'same-origin', signal: controller.signal,
        })
        if (!response.ok || response.redirected) return false
        const manifest = await response.json()
        return typeof manifest === 'object' && manifest !== null
          && (manifest.name === 'Pokéfolio' || manifest.short_name === 'Pokéfolio')
      }
      if (!await Promise.race([probe(), aborted])) throw new Error('Respuesta inesperada')
      window.location.replace('/catalogo')
    } catch {
      status.textContent = 'No se pudo comprobar la conexión. Revisa tu wifi o tus datos móviles y pulsa Reintentar.'
    } finally {
      clearTimeout(timeout)
      removeAbortListener()
      checking = false
      retry.disabled = false
      retry.removeAttribute('aria-busy')
    }
  }

  retry.addEventListener('click', () => { void reconnect() })
  // «online» solo es una señal para probar la red, nunca una confirmación de conectividad.
  window.addEventListener('online', () => { void reconnect() })
})()
