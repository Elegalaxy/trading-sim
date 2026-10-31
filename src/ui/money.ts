// Player-facing money. The simulation stores integer cents. $1 = 100 cents.

const CENTS_PER_DOLLAR = 100

function assertCents(cents: number, label: string): void {
  if (!Number.isSafeInteger(cents)) {
    throw new Error(`${label} must be a safe integer, received ${String(cents)}`)
  }
}

function groupDigits(value: number): string {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** `$1,234.50`. Negative balances keep the minus sign in front of the dollar sign. */
export function formatUsd(cents: number, label: string): string {
  assertCents(cents, label)
  const sign = cents < 0 ? '-' : ''
  const abs = Math.abs(cents)
  const dollars = Math.trunc(abs / CENTS_PER_DOLLAR)
  const frac = abs % CENTS_PER_DOLLAR
  return `${sign}$${groupDigits(dollars)}.${String(frac).padStart(2, '0')}`
}

/** `+$1.00` or `-$1.00`. Zero is `$0.00`. */
export function formatSignedUsd(cents: number, label: string): string {
  assertCents(cents, label)
  if (cents > 0) return `+${formatUsd(cents, label)}`
  return formatUsd(cents, label)
}

export type ParsedUsd = { ok: true; cents: number } | { ok: false; reason: string }

/**
 * Dollars typed by the player, such as `10`, `10.5`, or `$1,000.00`.
 * More than two decimal places is rejected. Zero is rejected.
 */
export function parseUsdToCents(raw: string, label: string): ParsedUsd {
  if (typeof raw !== 'string') return { ok: false, reason: `${label} must be a dollar amount.` }
  if (label.length === 0 || /[\r\n]/.test(label)) {
    throw new Error(`dollar label must be a single line, received ${JSON.stringify(label)}`)
  }
  const text = raw.trim().replaceAll('$', '').replaceAll(',', '').replaceAll(' ', '')
  if (text.length === 0) return { ok: false, reason: `${label} is empty.` }
  if (text.startsWith('-')) return { ok: false, reason: `${label} must be more than $0.00.` }
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(text)
  if (match === null) return { ok: false, reason: `${label} must be dollars and cents, like 10.50.` }
  const dollarsText = match[1]
  const fracText = match[2] ?? ''
  if (dollarsText === undefined) return { ok: false, reason: `${label} must be dollars and cents, like 10.50.` }
  if (dollarsText.length > 1 && dollarsText.startsWith('0')) {
    return { ok: false, reason: `${label} must be dollars and cents, like 10.50.` }
  }
  const dollars = Number(dollarsText)
  if (!Number.isSafeInteger(dollars)) return { ok: false, reason: `${label} is too large.` }
  const frac = fracText.length === 0 ? 0 : Number(fracText.padEnd(2, '0'))
  if (!Number.isSafeInteger(frac) || frac < 0 || frac > 99) {
    return { ok: false, reason: `${label} must be dollars and cents, like 10.50.` }
  }
  const cents = dollars * CENTS_PER_DOLLAR + frac
  if (!Number.isSafeInteger(cents) || cents <= 0) return { ok: false, reason: `${label} is too large.` }
  return { ok: true, cents }
}
