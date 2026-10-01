import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { 
  normalizeSaleAmount, 
  normalizeNetAmount, 
  normalizeSaleStatus, 
  normalizeSalePaymentMethod, 
  normalizeSaleInstallments,
  normalizeSaleUtms, 
  upsertSale 
} from '@/lib/integrations/normalizer'
import { createSaleNotification, SaleNotificationType } from '@/lib/notifications/service'
import { authenticateWebhook } from '@/lib/integrations/webhook-auth'
import { claimWebhookEvent } from '@/lib/integrations/webhook-event'
import { auth } from '@/lib/auth'
import { getUserWorkspaceId } from '@/lib/workspace'

export async function POST(req: Request) {
  let webhookEventId: string | null = null
  try {
    const { searchParams } = new URL(req.url)
    const queryWs = searchParams.get('workspaceId') || searchParams.get('workspace_id') || req.headers.get('x-workspace-id')
    const token = searchParams.get('token') || searchParams.get('signature') || req.headers.get('x-kiwify-signature')

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
      platform: 'kiwify',
      providedToken: token,
      queryWorkspaceId: queryWs,
      globalEnvSecret: process.env.KIWIFY_WEBHOOK_SECRET,
      sessionWorkspaceId
    })

    if (!authResult.authorized) {
      return NextResponse.json({ error: authResult.error }, { status: authResult.status })
    }

    const workspaceId = authResult.workspaceId!

    const payload = await req.json().catch(() => null)
    if (!payload) {
      return NextResponse.json({ error: 'Invalid JSON payload' }, { status: 400 })
    }

    const rawOrderId = payload.order_id || payload.orderId || payload.id
    if (rawOrderId === undefined || rawOrderId === null || !String(rawOrderId).trim()) {
      return NextResponse.json({ error: 'Missing order ID' }, { status: 400 })
    }
    const orderId = String(rawOrderId).trim()
    const rawStatus = String(payload.order_status || payload.status || 'paid')

    const status = normalizeSaleStatus(rawStatus, 'kiwify')
    const grossPrice = normalizeSaleAmount(payload, 'kiwify')
    const netPrice = normalizeNetAmount(payload, 'kiwify', grossPrice)
    const paymentMethod = normalizeSalePaymentMethod(payload, 'kiwify')
    const utms = normalizeSaleUtms(payload)

    const idempotencyKey = `kiwify_${workspaceId}_${orderId}_${status}`
    const claim = await claimWebhookEvent({
      idempotencyKey, workspaceId, source: 'kiwify', eventType: rawStatus, payload
    })
    if (!claim.claimed) {
      return NextResponse.json({
        success: true,
        message: claim.status === 'processed' ? 'Already processed' : 'Already processing',
        idempotencyKey
      }, { status: claim.status === 'processed' ? 200 : 202 })
    }
    webhookEventId = claim.eventId

    const customer = (payload.Customer as Record<string, unknown>) || (payload.customer as Record<string, unknown>) || {}
    const product = (payload.Product as Record<string, unknown>) || (payload.product as Record<string, unknown>) || {}
    const commissions = (payload.Commissions as Record<string, unknown>) || (payload.commissions as Record<string, unknown>) || {}

    const email = customer.email ? String(customer.email) : undefined
    const phone = customer.mobile || customer.phone ? String(customer.mobile || customer.phone) : undefined
    const createdAt = payload.created_at || payload.createdAt || Date.now()

    const sale = await upsertSale({
      workspaceId,
      platform: 'kiwify',
      externalId: orderId,
      externalRef: paymentMethod,
      paymentMethod,
      installments: normalizeSaleInstallments(payload, 'kiwify'),
      status,
      grossAmount: grossPrice,
      netAmount: netPrice,
      currency: String(commissions.currency || payload.currency || 'BRL'),
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
      orderedAt: new Date(createdAt),
      approvedAt: status === 'approved' ? (payload.approved_date ? new Date(payload.approved_date) : new Date()) : undefined,
      refundedAt: status === 'refunded' ? new Date() : undefined,
      productInfo: product.product_name || product.name ? {
        id: product.product_id ? String(product.product_id) : undefined,
        name: String(product.product_name || product.name),
      } : undefined
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
          grossAmount: grossPrice,
          netAmount: netPrice,
          capi: sale.capiResult
        })
      }
    })

    // Disparo de notificação oficial com som correspondente
    let notifType: SaleNotificationType = 'sale_pending'
    if (status === 'approved') notifType = 'sale_approved'
    else if (status === 'refunded') notifType = 'refund'
    else if (status === 'chargeback') notifType = 'chargeback'
    else if (rawStatus.toLowerCase().includes('pix') || paymentMethod === 'pix') notifType = 'pix_pending'

    await createSaleNotification({
      workspaceId,
      type: notifType,
      amount: grossPrice,
      currency: String(commissions.currency || payload.currency || 'BRL'),
      platform: 'Kiwify',
      product: product.product_name ? String(product.product_name) : undefined,
      saleId: sale.id,
      transactionId: orderId,
    }).catch(e => console.error('[Kiwify Webhook] Notification dispatch error:', e))

    return NextResponse.json({
      success: true,
      saleId: sale.id,
      status: sale.status,
      idempotencyKey,
      capi: sale.capiResult
    })
  } catch (error) {
    console.error('[Kiwify Webhook] Error:', error)
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
