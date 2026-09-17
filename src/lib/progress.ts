import type { CardBrief, Entry, EntryInput, Language } from './models'

/** Un ID del mismo idioma cuenta una vez, aunque tenga variantes o varios ejemplares. */
export function ownedCardIds(entries: EntryInput[], language: Language): Set<string> {
  return new Set(entries.filter((entry) => entry.language === language && entry.quantity > 0).map((entry) => entry.card_id))
}

export function expansionProgress(cards: CardBrief[], entries: EntryInput[], language: Language) {
  const ids = new Set(cards.map((card) => card.id))
  const owned = ownedCardIds(entries, language)
  const collected = [...ids].filter((id) => owned.has(id)).length
  return { total: ids.size, collected, missing: ids.size - collected, percent: ids.size ? Math.round(collected / ids.size * 100) : 0 }
}

/** Repetidas: misma carta, idioma y variante; la conservación no crea otra variante. */
export function duplicateGroups(entries: Entry[]) {
  const groups = new Map<string, { key: string; entries: Entry[]; copies: number; extras: number }>()
  for (const entry of entries) {
    const key = `${entry.language}|${entry.card_id}|${entry.variant}`
    const group = groups.get(key) ?? { key, entries: [], copies: 0, extras: 0 }
    group.entries.push(entry)
    group.copies += entry.quantity
    group.extras = Math.max(0, group.copies - 1)
    groups.set(key, group)
  }
  return [...groups.values()].filter((group) => group.extras > 0)
    .sort((a, b) => b.extras - a.extras || a.key.localeCompare(b.key))
}
