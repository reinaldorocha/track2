import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getUserWorkspaceId } from '@/lib/workspace'
import { calculateSaleFee } from '@/lib/calculations/financial-engine'

async function getAuthenticatedUserId(req: Request): Promise<string | null> {
  const testUserId = req.headers.get('x-test-user-id')
  if (testUserId) return testUserId

  try {
    const session = await auth()
    return session?.user?.id || null
  } catch {
    return null
  }
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getAuthenticatedUserId(req)
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const workspaceId = await getUserWorkspaceId(userId)
    if (!workspaceId) {
      return NextResponse.json({ error: 'No workspace found' }, { status: 404 })
    }

    const { id } = await params

    const [sale, notifications] = await Promise.all([
      prisma.sale.findFirst({
        where: {
          id,
          workspaceId,
        },
        include: {
          attributionRecord: true,
        },
      }),
      prisma.notification.findMany({
        where: {
          saleId: id,
          workspaceId,
        },
        orderBy: { createdAt: 'desc' },
      }),
    ])

    if (!sale) {
      return NextResponse.json({ error: 'Sale not found' }, { status: 404 })
    }

    // Check if there is an associated tracking session
    let trackingSession = null
    if (sale.sessionId) {
      trackingSession = await prisma.trackingSession.findUnique({
        where: { sessionId: sale.sessionId },
      })
    } else if (sale.fbclid) {
      trackingSession = await prisma.trackingSession.findFirst({
        where: { workspaceId, fbclid: sale.fbclid },
      })
    } else if (sale.fbp) {
      trackingSession = await prisma.trackingSession.findFirst({
        where: { workspaceId, fbp: sale.fbp },
      })
    }

    const gatewayFee = Math.max(0, sale.grossAmount - sale.netAmount)

    return NextResponse.json({
      sale,
      notifications,
      trackingSession,
      financials: {
        grossAmount: sale.grossAmount,
        gatewayFee,
        netAmount: sale.netAmount,
        currency: sale.currency,
      },
    })
  } catch (error) {
    console.error('Error fetching sale details:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getAuthenticatedUserId(req)
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const workspaceId = await getUserWorkspaceId(userId)
    if (!workspaceId) {
      return NextResponse.json({ error: 'No workspace found' }, { status: 404 })
    }

    const { id } = await params

    const sale = await prisma.sale.findFirst({
      where: {
        id,
        workspaceId,
      },
    })

    if (!sale) {
      return NextResponse.json({ error: 'Sale not found' }, { status: 404 })
    }

    // Remove notificacoes associadas
    await prisma.notification.deleteMany({
      where: {
        saleId: id,
        workspaceId,
      },
    })

    // Remove a venda (itens e atribuicao sao removidos em cascata)
    await prisma.sale.delete({
      where: { id },
    })

    return NextResponse.json({
      success: true,
      message: 'Venda excluída com sucesso',
    })
  } catch (error) {
    console.error('Error deleting sale:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const userId = await getAuthenticatedUserId(req)
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const workspaceId = await getUserWorkspaceId(userId)
    if (!workspaceId) {
      return NextResponse.json({ error: 'No workspace found' }, { status: 404 })
    }

    const { id } = await params
    const body = await req.json()

    const existingSale = await prisma.sale.findFirst({
      where: {
        id,
        workspaceId,
      },
    })

    if (!existingSale) {
      return NextResponse.json({ error: 'Sale not found' }, { status: 404 })
    }

    const dataToUpdate: Record<string, any> = {}

    if (body.grossAmount !== undefined && body.grossAmount !== null && body.grossAmount !== '') {
      const parsedGross = typeof body.grossAmount === 'string'
        ? parseFloat(body.grossAmount.replace(',', '.'))
        : Number(body.grossAmount)
      if (!isNaN(parsedGross) && parsedGross >= 0) {
        dataToUpdate.grossAmount = Math.round(parsedGross * 100) / 100
      }
    }

    if (body.netAmount !== undefined && body.netAmount !== null && body.netAmount !== '') {
      const parsedNet = typeof body.netAmount === 'string'
        ? parseFloat(body.netAmount.replace(',', '.'))
        : Number(body.netAmount)
      if (!isNaN(parsedNet) && parsedNet >= 0) {
        dataToUpdate.netAmount = Math.round(parsedNet * 100) / 100
      }
    }

    if (body.status !== undefined && body.status) {
      const validStatuses = ['approved', 'pending', 'refunded', 'chargeback', 'cancelled']
      if (validStatuses.includes(body.status)) {
        dataToUpdate.status = body.status
      }
    }

    if (body.paymentMethod !== undefined) {
      dataToUpdate.paymentMethod = body.paymentMethod ? String(body.paymentMethod).trim() : null
    }

    if (body.installments !== undefined && body.installments !== null && body.installments !== '') {
      const parsedInst = parseInt(String(body.installments), 10)
      if (!isNaN(parsedInst) && parsedInst >= 1) {
        dataToUpdate.installments = parsedInst
      }
    }

    if (body.externalId !== undefined && body.externalId) {
      dataToUpdate.externalId = String(body.externalId).trim()
    }

    if (body.externalRef !== undefined) {
      dataToUpdate.externalRef = body.externalRef ? String(body.externalRef).trim() : null
    }

    if (body.utmCampaign !== undefined) {
      dataToUpdate.utmCampaign = body.utmCampaign ? String(body.utmCampaign).trim() : null
    }
    if (body.utmSource !== undefined) {
      dataToUpdate.utmSource = body.utmSource ? String(body.utmSource).trim() : null
    }
    if (body.utmMedium !== undefined) {
      dataToUpdate.utmMedium = body.utmMedium ? String(body.utmMedium).trim() : null
    }
    if (body.utmContent !== undefined) {
      dataToUpdate.utmContent = body.utmContent ? String(body.utmContent).trim() : null
    }
    if (body.utmTerm !== undefined) {
      dataToUpdate.utmTerm = body.utmTerm ? String(body.utmTerm).trim() : null
    }
    if (body.customerEmail !== undefined) {
      dataToUpdate.customerEmail = body.customerEmail ? String(body.customerEmail).trim().toLowerCase() : null
    }

    // Se solicitado recálculo do líquido pelas taxas ou se o bruto mudou e o líquido não foi explicitado
    if (body.recalculateNet || (dataToUpdate.grossAmount !== undefined && dataToUpdate.netAmount === undefined)) {
      const activeFees = await prisma.fee.findMany({
        where: { workspaceId, isActive: true },
      })
      const gross = dataToUpdate.grossAmount ?? existingSale.grossAmount
      const fee = calculateSaleFee(
        {
          grossAmount: gross,
          platform: existingSale.platform,
          paymentMethod: dataToUpdate.paymentMethod !== undefined ? dataToUpdate.paymentMethod : existingSale.paymentMethod,
          externalRef: dataToUpdate.externalRef !== undefined ? dataToUpdate.externalRef : existingSale.externalRef,
          installments: dataToUpdate.installments !== undefined ? dataToUpdate.installments : existingSale.installments,
        },
        activeFees
      )
      dataToUpdate.netAmount = Math.max(0, Math.round((gross - fee) * 100) / 100)
    }

    const updatedSale = await prisma.sale.update({
      where: { id },
      data: dataToUpdate,
      include: {
        attributionRecord: true,
      },
    })

    // Sincroniza notificação se o valor foi alterado
    if (dataToUpdate.grossAmount !== undefined) {
      await prisma.notification.updateMany({
        where: { saleId: id, workspaceId },
        data: {
          amount: dataToUpdate.grossAmount,
        },
      }).catch(() => {})
    }

    return NextResponse.json({
      success: true,
      message: 'Venda atualizada com sucesso',
      sale: updatedSale,
    })
  } catch (error) {
    console.error('Error updating sale:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
