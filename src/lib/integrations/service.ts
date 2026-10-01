import crypto from 'crypto'
import { prisma } from '@/lib/db'

export const SUPPORTED_WEBHOOK_PLATFORMS = [
  { platform: 'getfy', name: 'Getfy', paramName: 'token' },
  { platform: 'kiwify', name: 'Kiwify', paramName: 'token' },
  { platform: 'cakto', name: 'Cakto', paramName: 'token' },
  { platform: 'hotmart', name: 'Hotmart', paramName: 'hottok' },
  { platform: 'yampi', name: 'Yampi', paramName: 'token' },
  { platform: 'shopify', name: 'Shopify', paramName: 'workspaceId' },
] as const

export function generateWebhookSecret(platform: string): string {
  const rand = crypto.randomBytes(16).toString('hex')
  return 'whsec_' + platform.toLowerCase() + '_' + rand
}

export function buildWebhookUrl(platform: string, secret: string | null | undefined, workspaceId: string, baseUrl?: string): string {
  const origin = (baseUrl || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000').replace(/\/+$/, '')
  const plat = platform.toLowerCase()

  if (plat === 'shopify') {
    return origin + '/api/webhooks/shopify?workspaceId=' + workspaceId
  }

  const token = secret || ''
  if (plat === 'hotmart') {
    return origin + '/api/webhooks/hotmart?hottok=' + token
  }

  return origin + '/api/webhooks/' + plat + '?token=' + token
}

export interface WorkspaceIntegrationDto {
  id: string
  workspaceId: string
  platform: string
  name: string
  status: string
  webhookSecret: string
  webhookUrl: string
  lastSyncAt: Date | null
  lastEventAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export async function getOrCreateWorkspaceIntegrations(
  workspaceId: string,
  baseUrl?: string
): Promise<WorkspaceIntegrationDto[]> {
  const existing = await prisma.integration.findMany({
    where: { workspaceId }
  })

  const results: WorkspaceIntegrationDto[] = []

  for (const item of SUPPORTED_WEBHOOK_PLATFORMS) {
    let integration = existing.find(i => i.platform.toLowerCase() === item.platform.toLowerCase())

    if (!integration) {
      const secret = generateWebhookSecret(item.platform)
      integration = await prisma.integration.create({
        data: {
          workspaceId,
          platform: item.platform,
          name: item.name,
          status: 'active',
          webhookSecret: secret
        }
      })
    } else if (!integration.webhookSecret) {
      const secret = generateWebhookSecret(item.platform)
      integration = await prisma.integration.update({
        where: { id: integration.id },
        data: {
          webhookSecret: secret,
          status: integration.status === 'inactive' ? 'active' : integration.status
        }
      })
    }

    results.push({
      id: integration.id,
      workspaceId: integration.workspaceId,
      platform: integration.platform,
      name: integration.name,
      status: integration.status,
      webhookSecret: integration.webhookSecret || '',
      webhookUrl: buildWebhookUrl(integration.platform, integration.webhookSecret, workspaceId, baseUrl),
      lastSyncAt: integration.lastSyncAt,
      lastEventAt: integration.lastEventAt,
      createdAt: integration.createdAt,
      updatedAt: integration.updatedAt
    })
  }

  return results
}

export async function rotateIntegrationSecret(
  workspaceId: string,
  platform: string,
  baseUrl?: string
): Promise<WorkspaceIntegrationDto> {
  const plat = platform.toLowerCase()
  const secret = generateWebhookSecret(plat)

  const meta = SUPPORTED_WEBHOOK_PLATFORMS.find(p => p.platform === plat)
  const name = meta?.name || platform

  const integration = await prisma.integration.upsert({
    where: {
      workspaceId_platform: {
        workspaceId,
        platform: plat
      }
    },
    update: {
      webhookSecret: secret,
      status: 'active'
    },
    create: {
      workspaceId,
      platform: plat,
      name,
      status: 'active',
      webhookSecret: secret
    }
  })

  return {
    id: integration.id,
    workspaceId: integration.workspaceId,
    platform: integration.platform,
    name: integration.name,
    status: integration.status,
    webhookSecret: integration.webhookSecret || '',
    webhookUrl: buildWebhookUrl(integration.platform, integration.webhookSecret, workspaceId, baseUrl),
    lastSyncAt: integration.lastSyncAt,
    lastEventAt: integration.lastEventAt,
    createdAt: integration.createdAt,
    updatedAt: integration.updatedAt
  }
}
