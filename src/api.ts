// YGOPRODeck API (δωρεάν, CORS *). Οι όροι τους ζητούν cache: κρατάμε κάρτες και λίστες στο localStorage.
import type { BanStatus, Card } from './logic'

const API = 'https://db.ygoprodeck.com/api/v7/cardinfo.php'
const DAY = 24 * 60 * 60 * 1000

interface ApiCard {
  id: number
  name: string
  type: string
  desc: string
  archetype?: string
  banlist_info?: { ban_tcg?: BanStatus }
}

const toCard = (c: ApiCard): Card => ({
  id: c.id, name: c.name, type: c.type, desc: c.desc, archetype: c.archetype, ban_tcg: c.banlist_info?.ban_tcg,
})

function cacheGet<T>(key: string, maxAge: number): T | null {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const { at, data } = JSON.parse(raw)
    return Date.now() - at < maxAge ? data : null
  } catch { return null }
}

function cacheSet(key: string, data: unknown) {
  try { localStorage.setItem(key, JSON.stringify({ at: Date.now(), data })) } catch { /* γεμάτο ή μπλοκαρισμένο: απλώς χωρίς cache */ }
}

async function query(params: Record<string, string>): Promise<Card[]> {
  const res = await fetch(`${API}?${new URLSearchParams(params)}`)
  if (res.status === 400) return [] // το API απαντά 400 όταν δεν βρει τίποτα
  if (!res.ok) throw new Error(`YGOPRODeck ${res.status}`)
  return ((await res.json()).data as ApiCard[]).map(toCard)
}

/** Κάρτες με βάση ids, με cache ανά κάρτα (7 μέρες). */
export async function cardsByIds(ids: number[]): Promise<Card[]> {
  const out: Card[] = []
  const missing: number[] = []
  for (const id of new Set(ids)) {
    const hit = cacheGet<Card>(`card:${id}`, 7 * DAY)
    if (hit) out.push(hit)
    else missing.push(id)
  }
  for (let i = 0; i < missing.length; i += 50) {
    for (const c of await query({ id: missing.slice(i, i + 50).join(',') })) {
      cacheSet(`card:${c.id}`, c)
      out.push(c)
    }
  }
  return out
}

export async function searchCards(text: string): Promise<Card[]> {
  if (text.trim().length < 3) return []
  return query({ fname: text.trim(), num: '20', offset: '0' })
}

export async function cardsByNames(names: string[]): Promise<Card[]> {
  if (!names.length) return []
  return query({ name: names.join('|') })
}

async function cachedList(key: string, params: Record<string, string>): Promise<Card[]> {
  const hit = cacheGet<Card[]>(key, DAY)
  if (hit) return hit
  const data = await query(params)
  cacheSet(key, data)
  return data
}

export const tcgBanlist = () => cachedList('list:banlist-tcg', { banlist: 'tcg' })

/** Οι κάρτες ενός archetype (για το Counter Deck): ό,τι παίζει ο αντίπαλος. */
export const cardsByArchetype = (name: string) => cachedList(`list:arch:${name.toLowerCase()}`, { archetype: name })

/** Όλα τα archetypes, για αυτόματη συμπλήρωση. */
export async function archetypes(): Promise<string[]> {
  const hit = cacheGet<string[]>('list:archetypes', 7 * DAY)
  if (hit) return hit
  const res = await fetch('https://db.ygoprodeck.com/api/v7/archetypes.php')
  if (!res.ok) throw new Error(`YGOPRODeck ${res.status}`)
  const names = ((await res.json()) as { archetype_name: string }[]).map(a => a.archetype_name).sort()
  cacheSet('list:archetypes', names)
  return names
}

/** Έκδοση και ημερομηνία της βάσης του YGOPRODeck (αλλάζει με νέες κάρτες και banlists). */
export async function dbVersion(): Promise<{ version: string; updated: string } | null> {
  const hit = cacheGet<{ version: string; updated: string }>('db:version', DAY)
  if (hit) return hit
  const res = await fetch('https://db.ygoprodeck.com/api/v7/checkDBVer.php')
  if (!res.ok) return null
  const row = ((await res.json()) as { database_version: string; last_update: string }[])[0]
  if (!row) return null
  const v = { version: row.database_version, updated: row.last_update }
  cacheSet('db:version', v)
  return v
}
export const staples = () => cachedList('list:staples', { staple: 'yes' })
