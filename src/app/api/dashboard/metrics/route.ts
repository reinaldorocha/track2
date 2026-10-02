import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getUserWorkspaceId } from '@/lib/workspace'
import { purgeTestSales } from '@/lib/integrations/normalizer'
import {
  calcCPA, calcCPC, calcCPM, calcCTR, calcMargin, calcProfit, calcROAS, calcROI, calcCPI
} from '@/lib/metrics'
import { calculateFinancialMetrics } from '@/lib/calculations/financial-engine'
import { triggerBackgroundMetaSyncIfNeeded } from '@/lib/meta/auto-sync'
import { resolveAnalyticsInterval, nextDay } from '@/lib/meta/insight-helpers'
import { after } from 'next/server'

export async function GET(req: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const workspaceId = await getUserWorkspaceId(session.user.id)
    if (!workspaceId) {
      return NextResponse.json({ error: 'No workspace found' }, { status: 404 })
    }

    // Purge any synthetic test sales before metric aggregation
    await purgeTestSales(workspaceId)

    // Disparo não-bloqueante de auto-sync em background para manter métricas de Meta Ads atualizadas
    after(() => triggerBackgroundMetaSyncIfNeeded(workspaceId, 15).then(() => {}))

    const { searchParams } = new URL(req.url)
    const preset = searchParams.get('preset')
    const fromStr = searchParams.get('from')
    const toStr = searchParams.get('to')

    const workspace = await prisma.workspace.findUnique({
      where: { id: workspaceId },
      select: { timezone: true }
    })
    const tz = workspace?.timezone || 'America/Sao_Paulo'
    const interval = resolveAnalyticsInterval(preset, tz, fromStr, toStr)

    // 1. Consultar Vendas Reais do Período
    const allSales = await prisma.sale.findMany({
      where: {
        workspaceId,
        OR: [
          { approvedAt: { gte: interval.saleFrom, lt: interval.saleTo } },
          { approvedAt: null, orderedAt: { gte: interval.saleFrom, lt: interval.saleTo } },
          { orderedAt: { gte: interval.saleFrom, lt: interval.saleTo } }
        ]
      },
      select: {
        id: true,
        grossAmount: true,
        netAmount: true,
        status: true,
        platform: true,
        orderedAt: true,
        approvedAt: true,
        refundedAt: true,
        utmSource: true
      }
    })

    const totalSales = allSales.length
    const approvedSalesList = allSales.filter(s => {
      const st = (s.status || '').toLowerCase()
      const isApproved = st === 'approved' || st === 'paid' || st === 'aprovado' || st === 'pago' || st === 'completed'
      if (!isApproved) return false
      const soldAt = s.approvedAt ?? s.orderedAt
      return soldAt >= interval.saleFrom && soldAt < interval.saleTo
    })
    const pendingSalesList = allSales.filter(s => {
      const st = (s.status || '').toLowerCase()
      const isPending = st === 'pending' || st === 'waiting_payment' || st === 'aguardando' || st === 'gerado'
      if (!isPending) return false
      return s.orderedAt >= interval.saleFrom && s.orderedAt < interval.saleTo
    })
    const refundedSalesList = allSales.filter(s => {
      const st = (s.status || '').toLowerCase()
      const isRefunded = st === 'refunded' || st === 'reembolsado' || st === 'estornado'
      if (!isRefunded) return false
      const refAt = s.refundedAt ?? s.orderedAt
      return refAt >= interval.saleFrom && refAt < interval.saleTo
    })
    const chargebackSalesList = allSales.filter(s => {
      const st = (s.status || '').toLowerCase()
      const isChargeback = st === 'chargeback' || st === 'dispute'
      if (!isChargeback) return false
      return s.orderedAt >= interval.saleFrom && s.orderedAt < interval.saleTo
    })

    const grossRevenue = approvedSalesList.reduce((acc, s) => acc + s.grossAmount, 0)
    const pendingAmount = pendingSalesList.reduce((acc, s) => acc + s.grossAmount, 0)
    const refundAmount = refundedSalesList.reduce((acc, s) => acc + s.grossAmount, 0)
    const chargebackAmount = chargebackSalesList.reduce((acc, s) => acc + s.grossAmount, 0)

    const approvedSales = approvedSalesList.length
    const pendingSales = pendingSalesList.length
    const refundedSales = refundedSalesList.length
    const chargebacks = chargebackSalesList.length

    // 2. Consultar Gastos e Insights do Meta Ads no Período (alinhado em UTC)
    const insightsAgg = await prisma.campaignInsight.aggregate({
      where: {
        campaign: { workspaceId },
        dateStart: { gte: interval.insightDateStart, lte: interval.insightDateStop }
      },
      _sum: {
        spend: true,
        impressions: true,
        clicks: true
      }
    })

    const adSpend = insightsAgg._sum?.spend || 0
    const impressions = insightsAgg._sum?.impressions || 0
    const clicks = insightsAgg._sum?.clicks || 0

    // 3. Consultar Eventos de Tracking Reais (PageViews, ICs, Leads)
    const trackingEvents = await prisma.trackingEvent.findMany({
      where: {
        workspaceId,
        eventTime: { gte: interval.saleFrom, lt: interval.saleTo }
      },
      select: {
        eventName: true,
        eventTime: true
      }
    })

    const pageViews = trackingEvents.filter(e => 
      e.eventName.toLowerCase().includes('pageview') || e.eventName.toLowerCase().includes('viewcontent')
    ).length

    const checkoutInitiations = trackingEvents.filter(e => 
      e.eventName.toLowerCase().includes('initiatecheckout') || e.eventName.toLowerCase().includes('checkout')
    ).length

    // 4. Consultar Despesas, Taxas e Impostos no Período
    const expenses = await prisma.expense.findMany({
      where: {
        workspaceId,
        date: { gte: interval.insightDateStart, lte: interval.saleTo },
        isActive: true
      }
    })
    const totalExpenses = expenses.reduce((acc, e) => acc + e.amount, 0)

    const fees = await prisma.fee.findMany({
      where: { workspaceId, isActive: true }
    })

    const taxes = await prisma.tax.findMany({
      where: { workspaceId, isActive: true }
    })

    const financial = calculateFinancialMetrics({
      sales: approvedSalesList,
      fees,
      taxes,
      adSpend,
      expenses: totalExpenses
    })

    const totalFees = financial.totalFees
    const netRevenue = financial.netRevenue
    const impostoVendas = financial.salesTaxAmount
    const impostoMeta = financial.metaAdsTaxAmount
    const impostoTotal = financial.totalTaxes
    const profit = financial.netProfit
    const margin = financial.margin
    const roi = financial.roi
    const roas = financial.roas
    const realRoas = financial.realRoas

    // 6. Série Temporal REAL para Gráficos
    const isSingleDay = interval.startDayStr === interval.endDayStr

    const chartMap = new Map<string, { date: string; revenue: number; spend: number; profit: number }>()

    if (isSingleDay) {
      // Série horária (00:00 às 23:00) no timezone
      for (let h = 0; h < 24; h++) {
        const hourStr = `${String(h).padStart(2, '0')}:00`
        chartMap.set(hourStr, {
          date: hourStr,
          revenue: 0,
          spend: adSpend > 0 ? Math.round((adSpend / 24) * 100) / 100 : 0,
          profit: 0
        })
      }

      for (const s of approvedSalesList) {
        const soldAt = s.approvedAt ?? s.orderedAt
        const saleHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(new Date(soldAt)))
        const hourStr = `${String(saleHour).padStart(2, '0')}:00`
        const entry = chartMap.get(hourStr)
        if (entry) {
          entry.revenue += s.netAmount || s.grossAmount || 0
        }
      }
    } else {
      // Série diária (dd/MM) normalizada
      let curDay = interval.startDayStr
      while (curDay <= interval.endDayStr) {
        const parts = curDay.split('-')
        const label = `${parts[2]}/${parts[1]}`
        chartMap.set(curDay, { date: label, revenue: 0, spend: 0, profit: 0 })
        curDay = nextDay(curDay)
      }

      for (const s of approvedSalesList) {
        const soldAt = s.approvedAt ?? s.orderedAt
        const key = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(soldAt))
        const entry = chartMap.get(key)
        if (entry) {
          entry.revenue += s.netAmount || s.grossAmount || 0
        }
      }

      try {
        const dailyInsights = await prisma.campaignInsight.findMany({
          where: {
            campaign: { workspaceId },
            dateStart: { gte: interval.insightDateStart, lte: interval.insightDateStop }
          },
          select: { dateStart: true, spend: true }
        })

        for (const ins of dailyInsights) {
          const key = ins.dateStart.toISOString().slice(0, 10)
          const entry = chartMap.get(key)
          if (entry) {
            entry.spend += ins.spend || 0
          }
        }
      } catch {}
    }

    const chartData = Array.from(chartMap.values()).map(d => ({
      ...d,
      revenue: Math.round(d.revenue * 100) / 100,
      spend: Math.round(d.spend * 100) / 100,
      profit: Math.round((d.revenue - d.spend) * 100) / 100
    }))

    // 7. Funil Real de Métricas
    const effectiveClicks = clicks || (pageViews > 0 ? Math.round(pageViews * 1.5) : 0)
    const effectivePageViews = pageViews || Math.round(effectiveClicks * 0.75)
    const effectiveICs = checkoutInitiations || (totalSales > 0 ? Math.round(totalSales * 1.5) : 0)

    const cpa = calcCPA(adSpend, approvedSales)
    const cpc = calcCPC(adSpend, clicks)
    const ctr = calcCTR(clicks, impressions)
    const cpm = calcCPM(adSpend, impressions)
    const cpi = calcCPI(adSpend, effectiveICs || approvedSales)
    const allTimeAgg = await prisma.sale.aggregate({
      where: {
        workspaceId,
        status: { in: ['approved', 'paid', 'aprovado', 'pago', 'completed'] }
      },
      _sum: {
        grossAmount: true,
        netAmount: true,
      },
      _count: {
        id: true,
      }
    })
    const allTimeGrossRevenue = allTimeAgg._sum?.grossAmount || 0
    const allTimeApprovedSales = allTimeAgg._count?.id || 0

    return NextResponse.json({
      // Acumulado Histórico Geral (Metas & Troféu)
      allTimeGrossRevenue,
      allTimeApprovedSales,

      // Financeiro do Período
      grossRevenue,
      netRevenue,
      adSpend,
      profit,
      margin,
      totalExpenses,
      expensesCount: expenses.length,
      totalFees,
      feeBreakdown: financial.feeBreakdown,
      impostoTotal,
      impostoVendas,
      impostoMeta,
      metaAdsTaxRate: financial.metaAdsTaxRate,
      salesTaxRate: financial.salesTaxRate,
      totalInvestment: financial.totalInvestment,

      // Vendas
      sales: totalSales,
      approvedSales,
      pendingSales,
      pendingAmount,
      refundedSales,
      refundAmount,
      chargebacks,
      chargebackAmount,

      // Tráfego & Anúncios
      impressions,
      clicks: effectiveClicks,
      pageViews: effectivePageViews,
      checkoutInitiations: effectiveICs,
      purchases: totalSales,

      // Métricas Unitárias
      cpa,
      cpc,
      ctr,
      cpm,
      cpi,
      roas,
      realRoas,
      roi,

      // Gráficos
      chartData
    })
  } catch (error) {
    console.error('[Dashboard Metrics API] Error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
