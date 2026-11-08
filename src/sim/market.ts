// Daily price step. Definitions are passed in.
// Price noise draws the market stream. Drift, event rolls, and the calendar draw the events stream.
// The day-ahead feed draws the info stream, and only for rumours. Distortion is not drawn.
// Mutates `state` and returns it: the streams inside the state advance in place.
// With `defs.traders` and a trader book (price-model plan, Step P2) stocks are priced by
// `priceWithTraders` instead of the pull-plus-noise formula; otherwise the code below is unchanged.

import {
  assertCalendarDefinitions,
  beginCalendarDay,
  calendarHeadlineText,
  calendarRulesFrom,
  rollCalendarForDay,
} from './calendar.ts'
import {
  CENTS_PER_UNIT,
  DAILY_MOVE_CAP_DENOMINATOR,
  DAILY_MOVE_CAP_NUMERATOR,
  EVENT_LOOKAHEAD_DAYS,
  FAIR_VALUE_PULL_DENOMINATOR,
  FAIR_VALUE_PULL_NUMERATOR,
  INDEX_LEVEL_SCALE,
} from './constants.ts'
import { assertEnvironmentDefinitions, driftEnvironment, initialEnvironment } from './environment.ts'
import { applyDueEffects, assertEventDefinitions, rollEventsForDay } from './events.ts'
import {
  assertParticipantDefinitions,
  assignLeaks,
  consensusFlow,
  createParticipants,
  crowdFlow,
  informedFlow,
  momentumFlow,
  newsFlow,
  orderFlowMove,
  startPartyDay,
} from './participants.ts'
import { assertFeedDefinitions, assertFeedState, publishFeed, type FiredHeadline } from './feed.ts'
import { createRng, nextNormal } from './rng.ts'
import {
  assertTraderDefinitions,
  commitTraderStock,
  createTraderBook,
  planTraderStock,
  startTraderDay,
  traderModelOn,
  type TraderDay,
} from './traders.ts'
import {
  RNG_STREAM_NAMES,
  type AssetDefinition,
  type AssetState,
  type CalendarItemEvent,
  type EffectAppliedEvent,
  type FairValueChangeEvent,
  type IndexStepEvent,
  type MarketDefinitions,
  type MarketState,
  type NoiseRollEvent,
  type ParticipantFlowEvent,
  type PriceStepEvent,
} from './types.ts'

const INDEX_PAR_CENTS = INDEX_LEVEL_SCALE * CENTS_PER_UNIT

function describeValue(value: unknown): string {
  if (typeof value === 'number' && Number.isNaN(value)) return 'NaN'
  if (typeof value === 'string') return JSON.stringify(value)
  if (value === undefined) return 'undefined'
  return String(value)
}

function assertDefinitions(defs: MarketDefinitions): void {
  if (typeof defs !== 'object' || defs === null || Array.isArray(defs)) {
    throw new Error(`market definitions must be an object, received ${describeValue(defs)}`)
  }
  if (defs.participants !== undefined) assertParticipantDefinitions(defs.participants)
  if (defs.traders !== undefined) assertTraderDefinitions(defs.traders)
  if (!Array.isArray(defs.assets) || defs.assets.length === 0) {
    throw new Error(`market definitions assets must be a non-empty array, received ${describeValue(defs.assets)}`)
  }
  const seen = new Set<string>()
  let stocks = 0
  let indexes = 0
  for (let i = 0; i < defs.assets.length; i += 1) {
    const def = defs.assets[i]
    if (typeof def !== 'object' || def === null || Array.isArray(def)) {
      throw new Error(`asset definitions[${i}] must be an object, received ${describeValue(def)}`)
    }
    if (typeof def.id !== 'string' || !/^[A-Za-z][A-Za-z0-9]*$/.test(def.id)) {
      throw new Error(
        `asset definitions[${i}].id must be a letter followed by letters or digits, received ${describeValue(def.id)}`,
      )
    }
    if (seen.has(def.id)) throw new Error(`asset id ${def.id} is duplicated`)
    seen.add(def.id)
    if (def.kind !== 'stock' && def.kind !== 'index') {
      throw new Error(`asset ${def.id} kind must be stock or index, received ${describeValue(def.kind)}`)
    }
    if (!Number.isSafeInteger(def.startPriceCents) || def.startPriceCents <= 0) {
      throw new Error(
        `asset ${def.id} startPriceCents must be a positive safe integer, received ${describeValue(def.startPriceCents)}`,
      )
    }
    if (typeof def.dailyVolatility !== 'number' || !Number.isFinite(def.dailyVolatility) || def.dailyVolatility < 0) {
      throw new Error(
        `asset ${def.id} dailyVolatility must be a finite number >= 0, received ${describeValue(def.dailyVolatility)}`,
      )
    }
    for (const field of ['sharesOutstanding', 'liquidityNotionalCents'] as const) {
      const value = def[field]
      if (value !== undefined && (!Number.isSafeInteger(value) || value <= 0)) {
        throw new Error(`asset ${def.id} ${field} must be a positive safe integer, received ${describeValue(value)}`)
      }
    }
    if (def.kind === 'index' && def.sharesOutstanding !== undefined) {
      throw new Error(`index ${def.id} sharesOutstanding must be unset`)
    }
    if (def.kind === 'stock') {
      stocks += 1
      if (def.sector !== 'A' && def.sector !== 'B') {
        throw new Error(`stock ${def.id} sector must be A or B, received ${describeValue(def.sector)}`)
      }
    } else {
      indexes += 1
      if (def.sector !== null) {
        throw new Error(`index ${def.id} sector must be null, received ${describeValue(def.sector)}`)
      }
      if (def.dailyVolatility !== 0) {
        throw new Error(`index ${def.id} dailyVolatility must be 0, received ${describeValue(def.dailyVolatility)}`)
      }
      if (def.startPriceCents !== INDEX_PAR_CENTS) {
        throw new Error(
          `index ${def.id} startPriceCents must be ${INDEX_PAR_CENTS}, received ${def.startPriceCents}`,
        )
      }
    }
  }
  if (stocks < 1) throw new Error('market definitions need at least one stock')
  if (indexes !== 1) throw new Error(`market definitions need exactly one index, received ${indexes}`)
  assertEnvironmentDefinitions(defs.environment)
  assertEventDefinitions(defs.events, defs.assets, defs.environment)
  if (defs.calendar !== undefined) assertCalendarDefinitions(defs.calendar, defs.environment, defs.assets)
  assertFeedDefinitions(defs)
}

function assertState(state: MarketState, defs: MarketDefinitions): void {
  if (typeof state !== 'object' || state === null || Array.isArray(state)) {
    throw new Error(`market state must be an object, received ${describeValue(state)}`)
  }
  if (!Number.isSafeInteger(state.day) || state.day < 0) {
    throw new Error(`market day must be a safe integer >= 0, received ${describeValue(state.day)}`)
  }
  if (!Array.isArray(state.log)) {
    throw new Error(`market log must be an array, received ${describeValue(state.log)}`)
  }
  if (typeof state.streams !== 'object' || state.streams === null) {
    throw new Error(`market streams must be an object, received ${describeValue(state.streams)}`)
  }
  for (const name of RNG_STREAM_NAMES) {
    const stream = state.streams[name]
    if (typeof stream !== 'object' || stream === null) {
      throw new Error(`rng stream ${name} must be an object, received ${describeValue(stream)}`)
    }
  }
  if (typeof state.assets !== 'object' || state.assets === null || Array.isArray(state.assets)) {
    throw new Error(`market assets must be an object, received ${describeValue(state.assets)}`)
  }
  const ids = defs.assets.map((def) => def.id)
  const keys = Object.keys(state.assets)
  if (keys.length !== ids.length || ids.some((id) => !Object.hasOwn(state.assets, id))) {
    throw new Error(`market assets must match definitions, received ${keys.join(',') || '(none)'}`)
  }
  for (const def of defs.assets) {
    const asset = state.assets[def.id]
    if (typeof asset !== 'object' || asset === null) {
      throw new Error(`asset ${def.id} state must be an object, received ${describeValue(asset)}`)
    }
    if (asset.id !== def.id) {
      throw new Error(`asset ${def.id} state id must match, received ${describeValue(asset.id)}`)
    }
    if (!Number.isSafeInteger(asset.priceCents) || asset.priceCents <= 0) {
      throw new Error(
        `asset ${def.id} priceCents must be a positive safe integer, received ${describeValue(asset.priceCents)}`,
      )
    }
    if (typeof asset.fairValue !== 'number' || !Number.isFinite(asset.fairValue)) {
      throw new Error(`asset ${def.id} fairValue must be a finite number, received ${describeValue(asset.fairValue)}`)
    }
  }
  if ((state.participants === undefined) !== (defs.participants === undefined)) {
    throw new Error('market participants state must be present exactly when the definitions have participants')
  }
  if (!Array.isArray(state.environment) || state.environment.length !== defs.environment.length) {
    throw new Error(
      `market environment must match definitions, received ${describeValue(state.environment?.length)} entries`,
    )
  }
  for (let i = 0; i < defs.environment.length; i += 1) {
    const entry = state.environment[i]
    const def = defs.environment[i]
    if (typeof entry !== 'object' || entry === null || entry.id !== def.id) {
      throw new Error(`environment state[${i}] must be ${def.id}, received ${describeValue(entry?.id)}`)
    }
    if (typeof entry.value !== 'number' || !Number.isFinite(entry.value)) {
      throw new Error(`environment ${def.id} value must be a finite number, received ${describeValue(entry.value)}`)
    }
    if (entry.lastReleased !== undefined && (typeof entry.lastReleased !== 'number' || !Number.isFinite(entry.lastReleased))) {
      throw new Error(
        `environment ${def.id} lastReleased must be a finite number when set, received ${describeValue(entry.lastReleased)}`,
      )
    }
  }
  if (typeof state.calendarRules !== 'object' || state.calendarRules === null || !Array.isArray(state.calendarRules.schedule)) {
    throw new Error(`calendar rules must be an object with a schedule, received ${describeValue(state.calendarRules)}`)
  }
  if (!Array.isArray(state.calendarRolls)) {
    throw new Error(`calendar rolls must be an array, received ${describeValue(state.calendarRolls)}`)
  }
  if (!Array.isArray(state.scheduled)) {
    throw new Error(`market scheduled events must be an array, received ${describeValue(state.scheduled)}`)
  }
  if (!Array.isArray(state.active)) {
    throw new Error(`market active effects must be an array, received ${describeValue(state.active)}`)
  }
  assertFeedState(state)
}

/**
 * Largest integer cent move that is still <= 8% of `priceCents`.
 * `floor(price * 8 / 100)` in integer arithmetic, so a later cent rounding
 * cannot publish a move larger than 8%. One cent is already more than 8% of
 * a price below 13 cents, so those prices do not move when the cap binds.
 */
function maxDailyMoveCents(priceCents: number): number {
  const whole = Math.floor(priceCents / DAILY_MOVE_CAP_DENOMINATOR)
  const remainder = priceCents % DAILY_MOVE_CAP_DENOMINATOR
  return (
    whole * DAILY_MOVE_CAP_NUMERATOR +
    Math.floor((remainder * DAILY_MOVE_CAP_NUMERATOR) / DAILY_MOVE_CAP_DENOMINATOR)
  )
}

/** Half away from zero. `Math.round` alone sends -1.5 to -1 (toward +infinity). */
function roundHalfAwayFromZero(value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`price move must be a finite number, received ${describeValue(value)}`)
  }
  const rounded = Math.round(Math.abs(value))
  const delta = value < 0 ? -rounded : rounded
  if (!Number.isSafeInteger(delta)) {
    throw new Error(`rounded price move is not a safe integer, received ${describeValue(value)}`)
  }
  return delta
}

/**
 * Round the raw cent move, then clamp to ±floor(price × 8 / 100).
 * `capped` is true only when that clamp changes the rounded cent move.
 * The unpublished part of a stock's gap stays in fair value minus price.
 */
function applyCappedMove(previousCents: number, rawMove: number): { delta: number; capped: boolean; newPrice: number } {
  const maxDelta = maxDailyMoveCents(previousCents)
  let delta = roundHalfAwayFromZero(rawMove)
  let capped = false
  if (delta > maxDelta) {
    delta = maxDelta
    capped = true
  } else if (delta < -maxDelta) {
    delta = -maxDelta
    capped = true
  }
  const newPrice = previousCents + delta
  if (!Number.isSafeInteger(newPrice) || newPrice <= 0) {
    throw new Error(
      `new price must be a positive safe integer, received ${newPrice} from previous=${previousCents} delta=${delta}`,
    )
  }
  return { delta, capped, newPrice }
}

/** 1000 × 100 cents × the equal-weight average of (price / start price). */
export function indexQuoteCents(defs: MarketDefinitions, assets: MarketState['assets']): number {
  let ratioSum = 0
  let count = 0
  for (const def of defs.assets) {
    if (def.kind !== 'stock') continue
    ratioSum += assets[def.id].priceCents / def.startPriceCents
    count += 1
  }
  if (count < 1) throw new Error('index quote needs at least one stock')
  return INDEX_LEVEL_SCALE * CENTS_PER_UNIT * (ratioSum / count)
}

/** Day 0. Start prices, fair value at the start price, four streams. Days 1–3 are rolled into the log. */
export function createMarket(defs: MarketDefinitions, seed: string): MarketState {
  assertDefinitions(defs)
  const streams = createRng(seed)
  const stocks = new Map<string, AssetState>()
  for (const def of defs.assets) {
    if (def.kind !== 'stock') continue
    stocks.set(def.id, {
      id: def.id,
      priceCents: def.startPriceCents,
      fairValue: def.startPriceCents,
    })
  }
  const quoted: Record<string, AssetState> = {}
  for (const [id, asset] of stocks) quoted[id] = asset
  const opening = indexQuoteCents(defs, quoted)
  if (opening !== INDEX_PAR_CENTS) {
    throw new Error(`opening index quote must be ${INDEX_PAR_CENTS} cents, received ${opening}`)
  }
  const assets: Record<string, AssetState> = {}
  for (const def of defs.assets) {
    if (def.kind === 'stock') {
      const asset = stocks.get(def.id)
      if (asset === undefined) throw new Error(`missing stock ${def.id} while building the market`)
      assets[def.id] = asset
      continue
    }
    assets[def.id] = {
      id: def.id,
      priceCents: def.startPriceCents,
      fairValue: opening,
    }
  }
  const state: MarketState = {
    day: 0,
    streams,
    assets,
    environment: initialEnvironment(defs.environment),
    calendarRules: calendarRulesFrom(defs),
    calendarRolls: [],
    scheduled: [],
    active: [],
    log: [],
    feed: { day: 1, items: [] },
  }
  const participants = createParticipants(defs, seed)
  if (participants !== undefined) state.participants = participants
  // The traders model needs the participants' depth and feed state; without them there is no book.
  if (participants !== undefined && defs.traders !== undefined) participants.book = createTraderBook(defs, seed, state)
  // Days 1–3 are rolled now, at the starting environment, before any drift.
  // The standard calendar starts on day 10, so this loop draws no calendar float.
  for (let eventDay = 1; eventDay <= EVENT_LOOKAHEAD_DAYS; eventDay += 1) {
    const rolled = rollEventsForDay(defs, state.environment, state.streams.events, 0, eventDay)
    for (const event of rolled.scheduled) state.scheduled.push(event)
    for (const event of rolled.log) state.log.push(event)
    assignLeaks(state, defs, rolled.scheduled)
    rollCalendarForDay(state, defs, eventDay)
  }
  // Nothing has fired yet, so the day-1 feed is rumours only.
  publishFeed(state, defs, [])
  return state
}

/**
 * Tag calendar slices after they share the ordinary effect clip.
 * The effect id is `calendar:<item>:<day>`. Fair-value lines for those assets get the same item.
 */
function tagCalendarEffects(events: Array<EffectAppliedEvent | FairValueChangeEvent>): void {
  const kindByAsset = new Map<string, string>()
  for (const event of events) {
    if (event.kind !== 'effectApplied') continue
    const parts = event.effect.split(':')
    if (parts[0] !== 'calendar' || parts.length !== 3) continue
    const kind = parts[1]
    if (kind === undefined || kind.length === 0) {
      throw new Error(`calendar effect id must be calendar:item:day, received ${event.effect}`)
    }
    event.calendar = kind
    kindByAsset.set(event.asset, kind)
  }
  for (const event of events) {
    if (event.kind !== 'fairValueChange') continue
    const kind = kindByAsset.get(event.asset)
    if (kind !== undefined) event.calendar = kind
  }
}

/**
 * One stock's price step under the traders model (price-model plan, Step P2). Value traders pull
 * toward the lagged anchor, noise traders add an AR(1) wobble from the stock's one normal, the
 * player's order flow adds its demand, and market makers thin the depth when the stock has been
 * volatile. The raw move goes through the same cent rounding and 8% cap as the current model; the
 * share that filled scales the positions, so an unfilled part is still wanted tomorrow.
 */
function priceWithTraders(
  state: MarketState,
  defs: MarketDefinitions,
  def: AssetDefinition,
  z: number,
  playerCents: number,
  traderDay: TraderDay,
): void {
  const day = state.day
  const asset = state.assets[def.id]
  const plan = planTraderStock(state, defs, def, z, playerCents, traderDay)
  const { previous, rawMove } = plan
  const applied = applyCappedMove(previous, rawMove)
  const fillScale = applied.capped && rawMove !== 0 ? applied.delta / rawMove : 1
  const parts: ParticipantFlowEvent[] = []
  for (const party of ['value', 'noise', 'informed', 'news', 'consensus', 'crowd', 'trend', 'contrarian'] as const) {
    const dq = plan.dq[party]
    if (dq === 0) continue
    const events =
      party === 'crowd'
        ? [...plan.crowdEvents]
        : [...new Set(plan.trades.filter((trade) => trade.type === party).map((trade) => trade.key.split('|')[0]))]
    parts.push({
      kind: 'participantFlow',
      day,
      asset: def.id,
      party,
      demandCents: dq * plan.depthCents,
      depthCents: plan.depthCents,
      moveCents: dq * previous,
      events,
    })
  }
  const playerMove = plan.playerDq * previous
  if (plan.playerDq !== 0) {
    parts.push({
      kind: 'participantFlow',
      day,
      asset: def.id,
      party: 'player',
      demandCents: playerCents,
      depthCents: plan.depthCents,
      moveCents: playerMove,
      events: [],
    })
  }
  const noiseEvent: NoiseRollEvent = { kind: 'noiseRoll', day, asset: def.id, z }
  const priceEvent: PriceStepEvent = {
    kind: 'priceStep',
    day,
    asset: def.id,
    previous,
    fair: asset.fairValue,
    anchor: plan.anchor,
    pull: plan.dq.value * previous,
    noise: plan.dq.noise * previous,
    ...(plan.playerDq === 0 ? {} : { flow: playerMove }),
    ...(plan.depthScale < 1 ? { depthScale: plan.depthScale } : {}),
    ...(applied.capped ? { fillScale } : {}),
    rawMove,
    cappedMove: applied.delta,
    capped: applied.capped,
    newPrice: applied.newPrice,
    gapAfter: plan.anchor - applied.newPrice,
  }
  state.log.push(noiseEvent)
  for (const item of parts) state.log.push(item)
  state.log.push(priceEvent)
  commitTraderStock(state, defs, def, plan, fillScale, applied.newPrice)
  asset.priceCents = applied.newPrice
}

/**
 * Advance one day, in this step's end-of-day order:
 * apply calendar outcome and event effects to fair value, step prices, drift the environment,
 * pre-roll day+3, then generate the next day's feed on the info stream.
 * The feed is generated after the pre-roll so a rumour can name a scheduled event 1 to 3 days ahead.
 * Each stock, in definition order:
 * pull = 35% of (fair value − price), noise = z × daily volatility × price,
 * raw move = pull + noise, then the 8% cent cap above.
 * The index is then 1000 × the equal-weight average of (price / start price), in cents, with the same cap.
 * The market stream is one `nextNormal` per stock, in definition order, and nothing else.
 * Drift, ordinary event rolls, and calendar outcomes read only the events stream.
 * A calendar float, when day+3 is a calendar date, is drawn after that day's ordinary event rolls.
 * Rumours read only the info stream, after that pre-roll. Headlines do not draw.
 */
export function stepMarketDay(
  state: MarketState,
  defs: MarketDefinitions,
  orderFlow?: Readonly<Record<string, number>>,
): MarketState {
  assertDefinitions(defs)
  assertState(state, defs)
  if (state.day >= Number.MAX_SAFE_INTEGER) {
    throw new Error(`market day cannot advance past ${Number.MAX_SAFE_INTEGER}`)
  }
  state.day += 1
  state.log = []
  const day = state.day
  // Read before the due events leave `scheduled`: the information traders need them (traders model only).
  const dueToday = state.scheduled.filter((event) => event.eventDay === day)
  const calendarEvents = beginCalendarDay(state, defs)
  for (const event of calendarEvents) state.log.push(event)
  const fired = firedHeadlines(state, defs, calendarEvents)
  const effects = applyDueEffects(state, defs)
  tagCalendarEffects(effects)
  for (const event of effects) state.log.push(event)
  const inPlay = new Set<string>()
  for (const event of effects) if (event.kind === 'effectApplied') inPlay.add(event.asset)
  const partyDay = startPartyDay(state, defs)
  const tradersOn = traderModelOn(state, defs)
  const traderDay = tradersOn ? startTraderDay(state, defs, dueToday, calendarEvents) : undefined

  for (const def of defs.assets) {
    if (def.kind !== 'stock') continue
    const asset = state.assets[def.id]
    const z = nextNormal(state.streams.market)
    if (traderDay !== undefined) {
      priceWithTraders(state, defs, def, z, orderFlow?.[def.id] ?? 0, traderDay)
      continue
    }
    const previous = asset.priceCents
    const fair = asset.fairValue
    const pull = ((fair - previous) * FAIR_VALUE_PULL_NUMERATOR) / FAIR_VALUE_PULL_DENOMINATOR
    const noise = z * def.dailyVolatility * previous
    const flows = [
      informedFlow(state, defs, def),
      newsFlow(state, defs, def, inPlay),
      crowdFlow(state, defs, def, partyDay),
      momentumFlow(state, defs, def),
      consensusFlow(state, defs, def),
      orderFlowMove(state, defs, def, orderFlow?.[def.id] ?? 0),
    ].filter(
      (item): item is ParticipantFlowEvent => item !== null,
    )
    const flowMove = flows.reduce((sum, item) => sum + item.moveCents, 0)
    const rawMove = flows.length === 0 ? pull + noise : pull + noise + flowMove
    const applied = applyCappedMove(previous, rawMove)
    const noiseEvent: NoiseRollEvent = { kind: 'noiseRoll', day, asset: def.id, z }
    const priceEvent: PriceStepEvent = {
      kind: 'priceStep',
      day,
      asset: def.id,
      previous,
      fair,
      pull,
      noise,
      ...(flows.length === 0 ? {} : { flow: flowMove }),
      rawMove,
      cappedMove: applied.delta,
      capped: applied.capped,
      newPrice: applied.newPrice,
      gapAfter: fair - applied.newPrice,
    }
    state.log.push(noiseEvent)
    for (const item of flows) state.log.push(item)
    state.log.push(priceEvent)
    asset.priceCents = applied.newPrice
  }

  let indexId: string | undefined
  for (const def of defs.assets) {
    if (def.kind === 'index') indexId = def.id
  }
  if (indexId === undefined) throw new Error('market definitions need exactly one index, received 0')
  const index = state.assets[indexId]
  const previous = index.priceCents
  const quote = indexQuoteCents(defs, state.assets)
  const rawMove = quote - previous
  const applied = applyCappedMove(previous, rawMove)
  const indexEvent: IndexStepEvent = {
    kind: 'indexStep',
    day,
    asset: indexId,
    previous,
    quote,
    rawMove,
    cappedMove: applied.delta,
    capped: applied.capped,
    newPrice: applied.newPrice,
    gapAfter: quote - applied.newPrice,
  }
  state.log.push(indexEvent)
  index.priceCents = applied.newPrice
  index.fairValue = quote

  for (const event of driftEnvironment(state, defs.environment)) state.log.push(event)
  const rolled = rollEventsForDay(
    defs,
    state.environment,
    state.streams.events,
    day,
    day + EVENT_LOOKAHEAD_DAYS,
  )
  for (const event of rolled.scheduled) state.scheduled.push(event)
  for (const event of rolled.log) state.log.push(event)
  assignLeaks(state, defs, rolled.scheduled)
  rollCalendarForDay(state, defs, day + EVENT_LOOKAHEAD_DAYS)
  publishFeed(state, defs, fired)
  return state
}

function calendarHeadline(item: CalendarItemEvent): string {
  return calendarHeadlineText(item.item, item.outcome, item.expected)
}

/** Largest absolute sector effect for this outcome, in percent of fair value. The summary does not see this number's source. */
function calendarMagnitude(defs: MarketDefinitions, item: CalendarItemEvent): number {
  const effects = defs.calendar?.effects ?? []
  let magnitude = 0
  for (const cell of effects) {
    if (cell.kind !== item.item || cell.outcome !== item.outcome) continue
    if (typeof cell.percent !== 'number' || !Number.isFinite(cell.percent)) {
      throw new Error(`calendar effect percent must be a finite number, received ${describeValue(cell.percent)}`)
    }
    const size = Math.abs(cell.percent)
    if (size > magnitude) magnitude = size
  }
  return magnitude
}

/**
 * Ordinary events due today, then today's calendar outcomes.
 * Direction `none` is not scheduled, so it does not get a headline.
 */
function firedHeadlines(
  state: MarketState,
  defs: MarketDefinitions,
  calendarEvents: readonly CalendarItemEvent[],
): FiredHeadline[] {
  const fired: FiredHeadline[] = []
  for (const event of state.scheduled) {
    if (event.eventDay !== state.day) continue
    fired.push({
      eventId: event.id,
      text: event.headline,
      magnitude: event.magnitudePercent,
      direction: event.direction,
    })
  }
  for (const item of calendarEvents) {
    fired.push({
      eventId: `calendar:${item.item}:${item.day}`,
      text: calendarHeadline(item),
      magnitude: calendarMagnitude(defs, item),
    })
  }
  return fired
}
