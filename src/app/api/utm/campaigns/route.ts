import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getUserWorkspaceId } from '@/lib/workspace'
import {
  calcCPA, calcROAS, calcROI, calcMargin, calcProfit
} from '@/lib/metrics'
import { resolveAnalyticsInterval } from '@/lib/meta/insight-helpers'
import { calculateSaleFee } from '@/lib/calculations/financial-engine'

function decodeSafely(val: string): string {
  try {
    return decodeURIComponent(val).trim()
  } catch {
    return val.trim()
  }
}

function normalizeKey(str: string): string {
  return decodeSafely(str).toLowerCase().replace(/[\s\-_+]+/g, ' ').trim()
}

export async function GET(req: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const workspaceId = await getUserWorkspaceId(session.user.id)
    if (!workspaceId) return NextResponse.json({ error: 'No workspace' }, { status: 404 })

    const { searchParams } = new URL(req.url)
    const preset = searchParams.get('preset')
    const fromStr = searchParams.get('from')
    const toStr = searchParams.get('to')

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { timezone: true }
    })
    const tz = workspace?.timezone || 'America/Sao_Paulo'

    const isAllTime = preset && (preset.toLowerCase() === 'all' || preset.toLowerCase() === 'todas' || preset.toLowerCase().includes('todo'))
    const interval = resolveAnalyticsInterval(preset, tz, fromStr, toStr)

    // 1. Carregar taxas ativas do workspace para dedução correta da receita líquida
    const activeFees = await prisma.fee.findMany({
      where: { workspaceId, isActive: true },
    })

    const calculateRealNet = (s: {
      grossAmount: number
      netAmount: number
      platform?: string | null
      paymentMethod?: string | null
      externalRef?: string | null
      installments?: number | null
    }) => {
      let net = s.netAmount
      if ((net === s.grossAmount || net === 0) && activeFees.length > 0 && s.grossAmount > 0) {
        const fee = calculateSaleFee(
          {
            grossAmount: s.grossAmount,
            platform: s.platform,
            paymentMethod: s.paymentMethod,
            externalRef: s.externalRef,
            installments: s.installments,
          },
          activeFees
        )
        if (fee > 0) {
          net = Math.max(0, Math.round((s.grossAmount - fee) * 100) / 100)
        }
      }
      return net
    }

    // 2. Consultar Vendas com UTMs e Atribuição
    const salesWhere: any = { workspaceId }
    if (!isAllTime) {
      salesWhere.orderedAt = {
        gte: interval.saleFrom,
        lt: interval.saleTo,
      }
    }

    const sales = await prisma.sale.findMany({
      where: salesWhere,
      select: {
        utmCampaign: true,
        status: true,
        grossAmount: true,
        netAmount: true,
        platform: true,
        paymentMethod: true,
        externalRef: true,
        installments: true,
        orderedAt: true,
        attributionRecord: {
          select: {
            campaignId: true,
            utmCampaign: true,
          }
        }
      }
    })

    // 3. Consultar Sessões por UTM Campaign
    const sessionsWhere: any = { workspaceId }
    if (!isAllTime) {
      sessionsWhere.firstSeenAt = {
        gte: interval.saleFrom,
        lt: interval.saleTo,
      }
    }

    const sessions = await prisma.trackingSession.groupBy({
      by: ['utmCampaign'],
      where: sessionsWhere,
      _count: { id: true }
    })

    // 4. Consultar Campanhas do Meta Ads e seus Insights no período
    const campaigns = await prisma.campaign.findMany({
      where: { workspaceId },
      include: {
        insights: {
          where: isAllTime ? undefined : {
            dateStart: {
              gte: interval.insightDateStart,
              lte: interval.insightDateStop,
            }
          }
        }
      }
    })

    // 5. Indexar campanhas do Meta para correspondência flexível (ID, externalId, Nome e Slug)
    type CampaignSummary = {
      name: string
      campaignId?: string
      externalId?: string
      salesCount: number
      approvedSalesCount: number
      grossRevenue: number
      netRevenue: number
      spend: number
      sessions: number
    }

    const campaignsMap = new Map<string, CampaignSummary>()
    const campaignByExact = new Map<string, typeof campaigns[0]>()
    const campaignByNorm = new Map<string, typeof campaigns[0]>()
    const campaignByIdOrExt = new Map<string, typeof campaigns[0]>()

    for (const c of campaigns) {
      const totalSpend = c.insights.reduce((acc, ins) => acc + (ins.spend || 0), 0)
      campaignByExact.set(c.name.toLowerCase().trim(), c)
      campaignByNorm.set(normalizeKey(c.name), c)
      if (c.externalId) campaignByIdOrExt.set(c.externalId.trim(), c)
      campaignByIdOrExt.set(c.id.trim(), c)

      // Se tiver gasto no período, pre-popula a campanha para ser exibida
      if (totalSpend > 0) {
        campaignsMap.set(c.name, {
          name: c.name,
          campaignId: c.id,
          externalId: c.externalId,
          salesCount: 0,
          approvedSalesCount: 0,
          grossRevenue: 0,
          netRevenue: 0,
          spend: totalSpend,
          sessions: 0
        })
      }
    }

    const findCampaignForUtm = (utm: string | null | undefined, attrCampaignId?: string | null) => {
      if (attrCampaignId) {
        const found = campaignByIdOrExt.get(attrCampaignId.trim())
        if (found) return found
      }
      if (!utm) return null
      const raw = decodeSafely(utm)
      if (campaignByIdOrExt.get(raw)) return campaignByIdOrExt.get(raw)
      if (campaignByExact.get(raw.toLowerCase())) return campaignByExact.get(raw.toLowerCase())
      if (campaignByNorm.get(normalizeKey(raw))) return campaignByNorm.get(normalizeKey(raw))
      return null
    }

    // 6. Associar Sessões
    for (const s of sessions) {
      const matched = findCampaignForUtm(s.utmCampaign)
      const name = matched ? matched.name : (s.utmCampaign ? decodeSafely(s.utmCampaign) : 'Orgânico / Direto')

      if (!campaignsMap.has(name)) {
        const totalSpend = matched ? matched.insights.reduce((acc, ins) => acc + (ins.spend || 0), 0) : 0
        campaignsMap.set(name, {
          name,
          campaignId: matched?.id,
          externalId: matched?.externalId,
          salesCount: 0,
          approvedSalesCount: 0,
          grossRevenue: 0,
          netRevenue: 0,
          spend: totalSpend,
          sessions: s._count.id
        })
      } else {
        campaignsMap.get(name)!.sessions += s._count.id
      }
    }

    // 7. Associar Vendas (Apenas vendas aprovadas somam Faturamento e Líquido)
    for (const sale of sales) {
      const matched = findCampaignForUtm(sale.utmCampaign, sale.attributionRecord?.campaignId || sale.attributionRecord?.utmCampaign)
      const name = matched ? matched.name : (sale.utmCampaign ? decodeSafely(sale.utmCampaign) : 'Orgânico / Direto')

      if (!campaignsMap.has(name)) {
        const totalSpend = matched ? matched.insights.reduce((acc, ins) => acc + (ins.spend || 0), 0) : 0
        campaignsMap.set(name, {
          name,
          campaignId: matched?.id,
          externalId: matched?.externalId,
          salesCount: 0,
          approvedSalesCount: 0,
          grossRevenue: 0,
          netRevenue: 0,
          spend: totalSpend,
          sessions: 0
        })
      }

      const item = campaignsMap.get(name)!
      item.salesCount += 1

      const st = (sale.status || '').toLowerCase()
      const isApproved = st === 'approved' || st === 'paid' || st === 'aprovado' || st === 'pago' || st === 'completed'

      if (isApproved) {
        item.approvedSalesCount += 1
        item.grossRevenue += sale.grossAmount
        item.netRevenue += calculateRealNet(sale)
      }
    }

    // 8. Calcular métricas derivadas por Campanha UTM
    const rows = Array.from(campaignsMap.values()).map((row) => {
      const profit = calcProfit({
        netRevenue: row.netRevenue,
        adSpend: row.spend,
        productCost: 0,
        fees: 0,
        taxes: 0,
        expenses: 0
      })

      return {
        campaign: row.name,
        sessions: row.sessions,
        sales: row.salesCount,
        approvedSales: row.approvedSalesCount,
        spend: Math.round(row.spend * 100) / 100,
        revenue: Math.round(row.grossRevenue * 100) / 100,
        netRevenue: Math.round(row.netRevenue * 100) / 100,
        profit: Math.round(profit * 100) / 100,
        cpa: calcCPA(row.spend, row.approvedSalesCount),
        roas: calcROAS(row.grossRevenue, row.spend),
        roi: calcROI(profit, row.spend),
        margin: calcMargin(profit, row.grossRevenue)
      }
    })

    rows.sort((a, b) => b.revenue - a.revenue || b.spend - a.spend || b.sales - a.sales)

    return NextResponse.json({ campaigns: rows })
  } catch (error) {
    console.error('Error fetching UTM campaigns performance:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
