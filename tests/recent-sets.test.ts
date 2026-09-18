import { afterEach, describe, expect, it, vi } from 'vitest'
import { getRecentSets, RECENT_SET_LIMIT, setLogoUrl } from '../src/lib/catalog'

const expansion = (id: string, total = 30) => ({
  id, name: `Expansión ${id}`, cardCount: { total, official: total }, serie: { id: 'sv' },
})

afterEach(() => vi.unstubAllGlobals())

describe('getRecentSets', () => {
  it.each(['es', 'en', 'ja'] as const)('consulta una sola vez el índice físico por lanzamiento en %s, sin fichas por carta', async (language) => {
    const sets = [expansion('z-new'), expansion('a-old')]
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(sets)))
    vi.stubGlobal('fetch', fetch)
    expect(await getRecentSets(language)).toEqual(sets)
    expect(fetch).toHaveBeenCalledTimes(1)
    const url = new URL(fetch.mock.calls[0][0])
    expect(url.origin).toBe('https://api.tcgdex.net')
    expect(url.pathname).toBe(`/v2/${language}/sets`)
    expect(Object.fromEntries(url.searchParams)).toEqual({
      'serie.id': 'neq:tcgp', 'sort:field': 'releaseDate', 'sort:order': 'DESC',
    })
    expect(fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal)
  })

  it('filtra Pocket y vacías, conserva el primer duplicado y limita a ocho después de filtrar', async () => {
    const physical = ['z-last', 'sv03.5', 'b', 'x', 'a', 'm', 'q', 'c', 'extra', 'extra-2'].map((id) => expansion(id))
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify([
      expansion('empty', 0), { ...expansion('A1'), serie: { id: 'tcgp' } },
      physical[0], { ...physical[0], name: 'Duplicado que no debe sustituir al original' },
      ...physical.slice(1),
    ])))
    vi.stubGlobal('fetch', fetch)
    expect(RECENT_SET_LIMIT).toBe(8)
    expect(await getRecentSets('es')).toEqual(physical.slice(0, 8))
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('no consume IDs de registros descartados antes de encontrar una expansión válida', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([
      expansion('same', 0), { ...expansion('same'), serie: { id: 'tcgp' } }, expansion('same'),
    ]))))
    expect(await getRecentSets('es')).toEqual([expansion('same')])
  })

  it.each([[], [expansion('empty', 0)], [{ ...expansion('A1'), serie: { id: 'tcgp' } }]].map((sets) => ({ sets })))('devuelve vacío sin pedir cartas: $sets', async ({ sets }) => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(sets)))
    vi.stubGlobal('fetch', fetch)
    expect(await getRecentSets('es')).toEqual([])
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('no mezcla idiomas ni conserva un índice anterior al actualizarlo', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([expansion('es-first')])))
      .mockResolvedValueOnce(new Response(JSON.stringify([expansion('en-first')])))
      .mockResolvedValueOnce(new Response(JSON.stringify([expansion('ja-first')])))
      .mockResolvedValueOnce(new Response(JSON.stringify([expansion('es-new')])))
    vi.stubGlobal('fetch', fetch)
    for (const [language, id] of [['es', 'es-first'], ['en', 'en-first'], ['ja', 'ja-first'], ['es', 'es-new']] as const) {
      expect((await getRecentSets(language)).map((set) => set.id)).toEqual([id])
    }
    expect(fetch.mock.calls.map(([url]) => new URL(url).pathname)).toEqual(['/v2/es/sets', '/v2/en/sets', '/v2/ja/sets', '/v2/es/sets'])
  })

  it('descarta metadatos desconocidos y precios sin usarlos para ordenar ni consultar otros endpoints', async () => {
    const physical = [expansion('z-new'), expansion('a-old')]
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(physical.map((set, i) => ({
      ...set, pricing: { cardmarket: { trend: i ? 999999 : 1, unit: 'EUR' } },
      price: 'PRICE_MUST_NOT_RENDER', releaseDate: i ? '2099-01-01' : '2000-01-01',
      cards: [{ id: 'do-not-fetch' }], metadata: { url: 'https://price.invalid/tracker' },
    })))))
    vi.stubGlobal('fetch', fetch)
    expect(await getRecentSets('es')).toEqual(physical)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('tolera logos y serie opcionales mal formados sin perder la expansión', async () => {
    const { serie: _serie, ...base } = expansion('optional')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify([
      base, { ...expansion('bad-optional'), logo: 123, serie: 'incorrecta' },
      { ...expansion('null-optional'), logo: null, serie: null },
    ]))))
    const sets = await getRecentSets('es')
    expect(sets).toHaveLength(3)
    expect(sets[0]).toEqual(base)
    expect(sets[1].logo).toBeUndefined()
    expect(sets[1].serie).toBeUndefined()
    expect(sets[2].logo).toBeNull()
  })

  it.each([
    null, {}, { sets: [] }, [null], [{ id: 'bad' }],
    [{ ...expansion('bad'), id: '' }], [{ ...expansion('bad'), name: '' }],
    [{ ...expansion('bad'), cardCount: { total: -1, official: 1 } }],
    [{ ...expansion('bad'), cardCount: { total: 1.5, official: 1 } }],
    [{ ...expansion('bad'), cardCount: { total: '30', official: 30 } }],
    [{ ...expansion('bad'), cardCount: { total: 30 } }],
    [expansion('valid'), { id: 'broken' }],
  ].map((payload) => ({ payload })))('rechaza el índice inválido sin devolver resultados parciales: $payload', async ({ payload }) => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload)))
    vi.stubGlobal('fetch', fetch)
    await expect(getRecentSets('es')).rejects.toThrow()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it.each([404, 429, 500, 503])('propaga el error HTTP %i', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Unavailable', { status })))
    await expect(getRecentSets('es')).rejects.toThrow(status === 404 ? 'no está disponible' : 'catálogo no está disponible')
  })

  it('rechaza JSON inválido', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{invalid')))
    await expect(getRecentSets('es')).rejects.toThrow(SyntaxError)
  })

  it.each([false, true])('respeta la cancelación sin reintento ni petición alternativa (abortada antes: %s)', async (alreadyAborted) => {
    const controller = new AbortController()
    const reason = new DOMException('Cancelada por cambio de idioma', 'AbortError')
    let received: AbortSignal | undefined
    const fetch = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      received = init.signal as AbortSignal
      if (received.aborted) reject(received.reason)
      else received.addEventListener('abort', () => reject(received!.reason), { once: true })
    }))
    vi.stubGlobal('fetch', fetch)
    if (alreadyAborted) controller.abort(reason)
    const result = getRecentSets('ja', controller.signal)
    const rejected = expect(result).rejects.toBe(reason)
    if (!alreadyAborted) controller.abort(reason)
    await rejected
    expect(received?.aborted).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})

describe('setLogoUrl', () => {
  it.each([
    'https://assets.tcgdex.net/es/sv/sv03.5/logo',
    'https://assets.tcgdex.net/en/base/base1/logo',
    'https://assets.tcgdex.net/ja/SV/SV-P_1/logo',
  ])('añade .webp directamente sin /low: %s', (url) => {
    expect(setLogoUrl(url)).toBe(`${url}.webp`)
    expect(setLogoUrl(url)).not.toContain('/low')
  })

  const base = 'https://assets.tcgdex.net/es/sv/sv03.5/logo'
  it.each([
    undefined, null, '', ' ', 'not-a-url',
    base.replace('https:', 'http:'), base.replace('https:', 'ftp:'), '//assets.tcgdex.net/es/sv/logo',
    'javascript:alert(1)', 'data:image/png;base64,AA==',
    base.replace('assets.tcgdex.net', 'evil.example'), base.replace('assets.tcgdex.net', 'assets.tcgdex.net.evil.example'),
    base.replace('assets.tcgdex.net', 'assets.tcgdex.net:443'),
    base.replace('assets.tcgdex.net', 'user@assets.tcgdex.net'), base.replace('assets.tcgdex.net', 'user:password@assets.tcgdex.net'),
    `${base}?tracking=1`, `${base}#fragment`, `${base}.webp`, `${base}/low`, `${base}/low.webp`,
    ` ${base}`, `${base} `, `${base}\n`, `${base}\t`, base.replace('/sv/', '/s v/'),
    base.replace('/sv/', '/sv\n/'), base.replace('/sv/', '/sv%20/'),
    base.replace('/sv/', '/../'), base.replace('/sv/', '/./'), base.replace('/sv/', '//'),
    base.replace('/es/', '/es\\'),
    `https://assets.tcgdex.net/${'a'.repeat(2048)}/logo`,
  ])('rechaza una URL de logo no permitida: %j', (url) => {
    expect(setLogoUrl(url)).toBeUndefined()
  })

  it('acepta el límite de 2048 caracteres y rechaza uno más', () => {
    const prefix = 'https://assets.tcgdex.net/'
    const url = `${prefix}${'a'.repeat(2048 - prefix.length - '/logo'.length)}/logo`
    expect(url).toHaveLength(2048)
    expect(setLogoUrl(url)).toBe(`${url}.webp`)
    expect(setLogoUrl(url.replace('/logo', 'a/logo'))).toBeUndefined()
  })
})
