import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { 
  normalizeSaleAmount, 
  normalizeNetAmount, 
  normalizeSaleStatus, 
  normalizeSalePaymentMethod, 
  normalizeSaleInstallments,
  normalizeSaleUtms, 
  upsertSale,
  InternalSaleItem
} from '@/lib/integrations/normalizer'
import { createSaleNotification, SaleNotificationType } from '@/lib/notifications/service'
import { authenticateWebhook } from '@/lib/integrations/webhook-auth'
import { claimWebhookEvent } from '@/lib/integrations/webhook-event'
import { auth } from '@/lib/auth'
import { getUserWorkspaceId } from '@/lib/workspace'
import { calculateSaleFee } from '@/lib/calculations/financial-engine'

export async function POST(req: Request) {
  let webhookEventId: string | null = null
  try {
    const { searchParams } = new URL(req.url)
    const queryWs = searchParams.get('workspaceId') || searchParams.get('workspace_id') || req.headers.get('x-workspace-id')

    // Bearer token ou query token
    const authHeader = req.headers.get('authorization') || ''
    const bearerToken = authHeader.toLowerCase().startsWith('bearer ') ? authHeader.slice(7).trim() : null
    const token = searchParams.get('token') || searchParams.get('signature') || req.headers.get('x-getfy-signature') || bearerToken

    let sessionWorkspaceId: string | null = null
    const cookie = req.headers.get('cookie') || ''
    if (cookie.includes('session-token')) {
      try {
        const session = await auth()
        if (session?.user?.id) {
          sessionWorkspaceId = await getUserWorkspaceId(session.user.id)
        }
      } catch {
        // Fallback se fora de contexto de sessão
      }
    }

    const authResult = await authenticateWebhook({
      platform: 'getfy',
      providedToken: token,
      queryWorkspaceId: queryWs,
      globalEnvSecret: process.env.GETFY_WEBHOOK_SECRET,
      sessionWorkspaceId
    })

    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    const workspaceId = authResult.workspaceId!

    const rawBody = await req.json().catch(() => null)
    if (!rawBody) {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 })
    }

    // Suporte tanto ao envelope { event, payload: { ... } } quanto ao payload direto
    const envelopePayload = ((rawBody.payload && typeof rawBody.payload === 'object') ? rawBody.payload : rawBody) as Record<string, unknown>
    const event = String(rawBody.event || envelopePayload.event || envelopePayload.status || 'pedido_pago')

    const order = (envelopePayload.order as Record<string, unknown>) || {}
    const customer = (envelopePayload.customer as Record<string, unknown>) || {}
    const product = (envelopePayload.product as Record<string, unknown>) || (envelopePayload.offer as Record<string, unknown>) || {}

    const rawOrderId = order.id || envelopePayload.order_id || envelopePayload.orderId || envelopePayload.id
    if (rawOrderId === undefined || rawOrderId === null || !String(rawOrderId).trim()) {
      return NextResponse.json({ error: 'Missing order ID' }, { status: 400 })
    }
    const orderId = String(rawOrderId).trim()

    const status = normalizeSaleStatus(event, 'getfy')
    const grossPrice = normalizeSaleAmount(envelopePayload, 'getfy')
    const paymentMethod = normalizeSalePaymentMethod(envelopePayload, 'getfy')
    const utms = normalizeSaleUtms(envelopePayload)
    const currency = String(order.currency || envelopePayload.currency || 'BRL')

    // 1. Extração da quantidade de parcelas no cartão e outros métodos:
    // Conforme especificação Getfy:
    // Quando cartão (payment.method === "card"):
    // - payload.payment.installments (inteiro, ex: 12)
    // - payload.payment.installments_text (string formatada, ex: "12x")
    // - payload.installments (inteiro no topo)
    // À vista (PIX, boleto ou cartão 1x): 1 (ou "1x")
    const payment = (envelopePayload.payment as Record<string, unknown>) || (rawBody.payment as Record<string, unknown>) || {}
    const rawInstallments =
      payment.installments ??
      payment.installments_text ??
      envelopePayload.installments ??
      rawBody.installments ??
      order.installments ??
      envelopePayload.order_installments

    let installments = 1
    if (rawInstallments !== undefined && rawInstallments !== null) {
      const parsed = parseInt(String(rawInstallments), 10)
      if (!isNaN(parsed) && parsed > 0) installments = parsed
    }

    // 2. Cálculo do valor líquido:
    // Se a plataforma não forneceu valor líquido exclusivo no payload,
    // calcula com base nas regras de taxas do workspace
    let netPrice = normalizeNetAmount(envelopePayload, 'getfy', grossPrice)

    const workspaceFees = await prisma.fee.findMany({
      where: { workspaceId, isActive: true },
    })

    if (workspaceFees.length > 0 && (netPrice === grossPrice || !envelopePayload.net_amount)) {
      const fee = calculateSaleFee(
        {
          grossAmount: grossPrice,
          platform: 'getfy',
          paymentMethod,
          externalRef: paymentMethod,
          installments,
        },
        workspaceFees
      )
      if (fee > 0) {
        netPrice = Math.max(0, Math.round((grossPrice - fee) * 100) / 100)
      }
    }

    const idempotencyKey = `getfy_${workspaceId}_${orderId}_${status}`
    const claim = await claimWebhookEvent({
      idempotencyKey, workspaceId, source: 'getfy', eventType: event, payload: rawBody
    })
    if (!claim.claimed) {
      return NextResponse.json({
        success: true,
        message: claim.status === 'processed' ? 'Already processed' : 'Already processing',
        idempotencyKey
      }, { status: claim.status === 'processed' ? 200 : 202 })
    }
    webhookEventId = claim.eventId

    const email = (customer.email || order.email || envelopePayload.email)
      ? String(customer.email || order.email || envelopePayload.email)
      : undefined
    const phone = (customer.phone || customer.mobile || order.phone || envelopePayload.phone)
      ? String(customer.phone || customer.mobile || order.phone || envelopePayload.phone)
      : undefined

    const createdAt = order.created_at || envelopePayload.created_at || envelopePayload.createdAt || Date.now()
    const paidAt = envelopePayload.paidAt || (status === 'approved' ? (order.updated_at || new Date()) : undefined)

    // Extração e normalização de Order Bumps enviados pelo Getfy
    const rawBumps = (
      envelopePayload.order_bumps ||
      rawBody.order_bumps ||
      order.order_bumps ||
      order.orderItems ||
      envelopePayload.order_items
    ) as Array<Record<string, unknown>> | undefined

    const validBumps: Array<{ id?: string; name: string; amount: number }> = []
    if (Array.isArray(rawBumps)) {
      for (const b of rawBumps) {
        const bAmount = Number(b.amount ?? b.price ?? b.value ?? 0)
        const bName = String(b.name || b.title || b.product_name || '').trim()
        const bId = b.product_id ? String(b.product_id) : (b.id ? String(b.id) : undefined)
        if (bName) {
          validBumps.push({
            id: bId,
            name: bName,
            amount: isNaN(bAmount) ? 0 : Math.max(0, bAmount)
          })
        }
      }
    }

    const totalBumpsAmount = validBumps.reduce((acc, b) => acc + b.amount, 0)
    const mainProductName = String(product.name || product.title || 'Produto Principal').trim()
    const mainProductId = product.id ? String(product.id) : undefined
    const mainProductPrice = Math.max(0, Math.round((grossPrice - totalBumpsAmount) * 100) / 100)

    const saleItems: InternalSaleItem[] = [
      {
        id: mainProductId,
        name: mainProductName,
        quantity: 1,
        unitPrice: mainProductPrice,
        totalPrice: mainProductPrice,
        isOrderBump: false
      },
      ...validBumps.map(b => ({
        id: b.id,
        name: b.name,
        quantity: 1,
        unitPrice: b.amount,
        totalPrice: b.amount,
        isOrderBump: true
      }))
    ]

    const sale = await upsertSale({
      workspaceId,
      platform: 'getfy',
      externalId: orderId,
      externalRef: paymentMethod,
      paymentMethod,
      installments,
      status,
      grossAmount: grossPrice,
      netAmount: netPrice,
      currency,
      customerEmail: email,
      customerPhone: phone,
      utmSource: utms.utmSource,
      utmMedium: utms.utmMedium,
      utmCampaign: utms.utmCampaign,
      utmContent: utms.utmContent,
      utmTerm: utms.utmTerm,
      fbclid: utms.fbclid,
      fbp: utms.fbp,
      fbc: utms.fbc,
      sessionId: utms.sessionId,
      orderedAt: new Date(createdAt as string | number),
      approvedAt: status === 'approved' ? (paidAt ? new Date(paidAt as string | number) : new Date()) : undefined,
      refundedAt: status === 'refunded' ? new Date() : undefined,
      productInfo: {
        id: mainProductId,
        name: mainProductName,
      },
      items: saleItems
    })

    await prisma.webhookEvent.update({
      where: { id: claim.eventId },
      data: {
        status: 'processed',
        processedAt: new Date(),
        processedData: JSON.stringify({
          saleId: sale.id,
          orderId,
          status,
          installments,
          paymentMethod,
          grossAmount: grossPrice,
          netAmount: sale.netAmount,
          itemsCount: saleItems.length,
          capi: sale.capiResult
        })
      }
    })

    // Notificação oficial com som correspondente
    let notifType: SaleNotificationType | null = null
    if (status === 'approved') notifType = 'sale_approved'
    else if (status === 'refunded') notifType = 'refund'
    else if (status === 'chargeback') notifType = 'chargeback'
    else if (status === 'pending') {
      if (event === 'pix_gerado' || paymentMethod === 'pix') notifType = 'pix_pending'
      else notifType = 'sale_pending'
    }

    if (notifType) {
      const bumpSummary = validBumps.length > 0 
        ? ` (+${validBumps.length} bump${validBumps.length > 1 ? 's' : ''})` 
        : ''
      await createSaleNotification({
        workspaceId,
        type: notifType,
        amount: grossPrice,
        currency,
        platform: 'Getfy',
        product: `${mainProductName}${bumpSummary}`,
        saleId: sale.id,
        transactionId: orderId,
      }).catch(e => console.error('[Getfy Webhook] Notification dispatch error:', e))
    }

    return NextResponse.json({
      success: true,
      saleId: sale.id,
      status: sale.status,
      idempotencyKey,
      capi: sale.capiResult
    })
  } catch (error) {
    console.error('[Getfy Webhook] Error:', error)
    if (webhookEventId) {
      await prisma.webhookEvent.update({
        where: { id: webhookEventId },
        data: {
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
          processedAt: new Date()
        }
      }).catch(() => {})
    }
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
