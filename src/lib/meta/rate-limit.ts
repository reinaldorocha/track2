export const META_RATE_LIMIT_COOLDOWN_MS = 60 * 60 * 1000

const RATE_LIMIT_PATTERN = /User request limit reached|rate.?limit|limite de requisições/i

export function isMetaRateLimitMessage(message: string | null | undefined): boolean {
  return Boolean(message && RATE_LIMIT_PATTERN.test(message))
}

export function summarizeMetaSyncError(message: string | null | undefined): string | null {
  if (!message) return null
  if (isMetaRateLimitMessage(message)) return 'Limite de requisições da Meta atingido. A coleta foi interrompida e será retomada após o intervalo de espera.'
  return message.length > 300 ? `${message.slice(0, 300)}…` : message
}

export function metaCooldownRemaining(startedAt: Date, message: string | null | undefined, now = new Date()): number {
  if (!isMetaRateLimitMessage(message)) return 0
  return Math.max(0, startedAt.getTime() + META_RATE_LIMIT_COOLDOWN_MS - now.getTime())
}
