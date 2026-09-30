import { Prisma } from '@prisma/client'
import { prisma } from '@/lib/db'

type ClaimResult =
  | { claimed: true; eventId: string }
  | { claimed: false; status: 'processed' | 'processing' }

export async function claimWebhookEvent(params: {
  idempotencyKey: string
  workspaceId: string
  source: string
  eventType: string
  payload: unknown
}): Promise<ClaimResult> {
  try {
    const event = await prisma.webhookEvent.create({
      data: { ...params, payload: JSON.stringify(params.payload), status: 'processing' },
    })
    return { claimed: true, eventId: event.id }
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error
  }

  const existing = await prisma.webhookEvent.findUnique({ where: { idempotencyKey: params.idempotencyKey } })
  if (!existing || existing.workspaceId !== params.workspaceId) {
    throw new Error('Webhook event ownership conflict')
  }
  const staleBefore = new Date(Date.now() - 5 * 60 * 1000)
  if (existing.status === 'failed' || (existing.status === 'processing' && existing.receivedAt < staleBefore)) {
    const claim = await prisma.webhookEvent.updateMany({
      where: {
        id: existing.id,
        OR: [{ status: 'failed' }, { status: 'processing', receivedAt: { lt: staleBefore } }],
      },
      data: { status: 'processing', receivedAt: new Date(), errorMessage: null },
    })
    if (claim.count === 1) return { claimed: true, eventId: existing.id }
  }
  return { claimed: false, status: existing.status === 'processed' ? 'processed' : 'processing' }
}
