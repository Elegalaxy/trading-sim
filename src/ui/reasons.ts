// Plain-language text for a rejected command, shared by the order and position panels.

import { MAX_EXIT_LEVELS } from '../sim/resting.ts'

export function reasonText(reason: string): string {
  switch (reason) {
    case 'insufficientBuyingPower':
      return 'too little buying power'
    case 'insufficientTradingCash':
      return 'too little trading cash'
    case 'marketClosed':
      return 'the market is not open'
    case 'limitNotBelowMarket':
      return 'a buy limit must be below the market price'
    case 'limitNotAboveMarket':
      return 'a sell limit must be above the market price'
    case 'takeProfitWrongSide':
      return 'take profit must be on the profit side of the price'
    case 'stopLossWrongSide':
      return 'stop loss must be on the loss side of the price'
    case 'tooManyOrders':
      return 'too many open orders'
    case 'tooManyExits':
      return `a position holds at most ${MAX_EXIT_LEVELS} take profit and ${MAX_EXIT_LEVELS} stop loss levels`
    case 'exitQuantityTooLarge':
      return 'an exit cannot close more shares than the position holds'
    case 'noSuchExit':
      return 'that exit is no longer open'
    case 'noPosition':
      return 'there is no open position'
    case 'nothingToChange':
      return 'nothing changed'
    default:
      return reason
  }
}
