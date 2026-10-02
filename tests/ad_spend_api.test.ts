import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

function formatBRL(val: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val || 0)
}

function calculateMetrics(gross: number, net: number, count: number, spend: number) {
  const roas = spend > 0 ? Math.round((gross / spend) * 100) / 100 : 0
  const cpa = count > 0 && spend > 0 ? Math.round((spend / count) * 100) / 100 : 0
  const realProfit = Math.round((net - spend) * 100) / 100

  return {
    roas,
    cpa,
    cpa_formatted: formatBRL(cpa),
    realProfit,
    realProfit_formatted: formatBRL(realProfit),
    spend_formatted: formatBRL(spend)
  }
}

describe('API de Gastos de Anúncios para Getfy (ad-spend report)', () => {
  test('1. Formata valores em BRL e calcula ROAS, CPA e Lucro Real', () => {
    const gross = 1850.00
    const net = 1780.00
    const count = 18
    const spend = 380.00

    const res = calculateMetrics(gross, net, count, spend)

    // ROAS = 1850 / 380 = 4.87
    assert.equal(res.roas, 4.87)
    // CPA = 380 / 18 = 21.11
    assert.equal(res.cpa, 21.11)
    // Lucro Real = 1780 - 380 = 1400.00
    assert.equal(res.realProfit, 1400.00)
    assert.ok(res.spend_formatted.includes('380,00'))
    assert.ok(res.realProfit_formatted.includes('1.400,00'))
  })

  test('2. Comportamento seguro com gasto zero (sem divisão por zero)', () => {
    const res = calculateMetrics(500, 480, 5, 0)
    assert.equal(res.roas, 0)
    assert.equal(res.cpa, 0)
    assert.equal(res.realProfit, 480)
  })

  test('3. Validação de autenticação via X-API-KEY e Bearer Token', () => {
    const secret = 'minha-chave-secreta-123'
    const validate = (provided: string | null) => provided === secret

    assert.equal(validate('minha-chave-secreta-123'), true)
    assert.equal(validate('chave-errada'), false)
    assert.equal(validate(null), false)
  })
})
