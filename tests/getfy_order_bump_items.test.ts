import { test, describe } from 'node:test'
import assert from 'node:assert/strict'

// 1. Simulação da extração de order bumps do Getfy
function extractGetfyOrderItems(payload: {
  grossPrice: number
  product: { id?: string | number; name?: string }
  order_bumps?: Array<{ product_id?: string | number; name?: string; amount?: number }>
}) {
  const rawBumps = payload.order_bumps || []
  const validBumps = rawBumps
    .map(b => ({
      id: b.product_id ? String(b.product_id) : undefined,
      name: String(b.name || '').trim(),
      amount: Number(b.amount || 0)
    }))
    .filter(b => b.name && b.amount >= 0)

  const totalBumpsAmount = validBumps.reduce((acc, b) => acc + b.amount, 0)
  const mainProductName = String(payload.product.name || 'Produto Principal').trim()
  const mainProductId = payload.product.id ? String(payload.product.id) : undefined
  const mainProductPrice = Math.max(0, Math.round((payload.grossPrice - totalBumpsAmount) * 100) / 100)

  const items = [
    {
      id: mainProductId,
      name: mainProductName,
      quantity: 1,
      unitPrice: mainProductPrice,
      totalPrice: mainProductPrice,
      isOrderBump: false
    },
    ...validBumps.map(b => ({
      id: b.id,
      name: b.name,
      quantity: 1,
      unitPrice: b.amount,
      totalPrice: b.amount,
      isOrderBump: true
    }))
  ]

  const bumpSummary = validBumps.length > 0
    ? ` (+${validBumps.length} bump${validBumps.length > 1 ? 's' : ''})`
    : ''
  const notificationTitle = `${mainProductName}${bumpSummary}`

  return { items, totalBumpsAmount, mainProductPrice, notificationTitle }
}

// 2. Simulação do ranking de produtos na Dashboard (src/app/api/summary/route.ts)
function aggregateProductRanking(approvedSales: Array<{
  grossAmount: number
  netAmount: number
  items?: Array<{ name: string; quantity: number; totalPrice: number }>
}>) {
  const productMap = new Map<string, { name: string; salesCount: number; grossRevenue: number; netRevenue: number }>()

  for (const s of approvedSales) {
    if (s.items && s.items.length > 0) {
      for (const it of s.items) {
        const prodKey = it.name || 'Produto Principal'
        const existing = productMap.get(prodKey) || { name: prodKey, salesCount: 0, grossRevenue: 0, netRevenue: 0 }
        existing.salesCount += it.quantity || 1
        const itemGross = it.totalPrice ?? (s.items.length > 0 ? s.grossAmount / s.items.length : s.grossAmount)
        const itemNet = s.grossAmount > 0 ? (itemGross / s.grossAmount) * s.netAmount : (s.netAmount || itemGross)
        existing.grossRevenue += itemGross
        existing.netRevenue += itemNet
        productMap.set(prodKey, existing)
      }
    }
  }

  return Array.from(productMap.values()).map(p => ({
    ...p,
    grossRevenue: Math.round(p.grossRevenue * 100) / 100,
    netRevenue: Math.round(p.netRevenue * 100) / 100
  }))
}

describe('Getfy Webhook & Dashboard Order Bumps Separation', () => {
  test('1. Separa corretamente Produto Principal e múltiplos Order Bumps com valores individuais', () => {
    const payload = {
      grossPrice: 156.80, // Pedido total
      product: { id: 'prod_main_01', name: 'Mentoria Tráfego Turbo' },
      order_bumps: [
        { product_id: 'bump_01', name: 'Pack de Criativos 2026', amount: 29.90 },
        { product_id: 'bump_02', name: 'Planilha de Métricas & ROI', amount: 29.90 }
      ]
    }

    const res = extractGetfyOrderItems(payload)

    assert.equal(res.items.length, 3)
    assert.equal(res.totalBumpsAmount, 59.80)
    // Preço do produto principal = 156.80 - 59.80 = 97.00
    assert.equal(res.mainProductPrice, 97.00)

    // Item 1: Principal
    assert.equal(res.items[0].name, 'Mentoria Tráfego Turbo')
    assert.equal(res.items[0].totalPrice, 97.00)
    assert.equal(res.items[0].isOrderBump, false)

    // Item 2: Bump 1
    assert.equal(res.items[1].name, 'Pack de Criativos 2026')
    assert.equal(res.items[1].totalPrice, 29.90)
    assert.equal(res.items[1].isOrderBump, true)

    // Item 3: Bump 2
    assert.equal(res.items[2].name, 'Planilha de Métricas & ROI')
    assert.equal(res.items[2].totalPrice, 29.90)
    assert.equal(res.items[2].isOrderBump, true)

    // Notificação com contador de bumps
    assert.equal(res.notificationTitle, 'Mentoria Tráfego Turbo (+2 bumps)')
  })

  test('2. Trata pedidos sem Order Bump mantendo 1 único item e 100% do valor', () => {
    const payload = {
      grossPrice: 97.00,
      product: { id: 'prod_single', name: 'Curso Único' },
      order_bumps: []
    }

    const res = extractGetfyOrderItems(payload)
    assert.equal(res.items.length, 1)
    assert.equal(res.items[0].name, 'Curso Único')
    assert.equal(res.items[0].totalPrice, 97.00)
    assert.equal(res.items[0].isOrderBump, false)
    assert.equal(res.notificationTitle, 'Curso Único')
  })

  test('3. Agrupamento no card da Dashboard distribui receita bruta e líquida sem distorção', () => {
    // 1 venda com bump (126.90 bruto, 115.00 líquido)
    const sale1 = {
      grossAmount: 126.90,
      netAmount: 115.00,
      items: [
        { name: 'Curso de Google Ads', quantity: 1, totalPrice: 97.00 },
        { name: 'Templates de Anúncios', quantity: 1, totalPrice: 29.90 }
      ]
    }

    // 1 venda isolada do mesmo bump comprado avulso ou em outro checkout (29.90 bruto, 27.00 líquido)
    const sale2 = {
      grossAmount: 29.90,
      netAmount: 27.00,
      items: [
        { name: 'Templates de Anúncios', quantity: 1, totalPrice: 29.90 }
      ]
    }

    const ranking = aggregateProductRanking([sale1, sale2])

    // Devem existir 2 produtos distintos no ranking
    assert.equal(ranking.length, 2)

    const mainProd = ranking.find(p => p.name === 'Curso de Google Ads')
    const bumpProd = ranking.find(p => p.name === 'Templates de Anúncios')

    assert.ok(mainProd)
    assert.ok(bumpProd)

    // Curso de Google Ads: 1 venda, R$ 97,00 bruto
    assert.equal(mainProd.salesCount, 1)
    assert.equal(mainProd.grossRevenue, 97.00)

    // Templates de Anúncios (Order Bump): 2 vendas totais (1 como bump e 1 avulsa), R$ 59,80 bruto
    assert.equal(bumpProd.salesCount, 2)
    assert.equal(bumpProd.grossRevenue, 59.80)

    // A soma das receitas brutas no ranking bate perfeitamente com o total das vendas
    const totalRankingGross = mainProd.grossRevenue + bumpProd.grossRevenue
    const totalSalesGross = sale1.grossAmount + sale2.grossAmount
    assert.equal(Math.round(totalRankingGross * 100) / 100, Math.round(totalSalesGross * 100) / 100)

    // A soma das receitas líquidas no ranking bate perfeitamente com o total líquido das vendas
    const totalRankingNet = mainProd.netRevenue + bumpProd.netRevenue
    const totalSalesNet = sale1.netAmount + sale2.netAmount
    assert.equal(Math.round(totalRankingNet * 100) / 100, Math.round(totalSalesNet * 100) / 100)
  })
})
