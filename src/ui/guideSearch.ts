// Guide search helpers: plain text of a topic body, and keyword matching over topics.

import { Children, isValidElement, type ReactNode } from 'react'

export type SearchTopic = { id: string; title: string; body: ReactNode }

/** Plain text of a topic body, for searching. */
export function nodeText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (isValidElement<{ children?: ReactNode }>(node)) return nodeText(node.props.children)
  return Children.toArray(node).map(nodeText).join(' ')
}

export type GuideHit = { id: string; title: string; snippet: string; score: number }

/** Topics matching every search word, best first: title hits outrank body hits. */
export function searchTopics(topics: readonly SearchTopic[], query: string): GuideHit[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return []
  const hits: GuideHit[] = []
  for (const topic of topics) {
    const body = nodeText(topic.body).replace(/\s+/g, ' ').trim()
    const lowerBody = body.toLowerCase()
    const lowerTitle = topic.title.toLowerCase()
    if (!words.every((word) => lowerTitle.includes(word) || lowerBody.includes(word))) continue
    let score = 0
    for (const word of words) {
      if (lowerTitle.includes(word)) score += 10
      score += lowerBody.split(word).length - 1
    }
    const at = Math.max(0, lowerBody.indexOf(words.find((word) => lowerBody.includes(word)) ?? ''))
    const from = Math.max(0, at - 40)
    const snippet = `${from > 0 ? '…' : ''}${body.slice(from, from + 110)}${from + 110 < body.length ? '…' : ''}`
    hits.push({ id: topic.id, title: topic.title, snippet, score })
  }
  return hits.sort((a, b) => b.score - a.score)
}

