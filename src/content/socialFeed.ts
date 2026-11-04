// The always-on social feed (plan market depth, Step M10). Provisional placeholders.
// A post comes from a persona. `calm` is the plain wording; `loaded` is the same post turned
// up, which stress can swap in for a post that agrees with what the player holds. Posts are
// retail chatter, never news and never a market event.
// `{asset}` is the stock the post is about.

import type { SocialDefinitions } from '../sim/types.ts'

export const SOCIAL_DEFINITIONS: SocialDefinitions = {
  personas: [
    {
      id: 'hype',
      mood: 'up',
      calm: ['{asset} is looking strong today.', 'Adding to {asset}. The chart looks good.', 'Hearing good things about {asset}.'],
      loaded: ['{asset} is going to the moon. Buy now or cry later.', 'Everyone is loading {asset}. This is the one.', 'You will regret not buying {asset} today.'],
    },
    {
      id: 'doom',
      mood: 'down',
      calm: ['{asset} looks weak to me.', 'Trimming {asset}. Not liking this chart.', 'Hearing some worries about {asset}.'],
      loaded: ['{asset} is about to crash. Get out while you can.', 'Everyone is dumping {asset}. It is over.', 'You will lose everything holding {asset}.'],
    },
    {
      id: 'bagHolder',
      mood: 'down',
      calm: ['Still holding {asset} and it is not great.', 'Down on {asset} again.'],
      loaded: ['Held {asset} all the way down. Never selling. Never.', 'My {asset} is a disaster and I cannot look.'],
    },
    {
      id: 'joker',
      mood: 'any',
      calm: ['Another day, another {asset} chart.', 'Who is trading {asset} today?'],
      loaded: ['{asset} to the moon or to zero, nothing in between.', 'Flipping a coin on {asset}. Heads I am a genius.'],
    },
    {
      id: 'insider',
      mood: 'any',
      calm: ['Someone told me something is coming for {asset}.', 'Quiet word on {asset} going round.'],
      loaded: ['I know something about {asset}. Trust me.', 'My cousin works there. {asset} is about to move big.'],
    },
  ],
  moodPostChance: 0.7,
  moodThreshold: 0.05,
  whisperTrueChance: 0.12,
  whisperLeakBoost: 2,
  falseWhispersPerDay: 3,
  falseWhisperChance: 0.9,
  whisperCalm: 'Rumour going round that {asset} has news coming.',
  whisperLoaded: {
    up: 'Hearing {asset} has big good news coming. Get in before it is out.',
    down: 'Hearing {asset} has bad news coming. Run.',
  },
  chatterThresholdPercent: 0.6,
  maxChatterPerDay: 4,
  chatterCalm: {
    up: '{asset} is ripping, anyone know why?',
    down: '{asset} is dumping, anyone know why?',
  },
}
