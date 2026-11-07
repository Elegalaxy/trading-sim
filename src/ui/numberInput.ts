// Keystroke filters for number-only text fields (money and share counts). The fields stay
// text inputs so an empty box and a half-typed "12." are allowed, but letters and symbols
// never get in. Pasted thousands commas are dropped. Dollar fields keep at most 2 decimals
// because the sim stores whole cents.

/** Digits only: a share count. */
export function wholeNumberText(value: string): string {
  return value.replace(/\D/g, '')
}

/** Digits and one dot, at most `decimals` places after it: a dollar amount or price. */
export function moneyText(value: string, decimals = 2): string {
  const kept = value.replace(/[^\d.]/g, '')
  const dot = kept.indexOf('.')
  if (dot === -1) return kept
  const whole = kept.slice(0, dot)
  const fraction = kept.slice(dot + 1).replace(/\./g, '').slice(0, decimals)
  return `${whole}.${fraction}`
}
