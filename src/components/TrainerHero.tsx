import { ArrowRight, Droplets, Flame, Leaf, ShieldCheck, Zap } from 'lucide-react'

/** Ilustración geométrica original; no utiliza imágenes ni logotipos oficiales. */
export function TrainerHero({ onCollection }: { onCollection: () => void }) {
  return <section className="hero trainer-hero" aria-label="Tu aventura Pokémon TCG">
    <div className="hero-copy">
      <span className="eyebrow"><span className="live-dot" />POKÉDEX DEL COLECCIONISTA</span>
      <h1>Tu aventura empieza<br /><span>con una carta.</span></h1>
      <p>De tu primer Pikachu a esa última carta que te falta. Explora, organiza y cuida tu colección Pokémon TCG.</p>
      <div className="hero-actions"><button className="primary" onClick={onCollection}>Mi colección <ArrowRight size={18} /></button><span className="hero-note"><ShieldCheck size={16} />Tu propio archivo de entrenador</span></div>
      <div className="energy-types" aria-hidden="true"><span className="energy electric"><Zap size={13} />Rayo</span><span className="energy water"><Droplets size={13} />Agua</span><span className="energy fire"><Flame size={13} />Fuego</span><span className="energy grass"><Leaf size={13} />Planta</span></div>
    </div>
    <div className="pokedex-art" aria-hidden="true">
      <div className="hero-orbit" />
      <div className="pokedex-device">
        <div className="device-lights"><span className="device-lens" /><i /><i /><i /><span className="device-label">POKÉFOLIO / TCG</span></div>
        <div className="device-screen-frame">
          <div className="device-screen"><div className="screen-status"><span>ARCHIVO PERSONAL</span><span>●</span></div><span className="pokeball screen-ball" /><strong>Una nueva aventura</strong><small>DESCUBRE · COLECCIONA · CONSERVA</small></div>
          <div className="screen-controls"><span /><i /><i /><i /></div>
        </div>
        <div className="device-controls"><div className="device-readout"><span>TU PRÓXIMO OBJETIVO</span><strong>Encuentra tu favorita</strong></div><span className="device-dpad" /></div>
      </div>
      <span className="trainer-sticker"><Zap size={17} fill="currentColor" />¡Haz que cuente!</span>
    </div>
  </section>
}