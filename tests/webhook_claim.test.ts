import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/db'
import { claimWebhookEvent } from '../src/lib/integrations/webhook-event'

describe('Reserva idempotente de webhook', () => {
  it('processa uma entrega por vez e permite tentar novamente após falha', async () => {
    const suffix = Math.random().toString(36).slice(2)
    const workspace = await prisma.workspace.create({
      data: { name: 'Webhook claim test', slug: 'webhook-claim-' + suffix },
    })
    const idempotencyKey = 'getfy_' + workspace.id + '_order-1_approved'
    const params = {
      idempotencyKey,
      workspaceId: workspace.id,
      source: 'getfy',
      eventType: 'approved',
      payload: { order_id: 'order-1' },
    }
    try {
      const first = await claimWebhookEvent(params)
      assert.equal(first.claimed, true)
      const concurrent = await claimWebhookEvent(params)
      assert.deepEqual(concurrent, { claimed: false, status: 'processing' })

      if (!first.claimed) throw new Error('First delivery did not claim event')
      await prisma.webhookEvent.update({
        where: { id: first.eventId },
        data: { receivedAt: new Date(Date.now() - 10 * 60 * 1000) },
      })
      const staleRetry = await claimWebhookEvent(params)
      assert.deepEqual(staleRetry, { claimed: true, eventId: first.eventId })
      await prisma.webhookEvent.update({ where: { id: first.eventId }, data: { status: 'failed' } })
      const retry = await claimWebhookEvent(params)
      assert.deepEqual(retry, { claimed: true, eventId: first.eventId })
      await prisma.webhookEvent.update({ where: { id: first.eventId }, data: { status: 'processed' } })
      const duplicate = await claimWebhookEvent(params)
      assert.deepEqual(duplicate, { claimed: false, status: 'processed' })
    } finally {
      await prisma.webhookEvent.deleteMany({ where: { workspaceId: workspace.id } })
      await prisma.workspace.delete({ where: { id: workspace.id } })
    }
  })
})
