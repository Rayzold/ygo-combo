import { useEffect, useMemo, useState } from 'react'
import { cardsByIds, cardsByNames, searchCards, staples } from './api'
import { askGemini, pickModel, type Advice } from './gemini'
import { banlistViolations, parseYdk, toYdk, validateCombos, type Card, type DeckEntry, type Zone } from './logic'
import './App.css'

const EXTRA_TYPES = /Fusion|Synchro|XYZ|Link/
const ZONES: { zone: Zone; title: string; min: number; max: number }[] = [
  { zone: 'main', title: 'Main Deck', min: 40, max: 60 },
  { zone: 'extra', title: 'Extra Deck', min: 0, max: 15 },
  { zone: 'side', title: 'Side Deck', min: 0, max: 15 },
]

function load<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? '') as T } catch { return fallback }
}

function Ban({ card }: { card?: Card }) {
  if (!card?.ban_tcg) return null
  return <span className={`ban ban-${card.ban_tcg.toLowerCase()}`}>{card.ban_tcg}</span>
}

export default function App() {
  const [deck, setDeck] = useState<DeckEntry[]>(() => load('deck', []))
  const [cards, setCards] = useState<Map<number, Card>>(new Map())
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Card[]>([])
  const [sideIdeas, setSideIdeas] = useState<Card[]>([])
  const [geminiKey, setGeminiKey] = useState(() => localStorage.getItem('geminiKey') ?? '')
  const [advice, setAdvice] = useState<(Advice & { rejected: number; extra: Card[] }) | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  useEffect(() => { localStorage.setItem('deck', JSON.stringify(deck)) }, [deck])
  useEffect(() => { localStorage.setItem('geminiKey', geminiKey) }, [geminiKey])

  // φέρνει όσες κάρτες του deck δεν έχουμε ακόμα
  useEffect(() => {
    const missing = deck.map(e => e.id).filter(id => !cards.has(id))
    if (!missing.length) return
    cardsByIds(missing)
      .then(cs => setCards(prev => new Map([...prev, ...cs.map(c => [c.id, c] as const)])))
      .catch(e => setError(String(e?.message ?? e)))
  }, [deck, cards])

  useEffect(() => {
    const t = setTimeout(() => { searchCards(query).then(setResults).catch(() => setResults([])) }, 300)
    return () => clearTimeout(t)
  }, [query])

  useEffect(() => {
    const inDeck = new Set(deck.map(e => e.id))
    // τα staples περιέχουν και Extra Deck (Link κ.λπ.)· στο Side μόνο Main Deck κάρτες
    staples().then(all => setSideIdeas(all.filter(c => !inDeck.has(c.id) && c.ban_tcg !== 'Forbidden' && !EXTRA_TYPES.test(c.type)).slice(0, 12))).catch(() => {})
  }, [deck])

  const violations = useMemo(() => banlistViolations(deck, cards), [deck, cards])

  function add(card: Card, zone?: Zone) {
    setCards(prev => new Map(prev).set(card.id, card))
    const z = zone ?? (EXTRA_TYPES.test(card.type) ? 'extra' : 'main')
    setDeck(d => {
      const hit = d.find(e => e.id === card.id && e.zone === z)
      return hit ? d.map(e => (e === hit ? { ...e, count: e.count + 1 } : e)) : [...d, { id: card.id, zone: z, count: 1, owned: true }]
    })
  }

  const update = (target: DeckEntry, patch: Partial<DeckEntry>) =>
    setDeck(d => d.map(e => (e === target ? { ...e, ...patch } : e)).filter(e => e.count > 0))

  async function importYdk(file?: File) {
    if (!file) return
    setDeck(parseYdk(await file.text()))
    setAdvice(null)
  }

  function exportYdk() {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([toYdk(deck)], { type: 'text/plain' }))
    a.download = 'deck.ydk'
    a.click()
  }

  async function combos() {
    setError('')
    setAdvice(null)
    const owned = deck.filter(e => e.zone === 'main' && e.owned).map(e => cards.get(e.id)).filter((c): c is Card => !!c)
    const extra = deck.filter(e => e.zone === 'extra').map(e => cards.get(e.id)).filter((c): c is Card => !!c)
    if (!geminiKey) return setError('Βάλε πρώτα το Gemini key σου (πάνω δεξιά).')
    if (!owned.length) return setError('Τσέκαρε τουλάχιστον μία κάρτα του Main Deck που έχεις.')
    try {
      setBusy('Διαλέγω μοντέλο Gemini…')
      const model = await pickModel(geminiKey)
      setBusy(`Το ${model} σκέφτεται combos…`)
      const result = await askGemini(geminiKey, model, owned, extra)
      // combos επιτρέπονται και με κάρτες του Extra Deck
      const { valid, rejected } = validateCombos(result.combos, [...owned, ...extra].map(c => c.name))
      setBusy('Ελέγχω τις προτάσεις για Extra…')
      const real = await cardsByNames(result.extraSuggestions.map(s => s.name)).catch(() => [])
      setAdvice({ ...result, combos: valid, rejected: rejected.length, extra: real.filter(c => c.ban_tcg !== 'Forbidden') })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy('')
    }
  }

  return (
    <div className="app">
      <header>
        <h1>YGO Combo Helper</h1>
        <label className="key">
          Gemini key
          <input type="password" value={geminiKey} onChange={e => setGeminiKey(e.target.value.trim())} placeholder="από aistudio.google.com" />
        </label>
      </header>

      <section className="toolbar">
        <label className="button">Import .ydk<input type="file" accept=".ydk" hidden onChange={e => importYdk(e.target.files?.[0])} /></label>
        <button onClick={exportYdk} disabled={!deck.length}>Export .ydk</button>
        <button onClick={() => { setDeck([]); setAdvice(null) }} disabled={!deck.length}>Καθάρισμα</button>
        <input className="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="Αναζήτηση κάρτας (3+ γράμματα)" />
      </section>

      {results.length > 0 && (
        <ul className="results">
          {results.map(c => (
            <li key={c.id}>
              <span>{c.name} <Ban card={c} /></span>
              <span>
                <button onClick={() => add(c)}>+ Deck</button>
                <button onClick={() => add(c, 'side')}>+ Side</button>
              </span>
            </li>
          ))}
        </ul>
      )}

      {error && <p className="error">{error}</p>}
      {violations.length > 0 && (
        <div className="warn">
          {violations.map(v => <p key={v.card.id}>{v.card.name}: έχεις {v.count}, επιτρέπονται {v.max} ({v.card.ban_tcg})</p>)}
        </div>
      )}

      <div className="zones">
        {ZONES.map(({ zone, title, min, max }) => {
          const entries = deck.filter(e => e.zone === zone)
          const total = entries.reduce((s, e) => s + e.count, 0)
          const off = total > max || (zone === 'main' && total > 0 && total < min)
          return (
            <section key={zone} className="zone">
              <h2>{title} <span className={off ? 'count off' : 'count'}>{total}</span></h2>
              {entries.length === 0 && <p className="muted">Άδειο.</p>}
              <ul>
                {entries.map(e => {
                  const c = cards.get(e.id)
                  return (
                    <li key={`${e.zone}-${e.id}`}>
                      {zone === 'main' && (
                        <input type="checkbox" checked={e.owned} title="Την έχω: μπαίνει στα combos" onChange={ev => update(e, { owned: ev.target.checked })} />
                      )}
                      <span className="name">{c?.name ?? `#${e.id}`} <Ban card={c} /></span>
                      <span className="qty">
                        <button onClick={() => update(e, { count: e.count - 1 })}>−</button>
                        {e.count}
                        <button onClick={() => update(e, { count: e.count + 1 })}>+</button>
                      </span>
                    </li>
                  )
                })}
              </ul>
            </section>
          )
        })}
      </div>

      <section className="panel">
        <h2>Combos</h2>
        <p className="muted">Μόνο με τις κάρτες του Main Deck που έχεις τσεκάρει, και το Extra Deck σου. Το AI μπορεί να κάνει λάθος: έλεγξε τα κείμενα.</p>
        <button className="primary" onClick={combos} disabled={!!busy}>{busy || 'Βρες combos'}</button>
        {advice && (
          <>
            {advice.combos.length === 0 && <p className="muted">Δεν βγήκε έγκυρο combo με αυτές τις κάρτες.</p>}
            {advice.combos.map((c, i) => (
              <article key={i} className="combo">
                <h3>{c.name}</h3>
                <p><b>Starter:</b> {c.starter}</p>
                <ol>{c.steps.map((s, j) => <li key={j}>{s}</li>)}</ol>
                <p><b>Τελικό board:</b> {c.endBoard}</p>
              </article>
            ))}
            {advice.rejected > 0 && <p className="muted">Απορρίφθηκαν {advice.rejected} combos γιατί χρησιμοποιούσαν κάρτες που δεν έχεις.</p>}
            {advice.extra.length > 0 && (
              <>
                <h3>Προτάσεις για Extra Deck</h3>
                <ul className="results">
                  {advice.extra.map(c => (
                    <li key={c.id}>
                      <span>{c.name} <Ban card={c} /><small>{advice.extraSuggestions.find(s => s.name.toLowerCase() === c.name.toLowerCase())?.reason}</small></span>
                      <button onClick={() => add(c, 'extra')}>+ Extra</button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </>
        )}
      </section>

      <section className="panel">
        <h2>Ιδέες για Side Deck</h2>
        <p className="muted">Staples του TCG που δεν έχεις ήδη (χωρίς Forbidden).</p>
        <ul className="results">
          {sideIdeas.map(c => (
            <li key={c.id}>
              <span>{c.name} <Ban card={c} /></span>
              <button onClick={() => add(c, 'side')}>+ Side</button>
            </li>
          ))}
        </ul>
      </section>

      <footer className="muted">Δεδομένα καρτών: YGOPRODeck. Το Gemini key μένει μόνο στον browser σου.</footer>
    </div>
  )
}
