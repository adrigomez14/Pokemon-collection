import { useState } from 'react'
import { ImageOff } from 'lucide-react'
import { imageUrl, type CardBrief } from '../lib/models'

export function CardImage({ card, large = false }: { card: CardBrief; large?: boolean }) {
  const [failedUrl, setFailedUrl] = useState<string>()
  const src = imageUrl(card.image, large ? 'high' : 'low')
  return <div className="card-image">
    {src && failedUrl !== src ? <img src={src} alt={`${card.name}, carta ${card.localId}`} loading={large ? 'eager' : 'lazy'} decoding="async" referrerPolicy="no-referrer" onError={() => setFailedUrl(src)} /> : <div className="image-missing"><ImageOff size={32} /><span>{card.name}</span><small>Imagen no disponible<br />en este idioma</small></div>}
  </div>
}