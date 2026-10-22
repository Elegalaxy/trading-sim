export function debugLog(tag: string, ...data: unknown[]): void {
  if (import.meta.env.DEV) {
    console.debug(tag, ...data)
  }
}
