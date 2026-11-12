import { useEffect, useMemo, useState } from 'react'
import { archetypes, cardsByArchetype, cardsByIds, cardsByNames, dbVersion, searchCards, staples, tcgBanlist } from './api'
import { askCounter, askGemini, pickModel, type Advice, type CounterAdvice } from './gemini'
import { banlistViolations, parseYdk, toYdk, validateCombos, type Card, type DeckEntry, type Zone } from './logic'
import './App.css'

const EXTRA_TYPES = /Fusion|Synchro|XYZ|Link/
const ZONES: { zone: Zone; title: string; min: number; max: number }[] = [
  { zone: 'main', title: 'Main Deck', min: 40, max: 60 },
  { zone: 'extra', title: 'Extra Deck', min: 0, max: 15 },
  { zone: 'side', title: 'Side Deck', min: 0, max: 15 },
]
type View = 'home' | 'deck' | 'counter' | 'search'

function load<T>(key: string, fallback: T): T {
  try { return JSON.parse(localStorage.getItem(key) ?? '') as T } catch { return fallback }
}

function Ban({ card }: { card?: Card }) {
  if (!card?.ban_tcg) return null
  return <span className={`ban ban-${card.ban_tcg.toLowerCase()}`}>{card.ban_tcg}</span>
}

/** Χρώμα πλαισίου ανά τύπο κάρτας (χωρίς artwork της Konami στο UI). */
function frame(type: string) {
  if (/Spell/.test(type)) return 'f-spell'
  if (/Trap/.test(type)) return 'f-trap'
  if (/Link/.test(type)) return 'f-link'
  if (/XYZ/.test(type)) return 'f-xyz'
  if (/Synchro/.test(type)) return 'f-synchro'
  if (/Fusion/.test(type)) return 'f-fusion'
  if (/Ritual/.test(type)) return 'f-ritual'
  if (/Effect|Pendulum/.test(type)) return 'f-effect'
  return 'f-normal'
}

export default function App() {
  const [view, setView] = useState<View>(() => (location.hash.slice(1) as View) || 'home')
  const [deck, setDeck] = useState<DeckEntry[]>(() => load('deck', []))
  const [cards, setCards] = useState<Map<number, Card>>(new Map())
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Card[]>([])
  const [openCard, setOpenCard] = useState<number | null>(null)
  const [sideIdeas, setSideIdeas] = useState<Card[]>([])
  const [geminiKey, setGeminiKey] = useState(() => localStorage.getItem('geminiKey') ?? '')
  const [advice, setAdvice] = useState<(Advice & { rejected: number; extra: Card[] }) | null>(null)
  const [opponent, setOpponent] = useState('')
  const [archList, setArchList] = useState<string[]>([])
  const [counter, setCounter] = useState<(CounterAdvice & { side: Card[]; real: Map<string, Card> }) | null>(null)
  const [news, setNews] = useState<{ forbidden: number; limited: number; semi: number; updated?: string } | null>(null)
  const [shortlist, setShortlist] = useState<Card[]>(() => load('shortlist', []))
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')

  useEffect(() => { localStorage.setItem('deck', JSON.stringify(deck)) }, [deck])
  useEffect(() => { localStorage.setItem('geminiKey', geminiKey) }, [geminiKey])
  useEffect(() => { localStorage.setItem('shortlist', JSON.stringify(shortlist)) }, [shortlist])
  useEffect(() => { history.replaceState(null, '', view === 'home' ? location.pathname : `#${view}`) }, [view])
  const go = (v: View) => { setView(v); setError('') }

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

  // πάνελ «Νέα»: η τρέχουσα TCG banlist και πότε ενημερώθηκε η βάση
  useEffect(() => {
    Promise.all([tcgBanlist(), dbVersion().catch(() => null)])
      .then(([list, v]) => setNews({
        forbidden: list.filter(c => c.ban_tcg === 'Forbidden').length,
        limited: list.filter(c => c.ban_tcg === 'Limited').length,
        semi: list.filter(c => c.ban_tcg === 'Semi-Limited').length,
        updated: v?.updated,
      }))
      .catch(() => {})
  }, [])

  useEffect(() => { if (view === 'counter' && !archList.length) archetypes().then(setArchList).catch(() => {}) }, [view, archList.length])

  const violations = useMemo(() => banlistViolations(deck, cards), [deck, cards])
  const mainCount = deck.filter(e => e.zone === 'main').reduce((s, e) => s + e.count, 0)

  function add(card: Card, zone?: Zone) {
    setCards(prev => new Map(prev).set(card.id, card))
    const z = zone ?? (EXTRA_TYPES.test(card.type) ? 'extra' : 'main')
    setDeck(d => {
      const hit = d.find(e => e.id === card.id && e.zone === z)
      return hit ? d.map(e => (e === hit ? { ...e, count: e.count + 1 } : e)) : [...d, { id: card.id, zone: z, count: 1, owned: true }]
    })
  }

  // «Λίστα»: κάρτες που μαζεύεις από Search και Counter Deck, για να τις βάλεις μετά στο deck
  const inList = (c: Card) => shortlist.some(x => x.id === c.id)
  const toList = (c: Card) => setShortlist(l => (l.some(x => x.id === c.id) ? l : [...l, c]))
  const fromList = (c: Card) => setShortlist(l => l.filter(x => x.id !== c.id))
  function ListBtn({ card }: { card?: Card }) {
    if (!card) return null
    return inList(card)
      ? <button className="listed" onClick={() => fromList(card)} title="Βγάλ' τη από τη Λίστα">✓ Λίστα</button>
      : <button onClick={() => toList(card)}>+ Λίστα</button>
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

  async function withModel<T>(label: string, run: (model: string) => Promise<T>): Promise<T | undefined> {
    setError('')
    if (!geminiKey) { setError('Βάλε πρώτα το Gemini key σου (πάνω δεξιά).'); return }
    try {
      setBusy('Διαλέγω μοντέλο Gemini…')
      const model = await pickModel(geminiKey)
      setBusy(`Το ${model} ${label}…`)
      return await run(model)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy('')
    }
  }

  async function combos() {
    setAdvice(null)
    const owned = deck.filter(e => e.zone === 'main' && e.owned).map(e => cards.get(e.id)).filter((c): c is Card => !!c)
    const extra = deck.filter(e => e.zone === 'extra').map(e => cards.get(e.id)).filter((c): c is Card => !!c)
    if (!owned.length) return setError('Τσέκαρε τουλάχιστον μία κάρτα του Main Deck που έχεις.')
    await withModel('σκέφτεται combos', async model => {
      const result = await askGemini(geminiKey, model, owned, extra)
      // combos επιτρέπονται και με κάρτες του Extra Deck
      const { valid, rejected } = validateCombos(result.combos, [...owned, ...extra].map(c => c.name))
      setBusy('Ελέγχω τις προτάσεις για Extra…')
      const real = await cardsByNames(result.extraSuggestions.map(s => s.name)).catch(() => [])
      setAdvice({ ...result, combos: valid, rejected: rejected.length, extra: real.filter(c => c.ban_tcg !== 'Forbidden') })
    })
  }

  async function counterDeck() {
    setCounter(null)
    const name = opponent.trim()
    if (!name) return setError('Γράψε τι παίζει ο αντίπαλος (archetype).')
    await withModel(`μελετά το ${name}`, async model => {
      const theirs = await cardsByArchetype(name).catch(() => [])
      if (!theirs.length) throw new Error(`Δεν βρήκα archetype «${name}». Διάλεξε από τη λίστα.`)
      const mine = deck.map(e => cards.get(e.id)).filter((c): c is Card => !!c)
      const result = await askCounter(geminiKey, model, name, theirs, mine)
      setBusy('Ελέγχω ότι οι προτάσεις είναι αληθινές κάρτες…')
      const names = [...result.sideSuggestions, ...result.threats].map(s => s.name)
      const real = await cardsByNames(names).catch(() => [])
      const byName = new Map([...real, ...mine, ...theirs].map(c => [c.name.toLowerCase(), c] as const))
      const sideNames = new Set(result.sideSuggestions.map(s => s.name.toLowerCase()))
      const owned = new Set(mine.map(c => c.name.toLowerCase()))
      setCounter({
        ...result,
        fromCollection: result.fromCollection.filter(f => owned.has(f.name.toLowerCase())),
        side: real.filter(c => sideNames.has(c.name.toLowerCase()) && c.ban_tcg !== 'Forbidden' && !owned.has(c.name.toLowerCase())),
        real: byName,
      })
    })
  }

  const tiles: { id: View; icon: string; title: string; text: string }[] = [
    { id: 'deck', icon: '🂠', title: 'Deck Builder', text: 'Χτίσε, έλεγξε στη banlist και βρες combos' },
    { id: 'counter', icon: '⛨', title: 'Counter Deck', text: 'Βρες πώς να αντιμετωπίσεις οποιοδήποτε deck' },
    { id: 'search', icon: '⌕', title: 'Card Search', text: 'Ψάξε κάρτες και διάβασε τα κείμενά τους' },
  ]

  return (
    <div className="shell">
      <div className="sky" aria-hidden><i /><i /><i /></div>
      <header className="top">
        <button className="brand" onClick={() => go('home')}>
          <span className="crest">✦</span>
          <span><b>YGO Assistant</b><small>Duel smarter. Play better.</small></span>
        </button>
        <nav>
          {tiles.map(t => (
            <button key={t.id} className={view === t.id ? 'on' : ''} onClick={() => go(t.id)}>{t.title}{t.id === 'deck' && shortlist.length > 0 && <span className="badge">{shortlist.length}</span>}</button>
          ))}
        </nav>
        <label className="key">
          Gemini key
          <input type="password" value={geminiKey} onChange={e => setGeminiKey(e.target.value.trim())} placeholder="από aistudio.google.com" />
        </label>
      </header>

      <main className="app">
        {error && <p className="error">{error}</p>}

        {view === 'home' && (
          <div className="home">
            <section className="hero">
              <div className="sigil" aria-hidden><span /><span /><span /></div>
              <h1>Η δύναμη του Duel,<br />στα χέρια σου.</h1>
              <p className="muted">Deck, banlist, combos και αντίμετρα, με τις κάρτες που πραγματικά έχεις.</p>
              <div className="tiles">
                {tiles.map(t => (
                  <button key={t.id} className="tile" onClick={() => go(t.id)}>
                    <span className="icon">{t.icon}</span>
                    <b>{t.title}</b>
                    <small>{t.text}</small>
                    <span className="go">›</span>
                  </button>
                ))}
              </div>
            </section>
            <aside className="news">
              <h2>Νέα & ενημερώσεις</h2>
              <article>
                <span className="tag t-ban">BANLIST</span>
                <div>
                  <b>TCG banlist σε ισχύ</b>
                  <p>{news ? `${news.forbidden} Forbidden · ${news.limited} Limited · ${news.semi} Semi-Limited` : 'Φορτώνει…'}</p>
                </div>
              </article>
              <article>
                <span className="tag t-db">DB</span>
                <div>
                  <b>Βάση καρτών</b>
                  <p>{news?.updated ? `Τελευταία ενημέρωση ${new Date(news.updated).toLocaleDateString('el-GR')}` : 'YGOPRODeck'}</p>
                </div>
              </article>
              <article>
                <span className="tag t-deck">DECK</span>
                <div>
                  <b>Το deck σου</b>
                  <p>{deck.length ? `${mainCount} κάρτες στο Main${violations.length ? ` · ${violations.length} εκτός banlist` : ' · όλα εντός banlist'}` : 'Άδειο. Ξεκίνα από το Deck Builder.'}</p>
                </div>
              </article>
            </aside>
          </div>
        )}

        {view === 'search' && (
          <section className="panel">
            <h2>Card Search</h2>
            <input className="search big" autoFocus value={query} onChange={e => setQuery(e.target.value)} placeholder="Όνομα κάρτας (3+ γράμματα)" />
            <ul className="cards">
              {results.map(c => (
                <li key={c.id} className={frame(c.type)}>
                  <button className="cardhead" onClick={() => setOpenCard(openCard === c.id ? null : c.id)}>
                    <span>{c.name} <Ban card={c} /></span>
                    <small>{c.type}{c.archetype ? ` · ${c.archetype}` : ''}</small>
                  </button>
                  {openCard === c.id && <p className="desc">{c.desc}</p>}
                  <span className="acts">
                    <ListBtn card={c} />
                    <button onClick={() => add(c)}>+ Deck</button>
                    <button onClick={() => add(c, 'side')}>+ Side</button>
                  </span>
                </li>
              ))}
            </ul>
            {query.trim().length >= 3 && results.length === 0 && <p className="muted">Τίποτα ακόμα.</p>}
          </section>
        )}

        {view === 'counter' && (
          <section className="panel">
            <h2>Counter Deck</h2>
            <p className="muted">Γράψε τι παίζει ο αντίπαλος. Πρώτα σου λέω τι από τη συλλογή σου βοηθάει, μετά τι αξίζει για το Side. Το AI μπορεί να κάνει λάθος: έλεγξε τα κείμενα.</p>
            <div className="row">
              <input className="search" list="archetypes" value={opponent} onChange={e => setOpponent(e.target.value)} placeholder="Archetype, π.χ. Snake-Eye" />
              <datalist id="archetypes">{archList.map(a => <option key={a} value={a} />)}</datalist>
              <button className="primary" onClick={counterDeck} disabled={!!busy}>{busy || 'Βρες αντίμετρα'}</button>
            </div>
            {counter && (
              <div className="counter">
                {counter.plan && <p className="plan">{counter.plan}</p>}
                <h3>Τι να σταματήσεις</h3>
                <ul className="results">{counter.threats.map(t => <li key={t.name}><span>{t.name}<small>{t.why}</small></span><ListBtn card={counter.real.get(t.name.toLowerCase())} /></li>)}</ul>
                <h3>Από τη συλλογή σου</h3>
                {counter.fromCollection.length ? (
                  <ul className="results">{counter.fromCollection.map(f => <li key={f.name}><span>{f.name}<small>{f.how}</small></span><ListBtn card={counter.real.get(f.name.toLowerCase())} /></li>)}</ul>
                ) : <p className="muted">Τίποτα από όσα έχεις δεν βοηθάει ιδιαίτερα.</p>}
                <h3>Για το Side Deck</h3>
                <ul className="results">
                  {counter.side.map(c => (
                    <li key={c.id}>
                      <span>{c.name} <Ban card={c} /><small>{counter.sideSuggestions.find(s => s.name.toLowerCase() === c.name.toLowerCase())?.why}</small></span>
                      <span><ListBtn card={c} /><button onClick={() => add(c, 'side')}>+ Side</button></span>
                    </li>
                  ))}
                </ul>
                {(counter.threats.length + counter.side.length) > 0 && <p className="muted">Με «+ Λίστα» τις μαζεύεις, και στο Deck Builder τις περνάς σε Main, Extra ή Side.</p>}
              </div>
            )}
          </section>
        )}

        {view === 'deck' && (
          <>
            {shortlist.length > 0 && (
              <section className="panel shortlist">
                <h2>Λίστα <span className="count">{shortlist.length}</span>
                  <button className="clear" onClick={() => setShortlist([])}>Άδειασμα</button></h2>
                <p className="muted">Κάρτες που μάζεψες από Card Search και Counter Deck. Πέρασέ τες στο deck· φεύγουν από τη Λίστα μόλις μπουν.</p>
                <ul className="results">
                  {shortlist.map(c => (
                    <li key={c.id} className={frame(c.type)}>
                      <span>{c.name} <Ban card={c} /><small>{c.type}</small></span>
                      <span>
                        {EXTRA_TYPES.test(c.type)
                          ? <button onClick={() => { add(c, 'extra'); fromList(c) }}>→ Extra</button>
                          : <button onClick={() => { add(c, 'main'); fromList(c) }}>→ Main</button>}
                        {!EXTRA_TYPES.test(c.type) && <button onClick={() => { add(c, 'side'); fromList(c) }}>→ Side</button>}
                        <button onClick={() => fromList(c)} title="Αφαίρεση">✕</button>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            )}
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
                          <li key={`${e.zone}-${e.id}`} className={c ? frame(c.type) : ''}>
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
          </>
        )}
      </main>

      <footer className="foot muted">
        <span>★ Η δύναμη του Duel, στα χέρια σου</span>
        <span>Δεδομένα καρτών: YGOPRODeck. Fan εργαλείο, χωρίς σχέση με την Konami. Το Gemini key μένει μόνο στον browser σου.</span>
      </footer>
    </div>
  )
}
