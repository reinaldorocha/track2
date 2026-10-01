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
    const raw = '\uFEFFData;Produto;Cliente;E-mail;Status;Método;Moeda;"Valor líquido"\n"01/10/2026 13:44";"Combo Simulado";Marcelo;marcelo@test.com;Pago;PIX;BRL;36,63'
    const lines = parseCsvLines(raw)
    assert.equal(lines.length, 2)
    assert.equal(lines[0][0], 'Data')
    assert.equal(lines[1][0], '01/10/2026 13:44')
    assert.equal(lines[1][1], 'Combo Simulado')
    assert.equal(lines[1][7], '36,63')
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

  await t.test('deve detectar índices de cabeçalho mesmo com variações e aspas', () => {
    const header = ['Data', 'Produto', 'Cliente', 'E-mail', 'Status', 'Método', 'Moeda', '"Valor líquido"']
    const indices = detectHeaderIndices(header)
    assert.equal(indices.isValid, true)
    assert.equal(indices.dateIdx, 0)
    assert.equal(indices.productIdx, 1)
    assert.equal(indices.customerIdx, 2)
    assert.equal(indices.emailIdx, 3)
    assert.equal(indices.statusIdx, 4)
    assert.equal(indices.methodIdx, 5)
    assert.equal(indices.netAmountIdx, 7)
  })

  await t.test('deve gerar prévia válida das linhas do CSV', () => {
    const csv = `Data;Produto;Cliente;E-mail;Status;Método;Moeda;"Valor líquido"
"01/10/2026 13:44";"Combo 4 Simulados";Marcelo;marcelo@test.com;Pago;PIX;BRL;36,63
"01/10/2026 11:15";"Combo 4 Simulados";Valdessa;valdessa@test.com;Pendente;PIX;BRL;56,90`
    const preview = previewGetfyCsv(csv, 5)
    assert.equal(preview.success, true)
    assert.equal(preview.totalRows, 2)
    assert.equal(preview.sample.length, 2)
    assert.equal(preview.sample[0].customerEmail, 'marcelo@test.com')
    assert.equal(preview.sample[0].netAmount, 36.63)
    assert.equal(preview.sample[1].status, 'Pendente')
  })
})

test('Getfy CSV Importer - Integração com Banco de Dados e Upsert', async (t) => {
  // Encontrar ou criar workspace de teste
  let workspace = await prisma.workspace.findFirst({
    where: { slug: { contains: 'test' } }
  })

  if (!workspace) {
    workspace = await prisma.workspace.findFirst()
  }

  assert.ok(workspace, 'Workspace deve existir no banco para o teste')
  const workspaceId = workspace.id

  const testEmail1 = `getfy_csv_user1_${Date.now()}@test.com`
  const testEmail2 = `getfy_csv_user2_${Date.now()}@test.com`
  const testEmail3 = `getfy_csv_user3_${Date.now()}@test.com`

  const sampleCsv = `Data;Produto;Cliente;E-mail;Status;Método;Moeda;"Valor líquido"
"01/10/2026 13:44";"SIMULADOS PMMA - COMBO 4";"Marcelo Silva";${testEmail1};Pago;PIX;BRL;36,63
"01/10/2026 11:15";"SIMULADOS PMMA - COMBO 4";"Valdessa Santos";${testEmail2};Pendente;PIX;BRL;56,90
"29/09/2026 11:51";"SIMULADOS PMMA - COMBO 4";"Ruan Costa";${testEmail3};Cancelado;PIX;BRL;37,00`

  try {
    // 1. Executar importação inicial
    const result = await importGetfySalesCsv(workspaceId, sampleCsv, {
      triggerCapi: false,
      updateExisting: true
    })

    assert.equal(result.success, true)
    assert.equal(result.totalRows, 3)
    assert.equal(result.createdCount, 3)
    assert.equal(result.failedCount, 0)
    assert.equal(result.stats.countApproved, 1)
    assert.equal(result.stats.countPending, 1)
    assert.equal(result.stats.countCancelled, 1)
    assert.equal(result.stats.totalNet, 36.63)

    // 2. Verificar que as vendas foram salvas com os status corretos
    const sale1 = await prisma.sale.findFirst({
      where: { workspaceId, platform: 'getfy', customerEmail: testEmail1 },
      include: { items: true }
    })
    assert.ok(sale1)
    assert.equal(sale1.status, 'approved')
    assert.equal(sale1.paymentMethod, 'pix')
    assert.equal(sale1.netAmount, 36.63)
    assert.ok(sale1.items.length > 0)
    assert.equal(sale1.items[0].name, 'SIMULADOS PMMA - COMBO 4')

    const sale2 = await prisma.sale.findFirst({
      where: { workspaceId, platform: 'getfy', customerEmail: testEmail2 }
    })
    assert.ok(sale2)
    assert.equal(sale2.status, 'pending')

    const sale3 = await prisma.sale.findFirst({
      where: { workspaceId, platform: 'getfy', customerEmail: testEmail3 }
    })
    assert.ok(sale3)
    assert.equal(sale3.status, 'cancelled')

    // 3. Testar idempotência e atualização: re-importar CSV com venda 2 agora "Pago"
    const updatedCsv = `Data;Produto;Cliente;E-mail;Status;Método;Moeda;"Valor líquido"
"01/10/2026 13:44";"SIMULADOS PMMA - COMBO 4";"Marcelo Silva";${testEmail1};Pago;PIX;BRL;36,63
"01/10/2026 11:15";"SIMULADOS PMMA - COMBO 4";"Valdessa Santos";${testEmail2};Pago;PIX;BRL;56,34
"29/09/2026 11:51";"SIMULADOS PMMA - COMBO 4";"Ruan Costa";${testEmail3};Cancelado;PIX;BRL;37,00`

    const reimportResult = await importGetfySalesCsv(workspaceId, updatedCsv, {
      triggerCapi: false,
      updateExisting: true
    })

    assert.equal(reimportResult.success, true)
    assert.equal(reimportResult.createdCount, 0, 'Não deve criar novas vendas em re-importação')
    assert.equal(reimportResult.updatedCount, 3, 'Deve atualizar as vendas existentes')

    // Verificar se sale2 foi atualizada para "approved"
    const sale2Updated = await prisma.sale.findFirst({
      where: { workspaceId, platform: 'getfy', customerEmail: testEmail2 }
    })
    assert.ok(sale2Updated)
    assert.equal(sale2Updated.status, 'approved')
    assert.equal(sale2Updated.netAmount, 56.34)

  } finally {
    // Limpeza dos dados de teste
    await prisma.saleItem.deleteMany({
      where: {
        sale: {
          workspaceId,
          platform: 'getfy',
          customerEmail: { in: [testEmail1, testEmail2, testEmail3] }
        }
      }
    })
    await prisma.sale.deleteMany({
      where: {
        workspaceId,
        platform: 'getfy',
        customerEmail: { in: [testEmail1, testEmail2, testEmail3] }
      }
    })
  }
})
