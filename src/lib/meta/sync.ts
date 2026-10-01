import { prisma } from '@/lib/db'
import { decrypt } from '@/lib/encryption'
import { MetaApiClient, MetaApiError, type MetaAction } from './client'
import { metaCooldownRemaining, summarizeMetaSyncError } from './rate-limit'

export interface SyncResult {
  success: boolean
  campaigns: number
  adSets: number
  ads: number
  insights: number
  errors: string[]
  reconnectRequired?: boolean
  rateLimited?: boolean
}
export function parseConversions(
  actions: MetaAction[] | undefined | null,
  actionValues?: MetaAction[] | undefined | null
): { conversions: number; conversionValue: number } {
  let conversions = 0
  let conversionValue = 0

  if (Array.isArray(actions)) {
    // Tipos de ação de compra canônicos da Meta em ordem estrita de prioridade
    // IMPORTANTE: Nunca somar tipos de compra diferentes! A Meta retorna 'offsite_conversion.fb_pixel_purchase',
    // 'purchase', 'omni_purchase' e 'onsite_web_purchase' para a MESMA conversão (duplicando de 4x a 7x).
    const purchaseAction =
      actions.find((a) => a.action_type === 'offsite_conversion.fb_pixel_purchase') ||
      actions.find((a) => a.action_type === 'purchase') ||
      actions.find((a) => a.action_type === 'omni_purchase') ||
      actions.find((a) => a.action_type === 'onsite_web_purchase') ||
      actions.find((a) => a.action_type.endsWith('_purchase')) ||
      actions.find((a) => a.action_type.includes('purchase'))

    if (purchaseAction) {
      conversions = parseInt(purchaseAction.value, 10) || 0
    }
  }

  if (Array.isArray(actionValues)) {
    const valueAction =
      actionValues.find((a) => a.action_type === 'offsite_conversion.fb_pixel_purchase') ||
      actionValues.find((a) => a.action_type === 'purchase') ||
      actionValues.find((a) => a.action_type === 'omni_purchase') ||
      actionValues.find((a) => a.action_type === 'onsite_web_purchase') ||
      actionValues.find((a) => a.action_type.endsWith('_purchase')) ||
      actionValues.find((a) => a.action_type.includes('purchase'))

    if (valueAction) {
      conversionValue = parseFloat(valueAction.value) || 0
    }
  }

  return { conversions, conversionValue }
}

export async function syncAdAccount(workspaceId: string, adAccountDbId: string, ignoreRateLimitCooldown = false): Promise<SyncResult> {
  let syncLogId: string | null = null

  try {
    const account = await prisma.adAccount.findFirst({
      where: { id: adAccountDbId, workspaceId }
    })

    if (!account) {
      return { success: false, campaigns: 0, adSets: 0, ads: 0, insights: 0, errors: ['Conta de anúncios não encontrada no workspace'] }
    }
    if (!account.accessTokenEnc) {
      return { success: false, campaigns: 0, adSets: 0, ads: 0, insights: 0, errors: ['Nenhum token configurado para esta conta'] }
    }

    const previousSync = await prisma.syncLog.findFirst({
      where: { workspaceId, adAccountId: account.id, type: 'meta_ads', status: { in: ['success', 'partial', 'failed'] } },
      orderBy: { startedAt: 'desc' },
      select: { startedAt: true, errorMessage: true },
    })
    const cooldown = previousSync ? metaCooldownRemaining(previousSync.startedAt, previousSync.errorMessage) : 0
    if (cooldown > 0 && !ignoreRateLimitCooldown) {
      return { success: false, campaigns: 0, adSets: 0, ads: 0, insights: 0,
        errors: [`Limite da Meta ativo. Nova tentativa em cerca de ${Math.ceil(cooldown / 60000)} minuto(s).`], rateLimited: true }
    }

    let token: string
    try {
      token = decrypt(account.accessTokenEnc)
    } catch {
      await prisma.adAccount.update({
        where: { id: account.id },
        data: { status: 'reconnect_required' }
      })
      return { success: false, campaigns: 0, adSets: 0, ads: 0, insights: 0, errors: ['Token corrompido. Reconexão necessária.'], reconnectRequired: true }
    }

    const client = new MetaApiClient(token)

    const syncLog = await prisma.syncLog.create({
      data: {
        workspaceId,
        adAccountId: account.id,
        status: 'running',
        type: 'meta_ads'
      }
    })
    syncLogId = syncLog.id

    // 1. Sincronizar Campanhas
    const campaigns = await client.getCampaigns(account.externalId)
    let totalAdSets = 0
    let totalAds = 0
    let totalInsights = 0
    const syncErrors: string[] = []
    let reconnectRequired = false
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: account.timezone,
      year: 'numeric', month: '2-digit', day: '2-digit'
    })
    const todayStr = formatter.format(new Date())
    const lastFullSync = await prisma.syncLog.findFirst({
      where: { workspaceId, adAccountId: account.id, type: 'meta_ads', status: 'success', startedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) }, details: { contains: '"history":true' } },
      orderBy: { startedAt: 'desc' }
    })
    const history = !lastFullSync
    const sinceStr = formatter.format(new Date(Date.now() - (history ? 95 : 7) * 86400000))

    const campaignDbMap = new Map<string, string>() // externalId -> dbId
    const adSetDbMap = new Map<string, string>() // externalId -> dbId
    const adDbMap = new Map<string, string>() // externalId -> dbId

    // Consultar cada coleção uma vez por conta evita uma requisição por campanha/conjunto.
    const accountAdSets = await client.getAccountAdSets(account.externalId)
    const accountAds = await client.getAccountAds(account.externalId)
    const adSetsByCampaign = new Map<string, typeof accountAdSets>()
    for (const adSet of accountAdSets) {
      const group = adSetsByCampaign.get(adSet.campaign_id) || []
      group.push(adSet)
      adSetsByCampaign.set(adSet.campaign_id, group)
    }
    const adsByAdSet = new Map<string, typeof accountAds>()
    for (const ad of accountAds) {
      const group = adsByAdSet.get(ad.adset_id) || []
      group.push(ad)
      adsByAdSet.set(ad.adset_id, group)
    }

    for (const c of campaigns) {
      const dbCampaign = await prisma.campaign.upsert({
        where: {
          adAccountId_externalId: {
            adAccountId: account.id,
            externalId: c.id
          }
        },
        update: {
          name: c.name,
          status: c.status || 'ACTIVE',
          objective: c.objective || null,
          buyingType: c.buying_type || null,
          dailyBudget: c.daily_budget ? parseFloat(c.daily_budget) / 100 : null,
          lifetimeBudget: c.lifetime_budget ? parseFloat(c.lifetime_budget) / 100 : null,
          startTime: c.start_time ? new Date(c.start_time) : null,
          stopTime: c.stop_time ? new Date(c.stop_time) : null,
          lastSyncAt: new Date()
        },
        create: {
          workspaceId,
          adAccountId: account.id,
          externalId: c.id,
          name: c.name,
          status: c.status || 'ACTIVE',
          objective: c.objective || null,
          buyingType: c.buying_type || null,
          dailyBudget: c.daily_budget ? parseFloat(c.daily_budget) / 100 : null,
          lifetimeBudget: c.lifetime_budget ? parseFloat(c.lifetime_budget) / 100 : null,
          startTime: c.start_time ? new Date(c.start_time) : null,
          stopTime: c.stop_time ? new Date(c.stop_time) : null,
          lastSyncAt: new Date()
        }
      })

      campaignDbMap.set(c.id, dbCampaign.id)

      // 2. Sincronizar Conjuntos de Anúncios (AdSets)
      try {
        const adSets = adSetsByCampaign.get(c.id) || []
        totalAdSets += adSets.length
        
        for (const as of adSets) {
          const dbAdSet = await prisma.adSet.upsert({
            where: {
              campaignId_externalId: {
                campaignId: dbCampaign.id,
                externalId: as.id
              }
            },
            update: {
              name: as.name,
              status: as.status || 'ACTIVE',
              dailyBudget: as.daily_budget ? parseFloat(as.daily_budget) / 100 : null,
              lifetimeBudget: as.lifetime_budget ? parseFloat(as.lifetime_budget) / 100 : null,
              optimizationGoal: as.optimization_goal || null,
              attributionSpec: as.attribution_spec ? JSON.stringify(as.attribution_spec) : null,
              billingEvent: as.billing_event || null,
              bidAmount: as.bid_amount ? parseFloat(as.bid_amount) / 100 : null,
              startTime: as.start_time ? new Date(as.start_time) : null,
              endTime: as.end_time ? new Date(as.end_time) : null,
              lastSyncAt: new Date()
            },
            create: {
              workspaceId,
              campaignId: dbCampaign.id,
              externalId: as.id,
              name: as.name,
              status: as.status || 'ACTIVE',
              dailyBudget: as.daily_budget ? parseFloat(as.daily_budget) / 100 : null,
              lifetimeBudget: as.lifetime_budget ? parseFloat(as.lifetime_budget) / 100 : null,
              optimizationGoal: as.optimization_goal || null,
              attributionSpec: as.attribution_spec ? JSON.stringify(as.attribution_spec) : null,
              billingEvent: as.billing_event || null,
              bidAmount: as.bid_amount ? parseFloat(as.bid_amount) / 100 : null,
              startTime: as.start_time ? new Date(as.start_time) : null,
              endTime: as.end_time ? new Date(as.end_time) : null,
              lastSyncAt: new Date()
            }
          })

          adSetDbMap.set(as.id, dbAdSet.id)

          // 3. Sincronizar Anúncios (Ads)
          try {
            const ads = adsByAdSet.get(as.id) || []
            totalAds += ads.length

            for (const ad of ads) {
              const dbAd = await prisma.ad.upsert({
                where: {
                  adSetId_externalId: {
                    adSetId: dbAdSet.id,
                    externalId: ad.id
                  }
                },
                update: {
                  name: ad.name,
                  status: ad.status || 'ACTIVE',
                  creativeId: ad.creative?.id || null,
                  previewUrl: ad.creative?.image_url || ad.creative?.thumbnail_url || null,
                  lastSyncAt: new Date()
                },
                create: {
                  workspaceId,
                  adSetId: dbAdSet.id,
                  externalId: ad.id,
                  name: ad.name,
                  status: ad.status || 'ACTIVE',
                  creativeId: ad.creative?.id || null,
                  previewUrl: ad.creative?.image_url || ad.creative?.thumbnail_url || null,
                  lastSyncAt: new Date()
                }
              })

              adDbMap.set(ad.id, dbAd.id)
            }
          } catch (adErr) {
            throw adErr
          }
        }
      } catch (adSetErr) {
        throw adSetErr
      }
    }

    // 4. Sincronizar Métricas e Insights Reais (Últimos 37 dias incluindo HOJE na timezone de Brasília)
    try {

      // 4.1 Insights de Campanhas
      const insights = await client.getInsights(account.externalId, 'campaign', undefined, sinceStr, todayStr)
      
      for (const ins of insights) {
        const campaignDbId = campaignDbMap.get(ins.campaign_id || '')
        if (!campaignDbId) continue

        const dateStart = new Date(ins.date_start)
        const dateStop = new Date(ins.date_stop)
        const spend = Number(ins.spend) || 0
        const impressions = Number(ins.impressions) || 0
        const reach = Number(ins.reach) || 0
        const clicks = Number(ins.clicks) || 0
        const uniqueClicks = Number(ins.unique_clicks) || 0
        const ctr = Number(ins.ctr) || (impressions > 0 ? (clicks / impressions) * 100 : 0)
        const cpc = Number(ins.cpc) || (clicks > 0 ? spend / clicks : 0)
        const cpm = Number(ins.cpm) || (impressions > 0 ? (spend / impressions) * 1000 : 0)
        const frequency = Number(ins.frequency) || (reach > 0 ? impressions / reach : 0)

        const { conversions, conversionValue } = parseConversions(ins.actions, ins.action_values)

        await prisma.campaignInsight.upsert({
          where: {
            campaignId_dateStart_dateStop: {
              campaignId: campaignDbId,
              dateStart,
              dateStop
            }
          },
          update: {
            spend,
            impressions,
            reach,
            clicks,
            uniqueClicks,
            ctr,
            cpc,
            cpm,
            frequency,
            conversions,
            conversionValue,
            actions: ins.actions ? JSON.stringify(ins.actions) : null
          },
          create: {
            campaignId: campaignDbId,
            dateStart,
            dateStop,
            spend,
            impressions,
            reach,
            clicks,
            uniqueClicks,
            ctr,
            cpc,
            cpm,
            frequency,
            conversions,
            conversionValue,
            actions: ins.actions ? JSON.stringify(ins.actions) : null
          }
        })

        totalInsights++
      }

      // 4.2 Insights de Conjuntos de Anúncios (AdSets)
      try {
        const adSetInsights = await client.getInsights(account.externalId, 'adset', undefined, sinceStr, todayStr)
        for (const ins of adSetInsights) {
          const adSetDbId = adSetDbMap.get(ins.adset_id || '')
          if (!adSetDbId) continue

          const dateStart = new Date(ins.date_start)
          const dateStop = new Date(ins.date_stop)
          const spend = Number(ins.spend) || 0
          const impressions = Number(ins.impressions) || 0
          const reach = Number(ins.reach) || 0
          const clicks = Number(ins.clicks) || 0
          const ctr = Number(ins.ctr) || (impressions > 0 ? (clicks / impressions) * 100 : 0)
          const cpc = Number(ins.cpc) || (clicks > 0 ? spend / clicks : 0)
          const cpm = Number(ins.cpm) || (impressions > 0 ? (spend / impressions) * 1000 : 0)
          const frequency = Number(ins.frequency) || (reach > 0 ? impressions / reach : 0)

          const { conversions, conversionValue } = parseConversions(ins.actions, ins.action_values)

          await prisma.adSetInsight.upsert({
            where: {
              adSetId_dateStart_dateStop: {
                adSetId: adSetDbId,
                dateStart,
                dateStop
              }
            },
            update: {
              spend,
              impressions,
              reach,
              clicks,
              ctr,
              cpc,
              cpm,
              frequency,
              conversions,
              conversionValue,
              actions: ins.actions ? JSON.stringify(ins.actions) : null
            },
            create: {
              adSetId: adSetDbId,
              dateStart,
              dateStop,
              spend,
              impressions,
              reach,
              clicks,
              ctr,
              cpc,
              cpm,
              frequency,
              conversions,
              conversionValue,
              actions: ins.actions ? JSON.stringify(ins.actions) : null
            }
          })

          totalInsights++
        }
      } catch (adSetErr) {
        if (adSetErr instanceof MetaApiError && adSetErr.isRateLimit) throw adSetErr
        if (adSetErr instanceof MetaApiError && adSetErr.isTokenInvalid) reconnectRequired = true
        syncErrors.push(`Insights de conjuntos: ${adSetErr instanceof Error ? adSetErr.message : 'erro desconhecido'}`)
        console.warn(`[Sync] Aviso ao buscar insights de adsets da conta ${account.externalId}:`, adSetErr)
      }

      // 4.3 Insights de Anúncios (Ads)
      try {
        const adInsights = await client.getInsights(account.externalId, 'ad', undefined, sinceStr, todayStr)
        for (const ins of adInsights) {
          const adDbId = adDbMap.get(ins.ad_id || '')
          if (!adDbId) continue

          const dateStart = new Date(ins.date_start)
          const dateStop = new Date(ins.date_stop)
          const spend = Number(ins.spend) || 0
          const impressions = Number(ins.impressions) || 0
          const reach = Number(ins.reach) || 0
          const clicks = Number(ins.clicks) || 0
          const ctr = Number(ins.ctr) || (impressions > 0 ? (clicks / impressions) * 100 : 0)
          const cpc = Number(ins.cpc) || (clicks > 0 ? spend / clicks : 0)
          const cpm = Number(ins.cpm) || (impressions > 0 ? (spend / impressions) * 1000 : 0)
          const frequency = Number(ins.frequency) || (reach > 0 ? impressions / reach : 0)

          const { conversions, conversionValue } = parseConversions(ins.actions, ins.action_values)

          await prisma.adInsight.upsert({
            where: {
              adId_dateStart_dateStop: {
                adId: adDbId,
                dateStart,
                dateStop
              }
            },
            update: {
              spend,
              impressions,
              reach,
              clicks,
              ctr,
              cpc,
              cpm,
              frequency,
              conversions,
              conversionValue,
              actions: ins.actions ? JSON.stringify(ins.actions) : null
            },
            create: {
              adId: adDbId,
              dateStart,
              dateStop,
              spend,
              impressions,
              reach,
              clicks,
              ctr,
              cpc,
              cpm,
              frequency,
              conversions,
              conversionValue,
              actions: ins.actions ? JSON.stringify(ins.actions) : null
            }
          })

          totalInsights++
        }
      } catch (adErr) {
        if (adErr instanceof MetaApiError && adErr.isRateLimit) throw adErr
        if (adErr instanceof MetaApiError && adErr.isTokenInvalid) reconnectRequired = true
        syncErrors.push(`Insights de anúncios: ${adErr instanceof Error ? adErr.message : 'erro desconhecido'}`)
        console.warn(`[Sync] Aviso ao buscar insights de anúncios da conta ${account.externalId}:`, adErr)
      }

    } catch (insightErr) {
      if (insightErr instanceof MetaApiError && insightErr.isRateLimit) throw insightErr
      if (insightErr instanceof MetaApiError && insightErr.isTokenInvalid) reconnectRequired = true
      syncErrors.push(`Insights de campanhas: ${insightErr instanceof Error ? insightErr.message : 'erro desconhecido'}`)
      console.warn(`[Sync] Aviso ao buscar insights da conta ${account.externalId}:`, insightErr)
    }

    // 5. Atualizar status da conta e data do último sync
    await prisma.adAccount.update({
      where: { id: account.id },
      data: { 
        ...(syncErrors.length === 0 ? { lastSyncAt: new Date() } : {}),
        status: reconnectRequired ? 'reconnect_required' : 'active'
      }
    })

    if (syncLogId) {
      await prisma.syncLog.update({
        where: { id: syncLogId },
        data: {
          status: syncErrors.length ? 'partial' : 'success',
          finishedAt: new Date(),
          errorMessage: syncErrors.length ? syncErrors.join('; ') : null,
          details: JSON.stringify({ since: sinceStr, until: todayStr, timezone: account.timezone, history,
            levels: {
              campaign: { success: !syncErrors.some(e => e.startsWith('Insights de campanhas')), errors: syncErrors.filter(e => e.startsWith('Insights de campanhas')) },
              adset: { success: !syncErrors.some(e => e.startsWith('Conjuntos') || e.startsWith('Insights de conjuntos')), errors: syncErrors.filter(e => e.startsWith('Conjuntos') || e.startsWith('Insights de conjuntos')) },
              ad: { success: !syncErrors.some(e => e.startsWith('Anúncios') || e.startsWith('Insights de anúncios')), errors: syncErrors.filter(e => e.startsWith('Anúncios') || e.startsWith('Insights de anúncios')) },
            }, errors: syncErrors }),
          itemsTotal: campaigns.length + totalAdSets + totalAds + totalInsights,
          itemsProcessed: campaigns.length + totalAdSets + totalAds + totalInsights
        }
      })
    }

    return {
      success: syncErrors.length === 0,
      campaigns: campaigns.length,
      adSets: totalAdSets,
      ads: totalAds,
      insights: totalInsights,
      errors: syncErrors,
      reconnectRequired
    }
  } catch (error: unknown) {
    const isRateLimit = error instanceof MetaApiError && error.isRateLimit
    if (!isRateLimit) console.error('Meta sync error:', error)
    const isTokenInvalid = error instanceof MetaApiError && error.isTokenInvalid
    const errorMsg = isRateLimit ? summarizeMetaSyncError(error.message)! : error instanceof Error ? error.message : 'Erro desconhecido na sincronização'

    if (isTokenInvalid) {
      await prisma.adAccount.update({
        where: { id: adAccountDbId },
        data: { status: 'reconnect_required' }
      }).catch(() => {})
    }

    if (syncLogId) {
      await prisma.syncLog.update({
        where: { id: syncLogId },
        data: {
          status: 'failed',
          errorMessage: errorMsg,
          details: JSON.stringify({ rateLimited: isRateLimit }),
          finishedAt: new Date()
        }
      }).catch(() => {})
    }

    return {
      success: false,
      campaigns: 0,
      adSets: 0,
      ads: 0,
      insights: 0,
      errors: [errorMsg],
      reconnectRequired: isTokenInvalid,
      rateLimited: isRateLimit
    }
  }
}

