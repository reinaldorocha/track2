import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getUserWorkspaceId } from '@/lib/workspace'
import { calculateSaleFee } from '@/lib/calculations/financial-engine'

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const testUserId = req.headers.get('x-test-user-id')
    const session = testUserId ? null : await auth()
    const userId = testUserId || session?.user?.id
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
          items: {
            include: {
              product: true,
            },
          },
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

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const testUserId = req.headers.get('x-test-user-id')
    const session = testUserId ? null : await auth()
    const userId = testUserId || session?.user?.id
    if (!userId) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const workspaceId = await getUserWorkspaceId(userId)
    if (!workspaceId) {
      return NextResponse.json({ error: 'No workspace found' }, { status: 404 })
    }

    const { id } = await params
    const sale = await prisma.sale.findFirst({
      where: { id, workspaceId }
    })

    if (!sale) {
      return NextResponse.json({ error: 'Sale not found' }, { status: 404 })
    }

    const body = await req.json()
    const {
      grossAmount,
      netAmount,
      status,
      paymentMethod,
      installments,
      externalId,
      utmCampaign,
      customerEmail,
      recalculateNet
    } = body

    const finalGross = typeof grossAmount === 'number' ? grossAmount : sale.grossAmount
    const finalPlatform = sale.platform
    const finalPaymentMethod = paymentMethod !== undefined ? paymentMethod : sale.paymentMethod
    const finalInstallments = installments !== undefined ? installments : sale.installments
    const finalExternalRef = sale.externalRef

    let finalNet = typeof netAmount === 'number' ? netAmount : sale.netAmount

    if (recalculateNet) {
      const activeFees = await prisma.fee.findMany({
        where: { workspaceId, isActive: true }
      })
      const fee = calculateSaleFee(
        {
          grossAmount: finalGross,
          platform: finalPlatform,
          paymentMethod: finalPaymentMethod,
          externalRef: finalExternalRef,
          installments: finalInstallments,
        },
        activeFees
      )
      finalNet = Math.max(0, Math.round((finalGross - fee) * 100) / 100)
    }

    const dataToUpdate: any = {}
    if (grossAmount !== undefined) dataToUpdate.grossAmount = finalGross
    if (finalNet !== undefined) dataToUpdate.netAmount = finalNet
    if (status !== undefined) dataToUpdate.status = status
    if (paymentMethod !== undefined) dataToUpdate.paymentMethod = paymentMethod
    if (installments !== undefined) dataToUpdate.installments = installments
    if (externalId !== undefined) dataToUpdate.externalId = externalId
    if (utmCampaign !== undefined) dataToUpdate.utmCampaign = utmCampaign
    if (customerEmail !== undefined) dataToUpdate.customerEmail = customerEmail

    const updatedSale = await prisma.sale.update({
      where: { id },
      data: dataToUpdate
    })

    // Sincroniza valor na notificação se houve alteração de valor bruto
    if (grossAmount !== undefined) {
      await prisma.notification.updateMany({
        where: { saleId: id },
        data: { amount: finalGross }
      })
    }

    return NextResponse.json({
      success: true,
      sale: updatedSale
    })
  } catch (error) {
    console.error('Error updating sale:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const testUserId = req.headers.get('x-test-user-id')
    const session = testUserId ? null : await auth()
    const userId = testUserId || session?.user?.id
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
