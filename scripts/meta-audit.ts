import { prisma } from '../src/lib/db'
import { decrypt } from '../src/lib/encryption'
import { MetaApiClient } from '../src/lib/meta/client'
import { day, nextDay, midnight } from '../src/lib/meta/insight-helpers'

async function main() {
  const accounts = await prisma.adAccount.findMany({ where: { status: 'active' } })
  for (const account of accounts) {
    const counts = await Promise.all([
      prisma.campaign.count({ where: { adAccountId: account.id } }),
      prisma.adSet.count({ where: { campaign: { adAccountId: account.id } } }),
      prisma.ad.count({ where: { adSet: { campaign: { adAccountId: account.id } } } }),
      prisma.campaignInsight.count({ where: { campaign: { adAccountId: account.id } } }),
    ])
    console.log(JSON.stringify({ accountId: account.id, currency: account.currency, timezone: account.timezone, lastSyncAt: account.lastSyncAt, counts }))
    if (!account.accessTokenEnc) continue
    const client = new MetaApiClient(decrypt(account.accessTokenEnc))
    const today = day(new Date(), account.timezone)
    const yesterday = day(new Date(Date.parse(today + 'T00:00:00Z') - 86400000), 'UTC')
    const thirty = day(new Date(Date.parse(today + 'T00:00:00Z') - 29 * 86400000), 'UTC')
    for (const [label, from, to] of [['today', today, today], ['yesterday', yesterday, yesterday], ['last30days', thirty, today]]) {
      try {
        const insights = await client.getInsights(account.externalId, 'campaign', undefined, from, to)
        const saleFrom = midnight(from, account.timezone)
        const saleTo = midnight(nextDay(to), account.timezone)
        const approved = await prisma.sale.count({ where: { workspaceId: account.workspaceId, status: 'approved', OR: [
          { approvedAt: { gte: saleFrom, lt: saleTo } }, { approvedAt: null, orderedAt: { gte: saleFrom, lt: saleTo } },
        ] } })
        console.log(JSON.stringify({ accountId: account.id, period: label, from, to, insightRows: insights.length,
          spend: insights.reduce((n, i) => n + (Number(i.spend) || 0), 0), impressions: insights.reduce((n, i) => n + (Number(i.impressions) || 0), 0), approvedWorkspaceSales: approved }))
      } catch (error) {
        console.log(JSON.stringify({ accountId: account.id, period: label, error: error instanceof Error ? error.message : 'unknown' }))
      }
    }
  }
}

main().finally(() => prisma.$disconnect())
