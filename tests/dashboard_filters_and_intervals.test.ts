import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { resolveAnalyticsInterval, midnight, nextDay, resolveRange } from '../src/lib/meta/insight-helpers'

describe('Filtros do Dashboard e Normalização de Intervalos de Data', () => {
  const tz = 'America/Sao_Paulo'
  // Fixar data de teste: 2026-10-01 15:30:00 BRT (18:30:00 UTC)
  const fakeNow = new Date('2026-10-01T18:30:00.000Z')

  it('1. "Hoje" resolve para o dia atual em SP e cobre insights UTC e vendas locais', () => {
    const interval = resolveAnalyticsInterval('Hoje', tz, null, null, fakeNow)

    assert.equal(interval.startDayStr, '2026-10-01')
    assert.equal(interval.endDayStr, '2026-10-01')

    // Vendas locais em SP (UTC-3): 00:00:00 BRT = 03:00:00Z do dia 01 até 03:00:00Z do dia 02
    assert.equal(interval.saleFrom.toISOString(), '2026-10-01T03:00:00.000Z')
    assert.equal(interval.saleTo.toISOString(), '2026-10-02T03:00:00.000Z')

    // Insights da Meta são gravados em UTC: dateStart deve ser 00:00:00Z e dateStop 23:59:59.999Z
    assert.equal(interval.insightDateStart.toISOString(), '2026-10-01T00:00:00.000Z')
    assert.equal(interval.insightDateStop.toISOString(), '2026-10-01T23:59:59.999Z')

    // Testar que um registro de CampaignInsight salvo em UTC para 2026-10-01 agora é capturado
    const insightRowDate = new Date('2026-10-01T00:00:00.000Z')
    assert.ok(insightRowDate >= interval.insightDateStart, 'dateStart >= insightDateStart')
    assert.ok(insightRowDate <= interval.insightDateStop, 'dateStart <= insightDateStop')
  })

  it('2. "Ontem" resolve para o dia anterior exato (2026-09-30)', () => {
    const interval = resolveAnalyticsInterval('Ontem', tz, null, null, fakeNow)

    assert.equal(interval.startDayStr, '2026-09-30')
    assert.equal(interval.endDayStr, '2026-09-30')

    assert.equal(interval.saleFrom.toISOString(), '2026-09-30T03:00:00.000Z')
    assert.equal(interval.saleTo.toISOString(), '2026-10-01T03:00:00.000Z')

    assert.equal(interval.insightDateStart.toISOString(), '2026-09-30T00:00:00.000Z')
    assert.equal(interval.insightDateStop.toISOString(), '2026-09-30T23:59:59.999Z')

    // Testar que um insight de ontem não é mais descartado pelo offset de 3 horas
    const yesterdayInsight = new Date('2026-09-30T00:00:00.000Z')
    assert.ok(yesterdayInsight >= interval.insightDateStart)
    assert.ok(yesterdayInsight <= interval.insightDateStop)
  })

  it('3. "Últimos 7 dias" resolve para os 7 dias completos (2026-09-25 a 2026-10-01)', () => {
    const interval = resolveAnalyticsInterval('Últimos 7 dias', tz, null, null, fakeNow)

    assert.equal(interval.startDayStr, '2026-09-25')
    assert.equal(interval.endDayStr, '2026-10-01')

    assert.equal(interval.saleFrom.toISOString(), '2026-09-25T03:00:00.000Z')
    assert.equal(interval.saleTo.toISOString(), '2026-10-02T03:00:00.000Z')

    assert.equal(interval.insightDateStart.toISOString(), '2026-09-25T00:00:00.000Z')
    assert.equal(interval.insightDateStop.toISOString(), '2026-10-01T23:59:59.999Z')

    // Verificar que o primeiro dia (2026-09-25 00:00:00Z) e o último (2026-10-01 00:00:00Z) são ambos incluídos
    const firstDayInsight = new Date('2026-09-25T00:00:00.000Z')
    const lastDayInsight = new Date('2026-10-01T00:00:00.000Z')

    assert.ok(firstDayInsight >= interval.insightDateStart && firstDayInsight <= interval.insightDateStop)
    assert.ok(lastDayInsight >= interval.insightDateStart && lastDayInsight <= interval.insightDateStop)
  })

  it('4. Intervalo personalizado via strings ISO extrai os dias de calendário corretos no fuso', () => {
    const fromStr = '2026-09-20T03:00:00.000Z'
    const toStr = '2026-09-28T02:59:59.999Z'

    const interval = resolveAnalyticsInterval(null, tz, fromStr, toStr, fakeNow)

    assert.equal(interval.startDayStr, '2026-09-20')
    assert.equal(interval.endDayStr, '2026-09-27')

    assert.equal(interval.saleFrom.toISOString(), '2026-09-20T03:00:00.000Z')
    assert.equal(interval.saleTo.toISOString(), '2026-09-28T03:00:00.000Z')
  })
})
