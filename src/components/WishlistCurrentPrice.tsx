import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getCard } from '../lib/catalog'
import { availableVariants, euros, formatDate, marketQuote, variants, type Language } from '../lib/models'

/** Referencia pública compartida con la ficha; nunca modifica el objetivo guardado. */
export function WishlistCurrentPrice({ cardId, language }: { cardId: string; language: Language }) {
  const element = useRef<HTMLSpanElement>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (!element.current || typeof IntersectionObserver === 'undefined') return
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) { setVisible(true); observer.disconnect() }
    }, { rootMargin: '120px' })
    observer.observe(element.current)
    return () => observer.disconnect()
  }, [])
  const detail = useQuery({
    // Misma clave y caducidad que CardModal: compartir datos al abrir una carta.
    queryKey: ['card', language, cardId],
    queryFn: ({ signal }) => getCard(language, cardId, signal),
    enabled: visible || typeof IntersectionObserver === 'undefined',
    staleTime: 5 * 60 * 1000,
  })
  const variant = detail.data ? availableVariants(detail.data)[0] : undefined
  const quote = detail.data && variant ? marketQuote(detail.data, variant) : undefined
  const text = quote ? euros(quote.value) : detail.isError ? 'No disponible' : '…'
  const title = quote
    ? `${detail.isError ? 'Última referencia disponible; no se pudo actualizar. ' : ''}Referencia Cardmarket · ${variants[variant!]} · ${formatDate(quote.updated)}. Mismo precio inicial de la ficha; no es una oferta en tiempo real ni está filtrado por idioma o conservación.`
    : detail.isError ? 'No se pudo cargar el precio. Abre la carta para reintentar.' : 'Cargando precio de referencia…'
  return <span ref={element} className="wishlist-current-price" title={title} data-state={detail.isError ? 'error' : quote ? 'ready' : 'loading'}>
    <small>Actual</small><strong>{text}</strong>
  </span>
}
