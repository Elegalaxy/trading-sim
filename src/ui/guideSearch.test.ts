// Guide search: matches every word, ranks title hits first, and gives a readable snippet.

import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { nodeText, searchTopics } from './guideSearch'

const topics = [
  { id: 'a', title: 'Orders', body: createElement('p', null, 'A stop order sells when the price falls to your level.') },
  { id: 'b', title: 'Rumours', body: createElement('ul', null, createElement('li', null, 'A rumour names a source and an order of events.')) },
  { id: 'c', title: 'Margin', body: createElement('p', null, 'Leverage multiplies gains and losses.') },
]

describe('guide search', () => {
  it('reads text out of nested elements', () => {
    expect(nodeText(topics[1]?.body)).toContain('rumour names a source')
  })

  it('needs every word and ignores case', () => {
    expect(searchTopics(topics, 'STOP price').map((hit) => hit.id)).toEqual(['a'])
    expect(searchTopics(topics, 'stop leverage')).toEqual([])
    expect(searchTopics(topics, '   ')).toEqual([])
  })

  it('ranks a title hit above a body hit', () => {
    expect(searchTopics(topics, 'order').map((hit) => hit.id)).toEqual(['a', 'b'])
  })

  it('returns a snippet around the match', () => {
    const hit = searchTopics(topics, 'leverage')[0]
    expect(hit?.snippet).toContain('Leverage')
  })
})
