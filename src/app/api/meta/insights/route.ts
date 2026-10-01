import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getUserWorkspaceId } from '@/lib/workspace'
import { day, chosenDay, nextDay, midnight, measure, assignSales, hasCompleteCoverage, type MetaInsight } from '@/lib/meta/insight-helpers'

type Row = { id: string; externalId: string; name: string; status: string; budget: number | null; accountId: string; accountName: string; currency: string; campaignId?: string; adSetId?: string; parentName?: string; campaignName?: string; previewUrl?: string | null; insights: MetaInsight[] }

export async function GET(req: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const workspaceId = await getUserWorkspaceId(session.user.id)
    if (!workspaceId) return NextResponse.json({ error: 'No workspace' }, { status: 404 })
    const params = new URL(req.url).searchParams
    const level = params.get('level') || 'campaign'
    if (!['campaign', 'adset', 'ad'].includes(level)) return NextResponse.json({ error: 'Nível inválido' }, { status: 400 })
    const accountId = params.get('adAccountId')
    const accounts = await prisma.adAccount.findMany({ where: { workspaceId, ...(accountId && accountId !== 'all' ? { id: accountId } : {}) } })
    if (!accounts.length) return NextResponse.json({ data: [], coverage: [] })
    const accountIds = accounts.map(a => a.id)
    const accountMap = new Map(accounts.map(a => [a.id, a]))
    const dates = new Map(accounts.map(a => {
      const preset = params.get('preset')?.toLowerCase() || ''
      const today = day(new Date(), a.timezone)
      const offset = preset === 'hoje' || preset === 'today' ? 0 : preset === 'ontem' || preset === 'yesterday' ? 1 : null
      const selected = offset === null ? null : new Date(Date.parse(today + 'T00:00:00Z') - offset * 86400000).toISOString().slice(0, 10)
      const from = selected || chosenDay(params.get('from'), a.timezone, new Date(Date.now() - 29 * 86400000))
      const to = selected || chosenDay(params.get('to'), a.timezone, new Date())
      return [a.id, { from, to, saleFrom: midnight(from, a.timezone), saleTo: midnight(nextDay(to), a.timezone) }] as const
    }))
    const ranges = [...dates.values()]
    const saleFrom = new Date(Math.min(...ranges.map(d => d.saleFrom.getTime())))
    const saleTo = new Date(Math.max(...ranges.map(d => d.saleTo.getTime())))
    const sales = await prisma.sale.findMany({ where: { workspaceId, status: 'approved', OR: [
      { approvedAt: { gte: saleFrom, lt: saleTo } },
      { approvedAt: null, orderedAt: { gte: saleFrom, lt: saleTo } },
    ] },
      select: { id: true, orderedAt: true, approvedAt: true, grossAmount: true, netAmount: true, currency: true, utmCampaign: true, utmTerm: true, utmContent: true,
        attributionRecord: { select: { campaignId: true, adSetId: true, adId: true, adAccountId: true, utmCampaign: true } } } })
    const insightDates = { dateStart: { gte: new Date(Math.min(...ranges.map(d => Date.parse(d.from + 'T00:00:00Z')))), lte: new Date(Math.max(...ranges.map(d => Date.parse(d.to + 'T00:00:00Z')))) } }
    const search = params.get('search')
    const name = search ? { name: { contains: search, mode: 'insensitive' as const } } : {}
    const campaignIds = params.getAll('campaignId')
    const adSetIds = params.getAll('adSetId')
    const rows: Row[] = []
    if (level === 'campaign') {
      const found = await prisma.campaign.findMany({ where: { workspaceId, adAccountId: { in: accountIds }, ...name }, include: { insights: { where: insightDates }, adAccount: true } })
      rows.push(...found.map(c => ({ id: c.id, externalId: c.externalId, name: c.name, status: c.status, budget: c.dailyBudget ?? c.lifetimeBudget, accountId: c.adAccountId, accountName: c.adAccount.name, currency: c.adAccount.currency, insights: c.insights })))
    } else if (level === 'adset') {
      const found = await prisma.adSet.findMany({ where: { workspaceId, campaign: { adAccountId: { in: accountIds } }, ...(campaignIds.length ? { campaignId: { in: campaignIds } } : {}), ...name }, include: { insights: { where: insightDates }, campaign: true } })
      rows.push(...found.map(as => { const a = accountMap.get(as.campaign.adAccountId)!; return { id: as.id, externalId: as.externalId, name: as.name, status: as.status, budget: as.dailyBudget ?? as.lifetimeBudget, accountId: a.id, accountName: a.name, currency: a.currency, campaignId: as.campaignId, parentName: as.campaign.name, insights: as.insights } }))
    } else {
      const found = await prisma.ad.findMany({ where: { workspaceId, adSet: { campaign: { adAccountId: { in: accountIds } }, ...(adSetIds.length ? { id: { in: adSetIds } } : {}), ...(campaignIds.length ? { campaignId: { in: campaignIds } } : {}) }, ...name }, include: { insights: { where: insightDates }, adSet: { include: { campaign: true } } } })
      rows.push(...found.map(ad => { const a = accountMap.get(ad.adSet.campaign.adAccountId)!; return { id: ad.id, externalId: ad.externalId, name: ad.name, status: ad.status, budget: null, accountId: a.id, accountName: a.name, currency: a.currency, campaignId: ad.adSet.campaignId, adSetId: ad.adSetId, parentName: ad.adSet.name, campaignName: ad.adSet.campaign.name, previewUrl: ad.previewUrl, insights: ad.insights } }))
    }
    const coverage = await Promise.all(accounts.map(async a => {
      const logs = await prisma.syncLog.findMany({ where: { workspaceId, adAccountId: a.id, type: 'meta_ads', status: { in: ['success', 'partial', 'failed'] }, startedAt: { gte: new Date(Date.now() - 3 * 86400000) } }, orderBy: { startedAt: 'desc' } })
      const range = dates.get(a.id)!
      const latest = logs[0]
      const spans = logs.filter(log => log.status === 'success' && log.details).flatMap(log => { try { const d = JSON.parse(log.details!); return [{ since: d.since as string, until: d.until as string }] } catch { return [] } })
      const complete = hasCompleteCoverage(range.from, range.to, latest?.status, spans)
      return { accountId: a.id, from: range.from, to: range.to, complete, lastSyncAt: a.lastSyncAt, error: logs[0]?.status === 'partial' || logs[0]?.status === 'failed' ? logs[0].errorMessage : null }
    }))
    const covered = new Map(coverage.map(c => [c.accountId, c.complete]))
    const attributionSpecs = await prisma.adSet.findMany({ where: { campaign: { adAccountId: { in: accountIds } } }, select: { id: true, campaignId: true, attributionSpec: true } })
    const eligible = rows.filter(row => {
      const range = dates.get(row.accountId)!
      row.insights = row.insights.filter(i => { const d = i.dateStart.toISOString().slice(0, 10); return d >= range.from && d <= range.to })
      const m = measure(row.insights)
      return (m.spend ?? 0) > 0 || (m.impressions ?? 0) > 0
    }).filter(row => !params.get('status') || params.get('status') === 'all' || row.status.toUpperCase() === params.get('status')?.toUpperCase())
    const { assigned, unassigned } = assignSales(sales, eligible, level as 'campaign' | 'adset' | 'ad', dates)
    const ratio = (value: number | null, divisor: number | null) => value !== null && divisor !== null && divisor > 0 ? value / divisor : null
    const data = eligible.map(row => {
      const m = measure(row.insights)
      const complete = covered.get(row.accountId) || false
      const matched = assigned.get(row.id) || []
      const sameCurrency = matched.every(s => s.currency.toUpperCase() === row.currency.toUpperCase())
      const revenue = sameCurrency ? matched.reduce((n, s) => n + s.grossAmount, 0) : null
      // O normalizador legado grava bruto como líquido quando o gateway omite o valor.
      // Valores iguais não provam que houve taxa zero; mantemos o líquido ausente.
      const verifiedNet = matched.every(s => s.netAmount !== s.grossAmount)
      const netRevenue = sameCurrency && verifiedNet ? matched.reduce((n, s) => n + s.netAmount, 0) : null
      const spend = complete ? m.spend : null
      const impressions = complete ? m.impressions : null
      const clicks = complete ? m.clicks : null
      const profit = spend !== null && netRevenue !== null ? netRevenue - spend : null
      const specs = attributionSpecs.filter(as => level === 'campaign' ? as.campaignId === row.id : level === 'adset' ? as.id === row.id : as.id === row.adSetId)
      const uniqueSpecs = [...new Set(specs.map(as => as.attributionSpec).filter((value): value is string => Boolean(value)))]
      const metaAttribution = uniqueSpecs.length === 1 && specs.every(as => as.attributionSpec) ? uniqueSpecs[0] : null
      return { id: row.id, externalId: row.externalId, name: row.name, status: row.status, budget: row.budget, parentName: row.parentName, campaignName: row.campaignName, adAccountName: row.accountName, previewUrl: row.previewUrl, currency: row.currency,
        spend, impressions, clicks, sales: matched.length, metaPurchases: complete ? m.metaPurchases : null, metaAttribution, revenue, netRevenue, profit,
        cpa: ratio(spend, matched.length), roas: ratio(netRevenue, spend), grossRoas: ratio(revenue, spend), roi: profit !== null && spend !== null && spend > 0 ? profit / spend * 100 : null,
        margin: profit !== null && revenue !== null && revenue > 0 ? profit / revenue * 100 : null,
        cpm: spend !== null && impressions !== null && impressions > 0 ? spend / impressions * 1000 : null, cpc: ratio(spend, clicks),
        ctr: clicks !== null && impressions !== null && impressions > 0 ? clicks / impressions * 100 : null, ic: complete ? m.ic : null,
        cpi: ratio(spend, complete ? m.ic : null) }
    })
    return NextResponse.json({ data, coverage, attribution: { approved: sales.length, attributed: sales.length - unassigned, unassigned }, metaAttribution: 'Configuração de atribuição do conjunto' })
  } catch (error) {
    console.error('Error fetching meta insights:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
