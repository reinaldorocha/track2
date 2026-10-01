import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'

process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
process.env.AUTH_SECRET = process.env.AUTH_SECRET || 'test_auth_secret_for_meta_csv_importer'

import { importMetaAdsCsv } from '../src/lib/meta/csv-importer'
import { prisma } from '../src/lib/db'

describe('Meta Ads — Importador de Relatório Histórico via CSV', () => {
  const testWorkspaceSlug = `ws_csv_test_${Date.now()}`
  let testWorkspaceId: string

  const sampleCsv = `"Nome da conta","Nome da campanha","Nome do conjunto de anúncios","Nome do anúncio",Dia,"Identificação da conta","Identificação da campanha","Identificação do conjunto de anúncios","Identificação do anúncio",Anúncios,Impressões,Moeda,"Valor gasto (BRL)","Configuração de atribuição",Compras,"Custo por compra","Cliques no link","CPC (custo por clique no link)",Alcance,"Finalizações de compra iniciadas","Início dos relatórios","Encerramento dos relatórios"
"CONTA DE ADS - CHEGA JUNTO","SIMULADO 04/09","PI,CE,MA 2 — Cópia4","CRIATIVO NOVO - 2",2026-10-01,103891466123901,120253670639860385,120254146010950385,120254146010960385,"CRIATIVO NOVO - 2",627,BRL,8.97,"Clique de 7 dias, visualização de 1 dia",1,8.97,4,2.2425,522,1,2026-10-01,2026-10-01
"CONTA DE ADS - CHEGA JUNTO","SIMULADO 04/09","PI,CE,MA 2 — Cópia 2","CRIATIVO NOVO - 2",2026-10-01,103891466123901,120253670639860385,120253980052450385,120253980052440385,"CRIATIVO NOVO - 2",989,BRL,12.04,"Clique de 7 dias, visualização de 1 dia",1,12.04,6,2.00666667,817,4,2026-10-01,2026-10-01
"CONTA DE ADS - CHEGA JUNTO","PMPE - 01/10","18-35- PE,PB,AL,CE","CRIATIVO 1 PMPE",2026-10-01,103891466123901,120254146495420385,120254146495430385,120254146495410385,"CRIATIVO 1 PMPE",654,BRL,7.58,"Clique de 7 dias, visualização de 1 dia",,,4,1.895,550,,2026-10-01,2026-10-01`

  before(async () => {
    const ws = await prisma.workspace.create({
      data: {
        name: 'Workspace Teste CSV',
        slug: testWorkspaceSlug,
      }
    })
    testWorkspaceId = ws.id
  })

  after(async () => {
    if (testWorkspaceId) {
      await prisma.workspace.delete({ where: { id: testWorkspaceId } }).catch(() => {})
    }
  })

  it('1. Processa e importa CSV da Meta Ads com sucesso', async () => {
    const result = await importMetaAdsCsv(testWorkspaceId, sampleCsv)

    assert.equal(result.success, true)
    assert.equal(result.rowsProcessed, 3)
    assert.equal(result.campaignsImported, 2)
    assert.equal(result.adSetsImported, 3)
    assert.equal(result.adsImported, 3)
    assert.equal(result.minDate, '2026-10-01')
    assert.equal(result.maxDate, '2026-10-01')

    // Verificar se as campanhas foram salvas no banco
    const campaigns = await prisma.campaign.findMany({
      where: { workspaceId: testWorkspaceId },
      include: { insights: true, adSets: { include: { ads: true, insights: true } } }
    })

    assert.equal(campaigns.length, 2)

    // Campanha SIMULADO 04/09 deve ter a soma das duas linhas no dia 01/10: spend = 8.97 + 12.04 = 21.01
    const simulado = campaigns.find(c => c.name === 'SIMULADO 04/09')
    assert.ok(simulado)
    assert.equal(simulado.insights.length, 1)
    assert.equal(Math.round(simulado.insights[0].spend * 100) / 100, 21.01)
    assert.equal(simulado.insights[0].conversions, 2) // 1 + 1 compras
    assert.equal(simulado.insights[0].clicks, 10) // 4 + 6 cliques

    // Campanha PMPE deve ter 1 linha com spend = 7.58
    const pmpe = campaigns.find(c => c.name === 'PMPE - 01/10')
    assert.ok(pmpe)
    assert.equal(pmpe.insights.length, 1)
    assert.equal(pmpe.insights[0].spend, 7.58)
    assert.equal(pmpe.insights[0].conversions, 0)
    assert.equal(pmpe.insights[0].clicks, 4)
  })

  it('2. Garante idempotência: reimportar o mesmo CSV atualiza sem duplicar linhas', async () => {
    const result = await importMetaAdsCsv(testWorkspaceId, sampleCsv)
    assert.equal(result.success, true)

    const insights = await prisma.campaignInsight.findMany({
      where: { campaign: { workspaceId: testWorkspaceId } }
    })
    // Deve continuar tendo exatamente 2 insights (1 para cada campanha no dia 01/10)
    assert.equal(insights.length, 2)
  })

  it('3. Rejeita CSV inválido ou vazio com erro amigável', async () => {
    const result = await importMetaAdsCsv(testWorkspaceId, 'campo1,campo2\n1,2')
    assert.equal(result.success, false)
    assert.ok(result.error?.includes('Colunas obrigatórias'))
  })
})
