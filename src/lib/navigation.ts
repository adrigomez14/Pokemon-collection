import { useEffect, useState } from 'react'

export const pagePaths = { catalog: '/catalogo', collection: '/coleccion', wishlists: '/deseos', contact: '/contacto', privacy: '/privacidad' } as const
export type PageView = keyof typeof pagePaths
export function pageFromPath(pathname: string): PageView {
  return (Object.entries(pagePaths).find(([, path]) => path === pathname.replace(/\/$/, ''))?.[0] as PageView | undefined) ?? 'catalog'
}

/** Rutas públicas estables, historial del navegador y título por sección. */
export function usePageNavigation(): [PageView, (view: PageView) => void] {
  const [view, setView] = useState<PageView>(() => pageFromPath(window.location.pathname))
  useEffect(() => {
    const onPop = () => setView(pageFromPath(window.location.pathname))
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  useEffect(() => {
    const titles = { catalog: 'Catálogo de cartas físicas', collection: 'Mi colección', wishlists: 'Listas de deseos', contact: 'Contacto', privacy: 'Privacidad' }
    document.title = `${titles[view]} · Pokéfolio`
  }, [view])
  return [view, (next) => {
    if (window.location.pathname !== pagePaths[next]) window.history.pushState(null, '', pagePaths[next])
    setView(next)
    window.scrollTo({ top: 0, behavior: 'instant' })
  }]
}
