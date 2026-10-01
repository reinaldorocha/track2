import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import axios from 'axios'
import { MetaApiClient } from '../src/lib/meta/client'
import { day, midnight, measure, nextDay, assignSales, hasCompleteCoverage, resolveRange } from '../src/lib/meta/insight-helpers'

describe('Meta Ads reporting', () => {
  it('percorre todas as páginas e mantém o token fora do resultado', async () => {
    const original = axios.get
    const calls: Array<Record<string, string>> = []
    try {
      axios.get = (async (_url: string, config: { params: Record<string, string> }) => {
        calls.push(config.params)
        return { data: config.params.after ? { data: [{ id: '2' }] } : { data: [{ id: '1' }], paging: { next: 'https://graph.facebook.com/next?access_token=secret', cursors: { after: 'cursor-2' } } } }
      }) as typeof axios.get
      const rows = await new MetaApiClient('secret').getCampaigns('123')
      assert.deepEqual(rows.map(row => row.id), ['1', '2'])
      assert.equal(calls[1].after, 'cursor-2')
      assert.equal(calls.length, 2)
    } finally {
      axios.get = original
    }
  })

  it('converte meia-noite local para UTC inclusive na mudança de horário', () => {
    assert.equal(midnight('2026-10-01', 'America/Sao_Paulo').toISOString(), '2026-10-01T03:00:00.000Z')
    assert.equal(day(new Date('2026-10-01T02:30:00Z'), 'America/Sao_Paulo'), '2026-09-30')
    assert.equal(nextDay('2026-09-30'), '2026-10-01')
    assert.equal(midnight('2026-03-08', 'America/New_York').toISOString(), '2026-03-08T05:00:00.000Z')
    assert.equal(midnight('2026-03-09', 'America/New_York').toISOString(), '2026-03-09T04:00:00.000Z')
  })

  it('calcula Hoje, Ontem e períodos históricos no fuso da conta', () => {
    const now = new Date('2026-10-01T02:30:00Z')
    assert.deepEqual(resolveRange('Hoje', 'America/Sao_Paulo', null, null, now), { from: '2026-09-30', to: '2026-09-30' })
    assert.deepEqual(resolveRange('Ontem', 'America/Sao_Paulo', null, null, now), { from: '2026-09-29', to: '2026-09-29' })
    assert.deepEqual(resolveRange('Últimos 90 dias', 'America/Sao_Paulo', null, null, now), { from: '2026-07-03', to: '2026-09-30' })
    assert.deepEqual(resolveRange('Mês anterior', 'America/Sao_Paulo', null, null, now), { from: '2026-08-01', to: '2026-08-31' })
    assert.deepEqual(resolveRange('Personalizado', 'America/Sao_Paulo', '2026-08-10', '2026-08-12', now), { from: '2026-08-10', to: '2026-08-12' })
  })

  it('distingue ausência de insight, zero medido e IC real', () => {
    assert.equal(measure([]).spend, null)
    const base = { dateStart: new Date('2026-10-01'), spend: 0, impressions: 0, clicks: 0, conversions: 0, actions: null }
    assert.equal(measure([base]).spend, 0)
    assert.equal(measure([base]).ic, null)
    assert.equal(measure([{ ...base, actions: JSON.stringify([{ action_type: 'initiate_checkout', value: '0' }]) }]).ic, 0)
    assert.equal(measure([{ ...base, conversions: 2 }]).ic, null)
  })

  it('atribui cada venda uma vez por nível e deixa UTM ambígua sem atribuição', () => {
    const instant = new Date('2026-10-01T12:00:00Z')
    const rows = [
      { id: 'a', externalId: 'meta-a', name: 'Oferta', accountId: 'account' },
      { id: 'b', externalId: 'meta-b', name: 'Oferta', accountId: 'account' },
    ]
    const base = { orderedAt: instant, approvedAt: instant, utmCampaign: 'Oferta', utmTerm: null, utmContent: null,
      attributionRecord: null }
    const sales = [
      { ...base, id: 'explicit', attributionRecord: { campaignId: 'meta-a', adSetId: null, adId: null, adAccountId: 'account', utmCampaign: 'Oferta' } },
      { ...base, id: 'ambiguous' },
      { ...base, id: 'missing', utmCampaign: null },
    ]
    const ranges = new Map([['account', { saleFrom: midnight('2026-10-01', 'America/Sao_Paulo'), saleTo: midnight('2026-10-02', 'America/Sao_Paulo') }]])
    const result = assignSales(sales, rows, 'campaign', ranges)
    assert.equal(result.assigned.get('a')?.length, 1)
    assert.equal(result.assigned.get('b'), undefined)
    assert.equal(result.unassigned, 2)
    assert.equal([...result.assigned.values()].flat().length + result.unassigned, sales.length)
  })

  it('combina histórico e atualização recente e rejeita sync parcial', () => {
    const spans = [{ since: '2026-07-01', until: '2026-09-25' }, { since: '2026-09-24', until: '2026-10-01' }]
    assert.equal(hasCompleteCoverage('2026-07-10', '2026-10-01', 'success', spans), true)
    assert.equal(hasCompleteCoverage('2026-07-10', '2026-10-01', 'partial', spans), false)
    assert.equal(hasCompleteCoverage('2026-07-10', '2026-10-01', 'success', [spans[0], { since: '2026-09-27', until: '2026-10-01' }]), false)
    assert.equal(hasCompleteCoverage('2026-07-10', '2026-10-02', 'success', spans), false)
  })
})
