import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

export function Modal({ title, onClose, children, busy = false, wide = false }: { title: string; onClose: () => void; children: ReactNode; busy?: boolean; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current!
    dialog.showModal()
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { dialog.close(); document.body.style.overflow = previous }
  }, [])
  return <dialog ref={ref} className={wide ? 'modal wide' : 'modal'} aria-labelledby="modal-title" onCancel={(event) => { event.preventDefault(); if (!busy) onClose() }}>
    <div className="modal-heading"><h2 id="modal-title">{title}</h2><button className="icon-button" aria-label="Cerrar" disabled={busy} onClick={onClose}><X size={20} /></button></div>
    {children}
  </dialog>
}