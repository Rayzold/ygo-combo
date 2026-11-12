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
  const res = await fetch(`${BASE}/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseMimeType: 'application/json', temperature: 0.4 } }),
  })
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 200)}`)
  const text = (await res.json()).candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? ''
  const parsed = JSON.parse(text) as Partial<Advice>
  return { combos: parsed.combos ?? [], extraSuggestions: parsed.extraSuggestions ?? [] }
}
