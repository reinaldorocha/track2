import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getUserWorkspaceId } from '@/lib/workspace'
import { decrypt } from '@/lib/encryption'
import { MetaApiClient } from '@/lib/meta/client'
import { syncAdAccount } from '@/lib/meta/sync'

export const maxDuration = 300

export async function POST(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const workspaceId = await getUserWorkspaceId(session.user.id)
  if (!workspaceId) return NextResponse.json({ error: 'No workspace' }, { status: 404 })

  try {
    const { level, id, suffix = ' - Cópia' } = await req.json()
    if (!['campaign', 'adset', 'ad'].includes(level) || typeof id !== 'string' || !id.trim() || typeof suffix !== 'string') {
      return NextResponse.json({ error: 'Nível, ID ou sufixo inválido' }, { status: 400 })
    }

    let accountId: string
    let externalId: string
    let token: string | null
    if (level === 'campaign') {
      const item = await prisma.campaign.findFirst({ where: { workspaceId, OR: [{ id }, { externalId: id }] }, include: { adAccount: true } })
      if (!item) return NextResponse.json({ error: 'Campanha não encontrada' }, { status: 404 })
      accountId = item.adAccountId
      externalId = item.externalId
      token = item.adAccount.accessTokenEnc
    } else if (level === 'adset') {
      const item = await prisma.adSet.findFirst({ where: { workspaceId, OR: [{ id }, { externalId: id }] }, include: { campaign: { include: { adAccount: true } } } })
      if (!item) return NextResponse.json({ error: 'Conjunto não encontrado' }, { status: 404 })
      accountId = item.campaign.adAccountId
      externalId = item.externalId
      token = item.campaign.adAccount.accessTokenEnc
    } else {
      const item = await prisma.ad.findFirst({ where: { workspaceId, OR: [{ id }, { externalId: id }] }, include: { adSet: { include: { campaign: { include: { adAccount: true } } } } } })
      if (!item) return NextResponse.json({ error: 'Anúncio não encontrado' }, { status: 404 })
      accountId = item.adSet.campaign.adAccountId
      externalId = item.externalId
      token = item.adSet.campaign.adAccount.accessTokenEnc
    }
    if (!token) return NextResponse.json({ error: 'Conta Meta sem token' }, { status: 409 })

    const client = new MetaApiClient(decrypt(token))
    const result = level === 'campaign'
      ? await client.duplicateCampaign(externalId, { deepCopy: true, status: 'PAUSED', suffix })
      : level === 'adset'
        ? await client.duplicateAdSet(externalId, { deepCopy: true, status: 'PAUSED', suffix })
        : await client.duplicateAd(externalId, { status: 'PAUSED', suffix })
    const copiedId = result.id
    if (!copiedId) {
      return NextResponse.json({ error: 'Meta não retornou o ID da cópia' }, { status: 502 })
    }

    // A Meta cria a hierarquia profunda; o sync importa os IDs reais dos filhos.
    const sync = await syncAdAccount(workspaceId, accountId)
    if (!sync.success) {
      return NextResponse.json({
        error: 'Cópia criada na Meta, mas a sincronização local falhou. Sincronize a conta antes de tentar novamente.',
        externalId: copiedId,
        syncErrors: sync.errors,
      }, { status: 502 })
    }
    const item = level === 'campaign'
      ? await prisma.campaign.findFirst({ where: { workspaceId, adAccountId: accountId, externalId: copiedId } })
      : level === 'adset'
        ? await prisma.adSet.findFirst({ where: { workspaceId, externalId: copiedId, campaign: { adAccountId: accountId } } })
        : await prisma.ad.findFirst({ where: { workspaceId, externalId: copiedId, adSet: { campaign: { adAccountId: accountId } } } })
    if (!item) {
      return NextResponse.json({
        error: 'Cópia criada na Meta, mas ainda não apareceu na sincronização. Aguarde e sincronize a conta.',
        externalId: copiedId,
      }, { status: 502 })
    }
    return NextResponse.json({ success: true, message: 'Cópia criada na Meta e sincronizada', item })
  } catch (error) {
    console.error('[Meta Duplicate] Error:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erro ao duplicar na Meta' }, { status: 502 })
  }
}
