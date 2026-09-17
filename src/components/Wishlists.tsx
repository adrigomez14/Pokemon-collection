return <section className="wishlist-page" aria-labelledby={headingId} style={{ padding: '24px 0' }}>
    
    {/* Cabecera adaptada a FONDO CLARO */}
    <div style={{
      display: 'grid',
      gridTemplateColumns: '1fr 320px',
      gap: '32px',
      alignItems: 'start',
      marginBottom: '40px'
    }}>
      {/* Columna izquierda: Títulos, subtítulo, botón principal y tarjetas de datos */}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#16a34a', fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '12px' }}>
          <span style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#16a34a', display: 'inline-block' }}></span>
          TU ESPACIO PRIVADO
        </div>
        
        {/* Texto principal en oscuro (#0f172a) para que se vea sobre el fondo claro */}
        <h1 id={headingId} style={{ fontSize: '2.8rem', fontWeight: 800, margin: '0 0 8px 0', lineHeight: 1.1, color: '#0f172a' }}>
          {totalWishedItems} {totalWishedItems === 1 ? 'carta guardada.' : 'cartas guardadas.'}
          <span style={{ display: 'block', color: '#f59e0b', fontWeight: 700, marginTop: '4px' }}>Tus próximas adquisiciones.</span>
        </h1>
        
        {/* Párrafo en gris oscuro */}
        <p style={{ color: '#475569', fontSize: '1.05rem', lineHeight: '1.5', maxWidth: '600px', margin: '16px 0 24px 0' }}>
          Cada hallazgo tiene su sitio. Revisa tus listas privadas, organiza tus objetivos de compra y mantén el seguimiento sin alterar tu colección principal.
        </p>

        {/* Botón amarillo principal */}
        <div style={{ marginBottom: '32px' }}>
          <button 
            type="button" 
            onClick={onExploreCatalog}
            style={{
              background: '#fbbf24',
              color: '#0f172a',
              fontWeight: 700,
              fontSize: '0.95rem',
              padding: '14px 24px',
              borderRadius: '10px',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '10px',
              border: 'none',
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(251, 191, 36, 0.2)'
            }}
          >
            Explorar catálogo <ArrowRight size={18} />
          </button>
          <span style={{ display: 'block', color: '#64748b', fontSize: '0.8rem', marginTop: '8px' }}>
            🔒 Listas protegidas y 100% privadas para ti
          </span>
        </div>

        {/* Bloque de tarjetas inferiores de estadísticas (Fondos oscurecidos transparentes y números oscuros) */}
        {userId && data && (
          <div style={{ display: 'flex', gap: '16px' }}>
            <div style={{ background: 'rgba(0, 0, 0, 0.03)', border: '1px solid rgba(0, 0, 0, 0.06)', borderRadius: '12px', padding: '16px 24px', minWidth: '150px' }}>
              <span style={{ display: 'block', color: '#64748b', fontSize: '0.8rem', fontWeight: 600, textTransform: 'uppercase', marginBottom: '6px' }}>Listas creadas</span>
              <span style={{ fontSize: '1.8rem', fontWeight: 800, color: '#0f172a' }}>{totalLists}</span>
            </div>
            <div style={{ background: 'rgba(0, 0, 0, 0.03)', border: '1px solid rgba(0, 0, 0, 0.06)', borderRadius: '12px', padding: '16px 24px', minWidth: '150px' }}>
              <span style={{ display: 'block', color: '#64748b', fontSize: '0.8rem', fontWeight: 600, textTransform: 'uppercase', marginBottom: '6px' }}>Total en deseos</span>
              <span style={{ fontSize: '1.8rem', fontWeight: 800, color: '#0f172a' }}>{totalWishedItems}</span>
            </div>
          </div>
        )}
      </div>

      {/* Columna derecha: Tarjeta estilo Pokéfolio con la carta destacada */}
      {featuredItem ? (
        <div style={{
          background: '#dc2626',
          borderRadius: '20px',
          padding: '16px',
          boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
          color: '#0f172a'
        }}>
          {/* Detalles superiores tipo dispositivo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '12px', padding: '0 4px' }}>
            <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#60a5fa', border: '2px solid white' }}></div>
            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#f87171' }}></div>
            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: '#facc15' }}></div>
            <span style={{ marginLeft: 'auto', fontSize: '0.7rem', fontWeight: 800, color: 'white', letterSpacing: '0.05em' }}>WISHLIST / TCG</span>
          </div>

          {/* Tarjeta interior blanca */}
          <div style={{ background: '#ffffff', borderRadius: '14px', padding: '14px' }}>
            <div style={{ fontSize: '0.75rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
              <Heart size={13} fill="currentColor" color="#dc2626" /> CARTA DESTACADA
            </div>
            
            <div style={{ background: '#f1f5f9', borderRadius: '10px', padding: '10px', textAlign: 'center', marginBottom: '12px' }}>
              <div style={{ maxHeight: '180px', overflow: 'hidden', display: 'flex', justifyContent: 'center' }}>
                <CardImage card={featuredItem.card_snapshot} />
              </div>
            </div>

            <div style={{ fontWeight: 800, fontSize: '1.05rem', color: '#0f172a', marginBottom: '2px' }}>
              {featuredItem.card_snapshot.name}
            </div>
            <div style={{ fontSize: '0.85rem', color: '#64748b', marginBottom: '16px' }}>
              N.º {featuredItem.card_snapshot.localId} · {languages[featuredItem.language]}
            </div>

            <button 
              type="button" 
              onClick={() => onOpenCard(featuredItem.card_snapshot, featuredItem.language)}
              style={{
                width: '100%',
                background: '#0f172a',
                color: 'white',
                border: 'none',
                borderRadius: '8px',
                padding: '10px',
                fontSize: '0.9rem',
                fontWeight: 700,
                cursor: 'pointer'
              }}
            >
              Ver detalles de la carta
            </button>
          </div>
        </div>
      ) : (
        <div style={{
          background: 'rgba(0, 0, 0, 0.02)',
          border: '2px dashed rgba(0, 0, 0, 0.1)',
          borderRadius: '20px',
          padding: '32px',
          textAlign: 'center',
          color: '#64748b'
        }}>
          <Heart size={32} style={{ margin: '0 auto 12px auto', opacity: 0.4 }} />
          <p style={{ fontSize: '0.9rem', margin: 0 }}>Añade cartas a tus listas para verlas destacadas aquí.</p>
        </div>
      )}
    </div>

    {!userId ? <div className="wishlist-empty">
      <h2>Tus próximas cartas, en un solo lugar</h2><p>Inicia sesión para crear varias listas privadas y guardar cartas por idioma.</p>
      <button type="button" className="wishlist-button wishlist-button-primary" onClick={onAuth}>Iniciar sesión</button>
    </div> : <>
      <WishlistStatus />
      {data && <>
        <WishlistNameForm onSave={(name) => run((owner, signal) => createWishlist(owner, name, signal))} />
        {!data.lists.length ? !error && <div className="wishlist-empty"><h2>Aún no tienes listas</h2><p>Crea tu primera lista privada. Después añade cartas con el corazón del catálogo.</p></div> :
          <div className="wishlist-layout">
            <nav className="wishlist-sidebar" aria-label="Mis listas privadas">
              <h2>Mis listas</h2>
              <ul className="wishlist-list-nav">{data.lists.map((list) => <li key={list.id}>
                <button type="button" className="wishlist-list-button" aria-current={selected?.id === list.id ? 'true' : undefined}
                  disabled={pending} onClick={() => setSelectedId(list.id)}>
                  <span>{list.name}</span><span className="wishlist-count" aria-label={`${counts.get(list.id) ?? 0} cartas`}>
                    {counts.get(list.id) ?? 0}
                  </span>
                </button>
              </li>)}</ul>
            </nav>
            {selected && <section className="wishlist-content" aria-label={`Lista ${selected.name}`}>
              <div className="wishlist-list-heading"><div><h2>{selected.name}</h2><p>{items?.length} cartas · Lista privada</p></div>
                <div className="wishlist-actions">
                  <button type="button" className="wishlist-button" disabled={!canWrite} onClick={() => setDialog({ kind: 'rename', list: selected })}>Renombrar</button>
                  <button type="button" className="wishlist-button wishlist-button-danger" disabled={!canWrite} onClick={() => setDialog({ kind: 'delete', list: selected })}>Eliminar lista</button>
                </div>
              </div>

              {/* Banner de referido con daxter14 */}
              <div className="cardmarket-referral-banner" style={{
                background: "var(--background-secondary, #f8f9fa)",
                border: "1px solid var(--border-color, #e9ecef)",
                borderRadius: "8px",
                padding: "12px 16px",
                margin: "16px 0",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "12px",
                fontSize: "0.9rem"
              }}>
                <div>
                  <strong>¿Vas a comprar cartas de esta lista?</strong>
                  <p style={{ margin: "4px 0 0 0", color: "var(--text-muted, #6c757d)" }}>
                    Si aún no tienes cuenta en Cardmarket, puedes apoyarnos introduciendo el usuario <code>daxter14</code> al registrarte.
                  </p>
                </div>
                <a 
                  href="https://www.cardmarket.com/es/Pokemon" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="wishlist-button"
                  style={{ whiteSpace: "nowrap", textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "6px" }}
                >
                  Ir a Cardmarket <ExternalLink size={14} />
                </a>
              </div>

              {items?.length === 0 ? !error && <div className="wishlist-empty"><h3>Esta lista aún no tiene cartas</h3><p>Abre el corazón de una carta del catálogo y marca esta lista.</p></div> :
                <ul className="wishlist-cards">{items?.map((item) => <li className="wishlist-card" key={wishlistCardKey(item.card_id, item.language)}>
                  <button type="button" className="wishlist-card-open" aria-label={`Abrir ${item.card_snapshot.name} en ${languages[item.language]}`}
                    onClick={() => onOpenCard(item.card_snapshot, item.language)}>
                    <CardImage card={item.card_snapshot} />
                    <span className="wishlist-card-info"><strong>{item.card_snapshot.name}</strong><span>{languages[item.language]}</span><small>N.º {item.card_snapshot.localId}</small></span>
                  </button>
                  <button type="button" className="wishlist-button wishlist-card-remove" disabled={!canWrite}
                    aria-label={`Quitar ${item.card_snapshot.name} en ${languages[item.language]} de ${selected.name}`}
                    onClick={() => setDialog({ kind: 'remove', list: selected, item })}><Trash2 size={16} aria-hidden="true" />Quitar de esta lista</button>
                </li>)}</ul>}
            </section>}
          </div>}
      </>}.
      {!error && <div className="wishlist-actions"><button type="button" className="wishlist-button" disabled={fetching || pending} onClick={() => { void retry() }}>Actualizar listas</button></div>}
    </>}.
    {userId && dialog && <Modal title={dialog.kind === 'rename' ? 'Renombrar lista' : dialog.kind === 'delete' ? 'Eliminar lista privada' : 'Quitar carta de esta lista'} busy={pending} onClose={() => setDialog(null)}>
      <div className="wishlist-dialog">
        <WishlistStatus />
        {dialog.kind === 'rename' ? <WishlistNameForm initialName={dialog.list.name} label="Nombre de la lista" submitLabel="Guardar nombre"
          onSave={(name) => save((owner, signal) => renameWishlist(owner, dialog.list.id, name, signal))} /> : <>
          <p>{dialog.kind === 'delete' ? <>¿Eliminar <strong>{dialog.list.name}</strong> y todas sus cartas guardadas?</> :
            <>¿Quitar <strong>{dialog.item.card_snapshot.name}</strong> ({languages[dialog.item.language]}) de <strong>{dialog.list.name}</strong>?</>}</p>
          <p className="wishlist-hint">No se modificará tu colección ni ninguna otra lista.{dialog.kind === 'delete' && ' Esta eliminación no se puede deshacer.'}</p>
          <button type="button" className="wishlist-button wishlist-button-danger" disabled={!canWrite} onClick={() => {
            void save((owner, signal) => dialog.kind === 'delete'
              ? deleteWishlist(owner, dialog.list.id, signal)
              : removeWishlistItem(owner, dialog.list.id, dialog.item.card_id, dialog.item.language, signal))
          }}>{dialog.kind === 'delete' ? 'Confirmar eliminación' : 'Confirmar quitar carta'}</button>
        </>}
        <button type="button" className="wishlist-button" disabled={pending} onClick={() => setDialog(null)}>Cancelar</button>
      </div>
    </Modal>}
  </section>
}
