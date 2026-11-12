// Καθαρή λογική χωρίς δίκτυο: .ydk, όρια banlist, έλεγχος combos. Έχει tests στο logic.test.ts.

export type Zone = 'main' | 'extra' | 'side'
export type BanStatus = 'Forbidden' | 'Limited' | 'Semi-Limited'

export interface Card {
  id: number
  name: string
  type: string
  desc: string
  archetype?: string
  ban_tcg?: BanStatus
}

export interface DeckEntry {
  id: number
  zone: Zone
  count: number
  owned: boolean // «την έχω»: μόνο αυτές μπαίνουν στα combos
}

/** Διαβάζει .ydk (EDOPro / YGOPRODeck): #main, #extra, !side και ένα id ανά γραμμή. */
export function parseYdk(text: string): DeckEntry[] {
  const counts = new Map<string, DeckEntry>()
  let zone: Zone = 'main'
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '#main') zone = 'main'
    else if (line === '#extra') zone = 'extra'
    else if (line === '!side') zone = 'side'
    else if (/^\d+$/.test(line)) {
      const id = Number(line)
      const key = `${zone}:${id}`
      const entry = counts.get(key)
      if (entry) entry.count++
      else counts.set(key, { id, zone, count: 1, owned: true })
    }
  }
  return [...counts.values()]
}

export function toYdk(deck: DeckEntry[]): string {
  const lines = (z: Zone) => deck.filter(e => e.zone === z).flatMap(e => Array(e.count).fill(String(e.id)))
  return ['#created by ygo-combo', '#main', ...lines('main'), '#extra', ...lines('extra'), '!side', ...lines('side'), ''].join('\n')
}

export function maxCopies(status?: BanStatus): number {
  return status === 'Forbidden' ? 0 : status === 'Limited' ? 1 : status === 'Semi-Limited' ? 2 : 3
}

/** Κάρτες που ξεπερνούν το όριο του TCG (μετράνε main + extra + side μαζί). */
export function banlistViolations(deck: DeckEntry[], cards: Map<number, Card>) {
  const total = new Map<number, number>()
  for (const e of deck) total.set(e.id, (total.get(e.id) ?? 0) + e.count)
  const out: { card: Card; count: number; max: number }[] = []
  for (const [id, count] of total) {
    const card = cards.get(id)
    if (!card) continue
    const max = maxCopies(card.ban_tcg)
    if (count > max) out.push({ card, count, max })
  }
  return out
}

export interface ComboLine {
  name: string
  starter: string
  steps: string[]
  endBoard: string
  cardsUsed: string[]
}

/**
 * Κρατά μόνο combos που χρησιμοποιούν αποκλειστικά κάρτες που έχει ο παίκτης.
 * Το AI μπορεί να «εφεύρει» κάρτες· αυτές οι γραμμές απορρίπτονται.
 */
export function validateCombos(lines: ComboLine[], ownedNames: string[]) {
  const owned = new Set(ownedNames.map(n => n.toLowerCase()))
  const valid: ComboLine[] = []
  const rejected: { line: ComboLine; unknown: string[] }[] = []
  for (const line of lines) {
    const unknown = (line.cardsUsed ?? []).filter(n => !owned.has(n.toLowerCase()))
    if (unknown.length || !line.cardsUsed?.length) rejected.push({ line, unknown })
    else valid.push(line)
  }
  return { valid, rejected }
}
