// Social feed "Y" (plan market depth, Step M10). An always-on feed of short retail posts, apart
// from the news. It is a window on the crowd, not a cause: posts never move a price, a fair
// value or a stream of the market. Everything here reads `MarketState` and the session bars
// and writes only `GameState.social`, which has its own stream (`createRng(seed + '#social')`).
//
// Three kinds of post are built once, at the start of each day:
//   mood     one per stock on most days, its direction taken from the crowd's mood (so posts
//            show how crowded a trade is) or a coin flip when the crowd is quiet.
//   whisper  an early word about a scheduled event, up to three days ahead. A true whisper is
//            likelier for an event informed money knows about. False whispers are mixed in so
//            the hit rate stays below the low rumour tier.
//   chatter  a reaction stamped with a session time to a bar that has printed. A post stamped
//            for bar i reads bars up to i only, and stays hidden until the clock reaches it.
// Draw order per day: mood (three floats per stock, in definition order), whispers (one float per
// scheduled event within three days, in schedule order, then three per false whisper slot), then
// chatter (one float per candidate bar, stock by stock, bar by bar).
//
// Stress (GAME_DESIGN section 9): posts that agree with an open position can be promoted to
// their loaded text, and posts that disagree can be hidden, up to the same cap as the news
// (none at stress 60, a quarter of the posts at stress 100). Nothing marks them. Verify shows
// every post in its calm text.

import { distortionCap } from './distortion.ts'
import { EVENT_LOOKAHEAD_DAYS } from './constants.ts'
import { affectedAssets } from './events.ts'
import { createRng, nextFloat } from './rng.ts'
import { clockTime } from './session.ts'
import type {
  GameState,
  MarketDefinitions,
  MarketState,
  OpenPosition,
  SessionState,
  SocialDefinitions,
  SocialPersona,
  SocialPost,
  SocialState,
} from './types.ts'

export function createSocial(seed: string): SocialState {
  return { stream: createRng(`${seed}#social`).market, day: 0, posts: [] }
}

function pick<T>(list: readonly T[], roll: number): T {
  return list[Math.min(list.length - 1, Math.floor(roll * list.length))]
}

function personasFor(defs: SocialDefinitions, direction: 'up' | 'down'): readonly SocialPersona[] {
  const found = defs.personas.filter((persona) => persona.mood === direction || persona.mood === 'any')
  return found.length === 0 ? defs.personas : found
}

function render(template: string, asset: string): string {
  return template.replaceAll('{asset}', asset)
}

/** Build the day's posts. Mutates only `social`. Call after the session for the day is built. */
export function buildSocialDay(
  social: SocialState,
  market: MarketState,
  session: SessionState,
  defs: MarketDefinitions,
): void {
  const config = defs.social
  if (config === undefined) return
  const stocks = defs.assets.filter((def) => def.kind === 'stock')
  const posts: SocialPost[] = []
  const add = (post: Omit<SocialPost, 'id'>): void => {
    posts.push({ id: `p${market.day}-${posts.length + 1}`, ...post })
  }

  for (const def of stocks) {
    const show = nextFloat(social.stream)
    const personaRoll = nextFloat(social.stream)
    const flip = nextFloat(social.stream)
    if (show >= config.moodPostChance) continue
    const mood = market.participants?.mood[def.id] ?? 0
    const direction: 'up' | 'down' = Math.abs(mood) >= config.moodThreshold ? (mood > 0 ? 'up' : 'down') : flip < 0.5 ? 'up' : 'down'
    const persona = pick(personasFor(config, direction), personaRoll)
    add({
      kind: 'mood',
      persona: persona.id,
      asset: def.id,
      direction,
      calm: render(pick(persona.calm, personaRoll), def.id),
      loaded: render(pick(persona.loaded, personaRoll), def.id),
      time: null,
      truth: null,
    })
  }

  const leaked = new Set(market.participants?.leaked ?? [])
  for (const event of market.scheduled) {
    const daysUntil = event.eventDay - market.day
    if (daysUntil < 1 || daysUntil > EVENT_LOOKAHEAD_DAYS) continue
    const roll = nextFloat(social.stream)
    const chance = config.whisperTrueChance * (leaked.has(event.id) ? config.whisperLeakBoost : 1)
    if (roll >= chance) continue
    const type = defs.events.find((item) => item.id === event.typeId)
    if (type === undefined) continue
    const asset = affectedAssets(type.scope, event.target, defs.assets)[0]
    const persona = pick(personasFor(config, event.direction), roll)
    add({
      kind: 'whisper',
      persona: persona.id,
      asset,
      direction: event.direction,
      calm: render(config.whisperCalm, asset),
      loaded: render(config.whisperLoaded[event.direction], asset),
      time: null,
      truth: true,
    })
  }
  for (let slot = 0; slot < config.falseWhispersPerDay; slot += 1) {
    const show = nextFloat(social.stream)
    const assetRoll = nextFloat(social.stream)
    const flip = nextFloat(social.stream)
    if (show >= config.falseWhisperChance) continue
    const asset = pick(stocks, assetRoll).id
    const direction: 'up' | 'down' = flip < 0.5 ? 'up' : 'down'
    const persona = pick(personasFor(config, direction), assetRoll)
    add({
      kind: 'whisper',
      persona: persona.id,
      asset,
      direction,
      calm: render(config.whisperCalm, asset),
      loaded: render(config.whisperLoaded[direction], asset),
      time: null,
      truth: false,
    })
  }

  let chatter = 0
  for (const def of stocks) {
    const bars = session.bars[def.id]
    for (let i = 0; i < bars.length && chatter < config.maxChatterPerDay; i += 1) {
      const move = (bars[i].close - bars[i].open) / bars[i].open
      if (Math.abs(move) * 100 < config.chatterThresholdPercent) continue
      const roll = nextFloat(social.stream)
      const direction: 'up' | 'down' = move > 0 ? 'up' : 'down'
      const persona = pick(personasFor(config, direction), roll)
      add({
        kind: 'chatter',
        persona: persona.id,
        asset: def.id,
        direction,
        calm: render(direction === 'up' ? config.chatterCalm.up : config.chatterCalm.down, def.id),
        loaded: render(pick(persona.loaded, roll), def.id),
        time: clockTime(i + 1),
        truth: null,
      })
      chatter += 1
    }
  }
  social.day = market.day
  social.posts = posts
}

/** Whether a post is on screen at this clock step. Chatter appears when the bar it reads has printed. */
function onScreen(post: SocialPost, clock: number): boolean {
  if (post.time === null) return true
  return post.time <= clockTime(clock)
}

function stanceOf(post: SocialPost, positions: Record<string, OpenPosition>): 'favor' | 'oppose' | 'neutral' {
  const shares = positions[post.asset]?.signedShares ?? 0
  if (shares === 0) return 'neutral'
  const long = shares > 0
  return (long && post.direction === 'up') || (!long && post.direction === 'down') ? 'favor' : 'oppose'
}

export type ShownPost = { post: SocialPost; text: string; bent: boolean }

/**
 * The posts on screen now. Stress hides posts against an open position and promotes posts for
 * it to their loaded text, up to the cap, in feed order. `verified` shows the true feed.
 */
export function shownPosts(state: GameState): ShownPost[] {
  const social = state.social
  if (social === undefined) return []
  const visible = social.posts.filter((post) => onScreen(post, state.session.clock))
  const calm = (): ShownPost[] => visible.map((post) => ({ post, text: post.calm, bent: false }))
  if (state.perception.verified) return calm()
  let budget = distortionCap(visible.length, state.stats.stress)
  if (budget === 0) return calm()
  const out: ShownPost[] = []
  const hide = new Set<string>()
  for (const post of visible) {
    if (budget > 0 && stanceOf(post, state.positions) === 'oppose') {
      hide.add(post.id)
      budget -= 1
    }
  }
  for (const post of visible) {
    if (hide.has(post.id)) continue
    if (budget > 0 && stanceOf(post, state.positions) === 'favor') {
      out.push({ post, text: post.loaded, bent: true })
      budget -= 1
    } else out.push({ post, text: post.calm, bent: false })
  }
  return out
}

/** How many posts stress bent or hid at the clock now. */
export function bentPostCount(state: GameState): number {
  const social = state.social
  if (social === undefined) return 0
  const visible = social.posts.filter((post) => onScreen(post, state.session.clock)).length
  const shown = shownPosts(state)
  return visible - shown.length + shown.filter((item) => item.bent).length
}

export function assertSocial(social: SocialState, day: number): void {
  if (typeof social !== 'object' || social === null) throw new Error('social state must be an object')
  if (!Number.isSafeInteger(social.day) || social.day !== day) {
    throw new Error(`social day ${String(social.day)} must match market day ${day}`)
  }
  if (!Array.isArray(social.posts)) throw new Error('social posts must be an array')
}
