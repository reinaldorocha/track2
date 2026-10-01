import test from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/db'
import {
  parseCsvLines,
  parseBrazilianDateTime,
  parseMoneyValue,
  detectHeaderIndices,
  previewGetfyCsv,
  importGetfySalesCsv
} from '../src/lib/integrations/getfy-csv-importer'

test('Getfy CSV Importer - Parser Unit Tests', async (t) => {
  await t.test('deve remover BOM e dividir linhas com delimitador ponto e vírgula', () => {
    const raw = '\uFEFFData;Produto;Cliente;E-mail;Status;Método;Moeda;"Valor bruto";"Valor líquido"\n"01/10/2026 13:44";"Combo Simulado";Marcelo;marcelo@test.com;Pago;PIX;BRL;37,00;36,63'
    const lines = parseCsvLines(raw)
    assert.equal(lines.length, 2)
    assert.equal(lines[0][0], 'Data')
    assert.equal(lines[1][0], '01/10/2026 13:44')
    assert.equal(lines[1][1], 'Combo Simulado')
    assert.equal(lines[1][7], '37,00')
    assert.equal(lines[1][8], '36,63')
  })

  await t.test('deve converter data no padrão brasileiro DD/MM/YYYY HH:mm corretamente', () => {
    const parsed = parseBrazilianDateTime('01/10/2026 13:44')
    assert.equal(parsed.valid, true)
    // 13:44 em UTC-3 corresponde a 16:44 UTC
    assert.equal(parsed.date.toISOString(), '2026-10-01T16:44:00.000Z')
  })

  await t.test('deve converter valores monetários em float brasileiro', () => {
    assert.equal(parseMoneyValue('36,63'), 36.63)
    assert.equal(parseMoneyValue('56,90'), 56.90)
    assert.equal(parseMoneyValue('1.250,75'), 1250.75)
    assert.equal(parseMoneyValue('R$ 84,10'), 84.10)
    assert.equal(parseMoneyValue(36.63), 36.63)
  })

  await t.test('deve detectar índices de cabeçalho com Valor bruto posicionado antes de Valor líquido', () => {
    const header = ['Data', 'Produto', 'Cliente', 'E-mail', 'Status', 'Método', 'Moeda', '"Valor bruto"', '"Valor líquido"']
    const indices = detectHeaderIndices(header)
    assert.equal(indices.isValid, true)
    assert.equal(indices.dateIdx, 0)
    assert.equal(indices.productIdx, 1)
    assert.equal(indices.customerIdx, 2)
    assert.equal(indices.emailIdx, 3)
    assert.equal(indices.statusIdx, 4)
    assert.equal(indices.methodIdx, 5)
    assert.equal(indices.currencyIdx, 6)
    assert.equal(indices.grossAmountIdx, 7)
    assert.equal(indices.netAmountIdx, 8)
  })

  await t.test('deve gerar prévia válida priorizando Valor bruto e calculando Valor líquido', () => {
    const csv = `Data;Produto;Cliente;E-mail;Status;Método;Moeda;"Valor bruto";"Valor líquido"
"01/10/2026 13:44";"Combo 4 Simulados";Marcelo;marcelo@test.com;Pago;PIX;BRL;37,00;36,63
"01/10/2026 11:15";"Combo 4 Simulados";Valdessa;valdessa@test.com;Pendente;PIX;BRL;56,90;56,34`
    
    // Taxa de teste configurada: 2%
    const mockFees = [
      { name: 'Taxa Pix Getfy', type: 'checkout', platform: 'getfy', paymentMethod: 'pix', percentage: 2.0, fixedAmount: 0 }
    ]

    const preview = previewGetfyCsv(csv, 5, mockFees)
    assert.equal(preview.success, true)
    assert.equal(preview.totalRows, 2)
    assert.equal(preview.sample.length, 2)
    assert.equal(preview.sample[0].grossAmount, 37.00, 'Deve pegar do Valor bruto')
    // 37.00 - 2% (0.74) = 36.26 calculado pelo sistema
    assert.equal(preview.sample[0].netAmount, 36.26, 'Sistema deve calcular o líquido a partir das taxas')
  })
})

test('Getfy CSV Importer - Integração com Banco de Dados e Cálculo do Líquido pelo Sistema', async (t) => {
  // Encontrar ou criar workspace de teste
  let workspace = await prisma.workspace.findFirst({
    where: { slug: { contains: 'test' } }
  })

  if (!workspace) {
    workspace = await prisma.workspace.findFirst()
  }

  assert.ok(workspace, 'Workspace deve existir no banco para o teste')
  const workspaceId = workspace.id

  // Cadastrar taxa temporária para Getfy Pix (1.00 fixo para teste claro e determinístico)
  const testFee = await prisma.fee.create({
    data: {
      workspaceId,
      name: 'Taxa Teste Pix Getfy',
      type: 'checkout',
      platform: 'getfy',
      paymentMethod: 'pix',
      percentage: 0,
      fixedAmount: 1.00,
      isActive: true
    }
  })

  const testEmail1 = `getfy_csv_user1_${Date.now()}@test.com`
  const testEmail2 = `getfy_csv_user2_${Date.now()}@test.com`

  const sampleCsv = `Data;Produto;Cliente;E-mail;Status;Método;Moeda;"Valor bruto";"Valor líquido"
"01/10/2026 13:44";"SIMULADOS PMMA - COMBO 4";"Marcelo Silva";${testEmail1};Pago;PIX;BRL;50,00;48,00
"01/10/2026 11:15";"SIMULADOS PMMA - COMBO 4";"Valdessa Santos";${testEmail2};Pendente;PIX;BRL;100,00;95,00`

  try {
    // 1. Executar importação inicial
    const result = await importGetfySalesCsv(workspaceId, sampleCsv, {
      triggerCapi: false,
      updateExisting: true
    })

    assert.equal(result.success, true)
    assert.equal(result.totalRows, 2)
    assert.equal(result.createdCount, 2)
    assert.equal(result.failedCount, 0)
    assert.equal(result.stats.totalGross, 50.00) // apenas aprovadas somam no faturamento
    // Sistema calcula: 50.00 bruto - 1.00 taxa = 49.00 liquido (em vez do 48,00 que veio no csv)
    assert.equal(result.stats.totalNet, 49.00)

    // 2. Verificar que as vendas foram salvas com o valor bruto pego do CSV e o líquido calculado pelo sistema
    const sale1 = await prisma.sale.findFirst({
      where: { workspaceId, platform: 'getfy', customerEmail: testEmail1 },
      include: { items: true }
    })
    assert.ok(sale1)
    assert.equal(sale1.grossAmount, 50.00, 'Deve pegar o valor bruto (50.00) da coluna Valor bruto')
    assert.equal(sale1.netAmount, 49.00, 'Líquido deve ser calculado pelo sistema (50.00 - 1.00 = 49.00)')
    assert.equal(sale1.status, 'approved')

    const sale2 = await prisma.sale.findFirst({
      where: { workspaceId, platform: 'getfy', customerEmail: testEmail2 }
    })
    assert.ok(sale2)
    assert.equal(sale2.grossAmount, 100.00, 'Deve pegar o valor bruto (100.00) da coluna Valor bruto')
    assert.equal(sale2.netAmount, 99.00, 'Líquido deve ser calculado pelo sistema (100.00 - 1.00 = 99.00)')
    assert.equal(sale2.status, 'pending')

  } finally {
    // Limpeza dos dados de teste
    await prisma.fee.delete({ where: { id: testFee.id } }).catch(() => {})
    await prisma.saleItem.deleteMany({
      where: {
        sale: {
          workspaceId,
          platform: 'getfy',
          customerEmail: { in: [testEmail1, testEmail2] }
        }
      }
    })
    await prisma.sale.deleteMany({
      where: {
        workspaceId,
        platform: 'getfy',
        customerEmail: { in: [testEmail1, testEmail2] }
      }
    })
  }
})

