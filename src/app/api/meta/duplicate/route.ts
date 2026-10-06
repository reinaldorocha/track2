import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getUserWorkspaceId } from '@/lib/workspace'
import { decrypt } from '@/lib/encryption'
import { MetaApiClient, type MetaCampaign, type MetaAdSet, type MetaAd } from '@/lib/meta/client'
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
    let originalCampaignDbId: string | null = null
    let originalAdSetDbId: string | null = null
    let originalName = ''

    if (level === 'campaign') {
      const item = await prisma.campaign.findFirst({
        where: { workspaceId, OR: [{ id }, { externalId: id }] },
        include: { adAccount: true },
      })
      if (!item) return NextResponse.json({ error: 'Campanha não encontrada' }, { status: 404 })
      accountId = item.adAccountId
      externalId = item.externalId
      token = item.adAccount.accessTokenEnc
      originalCampaignDbId = item.id
      originalName = item.name
    } else if (level === 'adset') {
      const item = await prisma.adSet.findFirst({
        where: { workspaceId, OR: [{ id }, { externalId: id }] },
        include: { campaign: { include: { adAccount: true } } },
      })
      if (!item) return NextResponse.json({ error: 'Conjunto não encontrado' }, { status: 404 })
      accountId = item.campaign.adAccountId
      externalId = item.externalId
      token = item.campaign.adAccount.accessTokenEnc
      originalCampaignDbId = item.campaignId
      originalAdSetDbId = item.id
      originalName = item.name
    } else {
      const item = await prisma.ad.findFirst({
        where: { workspaceId, OR: [{ id }, { externalId: id }] },
        include: { adSet: { include: { campaign: { include: { adAccount: true } } } } },
      })
      if (!item) return NextResponse.json({ error: 'Anúncio não encontrado' }, { status: 404 })
      accountId = item.adSet.campaign.adAccountId
      externalId = item.externalId
      token = item.adSet.campaign.adAccount.accessTokenEnc
      originalAdSetDbId = item.adSetId
      originalName = item.name
    }

    if (!token) return NextResponse.json({ error: 'Conta Meta sem token de acesso' }, { status: 400 })

    const client = new MetaApiClient(decrypt(token))
    console.log(`[Meta Duplicate] Iniciando duplicação (${level}): ${externalId}`)

    const result = level === 'campaign'
      ? await client.duplicateCampaign(externalId, { deepCopy: true, status: 'PAUSED', suffix })
      : level === 'adset'
        ? await client.duplicateAdSet(externalId, { deepCopy: true, status: 'PAUSED', suffix })
        : await client.duplicateAd(externalId, { status: 'PAUSED', suffix })

    console.log('[Meta Duplicate] Resposta da Meta:', result)

    const rawResult = result as Record<string, unknown>
    const copiedId = (
      result.id ||
      rawResult.copied_id ||
      rawResult.copied_parent_id ||
      (Array.isArray(rawResult.campaigns) ? (rawResult.campaigns as Array<{ id: string }>)[0]?.id : undefined) ||
      (Array.isArray(rawResult.adsets) ? (rawResult.adsets as Array<{ id: string }>)[0]?.id : undefined) ||
      (Array.isArray(rawResult.ads) ? (rawResult.ads as Array<{ id: string }>)[0]?.id : undefined)
    ) as string | undefined

    if (!copiedId) {
      return NextResponse.json(
        { error: 'A Meta não retornou o ID do objeto duplicado.', metaResponse: result },
        { status: 400 }
      )
    }

    // Upsert rápido e direto no banco de dados local para resposta imediata ao usuário (<1s)
    let createdItem: unknown = null

    if (level === 'campaign') {
      let metaDetails: MetaCampaign | null = null
      try {
        metaDetails = await client.get<MetaCampaign>(`/${copiedId}`, {
          fields: 'id,name,status,objective,buying_type,daily_budget,lifetime_budget,start_time,stop_time',
        })
      } catch (err) {
        console.warn('[Meta Duplicate] Aviso: não foi possível buscar detalhes imediatos da campanha:', err)
      }

      createdItem = await prisma.campaign.upsert({
        where: {
          adAccountId_externalId: {
            adAccountId: accountId,
            externalId: String(copiedId),
          },
        },
        update: {
          name: metaDetails?.name || `${originalName}${suffix}`,
          status: metaDetails?.status || 'PAUSED',
          objective: metaDetails?.objective || null,
          buyingType: metaDetails?.buying_type || null,
          dailyBudget: metaDetails?.daily_budget ? parseFloat(metaDetails.daily_budget) / 100 : null,
          lifetimeBudget: metaDetails?.lifetime_budget ? parseFloat(metaDetails.lifetime_budget) / 100 : null,
          startTime: metaDetails?.start_time ? new Date(metaDetails.start_time) : null,
          stopTime: metaDetails?.stop_time ? new Date(metaDetails.stop_time) : null,
          lastSyncAt: new Date(),
        },
        create: {
          workspaceId,
          adAccountId: accountId,
          externalId: String(copiedId),
          name: metaDetails?.name || `${originalName}${suffix}`,
          status: metaDetails?.status || 'PAUSED',
          objective: metaDetails?.objective || null,
          buyingType: metaDetails?.buying_type || null,
          dailyBudget: metaDetails?.daily_budget ? parseFloat(metaDetails.daily_budget) / 100 : null,
          lifetimeBudget: metaDetails?.lifetime_budget ? parseFloat(metaDetails.lifetime_budget) / 100 : null,
          startTime: metaDetails?.start_time ? new Date(metaDetails.start_time) : null,
          stopTime: metaDetails?.stop_time ? new Date(metaDetails.stop_time) : null,
          lastSyncAt: new Date(),
        },
      })
    } else if (level === 'adset') {
      let metaDetails: MetaAdSet | null = null
      try {
        metaDetails = await client.get<MetaAdSet>(`/${copiedId}`, {
          fields: 'id,campaign_id,name,status,daily_budget,lifetime_budget,optimization_goal,billing_event,bid_amount,start_time,end_time',
        })
      } catch (err) {
        console.warn('[Meta Duplicate] Aviso: não foi possível buscar detalhes imediatos do conjunto:', err)
      }

      if (originalCampaignDbId) {
        createdItem = await prisma.adSet.upsert({
          where: {
            campaignId_externalId: {
              campaignId: originalCampaignDbId,
              externalId: String(copiedId),
            },
          },
          update: {
            name: metaDetails?.name || `${originalName}${suffix}`,
            status: metaDetails?.status || 'PAUSED',
            dailyBudget: metaDetails?.daily_budget ? parseFloat(metaDetails.daily_budget) / 100 : null,
            lifetimeBudget: metaDetails?.lifetime_budget ? parseFloat(metaDetails.lifetime_budget) / 100 : null,
            optimizationGoal: metaDetails?.optimization_goal || null,
            billingEvent: metaDetails?.billing_event || null,
            bidAmount: metaDetails?.bid_amount ? parseFloat(metaDetails.bid_amount) / 100 : null,
            startTime: metaDetails?.start_time ? new Date(metaDetails.start_time) : null,
            endTime: metaDetails?.end_time ? new Date(metaDetails.end_time) : null,
            lastSyncAt: new Date(),
          },
          create: {
            workspaceId,
            campaignId: originalCampaignDbId,
            externalId: String(copiedId),
            name: metaDetails?.name || `${originalName}${suffix}`,
            status: metaDetails?.status || 'PAUSED',
            dailyBudget: metaDetails?.daily_budget ? parseFloat(metaDetails.daily_budget) / 100 : null,
            lifetimeBudget: metaDetails?.lifetime_budget ? parseFloat(metaDetails.lifetime_budget) / 100 : null,
            optimizationGoal: metaDetails?.optimization_goal || null,
            billingEvent: metaDetails?.billing_event || null,
            bidAmount: metaDetails?.bid_amount ? parseFloat(metaDetails.bid_amount) / 100 : null,
            startTime: metaDetails?.start_time ? new Date(metaDetails.start_time) : null,
            endTime: metaDetails?.end_time ? new Date(metaDetails.end_time) : null,
            lastSyncAt: new Date(),
          },
        })
      }
    } else {
      let metaDetails: MetaAd | null = null
      try {
        metaDetails = await client.get<MetaAd>(`/${copiedId}`, {
          fields: 'id,adset_id,name,status,creative',
        })
      } catch (err) {
        console.warn('[Meta Duplicate] Aviso: não foi possível buscar detalhes imediatos do anúncio:', err)
      }

      if (originalAdSetDbId) {
        createdItem = await prisma.ad.upsert({
          where: {
            adSetId_externalId: {
              adSetId: originalAdSetDbId,
              externalId: String(copiedId),
            },
          },
          update: {
            name: metaDetails?.name || `${originalName}${suffix}`,
            status: metaDetails?.status || 'PAUSED',
            previewUrl: metaDetails?.creative?.image_url || metaDetails?.creative?.thumbnail_url || null,
            creativeId: metaDetails?.creative?.id || null,
            lastSyncAt: new Date(),
          },
          create: {
            workspaceId,
            adSetId: originalAdSetDbId,
            externalId: String(copiedId),
            name: metaDetails?.name || `${originalName}${suffix}`,
            status: metaDetails?.status || 'PAUSED',
            previewUrl: metaDetails?.creative?.image_url || metaDetails?.creative?.thumbnail_url || null,
            creativeId: metaDetails?.creative?.id || null,
            lastSyncAt: new Date(),
          },
        })
      }
    }

    // Dispara sincronização da conta em background (sem travar a resposta HTTP da requisição)
    syncAdAccount(workspaceId, accountId, true).catch((err) => {
      console.error('[Meta Duplicate Background Sync] Erro na sincronização pós-cópia:', err)
    })

    return NextResponse.json({
      success: true,
      message: 'Cópia criada na Meta com sucesso como Pausada!',
      externalId: copiedId,
      item: createdItem,
    })
  } catch (error) {
    console.error('[Meta Duplicate] Erro:', error)
    const message = error instanceof Error ? error.message : 'Erro ao duplicar na Meta'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
