export type MetaInsight = { dateStart: Date; spend: number; impressions: number; clicks: number; conversions: number; actions: string | null }

export const day = (instant: Date, timezone: string) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant)
export const chosenDay = (value: string | null, timezone: string, fallback: Date) => value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : day(value && !Number.isNaN(Date.parse(value)) ? new Date(value) : fallback, timezone)
export const nextDay = (value: string) => new Date(Date.parse(value + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10)

export function resolveRange(preset: string | null, timezone: string, fromValue: string | null, toValue: string | null, now = new Date()): { from: string; to: string } {
  const label = (preset || '').toLowerCase()
  const today = day(now, timezone)
  const shift = (value: string, days: number) => new Date(Date.parse(value + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10)
  if (label === 'hoje' || label === 'today') return { from: today, to: today }
  if (label === 'ontem' || label === 'yesterday') return { from: shift(today, -1), to: shift(today, -1) }
  for (const count of [7, 15, 30, 60, 90]) {
    if (label.includes(String(count)) || label === `last${count}days`) return { from: shift(today, 1 - count), to: today }
  }
  if (label.includes('este m') || label === 'thismonth') return { from: `${today.slice(0, 7)}-01`, to: today }
  if (label.includes('anterior') || label === 'lastmonth') {
    const firstThisMonth = `${today.slice(0, 7)}-01`
    const lastPreviousMonth = shift(firstThisMonth, -1)
    return { from: `${lastPreviousMonth.slice(0, 7)}-01`, to: lastPreviousMonth }
  }
  return { from: chosenDay(fromValue, timezone, new Date(now.getTime() - 29 * 86400000)), to: chosenDay(toValue, timezone, now) }
}

export function midnight(value: string, timezone: string): Date {
  const target = Date.parse(value + 'T00:00:00Z')
  let instant = target
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(instant))
    const n = (type: string) => Number(parts.find(part => part.type === type)?.value)
    instant += target - Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'))
  }
  return new Date(instant)
}

export function measure(insights: MetaInsight[]) {
  if (!insights.length) return { spend: null, impressions: null, clicks: null, metaPurchases: null, ic: null }
  let ic = 0
  let foundIc = false
  for (const insight of insights) {
    if (!insight.actions) continue
    try {
      const actions = JSON.parse(insight.actions) as Array<{ action_type: string; value: string }>
      const action = actions.find(a => ['offsite_conversion.fb_pixel_initiate_checkout', 'initiate_checkout', 'omni_initiated_checkout'].includes(a.action_type))
      if (action) { foundIc = true; ic += Number(action.value) || 0 }
    } catch { /* dado inválido permanece ausente */ }
  }
  return { spend: insights.reduce((n, i) => n + i.spend, 0), impressions: insights.reduce((n, i) => n + i.impressions, 0), clicks: insights.reduce((n, i) => n + i.clicks, 0), metaPurchases: insights.reduce((n, i) => n + i.conversions, 0), ic: foundIc ? ic : null }
}

type AttributableSale = {
  id: string; orderedAt: Date; approvedAt: Date | null;
  utmCampaign: string | null; utmTerm: string | null; utmContent: string | null;
  attributionRecord: { campaignId: string | null; adSetId: string | null; adId: string | null; adAccountId: string | null; utmCampaign: string | null } | null;
}
type AttributionRow = { id: string; externalId: string; name: string; accountId: string }

export function assignSales<S extends AttributableSale, R extends AttributionRow>(
  sales: S[], rows: R[], level: 'campaign' | 'adset' | 'ad', ranges: Map<string, { saleFrom: Date; saleTo: Date }>
): { assigned: Map<string, S[]>; unassigned: number } {
  const assigned = new Map<string, S[]>()
  let unassigned = 0
  for (const sale of sales) {
    const attr = sale.attributionRecord
    const id = level === 'campaign' ? attr?.campaignId : level === 'adset' ? attr?.adSetId : attr?.adId
    let matches = rows.filter(row => {
      const range = ranges.get(row.accountId)
      const soldAt = sale.approvedAt ?? sale.orderedAt
      return range && soldAt >= range.saleFrom && soldAt < range.saleTo && (!attr?.adAccountId || attr.adAccountId === row.accountId)
    })
    if (id) matches = matches.filter(row => row.id === id || row.externalId === id)
    else {
      const utm = level === 'ad' ? sale.utmContent : level === 'adset' ? sale.utmTerm : sale.utmCampaign || attr?.utmCampaign
      matches = utm ? matches.filter(row => row.name.toLowerCase().trim() === utm.toLowerCase().trim() || row.externalId === utm.trim()) : []
    }
    if (matches.length === 1) assigned.set(matches[0].id, [...(assigned.get(matches[0].id) || []), sale])
    else unassigned++
  }
  return { assigned, unassigned }
}

export function hasCompleteCoverage(from: string, to: string, latestStatus: string | undefined, spans: Array<{ since: string; until: string }>): boolean {
  if (latestStatus !== 'success') return false
  let coveredUntil = from
  for (const span of [...spans].sort((a, b) => a.since.localeCompare(b.since))) {
    if (span.since > coveredUntil) break
    if (span.until >= coveredUntil) coveredUntil = nextDay(span.until)
    if (coveredUntil > to) return true
  }
  return false
}

export function resolveAnalyticsInterval(
  preset: string | null,
  timezone = 'America/Sao_Paulo',
  fromStr?: string | null,
  toStr?: string | null,
  now = new Date()
) {
  const { from: startDayStr, to: endDayStr } = resolveRange(preset, timezone, fromStr || null, toStr || null, now)

  const saleFrom = midnight(startDayStr, timezone)
  const saleTo = midnight(nextDay(endDayStr), timezone)

  const insightDateStart = new Date(`${startDayStr}T00:00:00.000Z`)
  const insightDateStop = new Date(`${endDayStr}T23:59:59.999Z`)

  return {
    startDayStr,
    endDayStr,
    saleFrom,
    saleTo,
    insightDateStart,
    insightDateStop,
    timezone
  }
}
