import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getUserWorkspaceId } from '@/lib/workspace'
import { purgeTestSales } from '@/lib/integrations/normalizer'

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

    // Purge any legacy synthetic test sales cleanly
    await purgeTestSales(workspaceId)

    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status')
    const platform = searchParams.get('platform')
    const search = searchParams.get('search')
    const from = searchParams.get('from')
    const to = searchParams.get('to')
    const page = parseInt(searchParams.get('page') || '1', 10)
    const limit = Math.min(parseInt(searchParams.get('limit') || '25', 10), 100)
    const skip = (page - 1) * limit

    const where: any = { workspaceId }

    if (status && status !== 'all') {
      where.status = status
    }

    if (platform && platform !== 'all') {
      where.platform = platform.toLowerCase()
    }

    if (search) {
      where.OR = [
        { externalId: { contains: search } },
        { externalRef: { contains: search } },
        { customerEmail: { contains: search } },
        { utmCampaign: { contains: search } },
        { utmSource: { contains: search } },
      ]
    }

    if (from || to) {
      where.orderedAt = {}
      if (from) where.orderedAt.gte = new Date(from)
      if (to) where.orderedAt.lte = new Date(to)
    }

    const statsWhere: any = { workspaceId }
    if (platform && platform !== 'all') {
      statsWhere.platform = platform.toLowerCase()
    }
    if (from || to) {
      statsWhere.orderedAt = {}
      if (from) statsWhere.orderedAt.gte = new Date(from)
      if (to) statsWhere.orderedAt.lte = new Date(to)
    }

    const [sales, totalCount, allStatusSales] = await Promise.all([
      prisma.sale.findMany({
        where,
        orderBy: { orderedAt: 'desc' },
        skip,
        take: limit,
        include: {
          attributionRecord: true,
        },
      }),
      prisma.sale.count({ where }),
      prisma.sale.findMany({
        where: statsWhere,
        select: {
          status: true,
          grossAmount: true,
          netAmount: true,
        },
      }),
    ])

    // Compute KPI metrics across the entire workspace
    let totalGross = 0
    let totalNet = 0
    let totalPending = 0
    let totalRefunded = 0
    let totalChargeback = 0
    let countApproved = 0
    let countPending = 0
    let countRefunded = 0
    let countChargeback = 0

    for (const s of allStatusSales) {
      if (s.status === 'approved') {
        totalGross += s.grossAmount
        totalNet += s.netAmount
        countApproved++
      } else if (s.status === 'pending') {
        totalPending += s.grossAmount
        countPending++
      } else if (s.status === 'refunded') {
        totalRefunded += s.grossAmount
        countRefunded++
      } else if (s.status === 'chargeback') {
        totalChargeback += s.grossAmount
        countChargeback++
      }
    }

    const countTotal = allStatusSales.length
    const approvalRate = countTotal > 0 ? (countApproved / countTotal) * 100 : 0

    return NextResponse.json({
      sales,
      totalCount,
      page,
      totalPages: Math.ceil(totalCount / limit) || 1,
      stats: {
        totalGross,
        totalNet,
        totalPending,
        totalRefunded,
        totalChargeback,
        countApproved,
        countPending,
        countRefunded,
        countChargeback,
        countTotal,
        approvalRate,
      },
    })
  } catch (error) {
    console.error('Error fetching sales:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function DELETE(req: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const workspaceId = await getUserWorkspaceId(session.user.id)
    if (!workspaceId) {
      return NextResponse.json({ error: 'No workspace found' }, { status: 404 })
    }

    const body = await req.json().catch(() => ({}))
    const ids: string[] = Array.isArray(body?.ids) ? body.ids : []

    if (ids.length === 0) {
      return NextResponse.json({ error: 'Nenhum ID de venda fornecido' }, { status: 400 })
    }

    // Busca vendas válidas que pertencem ao workspace
    const validSales = await prisma.sale.findMany({
      where: {
        id: { in: ids },
        workspaceId,
      },
      select: { id: true },
    })

    const validIds = validSales.map((s) => s.id)

    if (validIds.length === 0) {
      return NextResponse.json({
        success: true,
        deletedCount: 0,
        message: 'Nenhuma venda encontrada para exclusão',
      })
    }

    // Deleta notificações vinculadas
    await prisma.notification.deleteMany({
      where: {
        saleId: { in: validIds },
        workspaceId,
      },
    })

    // Deleta itens e atribuição
    await prisma.saleItem.deleteMany({
      where: { saleId: { in: validIds } },
    })

    await prisma.attributionRecord.deleteMany({
      where: { saleId: { in: validIds } },
    })

    // Deleta as vendas
    const deleteResult = await prisma.sale.deleteMany({
      where: {
        id: { in: validIds },
        workspaceId,
      },
    })

    return NextResponse.json({
      success: true,
      deletedCount: deleteResult.count,
      message: `${deleteResult.count} venda(s) excluída(s) com sucesso`,
    })
  } catch (error) {
    console.error('Error batch deleting sales:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
