import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getUserWorkspaceId } from '@/lib/workspace'
import { decrypt } from '@/lib/encryption'
import { MetaApiClient } from '@/lib/meta/client'

export async function PATCH(req: Request) {
  const session = await auth()
  if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const workspaceId = await getUserWorkspaceId(session.user.id)
  if (!workspaceId) return NextResponse.json({ error: 'No workspace' }, { status: 404 })

  try {
    const { level, id, ids, status, name, budget, budgetChangePercent } = await req.json()
    const targetIds: string[] = Array.isArray(ids) && ids.length ? ids : id ? [id] : []
    if (!['campaign', 'adset', 'ad'].includes(level) || !targetIds.length || targetIds.some((value) => typeof value !== 'string')) {
      return NextResponse.json({ error: 'Informe nível e IDs válidos' }, { status: 400 })
    }
    if (status !== undefined && !['ACTIVE', 'PAUSED'].includes(String(status).toUpperCase())) {
      return NextResponse.json({ error: 'Status inválido' }, { status: 400 })
    }
    if (name !== undefined && (typeof name !== 'string' || !name.trim())) {
      return NextResponse.json({ error: 'Nome inválido' }, { status: 400 })
    }
    if (level === 'ad' && (budget !== undefined || budgetChangePercent !== undefined)) {
      return NextResponse.json({ error: 'Anúncios não aceitam orçamento diário' }, { status: 400 })
    }
    if ([budget, budgetChangePercent].some((value) => value !== undefined && (value === null || !Number.isFinite(Number(value))))) {
      return NextResponse.json({ error: 'Orçamento inválido' }, { status: 400 })
    }

    const updatedItems: unknown[] = []
    const failures: { id: string; error: string }[] = []
    for (const targetId of targetIds) {
      try {
        if (level === 'campaign') {
          const item = await prisma.campaign.findFirst({ where: { workspaceId, OR: [{ id: targetId }, { externalId: targetId }] }, include: { adAccount: true } })
          if (!item) throw new Error('Campanha não encontrada')
          if (!item.adAccount.accessTokenEnc) throw new Error('Conta Meta sem token')
          const dailyBudget = resolveBudget(item.dailyBudget, budget, budgetChangePercent)
          const payload = makePayload(status, name, dailyBudget)
          if (!Object.keys(payload).length) throw new Error('Nenhuma alteração informada')
          const result = await new MetaApiClient(decrypt(item.adAccount.accessTokenEnc)).updateCampaign(item.externalId, payload)
          if (!result.success) throw new Error('Meta não confirmou a atualização')
          updatedItems.push(await prisma.campaign.update({ where: { id: item.id }, data: localChanges(status, name, dailyBudget) }))
        } else if (level === 'adset') {
          const item = await prisma.adSet.findFirst({ where: { workspaceId, OR: [{ id: targetId }, { externalId: targetId }] }, include: { campaign: { include: { adAccount: true } } } })
          if (!item) throw new Error('Conjunto não encontrado')
          const token = item.campaign.adAccount.accessTokenEnc
          if (!token) throw new Error('Conta Meta sem token')
          const dailyBudget = resolveBudget(item.dailyBudget, budget, budgetChangePercent)
          const payload = makePayload(status, name, dailyBudget)
          if (!Object.keys(payload).length) throw new Error('Nenhuma alteração informada')
          const result = await new MetaApiClient(decrypt(token)).updateAdSet(item.externalId, payload)
          if (!result.success) throw new Error('Meta não confirmou a atualização')
          updatedItems.push(await prisma.adSet.update({ where: { id: item.id }, data: localChanges(status, name, dailyBudget) }))
        } else {
          const item = await prisma.ad.findFirst({ where: { workspaceId, OR: [{ id: targetId }, { externalId: targetId }] }, include: { adSet: { include: { campaign: { include: { adAccount: true } } } } } })
          if (!item) throw new Error('Anúncio não encontrado')
          const token = item.adSet.campaign.adAccount.accessTokenEnc
          if (!token) throw new Error('Conta Meta sem token')
          const payload = makePayload(status, name)
          if (!Object.keys(payload).length) throw new Error('Nenhuma alteração informada')
          const result = await new MetaApiClient(decrypt(token)).updateAd(item.externalId, payload)
          if (!result.success) throw new Error('Meta não confirmou a atualização')
          updatedItems.push(await prisma.ad.update({ where: { id: item.id }, data: localChanges(status, name) }))
        }
      } catch (error) {
        failures.push({ id: targetId, error: error instanceof Error ? error.message : 'Erro desconhecido' })
      }
    }
    return NextResponse.json({
      success: failures.length === 0,
      updatedCount: updatedItems.length,
      items: updatedItems,
      failures,
      error: failures.map((failure) => failure.id + ': ' + failure.error).join('; ') || undefined,
    }, { status: failures.length ? 502 : 200 })
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : 'Erro ao atualizar na Meta' }, { status: 500 })
  }
}

function resolveBudget(current: number | null, budget: unknown, percent: unknown): number | undefined {
  if (budget !== undefined) {
    const value = Number(budget)
    if (value <= 0) throw new Error('Orçamento deve ser positivo')
    return value
  }
  if (percent !== undefined) {
    if (current === null) throw new Error('Item sem orçamento diário para ajuste percentual')
    const value = Math.round(current * (1 + Number(percent) / 100) * 100) / 100
    if (value <= 0) throw new Error('Orçamento resultante deve ser positivo')
    return value
  }
  return undefined
}

function makePayload(status?: string, name?: string, dailyBudget?: number) {
  return {
    ...(status ? { status: status.toUpperCase() } : {}),
    ...(name ? { name: name.trim() } : {}),
    ...(dailyBudget !== undefined ? { daily_budget: Math.round(dailyBudget * 100) } : {}),
  }
}

function localChanges(status?: string, name?: string, dailyBudget?: number) {
  return {
    ...(status ? { status: status.toUpperCase() } : {}),
    ...(name ? { name: name.trim() } : {}),
    ...(dailyBudget !== undefined ? { dailyBudget } : {}),
  }
}
