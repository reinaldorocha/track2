export type MetaInsight = { dateStart: Date; spend: number; impressions: number; clicks: number; conversions: number; actions: string | null }

export const day = (instant: Date, timezone: string) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant)
export const chosenDay = (value: string | null, timezone: string, fallback: Date) => value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : day(value && !Number.isNaN(Date.parse(value)) ? new Date(value) : fallback, timezone)
export const nextDay = (value: string) => new Date(Date.parse(value + 'T00:00:00Z') + 86400000).toISOString().slice(0, 10)

export function extractDateStr(value: string | null | undefined, timezone: string): string | null {
  if (!value) return null
  const str = String(value).trim()
  if (!str) return null

  // 1. Direct YYYY-MM-DD or starting with YYYY-MM-DD (ex: "2026-09-30", "2026-09-30T00:00:00.000Z")
  const isoDateMatch = str.match(/^(\d{4}-\d{2}-\d{2})/)
  if (isoDateMatch) {
    if (str.includes('T') && !Number.isNaN(Date.parse(str))) {
      // Se for exatamente meia-noite UTC (ex: 2026-09-30T00:00:00), foi serializado com foco no dia do calendário
      if (str.includes('T00:00:00')) {
        return isoDateMatch[1]
      }
      return day(new Date(str), timezone)
    }
    return isoDateMatch[1]
  }

  // 2. Brazilian format: DD/MM/YYYY or DD-MM-YYYY (ex: "30/09/2026" or "30-09-2026")
  const brMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/)
  if (brMatch) {
    const [, d, m, y] = brMatch
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`
  }

  // 3. Any other parseable date
  const parsed = Date.parse(str)
  if (!Number.isNaN(parsed)) {
    return day(new Date(parsed), timezone)
  }

  return null
}

export function resolveRange(preset: string | null, timezone: string, fromValue: string | null, toValue: string | null, now = new Date()): { from: string; to: string } {
  const label = (preset || '').toLowerCase().trim()
  const today = day(now, timezone)
  const shift = (value: string, days: number) => new Date(Date.parse(value + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10)

  // 1. PRIORIDADE MÁXIMA: Período Personalizado / Customizado
  // Se preset começar com "personalizado" ou "custom", ou se fromValue/toValue forem fornecidos explicitamente
  const isCustomPreset = label.startsWith('personalizado') || label.startsWith('custom') || label === 'custom_range'
  
  if (isCustomPreset || (!preset && (fromValue || toValue))) {
    let from = extractDateStr(fromValue, timezone)
    let to = extractDateStr(toValue, timezone)

    // Se não veio em fromValue/toValue, tenta extrair da própria string do preset (ex: "Personalizado: 2026-09-30 - 2026-09-30" ou "Personalizado: 30/09/2026 a 30/09/2026")
    if (!from || !to) {
      const isoMatches = label.match(/\d{4}-\d{2}-\d{2}/g)
      if (isoMatches && isoMatches.length >= 2) {
        from = from || isoMatches[0]
        to = to || isoMatches[1]
      } else if (isoMatches && isoMatches.length === 1) {
        from = from || isoMatches[0]
        to = to || isoMatches[0]
      } else {
        const brMatches = label.match(/\d{1,2}[\/\-]\d{1,2}[\/\-]\d{4}/g)
        if (brMatches && brMatches.length >= 2) {
          from = from || extractDateStr(brMatches[0], timezone)
          to = to || extractDateStr(brMatches[1], timezone)
        } else if (brMatches && brMatches.length === 1) {
          from = from || extractDateStr(brMatches[0], timezone)
          to = to || extractDateStr(brMatches[0], timezone)
        }
      }
    }

    if (from && to) {
      if (from > to) {
        const temp = from
        from = to
        to = temp
      }
      return { from, to }
    }
    if (from && !to) return { from, to: from }
    if (!from && to) return { from: to, to }
  }

  // 2. Presets fixos
  if (label === 'hoje' || label === 'today') return { from: today, to: today }
  if (label === 'ontem' || label === 'yesterday') return { from: shift(today, -1), to: shift(today, -1) }

  // Presets relativos de contagem de dias: SOMENTE palavras-chave específicas (NUNCA substring de número isolado)
  const daysPresets: Array<{ days: number; patterns: string[] }> = [
    { days: 7, patterns: ['últimos 7 dias', 'ultimos 7 dias', 'last 7 days', 'last7days', '7d', '7 dias'] },
    { days: 15, patterns: ['últimos 15 dias', 'ultimos 15 dias', 'last 15 days', 'last15days', '15d', '15 dias'] },
    { days: 30, patterns: ['últimos 30 dias', 'ultimos 30 dias', 'last 30 days', 'last30days', '30d', '30 dias'] },
    { days: 60, patterns: ['últimos 60 dias', 'ultimos 60 dias', 'last 60 days', 'last60days', '60d', '60 dias'] },
    { days: 90, patterns: ['últimos 90 dias', 'ultimos 90 dias', 'last 90 days', 'last90days', '90d', '90 dias'] },
  ]

  for (const p of daysPresets) {
    if (p.patterns.some(pattern => label === pattern || label.startsWith(pattern) || label.endsWith(pattern))) {
      return { from: shift(today, 1 - p.days), to: today }
    }
  }

  if (label.includes('este m') || label === 'thismonth' || label === 'this_month') {
    return { from: `${today.slice(0, 7)}-01`, to: today }
  }

  if (label.includes('anterior') || label === 'lastmonth' || label === 'last_month') {
    const firstThisMonth = `${today.slice(0, 7)}-01`
    const lastPreviousMonth = shift(firstThisMonth, -1)
    return { from: `${lastPreviousMonth.slice(0, 7)}-01`, to: lastPreviousMonth }
  }

  if (label.includes('todo') || label === 'all' || label === 'todas') {
    return { from: '2020-01-01', to: today }
  }

  const fallbackFrom = extractDateStr(fromValue, timezone) || shift(today, -29)
  const fallbackTo = extractDateStr(toValue, timezone) || today
  return { from: fallbackFrom, to: fallbackTo }
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

export function parseMetaFunnelActions(actionsJson: string | null | undefined | Array<{ action_type: string; value: string }>): {
  pageViews: number
  initiateCheckouts: number
  leads: number
} {
  if (!actionsJson) return { pageViews: 0, initiateCheckouts: 0, leads: 0 }

  let actions: Array<{ action_type: string; value: string }> = []
  try {
    actions = typeof actionsJson === 'string' ? JSON.parse(actionsJson) : actionsJson
  } catch {
    return { pageViews: 0, initiateCheckouts: 0, leads: 0 }
  }
  if (!Array.isArray(actions)) return { pageViews: 0, initiateCheckouts: 0, leads: 0 }

  // 1. Landing Page Views (Vis. Página)
  // Ordem canônica de prioridade da Meta. NUNCA somar múltiplos tipos do mesmo evento!
  // 'landing_page_view' é a métrica oficial pós-clique. Se ausente, busca view_content/pageview.
  const pvAction =
    actions.find(a => a.action_type === 'landing_page_view') ||
    actions.find(a => a.action_type === 'offsite_conversion.fb_pixel_view_content') ||
    actions.find(a => a.action_type === 'view_content') ||
    actions.find(a => a.action_type === 'omni_view_content') ||
    actions.find(a => a.action_type === 'pageview')

  // 2. Initiate Checkouts (ICs / Finalizações de Compra Iniciadas)
  // Ordem canônica de prioridade da Meta. NUNCA somar!
  const icAction =
    actions.find(a => a.action_type === 'offsite_conversion.fb_pixel_initiate_checkout') ||
    actions.find(a => a.action_type === 'initiate_checkout') ||
    actions.find(a => a.action_type === 'omni_initiated_checkout') ||
    actions.find(a => a.action_type?.endsWith('_initiate_checkout')) ||
    actions.find(a => a.action_type?.includes('initiate_checkout'))

  // 3. Leads (Cadastros)
  const leadAction =
    actions.find(a => a.action_type === 'offsite_conversion.fb_pixel_lead') ||
    actions.find(a => a.action_type === 'lead') ||
    actions.find(a => a.action_type === 'omni_lead') ||
    actions.find(a => a.action_type?.includes('lead'))

  return {
    pageViews: pvAction ? parseInt(pvAction.value, 10) || 0 : 0,
    initiateCheckouts: icAction ? parseInt(icAction.value, 10) || 0 : 0,
    leads: leadAction ? parseInt(leadAction.value, 10) || 0 : 0,
  }
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
