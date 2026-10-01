import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getUserWorkspaceId } from '@/lib/workspace'
import { calcCPC, calcCPM, calcCTR, calcCPA, calcROAS, calcROI, calcMargin, calcCPI } from '@/lib/metrics'

type MetaRecommendation =
  | 'scale'
  | 'profitable'
  | 'breakeven'
  | 'pause'
  | 'learning'
  | 'inactive'

function parseNormalizedDateRange(fromStr: string | null, toStr: string | null): { from: Date; to: Date } {
  const tz = 'America/Sao_Paulo'
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  })

  let fromDate: Date
  let toDate: Date

  if (fromStr) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(fromStr)) {
      const [y, m, d] = fromStr.split('-').map(Number)
      fromDate = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0))
    } else {
      const parsed = new Date(fromStr)
      if (!isNaN(parsed.getTime())) {
        const parts = formatter.format(parsed) // YYYY-MM-DD
        const [y, m, d] = parts.split('-').map(Number)
        fromDate = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0))
      } else {
        const d = new Date(Date.now() - 30 * 86400000)
        fromDate = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0))
      }
    }
  } else {
    const d = new Date(Date.now() - 30 * 86400000)
    fromDate = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0))
  }

  if (toStr) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(toStr)) {
      const [y, m, d] = toStr.split('-').map(Number)
      toDate = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999))
    } else {
      const parsed = new Date(toStr)
      if (!isNaN(parsed.getTime())) {
        const parts = formatter.format(parsed) // YYYY-MM-DD
        const [y, m, d] = parts.split('-').map(Number)
        toDate = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999))
      } else {
        const now = new Date()
        toDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999))
      }
    }
  } else {
    const now = new Date()
    toDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999))
  }

  return { from: fromDate, to: toDate }
}

function getCanonicalMetrics(insights: Array<{
  spend: number
  impressions: number
  clicks: number
  conversions: number
  conversionValue: number
  actions?: string | null
}>) {
  let spend = 0
  let impressions = 0
  let clicks = 0
  let conversions = 0
  let metaRevenue = 0
  let icCount = 0
  let foundIc = false

  for (const i of insights) {
    spend += i.spend || 0
    impressions += i.impressions || 0
    clicks += i.clicks || 0

    let rowConversions = i.conversions || 0
    let rowRevenue = i.conversionValue || 0

    if (i.actions) {
      try {
        const actionsArr = JSON.parse(i.actions)
        if (Array.isArray(actionsArr)) {
          // Extrair compra canônica (sem duplicar entre pixel, omni e web)
          const purchaseAction =
            actionsArr.find((a: any) => a.action_type === 'offsite_conversion.fb_pixel_purchase') ||
            actionsArr.find((a: any) => a.action_type === 'purchase') ||
            actionsArr.find((a: any) => a.action_type === 'omni_purchase') ||
            actionsArr.find((a: any) => a.action_type === 'onsite_web_purchase') ||
            actionsArr.find((a: any) => typeof a.action_type === 'string' && a.action_type.endsWith('_purchase')) ||
            actionsArr.find((a: any) => typeof a.action_type === 'string' && a.action_type.includes('purchase'))

          if (purchaseAction) {
            rowConversions = parseInt(purchaseAction.value, 10) || 0
          }

          // Extrair InitiateCheckout real
          const icAction =
            actionsArr.find((a: any) => a.action_type === 'offsite_conversion.fb_pixel_initiate_checkout') ||
            actionsArr.find((a: any) => a.action_type === 'initiate_checkout') ||
            actionsArr.find((a: any) => a.action_type === 'omni_initiated_checkout') ||
            actionsArr.find((a: any) => typeof a.action_type === 'string' && a.action_type.includes('initiate_checkout'))

          if (icAction) {
            icCount += parseInt(icAction.value, 10) || 0
            foundIc = true
          }
        }
      } catch {}
    }

    conversions += rowConversions
    metaRevenue += rowRevenue
  }

  if (!foundIc) {
    icCount = Math.round(conversions * 1.5)
  }

  return { spend, impressions, clicks, conversions, metaRevenue, icCount }
}

function computeRecommendation(
  spend: number,
  sales: number,
  profit: number,
  roas: number | null,
  status: string
): MetaRecommendation {
  if (spend <= 0) {
    return 'inactive'
  }
  if (status?.toUpperCase() !== 'ACTIVE') {
    return profit > 0 ? 'profitable' : 'pause'
  }
  if (sales >= 3 && roas !== null && roas >= 2.0 && profit > 0) {
    return 'scale'
  }
  if (profit > 0 || (roas !== null && roas >= 1.2)) {
    return 'profitable'
  }
  if (sales > 0 && roas !== null && roas >= 0.8) {
    return 'breakeven'
  }
  if (sales === 0 && spend < 50) {
    return 'learning'
  }
  return 'pause'
}

function normalizeForMatch(str: string | null | undefined): string {
  if (!str) return ''
  return str.toLowerCase().trim().replace(/[-_\s]+/g, '')
}

export async function GET(req: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const workspaceId = await getUserWorkspaceId(session.user.id)
    if (!workspaceId) return NextResponse.json({ error: 'No workspace' }, { status: 404 })

    const { searchParams } = new URL(req.url)
    const level = searchParams.get('level') || 'campaign'
    const adAccountId = searchParams.get('adAccountId')
    const statusFilter = searchParams.get('status')
    const search = searchParams.get('search')
    const fromStr = searchParams.get('from')
    const toStr = searchParams.get('to')

    const { from, to } = parseNormalizedDateRange(fromStr, toStr)

    // Buscar vendas reais aprovadas no período (estilo UTMfy)
    const sales = await prisma.sale.findMany({
      where: {
        workspaceId,
        status: 'approved',
        orderedAt: { gte: from, lte: to }
      },
      select: {
        id: true,
        utmCampaign: true,
        utmContent: true,
        grossAmount: true,
        netAmount: true,
        attributionRecord: {
          select: {
            campaignId: true,
            adSetId: true,
            adId: true,
            utmCampaign: true
          }
        }
      }
    })

    if (level === 'adset') {
      const whereClause: any = { workspaceId }
      if (adAccountId && adAccountId !== 'all') {
        whereClause.campaign = { adAccountId }
      }
      if (search) {
        whereClause.name = { contains: search, mode: 'insensitive' }
      }

      const adSets = await prisma.adSet.findMany({
        where: whereClause,
        include: {
          insights: {
            where: { dateStart: { gte: from, lte: to } }
          },
          campaign: { select: { name: true, adAccountId: true } }
        }
      })

      const data = adSets.map(as => {
        const { spend, impressions, clicks, conversions, metaRevenue, icCount } = getCanonicalMetrics(as.insights)

        // Matching de vendas reais do gateway/banco
        const matchedSales = sales.filter(s => {
          if (s.attributionRecord?.adSetId && (s.attributionRecord.adSetId === as.id || s.attributionRecord.adSetId === as.externalId)) {
            return true
          }
          const utm = s.utmCampaign || s.attributionRecord?.utmCampaign
          if (!utm) return false
          const nUtm = normalizeForMatch(utm)
          const nName = normalizeForMatch(as.name)
          const nExt = normalizeForMatch(as.externalId)
          return nUtm === nName || nUtm === nExt || nName.includes(nUtm) || nUtm.includes(nName)
        })

        const realSalesCount = matchedSales.length
        const realGrossRevenue = matchedSales.reduce((acc, s) => acc + (s.grossAmount || 0), 0)
        const realNetRevenue = matchedSales.reduce((acc, s) => acc + (s.netAmount || 0), 0)

        const displaySales = conversions > 0 ? conversions : realSalesCount
        const revenue = realGrossRevenue > 0 ? realGrossRevenue : metaRevenue
        const netRevenue = realNetRevenue > 0 ? realNetRevenue : (revenue * 0.9)
        const profit = netRevenue - spend
        const roas = calcROAS(revenue, spend)
        const roi = calcROI(profit, spend)
        const margin = calcMargin(profit, revenue)
        const cpa = calcCPA(spend, displaySales)
        const recommendation = computeRecommendation(spend, displaySales, profit, roas, as.status)

        return {
          id: as.id,
          externalId: as.externalId,
          name: as.name,
          parentName: as.campaign?.name || '',
          status: as.status || 'ACTIVE',
          budget: as.dailyBudget || as.lifetimeBudget || null,
          spend,
          sales: conversions,
          realSalesCount,
          cpa,
          revenue,
          netRevenue,
          profit,
          roas,
          roi,
          impressions,
          margin,
          cpm: calcCPM(spend, impressions),
          clicks,
          cpc: calcCPC(spend, clicks),
          ctr: calcCTR(clicks, impressions),
          ic: icCount,
          cpi: calcCPI(spend, icCount),
          recommendation
        }
      })

      let filteredData = data
      if (statusFilter === 'ACTIVE') {
        filteredData = data.filter(item => item.status?.toUpperCase() === 'ACTIVE')
      } else if (statusFilter === 'PAUSED') {
        filteredData = data.filter(item => item.status?.toUpperCase() === 'PAUSED' && (item.spend > 0 || item.impressions > 0))
      } else if (statusFilter === 'ARCHIVED') {
        filteredData = data.filter(item => item.status?.toUpperCase() === 'ARCHIVED')
      } else {
        // Padrão: Apenas ativos ou que tiveram veiculação/gasto no período
        filteredData = data.filter(item => item.status?.toUpperCase() === 'ACTIVE' || item.spend > 0 || item.impressions > 0)
      }

      return NextResponse.json({ data: filteredData })
    }

    if (level === 'ad') {
      const whereClause: any = { workspaceId }
      if (search) {
        whereClause.name = { contains: search, mode: 'insensitive' }
      }

      const ads = await prisma.ad.findMany({
        where: whereClause,
        include: {
          insights: {
            where: { dateStart: { gte: from, lte: to } }
          },
          adSet: {
            select: {
              name: true,
              campaign: { select: { name: true, adAccountId: true } }
            }
          }
        }
      })

      const data = ads.map(ad => {
        const { spend, impressions, clicks, conversions, metaRevenue, icCount } = getCanonicalMetrics(ad.insights)

        // Matching de vendas reais do gateway/banco
        const matchedSales = sales.filter(s => {
          if (s.attributionRecord?.adId && (s.attributionRecord.adId === ad.id || s.attributionRecord.adId === ad.externalId)) {
            return true
          }
          const utm = s.utmContent || s.utmCampaign || s.attributionRecord?.utmCampaign
          if (!utm) return false
          const nUtm = normalizeForMatch(utm)
          const nName = normalizeForMatch(ad.name)
          const nExt = normalizeForMatch(ad.externalId)
          return nUtm === nName || nUtm === nExt || nName.includes(nUtm) || nUtm.includes(nName)
        })

        const realSalesCount = matchedSales.length
        const realGrossRevenue = matchedSales.reduce((acc, s) => acc + (s.grossAmount || 0), 0)
        const realNetRevenue = matchedSales.reduce((acc, s) => acc + (s.netAmount || 0), 0)

        const displaySales = conversions > 0 ? conversions : realSalesCount
        const revenue = realGrossRevenue > 0 ? realGrossRevenue : metaRevenue
        const netRevenue = realNetRevenue > 0 ? realNetRevenue : (revenue * 0.9)
        const profit = netRevenue - spend
        const roas = calcROAS(revenue, spend)
        const roi = calcROI(profit, spend)
        const margin = calcMargin(profit, revenue)
        const cpa = calcCPA(spend, displaySales)
        const recommendation = computeRecommendation(spend, displaySales, profit, roas, ad.status)

        return {
          id: ad.id,
          externalId: ad.externalId,
          name: ad.name,
          parentName: ad.adSet?.name || '',
          campaignName: ad.adSet?.campaign?.name || '',
          previewUrl: ad.previewUrl,
          status: ad.status || 'ACTIVE',
          budget: null,
          spend,
          sales: conversions,
          realSalesCount,
          cpa,
          revenue,
          netRevenue,
          profit,
          roas,
          roi,
          impressions,
          margin,
          cpm: calcCPM(spend, impressions),
          clicks,
          cpc: calcCPC(spend, clicks),
          ctr: calcCTR(clicks, impressions),
          ic: icCount,
          cpi: calcCPI(spend, icCount),
          recommendation
        }
      })

      let filteredData = data
      if (statusFilter === 'ACTIVE') {
        filteredData = data.filter(item => item.status?.toUpperCase() === 'ACTIVE')
      } else if (statusFilter === 'PAUSED') {
        filteredData = data.filter(item => item.status?.toUpperCase() === 'PAUSED' && (item.spend > 0 || item.impressions > 0))
      } else if (statusFilter === 'ARCHIVED') {
        filteredData = data.filter(item => item.status?.toUpperCase() === 'ARCHIVED')
      } else {
        // Padrão: Apenas ativos ou que tiveram veiculação/gasto no período
        filteredData = data.filter(item => item.status?.toUpperCase() === 'ACTIVE' || item.spend > 0 || item.impressions > 0)
      }

      return NextResponse.json({ data: filteredData })
    }

    // Default: campaign level
    const whereClause: any = { workspaceId }
    if (adAccountId && adAccountId !== 'all') {
      whereClause.adAccountId = adAccountId
    }
    if (search) {
      whereClause.name = { contains: search, mode: 'insensitive' }
    }

    const campaigns = await prisma.campaign.findMany({
      where: whereClause,
      include: {
        insights: {
          where: { dateStart: { gte: from, lte: to } }
        },
        adAccount: { select: { name: true } }
      }
    })

    const data = campaigns.map(c => {
      const { spend, impressions, clicks, conversions, metaRevenue, icCount } = getCanonicalMetrics(c.insights)

      // Matching de vendas reais do gateway/banco
      const matchedSales = sales.filter(s => {
        if (s.attributionRecord?.campaignId && (s.attributionRecord.campaignId === c.id || s.attributionRecord.campaignId === c.externalId)) {
          return true
        }
        const utm = s.utmCampaign || s.attributionRecord?.utmCampaign
        if (!utm) return false
        const nUtm = normalizeForMatch(utm)
        const nName = normalizeForMatch(c.name)
        const nExt = normalizeForMatch(c.externalId)
        return nUtm === nName || nUtm === nExt || nName.includes(nUtm) || nUtm.includes(nName)
      })

      const realSalesCount = matchedSales.length
      const realGrossRevenue = matchedSales.reduce((acc, s) => acc + (s.grossAmount || 0), 0)
      const realNetRevenue = matchedSales.reduce((acc, s) => acc + (s.netAmount || 0), 0)

      const displaySales = conversions > 0 ? conversions : realSalesCount
      const revenue = realGrossRevenue > 0 ? realGrossRevenue : metaRevenue
      const netRevenue = realNetRevenue > 0 ? realNetRevenue : (revenue * 0.9)
      const profit = netRevenue - spend
      const roas = calcROAS(revenue, spend)
      const roi = calcROI(profit, spend)
      const margin = calcMargin(profit, revenue)
      const cpa = calcCPA(spend, displaySales)
      const recommendation = computeRecommendation(spend, displaySales, profit, roas, c.status)

      return {
        id: c.id,
        externalId: c.externalId,
        name: c.name,
        adAccountName: c.adAccount?.name || '',
        status: c.status || 'ACTIVE',
        budget: c.dailyBudget || c.lifetimeBudget || null,
        spend,
        sales: conversions,
        realSalesCount,
        cpa,
        revenue,
        netRevenue,
        profit,
        roas,
        roi,
        impressions,
        margin,
        cpm: calcCPM(spend, impressions),
        clicks,
        cpc: calcCPC(spend, clicks),
        ctr: calcCTR(clicks, impressions),
        ic: icCount,
        cpi: calcCPI(spend, icCount),
        recommendation
      }
    })

    let filteredData = data
    if (statusFilter === 'ACTIVE') {
      filteredData = data.filter(item => item.status?.toUpperCase() === 'ACTIVE')
    } else if (statusFilter === 'PAUSED') {
      filteredData = data.filter(item => item.status?.toUpperCase() === 'PAUSED' && (item.spend > 0 || item.impressions > 0))
    } else if (statusFilter === 'ARCHIVED') {
      filteredData = data.filter(item => item.status?.toUpperCase() === 'ARCHIVED')
    } else {
      // Padrão: Apenas ativos ou que tiveram veiculação/gasto no período
      filteredData = data.filter(item => item.status?.toUpperCase() === 'ACTIVE' || item.spend > 0 || item.impressions > 0)
    }

    return NextResponse.json({ data: filteredData })
  } catch (error) {
    console.error('Error fetching meta insights:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
