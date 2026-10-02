import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

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

function calculateRunwayAndAlerts(params: {
  accountStatus: number
  isPrepaid: boolean
  balance: number
  amountSpent: number
  spendCap: number | null
  averageDailySpend: number
  currency?: string
}) {
  const { accountStatus, isPrepaid, balance, amountSpent, spendCap, averageDailySpend, currency = 'BRL' } = params

  let availableBalance = 0
  let remainingLimit: number | null = null
  let percentUsed: number | null = null
  let estimatedDaysRemaining: number | null = null
  let alertLevel: 'critical' | 'warning' | 'ok' = 'ok'
  let alertReason = 'Saldo e limites em conformidade'

  if (isPrepaid) {
    availableBalance = balance
    if (averageDailySpend > 0 && availableBalance > 0) {
      estimatedDaysRemaining = Math.max(0, Math.round((availableBalance / averageDailySpend) * 10) / 10)
    } else if (availableBalance <= 0) {
      estimatedDaysRemaining = 0
    }

    if (accountStatus !== 1) {
      alertLevel = 'critical'
      alertReason = 'Conta não está ativa'
    } else if (availableBalance <= 50 || (estimatedDaysRemaining !== null && estimatedDaysRemaining <= 1)) {
      alertLevel = 'critical'
      alertReason = `Saldo pré-pago crítico (${currency} ${availableBalance.toFixed(2)})`
    } else if (availableBalance <= 150 || (estimatedDaysRemaining !== null && estimatedDaysRemaining <= 3)) {
      alertLevel = 'warning'
      alertReason = `Saldo pré-pago baixo (${currency} ${availableBalance.toFixed(2)})`
    }
  } else {
    if (spendCap && spendCap > 0) {
      remainingLimit = Math.max(0, Math.round((spendCap - amountSpent) * 100) / 100)
      percentUsed = Math.min(100, Math.round((amountSpent / spendCap) * 1000) / 10)

      if (averageDailySpend > 0 && remainingLimit > 0) {
        estimatedDaysRemaining = Math.max(0, Math.round((remainingLimit / averageDailySpend) * 10) / 10)
      } else if (remainingLimit <= 0) {
        estimatedDaysRemaining = 0
      }

      if (accountStatus !== 1) {
        alertLevel = 'critical'
        alertReason = 'Conta não está ativa'
      } else if (remainingLimit <= 50 || percentUsed >= 98) {
        alertLevel = 'critical'
        alertReason = `Limite de gastos quase esgotado (${percentUsed}% atingido)`
      } else if (percentUsed >= 85 || (estimatedDaysRemaining !== null && estimatedDaysRemaining <= 3)) {
        alertLevel = 'warning'
        alertReason = `Atingiu ${percentUsed}% do limite`
      }
    } else {
      remainingLimit = null
      percentUsed = null
      availableBalance = balance
      if (accountStatus !== 1) {
        alertLevel = 'critical'
        alertReason = 'Conta não está ativa'
      }
    }
  }

  return {
    availableBalance,
    remainingLimit,
    percentUsed,
    estimatedDaysRemaining,
    alertLevel,
    alertReason
  }
}

describe('Monitor de Saldo & Limite da Meta (Unit & Business Logic)', () => {
  test('1. Converte unidades menores de moeda (centavos) para decimais corretamente', () => {
    // 15000 centavos de BRL = R$ 150.00
    assert.equal(parseMetaCurrency('15000', 'BRL'), 150.00)
    assert.equal(parseMetaCurrency(5050, 'USD'), 50.50)
    // Moeda sem casas decimais (ex: JPY)
    assert.equal(parseMetaCurrency(1000, 'JPY'), 1000)
    // Valores nulos ou vazios
    assert.equal(parseMetaCurrency(undefined), 0)
    assert.equal(parseMetaCurrency(null), 0)
  })

  test('2. Conta Pré-Paga: calcula dias de duração estimada e alerta de saldo baixo', () => {
    // Conta pré-paga com R$ 300,00 de saldo e gasto diário de R$ 100,00/dia -> 3 dias -> warning
    const res1 = calculateRunwayAndAlerts({
      accountStatus: 1,
      isPrepaid: true,
      balance: 300,
      amountSpent: 1200,
      spendCap: null,
      averageDailySpend: 100
    })
    assert.equal(res1.availableBalance, 300)
    assert.equal(res1.estimatedDaysRemaining, 3)
    assert.equal(res1.alertLevel, 'warning')

    // Conta pré-paga com R$ 40,00 de saldo e gasto de R$ 50/dia -> <= R$ 50 -> critical
    const res2 = calculateRunwayAndAlerts({
      accountStatus: 1,
      isPrepaid: true,
      balance: 40,
      amountSpent: 2000,
      spendCap: null,
      averageDailySpend: 50
    })
    assert.equal(res2.alertLevel, 'critical')
    assert.equal(res2.estimatedDaysRemaining, 0.8)

    // Conta pré-paga saudável: R$ 1.500,00 com gasto de R$ 100/dia -> 15 dias -> ok
    const res3 = calculateRunwayAndAlerts({
      accountStatus: 1,
      isPrepaid: true,
      balance: 1500,
      amountSpent: 5000,
      spendCap: null,
      averageDailySpend: 100
    })
    assert.equal(res3.alertLevel, 'ok')
    assert.equal(res3.estimatedDaysRemaining, 15)
  })

  test('3. Conta Pós-Paga com Spend Cap: calcula percentual consumido e limite restante', () => {
    // Limite de R$ 5.000,00 e já gastou R$ 4.500,00 (90%) -> warning
    const res1 = calculateRunwayAndAlerts({
      accountStatus: 1,
      isPrepaid: false,
      balance: 450,
      amountSpent: 4500,
      spendCap: 5000,
      averageDailySpend: 150
    })
    assert.equal(res1.remainingLimit, 500)
    assert.equal(res1.percentUsed, 90)
    assert.equal(res1.estimatedDaysRemaining, 3.3)
    assert.equal(res1.alertLevel, 'warning')

    // Limite de R$ 5.000,00 e já gastou R$ 4.960,00 (99.2% / resta R$ 40) -> critical
    const res2 = calculateRunwayAndAlerts({
      accountStatus: 1,
      isPrepaid: false,
      balance: 40,
      amountSpent: 4960,
      spendCap: 5000,
      averageDailySpend: 100
    })
    assert.equal(res2.remainingLimit, 40)
    assert.equal(res2.percentUsed, 99.2)
    assert.equal(res2.alertLevel, 'critical')
  })

  test('4. Conta Desativada ou com Pagamento Pendente aciona alerta crítico imediato', () => {
    // Status 2 = Desativada
    const resDisabled = calculateRunwayAndAlerts({
      accountStatus: 2,
      isPrepaid: true,
      balance: 1000,
      amountSpent: 500,
      spendCap: null,
      averageDailySpend: 50
    })
    assert.equal(resDisabled.alertLevel, 'critical')
    assert.equal(resDisabled.alertReason, 'Conta não está ativa')

    // Status 3 = Pagamento Pendente
    const resUnsettled = calculateRunwayAndAlerts({
      accountStatus: 3,
      isPrepaid: false,
      balance: 300,
      amountSpent: 3000,
      spendCap: null,
      averageDailySpend: 100
    })
    assert.equal(resUnsettled.alertLevel, 'critical')
  })
})
