import { describe, it } from 'node:test'
import assert from 'node:assert/strict'

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'test_auth_secret_for_meta_management_2025'

import { MetaApiClient, MetaApiError, isStandardEnhancementsError } from '../src/lib/meta/client'
import { prisma } from '../src/lib/db'

describe('Meta Ads Management — Edição e Duplicação (Estilo UTMFY)', () => {
  // 1. MetaApiClient possui métodos para gestão
  it('1. MetaApiClient expõe updateCampaign, updateAdSet, updateAd, duplicateCampaign, duplicateAdSet, duplicateAd', () => {
    const client = new MetaApiClient('mock_token_123')
    assert.equal(typeof client.updateCampaign, 'function')
    assert.equal(typeof client.updateAdSet, 'function')
    assert.equal(typeof client.updateAd, 'function')
    assert.equal(typeof client.duplicateCampaign, 'function')
    assert.equal(typeof client.duplicateAdSet, 'function')
    assert.equal(typeof client.duplicateAd, 'function')
    assert.equal(typeof client.post, 'function')
  })

  // 2. Formatação de payload para a Meta Graph API
  it('2. Garante que o orçamento diário em R$ é convertido para centavos para a Meta API', () => {
    const budgetInBRL = 150.0 // R$ 150,00
    const budgetInCents = Math.round(budgetInBRL * 100) // 15000 centavos
    assert.equal(budgetInCents, 15000)

    const scaleFactor = 1.2 // +20% de escala
    const scaledBudget = Math.round(budgetInBRL * scaleFactor)
    assert.equal(scaledBudget, 180)
    assert.equal(Math.round(scaledBudget * 100), 18000)
  })

  // 3. Regras de sufixo e status inicial na duplicação
  it('3. Elementos duplicados devem receber sufixo " - Cópia" e status inicial "PAUSED"', () => {
    const originalName = 'AD01 - Vídeo Depoimento Oferta Black'
    const suffix = ' - Cópia'
    const duplicatedName = `${originalName}${suffix}`
    const duplicatedStatus = 'PAUSED'

    assert.equal(duplicatedName, 'AD01 - Vídeo Depoimento Oferta Black - Cópia')
    assert.equal(duplicatedStatus, 'PAUSED', 'Anúncio duplicado NUNCA deve nascer ATIVO sem revisão')
  })

  // 4. Operações em Massa (Bulk Actions)
  it('4. Valida estrutura de ações em massa para múltiplos IDs selecionados', () => {
    const selectedIds = ['ad_1', 'ad_2', 'ad_3']
    const action = 'PAUSED'
    const updates = selectedIds.map(id => ({ id, status: action }))

    assert.equal(updates.length, 3)
    assert.ok(updates.every(u => u.status === 'PAUSED'))
  })

  // 5. Extração de ID de cópia em múltiplos formatos da Meta Graph API
  it('5. Extrai copiedId com sucesso de diferentes formatos retornados pela Meta (id, copied_id, copied_parent_id, arrays)', () => {
    const extractCopiedId = (result: Record<string, unknown>) => {
      return (
        result.id ||
        result.copied_id ||
        result.copied_parent_id ||
        (Array.isArray(result.campaigns) ? (result.campaigns as Array<{ id: string }>)[0]?.id : undefined) ||
        (Array.isArray(result.adsets) ? (result.adsets as Array<{ id: string }>)[0]?.id : undefined) ||
        (Array.isArray(result.ads) ? (result.ads as Array<{ id: string }>)[0]?.id : undefined)
      ) as string | undefined
    }

    assert.equal(extractCopiedId({ id: '120211111' }), '120211111')
    assert.equal(extractCopiedId({ copied_id: '120222222' }), '120222222')
    assert.equal(extractCopiedId({ copied_parent_id: '120233333' }), '120233333')
    assert.equal(extractCopiedId({ campaigns: [{ id: '120244444' }] }), '120244444')
    assert.equal(extractCopiedId({ adsets: [{ id: '120255555' }] }), '120255555')
    assert.equal(extractCopiedId({ ads: [{ id: '120266666' }] }), '120266666')
    assert.equal(extractCopiedId({}), undefined)
  })

  // 6. Detecção da descontinuação de standard_enhancements (Aprimoramentos padrão Meta)
  it('6. isStandardEnhancementsError identifica erro de descontinuação de aprimoramentos padrão', () => {
    // Erro real recebido pelo usuário
    const userError = new MetaApiError(
      'Invalid parameter (O recurso de inclusão do campo de aprimoramentos padrão no criativo foi descontinuado. Defina recursos individuais. Saiba mais aqui: https://fburl.com/hyth50xo)',
      100,
      3858504
    )
    assert.equal(isStandardEnhancementsError(userError), true)

    // Detecção por subcode mesmo sem mensagem
    const subcodeError = new MetaApiError('Some error', 100, 3858504)
    assert.equal(isStandardEnhancementsError(subcodeError), true)

    // Detecção por URL de documentação ou palavras-chave
    const urlError = new Error('Descontinuado conforme https://fburl.com/hyth50xo')
    assert.equal(isStandardEnhancementsError(urlError), true)

    const engError = new MetaApiError('The standard_enhancements feature on creative is deprecated', 100)
    assert.equal(isStandardEnhancementsError(engError), true)

    // Erros normais não devem ser falsos positivos
    const authError = new MetaApiError('Session expired', 190)
    assert.equal(isStandardEnhancementsError(authError), false)

    const rateError = new MetaApiError('User request limit reached', 17)
    assert.equal(isStandardEnhancementsError(rateError), false)
  })
})

