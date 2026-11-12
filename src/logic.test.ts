import { describe, expect, it } from 'vitest'
import { banlistViolations, maxCopies, parseYdk, toYdk, validateCombos, type Card } from './logic'

describe('ydk', () => {
  it('parses zones and counts copies', () => {
    const deck = parseYdk('#created by x\n#main\n14558127\n14558127\n89631139\n#extra\n1561110\n!side\n14558127\n')
    expect(deck).toEqual([
      { id: 14558127, zone: 'main', count: 2, owned: true },
      { id: 89631139, zone: 'main', count: 1, owned: true },
      { id: 1561110, zone: 'extra', count: 1, owned: true },
      { id: 14558127, zone: 'side', count: 1, owned: true },
    ])
  })
  it('round-trips', () => {
    const deck = parseYdk('#main\n1\n1\n#extra\n2\n!side\n3\n')
    expect(parseYdk(toYdk(deck))).toEqual(deck)
  })
})

describe('banlist', () => {
  it('limits', () => {
    expect([maxCopies('Forbidden'), maxCopies('Limited'), maxCopies('Semi-Limited'), maxCopies(undefined)]).toEqual([0, 1, 2, 3])
  })
  it('counts main + side together', () => {
    const cards = new Map<number, Card>([[1, { id: 1, name: 'Limited Card', type: '', desc: '', ban_tcg: 'Limited' }]])
    const v = banlistViolations([{ id: 1, zone: 'main', count: 1, owned: true }, { id: 1, zone: 'side', count: 1, owned: true }], cards)
    expect(v).toHaveLength(1)
    expect(v[0]).toMatchObject({ count: 2, max: 1 })
  })
})

describe('combos', () => {
  it('rejects lines with cards the player does not own', () => {
    const line = (cardsUsed: string[]) => ({ name: 'x', starter: 'a', steps: [], endBoard: '', cardsUsed })
    const { valid, rejected } = validateCombos([line(['Ash Blossom & Joyous Spring']), line(['Ash Blossom & Joyous Spring', 'Pot of Greed']), line([])], ['ash blossom & joyous spring'])
    expect(valid).toHaveLength(1)
    expect(rejected.map(r => r.unknown)).toEqual([['Pot of Greed'], []])
  })
})
