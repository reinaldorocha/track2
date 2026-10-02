import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getUserWorkspaceId } from '@/lib/workspace'
import { decrypt } from '@/lib/encryption'
import { MetaApiClient, MetaApiError } from '@/lib/meta/client'

const ZERO_DECIMAL_CURRENCIES = new Set(['JPY', 'KRW', 'VND', 'CLP', 'PYG', 'HUF'])

function parseMetaCurrency(val: string | number | undefined | null, currency = 'BRL'): number {
  if (val === undefined || val === null) return 0
  const num = typeof val === 'string' ? parseFloat(val) : val
  if (isNaN(num)) return 0
  if (ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase())) {
    return num
  }
  return Math.round((num / 100) * 100) / 100
}

const META_STATUS_CONFIG: Record<number, { label: string; badgeColor: 'emerald' | 'amber' | 'rose' | 'slate' }> = {
  1: { label: 'Ativa', badgeColor: 'emerald' },
  2: { label: 'Desativada', badgeColor: 'rose' },
  3: { label: 'Pagamento Pendente', badgeColor: 'rose' },
  7: { label: 'Em Análise de Risco', badgeColor: 'amber' },
  8: { label: 'Liquidação Pendente', badgeColor: 'amber' },
  9: { label: 'Período de Tolerância', badgeColor: 'amber' },
  100: { label: 'Fechamento Pendente', badgeColor: 'slate' },
  101: { label: 'Fechada', badgeColor: 'slate' },
}

const DISABLE_REASONS: Record<number, string> = {
  0: 'Nenhum motivo reportado',
  1: 'Violação das Políticas de Publicidade',
  2: 'Revisão de Propriedade Intelectual / Fraude',
  3: 'Risco no Método de Pagamento',
  4: 'Encerramento de Conta pelo Usuário',
  5: 'Violação das Políticas Comerciais',
}

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const workspaceId = await getUserWorkspaceId(session.user.id)
    if (!workspaceId) {
      return NextResponse.json({ error: 'No workspace' }, { status: 404 })
    }

    const { searchParams } = new URL(req.url)
    const filterAccountId = searchParams.get('accountId')

    const dbAccounts = await prisma.adAccount.findMany({
      where: {
        workspaceId,
        ...(filterAccountId && filterAccountId !== 'all' ? { id: filterAccountId } : {}),
      },
      select: {
        id: true,
        name: true,
        externalId: true,
        currency: true,
        timezone: true,
        status: true,
        accessTokenEnc: true,
        lastSyncAt: true,
      },
      orderBy: { createdAt: 'desc' },
    })

    if (dbAccounts.length === 0) {
      return NextResponse.json({
        summary: {
          totalAccounts: 0,
          activeAccounts: 0,
          totalPrepaidBalance: 0,
          totalLifetimeSpend: 0,
          criticalAlertsCount: 0,
          warningAlertsCount: 0,
          healthyAccountsCount: 0,
          totalDailySpend: 0,
        },
        accounts: [],
      })
    }

    // Calcular gasto médio diário dos últimos 7 dias para cada conta
    const sevenDaysAgo = new Date()
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)
    sevenDaysAgo.setHours(0, 0, 0, 0)

    const accountsResults = await Promise.all(
      dbAccounts.map(async (account) => {
        // Gasto médio nos últimos 7 dias via banco de dados
        const insights = await prisma.campaignInsight.findMany({
          where: {
            campaign: { adAccountId: account.id },
            dateStart: { gte: sevenDaysAgo },
          },
          select: { spend: true },
        })
        const total7DaySpend = insights.reduce((sum, item) => sum + (item.spend || 0), 0)
        const averageDailySpend = Math.round((total7DaySpend / 7) * 100) / 100

        if (!account.accessTokenEnc) {
          return {
            id: account.id,
            name: account.name,
            externalId: account.externalId,
            currency: account.currency,
            timezone: account.timezone,
            accountStatus: 0,
            accountStatusLabel: 'Sem Token',
            badgeColor: 'rose' as const,
            isPrepayAccount: false,
            balance: 0,
            amountSpent: 0,
            spendCap: null,
            availableBalance: 0,
            remainingLimit: null,
            percentUsed: null,
            averageDailySpend,
            estimatedDaysRemaining: null,
            alertLevel: 'critical' as const,
            alertReason: 'Conta sem token de acesso da Meta configurado',
            fundingSource: 'Não configurado',
            billingUrl: `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${account.externalId.replace(/^act_/, '')}`,
            lastCheckedAt: new Date().toISOString(),
          }
        }

        let token: string
        try {
          token = decrypt(account.accessTokenEnc)
        } catch {
          return {
            id: account.id,
            name: account.name,
            externalId: account.externalId,
            currency: account.currency,
            timezone: account.timezone,
            accountStatus: 0,
            accountStatusLabel: 'Token Corrompido',
            badgeColor: 'rose' as const,
            isPrepayAccount: false,
            balance: 0,
            amountSpent: 0,
            spendCap: null,
            availableBalance: 0,
            remainingLimit: null,
            percentUsed: null,
            averageDailySpend,
            estimatedDaysRemaining: null,
            alertLevel: 'critical' as const,
            alertReason: 'Token de autenticação corrompido ou inválido',
            fundingSource: 'Desconhecido',
            billingUrl: `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${account.externalId.replace(/^act_/, '')}`,
            lastCheckedAt: new Date().toISOString(),
          }
        }

        try {
          const client = new MetaApiClient(token)
          const metaInfo = await client.getAdAccountBalance(account.externalId)

          const currency = metaInfo.currency || account.currency || 'BRL'
          const balanceRaw = parseMetaCurrency(metaInfo.balance, currency)
          const amountSpentRaw = parseMetaCurrency(metaInfo.amount_spent, currency)
          const spendCapRaw = metaInfo.spend_cap ? parseMetaCurrency(metaInfo.spend_cap, currency) : null
          const isPrepaid = metaInfo.is_prepay_account === true

          const accountStatus = metaInfo.account_status ?? 1
          const statusConfig = META_STATUS_CONFIG[accountStatus] || { label: 'Desconhecido', badgeColor: 'slate' }
          const disableReason = metaInfo.disable_reason !== undefined ? DISABLE_REASONS[metaInfo.disable_reason] || 'Desconhecido' : null

          let availableBalance = 0
          let remainingLimit: number | null = null
          let percentUsed: number | null = null
          let estimatedDaysRemaining: number | null = null
          let alertLevel: 'critical' | 'warning' | 'ok' = 'ok'
          let alertReason = 'Saldo e limites em conformidade'

          if (isPrepaid) {
            // Conta pré-paga: saldo disponível
            availableBalance = balanceRaw
            if (averageDailySpend > 0 && availableBalance > 0) {
              estimatedDaysRemaining = Math.max(0, Math.round((availableBalance / averageDailySpend) * 10) / 10)
            } else if (availableBalance <= 0) {
              estimatedDaysRemaining = 0
            }

            if (accountStatus !== 1) {
              alertLevel = 'critical'
              alertReason = `Conta com status ${statusConfig.label}${disableReason ? ` (${disableReason})` : ''}`
            } else if (availableBalance <= 50 || (estimatedDaysRemaining !== null && estimatedDaysRemaining <= 1)) {
              alertLevel = 'critical'
              alertReason = `Saldo pré-pago crítico (${currency} ${availableBalance.toFixed(2)}) — risco iminente de pausa das campanhas`
            } else if (availableBalance <= 150 || (estimatedDaysRemaining !== null && estimatedDaysRemaining <= 3)) {
              alertLevel = 'warning'
              alertReason = `Saldo pré-pago baixo (${currency} ${availableBalance.toFixed(2)}) — previsão de esgotar em ~${estimatedDaysRemaining || 2} dias`
            }
          } else {
            // Conta pós-paga (cartão de crédito / fatura)
            if (spendCapRaw && spendCapRaw > 0) {
              remainingLimit = Math.max(0, Math.round((spendCapRaw - amountSpentRaw) * 100) / 100)
              percentUsed = Math.min(100, Math.round((amountSpentRaw / spendCapRaw) * 1000) / 10)

              if (averageDailySpend > 0 && remainingLimit > 0) {
                estimatedDaysRemaining = Math.max(0, Math.round((remainingLimit / averageDailySpend) * 10) / 10)
              } else if (remainingLimit <= 0) {
                estimatedDaysRemaining = 0
              }

              if (accountStatus !== 1) {
                alertLevel = 'critical'
                alertReason = `Conta com status ${statusConfig.label}${disableReason ? ` (${disableReason})` : ''}`
              } else if (remainingLimit <= 50 || percentUsed >= 98) {
                alertLevel = 'critical'
                alertReason = `Limite de gastos quase esgotado (${percentUsed}% atingido, restam ${currency} ${remainingLimit.toFixed(2)})`
              } else if (percentUsed >= 85 || (estimatedDaysRemaining !== null && estimatedDaysRemaining <= 3)) {
                alertLevel = 'warning'
                alertReason = `Atingiu ${percentUsed}% do limite de gastos (${currency} ${remainingLimit.toFixed(2)} restantes)`
              }
            } else {
              // Pós-paga sem limite configurado (faturamento automático do cartão)
              remainingLimit = null
              percentUsed = null
              availableBalance = balanceRaw // Saldo pendente desde o último fechamento de ciclo
              if (accountStatus !== 1) {
                alertLevel = 'critical'
                alertReason = `Conta com status ${statusConfig.label}${disableReason ? ` (${disableReason})` : ''}`
              }
            }
          }

          const fundingSourceStr = metaInfo.funding_source_details?.display_string
            || (isPrepaid ? 'Saldo Pré-pago (Pix / Boleto / Créditos)' : 'Cartão de Crédito / Cobrança Automática')

          return {
            id: account.id,
            name: metaInfo.name || account.name,
            externalId: account.externalId,
            currency,
            timezone: metaInfo.timezone_name || account.timezone,
            accountStatus,
            accountStatusLabel: statusConfig.label,
            badgeColor: statusConfig.badgeColor,
            disableReason,
            isPrepayAccount: isPrepaid,
            balance: balanceRaw,
            amountSpent: amountSpentRaw,
            spendCap: spendCapRaw,
            availableBalance,
            remainingLimit,
            percentUsed,
            averageDailySpend,
            estimatedDaysRemaining,
            alertLevel,
            alertReason,
            fundingSource: fundingSourceStr,
            billingUrl: `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${account.externalId.replace(/^act_/, '')}`,
            lastCheckedAt: new Date().toISOString(),
          }
        } catch (err: unknown) {
          console.error(`Erro ao consultar saldo da conta ${account.externalId}:`, err)
          const errorMsg = err instanceof MetaApiError ? err.message : 'Falha na comunicação com a API da Meta'
          return {
            id: account.id,
            name: account.name,
            externalId: account.externalId,
            currency: account.currency,
            timezone: account.timezone,
            accountStatus: 0,
            accountStatusLabel: 'Erro de Leitura',
            badgeColor: 'amber' as const,
            isPrepayAccount: false,
            balance: 0,
            amountSpent: 0,
            spendCap: null,
            availableBalance: 0,
            remainingLimit: null,
            percentUsed: null,
            averageDailySpend,
            estimatedDaysRemaining: null,
            alertLevel: 'warning' as const,
            alertReason: `Não foi possível consultar os dados ao vivo: ${errorMsg}`,
            fundingSource: 'Desconhecido',
            billingUrl: `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${account.externalId.replace(/^act_/, '')}`,
            lastCheckedAt: new Date().toISOString(),
          }
        }
      })
    )

    // Resumo consolidado
    const totalPrepaidBalance = accountsResults
      .filter((a) => a.isPrepayAccount)
      .reduce((sum, a) => sum + (a.availableBalance || 0), 0)

    const totalLifetimeSpend = accountsResults.reduce((sum, a) => sum + (a.amountSpent || 0), 0)
    const totalDailySpend = accountsResults.reduce((sum, a) => sum + (a.averageDailySpend || 0), 0)

    const criticalAlertsCount = accountsResults.filter((a) => a.alertLevel === 'critical').length
    const warningAlertsCount = accountsResults.filter((a) => a.alertLevel === 'warning').length
    const healthyAccountsCount = accountsResults.filter((a) => a.alertLevel === 'ok').length
    const activeAccounts = accountsResults.filter((a) => a.accountStatus === 1).length

    return NextResponse.json({
      summary: {
        totalAccounts: accountsResults.length,
        activeAccounts,
        totalPrepaidBalance: Math.round(totalPrepaidBalance * 100) / 100,
        totalLifetimeSpend: Math.round(totalLifetimeSpend * 100) / 100,
        totalDailySpend: Math.round(totalDailySpend * 100) / 100,
        criticalAlertsCount,
        warningAlertsCount,
        healthyAccountsCount,
      },
      accounts: accountsResults,
    })
  } catch (error) {
    console.error('Error in meta balance API:', error)
    return NextResponse.json({ error: 'Erro interno ao processar saldos da Meta' }, { status: 500 })
  }
}
