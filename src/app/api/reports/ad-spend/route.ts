import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { resolveAnalyticsInterval } from '@/lib/meta/insight-helpers'

function formatBRL(val: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0)
}

function validateAuth(req: Request): boolean {
  const configuredSecret =
    process.env.REPORTS_API_SECRET ||
    process.env.CRON_SECRET ||
    process.env.NEXTAUTH_SECRET

  // Se nenhum segredo foi configurado no .env, bloqueia em produção
  if (!configuredSecret) {
    if (process.env.NODE_ENV === 'development') return true
    return false
  }

  const { searchParams } = new URL(req.url)
  const queryToken = searchParams.get('token') || searchParams.get('key') || searchParams.get('secret')
  const headerKey = req.headers.get('x-api-key') || req.headers.get('x-token')
  const authHeader = req.headers.get('authorization')
  const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.substring(7) : null

  const providedToken = queryToken || headerKey || bearerToken

  return Boolean(providedToken && providedToken === configuredSecret)
}

export async function GET(req: Request) {
  try {
    if (!validateAuth(req)) {
      return NextResponse.json(
        {
          error: 'Unauthorized',
          message: 'Token de autenticação inválido ou ausente. Forneça o header X-API-KEY ou parâmetro ?token=',
        },
        { status: 401 }
      )
    }

    const { searchParams } = new URL(req.url)

    // Parâmetros de data flexíveis
    const dateParam = searchParams.get('date')
    const startParam = dateParam || searchParams.get('start') || searchParams.get('from')
    const endParam = dateParam || searchParams.get('end') || searchParams.get('to')
    const presetParam = searchParams.get('preset')
    const reqWorkspaceId = searchParams.get('workspaceId')

    // Localizar workspace
    let workspace = null
    if (reqWorkspaceId) {
      workspace = await prisma.workspace.findUnique({
        where: { id: reqWorkspaceId },
        select: { id: true, timezone: true, name: true },
      })
    }

    if (!workspace) {
      workspace = await prisma.workspace.findFirst({
        select: { id: true, timezone: true, name: true },
        orderBy: { createdAt: 'asc' },
      })
    }

    if (!workspace) {
      return NextResponse.json({ error: 'Nenhum workspace encontrado no sistema' }, { status: 404 })
    }

    const tz = workspace.timezone || 'America/Sao_Paulo'
    const interval = resolveAnalyticsInterval(presetParam, tz, startParam, endParam)

    // 1. Agregar gastos e métricas de Meta Ads gravados no banco
    const insightsAgg = await prisma.campaignInsight.aggregate({
      where: {
        campaign: { workspaceId: workspace.id },
        dateStart: { gte: interval.insightDateStart, lte: interval.insightDateStop },
      },
      _sum: {
        spend: true,
        impressions: true,
        clicks: true,
        conversions: true,
      },
    })

    const adSpend = Math.round((insightsAgg._sum?.spend || 0) * 100) / 100
    const impressions = insightsAgg._sum?.impressions || 0
    const clicks = insightsAgg._sum?.clicks || 0
    const metaPurchases = insightsAgg._sum?.conversions || 0

    const ctr = impressions > 0 ? Math.round(((clicks / impressions) * 100) * 100) / 100 : 0
    const cpc = clicks > 0 ? Math.round((adSpend / clicks) * 100) / 100 : 0
    const cpm = impressions > 0 ? Math.round(((adSpend / impressions) * 1000) * 100) / 100 : 0

    // 2. Consultar vendas aprovadas no utm-track para calcular ROAS e Lucro de referência
    const sales = await prisma.sale.findMany({
      where: {
        workspaceId: workspace.id,
        OR: [
          { approvedAt: { gte: interval.saleFrom, lt: interval.saleTo } },
          { approvedAt: null, orderedAt: { gte: interval.saleFrom, lt: interval.saleTo } },
        ],
      },
      select: {
        grossAmount: true,
        netAmount: true,
        status: true,
        approvedAt: true,
        orderedAt: true,
      },
    })

    const approvedSales = sales.filter((s) => {
      const st = (s.status || '').toLowerCase()
      const isPaid = st === 'approved' || st === 'paid' || st === 'aprovado' || st === 'pago' || st === 'completed'
      if (!isPaid) return false
      const soldAt = s.approvedAt ?? s.orderedAt
      return soldAt >= interval.saleFrom && soldAt < interval.saleTo
    })

    const salesCount = approvedSales.length
    const salesGross = Math.round(approvedSales.reduce((acc, s) => acc + (s.grossAmount || 0), 0) * 100) / 100
    const salesNet = Math.round(approvedSales.reduce((acc, s) => acc + (s.netAmount || s.grossAmount || 0), 0) * 100) / 100

    const roas = adSpend > 0 ? Math.round((salesGross / adSpend) * 100) / 100 : 0
    const cpa = salesCount > 0 && adSpend > 0 ? Math.round((adSpend / salesCount) * 100) / 100 : 0
    const realProfit = Math.round((salesNet - adSpend) * 100) / 100

    return NextResponse.json({
      success: true,
      workspace: {
        id: workspace.id,
        name: workspace.name,
        timezone: tz,
      },
      period: {
        from: interval.startDayStr,
        to: interval.endDayStr,
        start_date: interval.startDayStr,
        end_date: interval.endDayStr,
        timezone: tz,
      },
      // Gasto de Anúncios consolidado
      ad_spend: adSpend,
      ad_spend_formatted: formatBRL(adSpend),
      impressions,
      clicks,
      ctr,
      cpc,
      cpc_formatted: formatBRL(cpc),
      cpm,
      cpm_formatted: formatBRL(cpm),
      meta_purchases: metaPurchases,
      // Vendas & ROAS apurados no utm-track
      utm_sales: {
        orders_count: salesCount,
        gross_revenue: salesGross,
        gross_revenue_formatted: formatBRL(salesGross),
        net_revenue: salesNet,
        net_revenue_formatted: formatBRL(salesNet),
        roas,
        cpa,
        cpa_formatted: formatBRL(cpa),
        real_profit: realProfit,
        real_profit_formatted: formatBRL(realProfit),
      },
    })
  } catch (error) {
    console.error('Error fetching ad spend report:', error)
    return NextResponse.json({ error: 'Erro ao consultar gastos de anúncios' }, { status: 500 })
  }
}
