// Gemini με το key του χρήστη (BYOK). Το key μένει μόνο στον browser του.
import type { Card, ComboLine } from './logic'

const BASE = 'https://generativelanguage.googleapis.com/v1beta'

/** Διαλέγει το νεότερο σταθερό «flash» μοντέλο που έχει το key, αφού τα ονόματα αλλάζουν συχνά. */
export async function pickModel(key: string): Promise<string> {
  const res = await fetch(`${BASE}/models?key=${encodeURIComponent(key)}&pageSize=200`)
  if (!res.ok) throw new Error(res.status === 400 || res.status === 403 ? 'Το Gemini key δεν δουλεύει.' : `Gemini ${res.status}`)
  const models: { name: string; supportedGenerationMethods?: string[] }[] = (await res.json()).models ?? []
  const flash = models
    .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
    .map(m => m.name.replace('models/', ''))
    .filter(n => n.includes('flash') && !/lite|preview|exp|tts|image|live|audio|thinking/.test(n))
    .sort()
  if (!flash.length) throw new Error('Δεν βρέθηκε μοντέλο Gemini Flash σε αυτό το key.')
  return flash[flash.length - 1]
}

export interface Advice {
  combos: ComboLine[]
  extraSuggestions: { name: string; reason: string }[]
}

export interface CounterAdvice {
  threats: { name: string; why: string }[]
  fromCollection: { name: string; how: string }[]
  sideSuggestions: { name: string; why: string }[]
  plan: string
}

async function generate<T>(key: string, model: string, prompt: string): Promise<Partial<T>> {
  const res = await fetch(`${BASE}/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.4 } }),
  })
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const text = (await res.json()).candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? ''
  return JSON.parse(text) as Partial<T>
}

/** Counter Deck: πώς να αντιμετωπίσει ο παίκτης ένα archetype, πρώτα με ό,τι έχει και μετά με Side προτάσεις. */
export async function askCounter(key: string, model: string, opponent: string, opponentCards: Card[], collection: Card[]): Promise<CounterAdvice> {
  const list = (cs: Card[]) => cs.map(c => `- ${c.name} [${c.type}]: ${c.desc.replace(/\s+/g, ' ').slice(0, 400)}`).join('\n')
  const prompt = `You are a Yu-Gi-Oh! TCG side-decking expert. The opponent plays the "${opponent}" archetype.

OPPONENT ARCHETYPE CARDS (reference):
${list(opponentCards.slice(0, 40))}

CARDS THE PLAYER HAS (main, extra and side deck):
${list(collection) || '(none)'}

Return JSON only:
{"threats":[{"name":exact card name of an opponent key card,"why":string}],
 "fromCollection":[{"name":exact name from the player's list,"how":string (when to use it against this deck)}],
 "sideSuggestions":[{"name":exact real TCG card name the player does NOT have,"why":string}],
 "plan":string (2-3 sentences: game plan against this deck)}
Up to 5 threats (the cards to stop, with the chain link / timing to interrupt). "fromCollection": only cards from the player's list that really help, possibly empty.
Up to 6 sideSuggestions, legal in the current TCG banlist (hand traps, floodgates, board breakers that hit this archetype's weak points). Answer in Greek, keep card names in English.`
  const parsed = await generate<CounterAdvice>(key, model, prompt)
  return { threats: parsed.threats ?? [], fromCollection: parsed.fromCollection ?? [], sideSuggestions: parsed.sideSuggestions ?? [], plan: parsed.plan ?? '' }
}

export async function askGemini(key: string, model: string, owned: Card[], extraInDeck: Card[]): Promise<Advice> {
  const list = (cs: Card[]) => cs.map(c => `- ${c.name} [${c.type}]: ${c.desc.replace(/\s+/g, ' ')}`).join('\n')
  const prompt = `You are a Yu-Gi-Oh! TCG combo expert. Use ONLY the cards listed below (main deck cards the player owns, plus their Extra Deck).
Never use a card that is not in these lists. Respect current TCG rules and each card's text exactly (once-per-turn clauses, costs, summoning conditions).

MAIN DECK CARDS THE PLAYER OWNS:
${list(owned)}

EXTRA DECK:
${list(extraInDeck) || '(empty)'}

Return JSON only:
{"combos":[{"name":string,"starter":string,"steps":[string],"endBoard":string,"cardsUsed":[exact card names from the lists]}],
 "extraSuggestions":[{"name":exact real TCG card name,"reason":string}]}
Give up to 5 combos, from the most common 1-card starters to bigger lines. "extraSuggestions": up to 5 Extra Deck monsters NOT already listed that these cards can summon, legal in TCG.`
  const parsed = await generate<Advice>(key, model, prompt)
  return { combos: parsed.combos ?? [], extraSuggestions: parsed.extraSuggestions ?? [] }
}
