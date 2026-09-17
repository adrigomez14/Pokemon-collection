/** Orden de presentación por categoría; no representa precio ni probabilidades de sobres. */
const rarityLevels: [number, string[]][] = [
  [120, ['Mega Hyper Rare', 'Mega Hiper Rara', 'Crown', 'Corona']],
  [110, ['Hyper rare', 'Rara Híper', 'Secret Rare', 'Rara Secreta', 'Rainbow Rare']],
  [100, ['Special illustration rare', 'Rara Ilustración Especial', 'Character Super Rare', 'Shiny Ultra Rare', 'Rara Ultra Variocolor', 'Three Star', 'Tres Estrellas', 'Black White Rare', 'Rara Blanca y Negra']],
  [90, ['Ultra Rare', 'Ultra Rara', 'Full Art Trainer', 'Entrenador de arte completo', 'Shiny rare V', 'Shiny rare VMAX', 'Two Star', 'Dos Estrellas', 'Two Shiny']],
  [80, ['Illustration rare', 'Rara Ilustración', 'Character Rare', 'Shiny rare', 'One Star', 'Una Estrella', 'One Shiny']],
  [70, ['Holo Rare VMAX', 'Holo Rara VMAX', 'Holo Rare VSTAR', 'Holo Rara VSTAR', 'Triple Rare', 'LEGEND', 'Rare Holo LV.X', 'Rare PRIME']],
  [60, ['Double rare', 'Rara Doble', 'Holo Rare V', 'Holo Rara V', 'Four Diamond', 'Cuatro Diamantes']],
  [50, ['ACE SPEC Rare', 'Rara AS TÁCTICO', 'Radiant Rare', 'Rara Radiante', 'Amazing Rare', 'Increíbles']],
  [40, ['Holo Rare', 'Rare Holo', 'Holo Rara']],
  [30, ['Rare', 'Rara', 'Three Diamond', 'Tres Diamantes']],
  [20, ['Uncommon', 'Poco común', 'Infrecuente', 'Two Diamond', 'Dos Diamantes']],
  [10, ['Common', 'Común', 'One Diamond', 'Un Diamante']],
]

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLowerCase()
const ranks = new Map(rarityLevels.flatMap(([rank, names]) => names.map((name) => [normalize(name), rank] as const)))

/** Promos, rarezas futuras y cartas sin clasificación quedan antes de poco comunes/comunes. */
export function rarityRank(rarity?: string | null): number {
  return ranks.get(normalize(rarity ?? '')) ?? 25
}
