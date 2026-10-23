// Provisional display-only posts for biased news (GAME_DESIGN section 9).
// `{asset}` is replaced with the open position. These are never market events.
// The sim labels every post as a low-reliability source.

import type { SocialPostDefinition } from '../sim/types.ts'

export const SOCIAL_POST_SOURCE_ID = 'streetFeed'

export const SOCIAL_POST_DEFINITIONS: readonly SocialPostDefinition[] = [
  {
    id: 'runItUp',
    sourceId: SOCIAL_POST_SOURCE_ID,
    direction: 'up',
    text: '{asset} is going up. Everyone on here is buying.',
  },
  {
    id: 'cantLose',
    sourceId: SOCIAL_POST_SOURCE_ID,
    direction: 'up',
    text: 'Still long {asset}. The timeline says it only goes up.',
  },
  {
    id: 'getOut',
    sourceId: SOCIAL_POST_SOURCE_ID,
    direction: 'down',
    text: '{asset} is going down. I am short and staying short.',
  },
  {
    id: 'dumpIt',
    sourceId: SOCIAL_POST_SOURCE_ID,
    direction: 'down',
    text: 'Dump {asset}. The posts all say it is going down.',
  },
]
