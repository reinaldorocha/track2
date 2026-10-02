import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { prisma } from '../src/lib/db'
import { getOrCreateWorkspaceIntegrations, rotateIntegrationSecret } from '../src/lib/integrations/service'
import { authenticateWebhook } from '../src/lib/integrations/webhook-auth'
import { POST as getfyPost } from '../src/app/api/webhooks/getfy/route'
import { POST as kiwifyPost } from '../src/app/api/webhooks/kiwify/route'

describe('Hub de Integracoes e Testes de Webhooks (Getfy e Kiwify)', () => {
  it('Gera e recupera integracoes com segredos exclusivos e URLs formatadas para todos os gateways', async () => {
    const testWs = await prisma.workspace.create({
      data: {
        name: 'Workspace Teste Integracoes',
        slug: `test-integrations-${Date.now()}`
      }
    })

    try {
      const integrations = await getOrCreateWorkspaceIntegrations(testWs.id, 'http://localhost:3000')
      assert.equal(integrations.length, 6, 'Deve garantir 6 plataformas oficiais')

      const getfy = integrations.find(i => i.platform === 'getfy')
      const kiwify = integrations.find(i => i.platform === 'kiwify')
      const cakto = integrations.find(i => i.platform === 'cakto')
      const hotmart = integrations.find(i => i.platform === 'hotmart')
      const yampi = integrations.find(i => i.platform === 'yampi')
      const shopify = integrations.find(i => i.platform === 'shopify')

      assert.ok(getfy?.webhookSecret.startsWith('whsec_getfy_'), 'Segredo Getfy deve ter prefixo exclusivo')
      assert.ok(getfy?.webhookUrl.includes(`/api/webhooks/getfy?token=${getfy?.webhookSecret}`), 'URL Getfy deve embutir o token')

      assert.ok(kiwify?.webhookSecret.startsWith('whsec_kiwify_'), 'Segredo Kiwify deve ter prefixo exclusivo')
      assert.ok(kiwify?.webhookUrl.includes(`/api/webhooks/kiwify?token=${kiwify?.webhookSecret}`), 'URL Kiwify deve embutir o token')

      assert.ok(cakto?.webhookUrl.includes(`/api/webhooks/cakto?token=${cakto?.webhookSecret}`))
      assert.ok(hotmart?.webhookUrl.includes(`/api/webhooks/hotmart?hottok=${hotmart?.webhookSecret}`))
      assert.ok(yampi?.webhookUrl.includes(`/api/webhooks/yampi?token=${yampi?.webhookSecret}`))
      assert.ok(shopify?.webhookUrl.includes(`/api/webhooks/shopify?workspaceId=${testWs.id}`))
    } finally {
      await prisma.integration.deleteMany({ where: { workspaceId: testWs.id } })
      await prisma.workspace.delete({ where: { id: testWs.id } })
    }
  })

  it('Rotaciona segredo da integracao com seguranca preservando integridade', async () => {
    const testWs = await prisma.workspace.create({
      data: {
        name: 'Workspace Rotacao Token',
        slug: `test-rotate-${Date.now()}`
      }
    })

    try {
      const initial = await getOrCreateWorkspaceIntegrations(testWs.id, 'http://localhost:3000')
      const getfyInitial = initial.find(i => i.platform === 'getfy')!

      const rotated = await rotateIntegrationSecret(testWs.id, 'getfy', 'http://localhost:3000')

      assert.notEqual(rotated.webhookSecret, getfyInitial.webhookSecret, 'Novo segredo deve ser diferente do anterior')
      assert.ok(rotated.webhookUrl.includes(rotated.webhookSecret), 'URL deve refletir novo segredo')
    } finally {
      await prisma.integration.deleteMany({ where: { workspaceId: testWs.id } })
      await prisma.workspace.delete({ where: { id: testWs.id } })
    }
  })

  it('Autentica webhook Getfy via token gerado na query parameter e processa pedido_pago', async () => {
    const testWs = await prisma.workspace.create({
      data: {
        name: 'Workspace Getfy Teste',
        slug: `test-getfy-${Date.now()}`
      }
    })

    try {
      const integrations = await getOrCreateWorkspaceIntegrations(testWs.id, 'http://localhost:3000')
      const getfy = integrations.find(i => i.platform === 'getfy')!

      const orderId = `test_gt_${Date.now()}`
      const req = new Request(`http://localhost:3000/api/webhooks/getfy?token=${getfy.webhookSecret}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'pedido_pago',
          payload: {
            order: {
              id: orderId,
              status: 'completed',
              amount: 197.0,
              currency: 'BRL',
              created_at: new Date().toISOString()
            },
            customer: {
              email: 'comprador@getfy.com.br',
              phone: '11999990000',
              name: 'Cliente Getfy'
            },
            amount: 197.0,
            status: 'paid',
            paymentMethod: 'pix',
            product: {
              id: 'prod_gt_1',
              name: 'Curso Getfy VIP'
            },
            tracking: {
              utm_source: 'meta',
              utm_campaign: 'campanha_validacao'
            }
          }
        })
      })

      const res = await getfyPost(req)
      const data = await res.json()

      assert.equal(res.status, 200, 'Deve autorizar e processar com HTTP 200')
      assert.equal(data.success, true)
      assert.equal(data.status, 'approved')

      const savedSale = await prisma.sale.findFirst({
        where: { workspaceId: testWs.id, platform: 'getfy', externalId: orderId }
      })
      assert.ok(savedSale, 'Venda Getfy deve ser gravada no banco com o workspace correto')
      assert.equal(savedSale?.grossAmount, 197.0)
    } finally {
      await prisma.sale.deleteMany({ where: { workspaceId: testWs.id } })
      await prisma.webhookEvent.deleteMany({ where: { workspaceId: testWs.id } })
      await prisma.integration.deleteMany({ where: { workspaceId: testWs.id } })
      await prisma.workspace.delete({ where: { id: testWs.id } })
    }
  })

  it('Autentica webhook Kiwify via token gerado na query parameter e processa pedido pago', async () => {
    const testWs = await prisma.workspace.create({
      data: {
        name: 'Workspace Kiwify Teste',
        slug: `test-kiwify-${Date.now()}`
      }
    })

    try {
      const integrations = await getOrCreateWorkspaceIntegrations(testWs.id, 'http://localhost:3000')
      const kiwify = integrations.find(i => i.platform === 'kiwify')!

      const orderId = `test_kw_${Date.now()}`
      const req = new Request(`http://localhost:3000/api/webhooks/kiwify?token=${kiwify.webhookSecret}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: orderId,
          order_status: 'paid',
          order_amount: 19700,
          Commissions: { charge_amount: 19700, my_commission: 18000 },
          Customer: { email: 'comprador@kiwify.com', mobile: '11999998888' },
          Product: { product_id: 'prod_kw_1', product_name: 'Curso Kiwify' },
          TrackingParameters: { src: 'facebook_ads', utm_source: 'fb', utm_campaign: 'campanha_teste' }
        })
      })

      const res = await kiwifyPost(req)
      const data = await res.json()

      assert.equal(res.status, 200, 'Deve autorizar e processar com HTTP 200')
      assert.equal(data.success, true)
      assert.equal(data.status, 'approved')

      const savedSale = await prisma.sale.findFirst({
        where: { workspaceId: testWs.id, platform: 'kiwify', externalId: orderId }
      })
      assert.ok(savedSale, 'Venda Kiwify deve ser gravada no banco com o workspace correto')
      assert.equal(savedSale?.grossAmount, 197.0)
    } finally {
      await prisma.sale.deleteMany({ where: { workspaceId: testWs.id } })
      await prisma.webhookEvent.deleteMany({ where: { workspaceId: testWs.id } })
      await prisma.integration.deleteMany({ where: { workspaceId: testWs.id } })
      await prisma.workspace.delete({ where: { id: testWs.id } })
    }
  })

  it('authenticateWebhook autoriza chamadas de simulacao com sessionWorkspaceId mesmo sem token na URL', async () => {
    const testWs = await prisma.workspace.create({
      data: {
        name: 'Workspace Simulacao Painel',
        slug: `test-sim-${Date.now()}`
      }
    })

    try {
      const authResult = await authenticateWebhook({
        platform: 'getfy',
        providedToken: null,
        sessionWorkspaceId: testWs.id
      })

      assert.equal(authResult.authorized, true)
      assert.equal(authResult.status, 200)
      assert.equal(authResult.workspaceId, testWs.id)
    } finally {
      await prisma.workspace.delete({ where: { id: testWs.id } })
    }
  })

  it('Processa webhook Getfy com parcelas de cartao (12x e 1x) e calcula valor liquido correto por taxas', async () => {
    const testWs = await prisma.workspace.create({
      data: {
        name: 'Workspace Getfy Parcelas Teste',
        slug: `test-getfy-installments-${Date.now()}`
      }
    })

    try {
      const integrations = await getOrCreateWorkspaceIntegrations(testWs.id, 'http://localhost:3000')
      const getfy = integrations.find(i => i.platform === 'getfy')!

      // Configura regras de taxa: 6% para cartão 1x e 3% para parcelado (2x a 12x)
      await prisma.fee.createMany({
        data: [
          {
            workspaceId: testWs.id,
            name: 'Taxa Cartão 1x',
            type: 'gateway',
            paymentMethod: 'card_single',
            percentage: 6.0,
            fixedAmount: 0,
            isActive: true,
          },
          {
            workspaceId: testWs.id,
            name: 'Taxa Cartão Parcelado (2a12x)',
            type: 'gateway',
            paymentMethod: 'card_installments',
            percentage: 3.0,
            fixedAmount: 0,
            isActive: true,
          }
        ]
      })

      // Caso 1: Cartão 12x via payment.installments
      const orderId12x = `test_gt_12x_${Date.now()}`
      const req12x = new Request(`http://localhost:3000/api/webhooks/getfy?token=${getfy.webhookSecret}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'pedido_pago',
          payload: {
            order: {
              id: orderId12x,
              status: 'completed',
              amount: 100.0,
              currency: 'BRL',
            },
            payment: {
              method: 'card',
              installments: 12,
              installments_text: '12x',
            },
            amount: 100.0,
            product: {
              id: 'prod_12x',
              name: 'Produto Parcelado 12x'
            }
          }
        })
      })

      const res12x = await getfyPost(req12x)
      assert.equal(res12x.status, 200)

      const sale12x = await prisma.sale.findFirst({
        where: { workspaceId: testWs.id, externalId: orderId12x }
      })
      assert.ok(sale12x, 'Venda 12x deve ser registrada')
      assert.equal(sale12x?.installments, 12, 'Parcelas devem ser 12')
      assert.equal(sale12x?.paymentMethod, 'card', 'Método de pagamento deve ser card')
      assert.equal(sale12x?.grossAmount, 100.0)
      // 3% de 100 = 3 -> líquido 97.00
      assert.equal(sale12x?.netAmount, 97.0, 'Valor líquido para 12x deve descontar 3% (R$ 97,00)')

      // Caso 2: Cartão 1x via payment.installments_text ("1x")
      const orderId1x = `test_gt_1x_${Date.now()}`
      const req1x = new Request(`http://localhost:3000/api/webhooks/getfy?token=${getfy.webhookSecret}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'pedido_pago',
          payload: {
            order: {
              id: orderId1x,
              status: 'completed',
              amount: 100.0,
              currency: 'BRL',
            },
            payment: {
              method: 'card',
              installments_text: '1x',
            },
            amount: 100.0,
            product: {
              id: 'prod_1x',
              name: 'Produto 1x'
            }
          }
        })
      })

      const res1x = await getfyPost(req1x)
      assert.equal(res1x.status, 200)

      const sale1x = await prisma.sale.findFirst({
        where: { workspaceId: testWs.id, externalId: orderId1x }
      })
      assert.ok(sale1x, 'Venda 1x deve ser registrada')
      assert.equal(sale1x?.installments, 1, 'Parcelas devem ser 1')
      assert.equal(sale1x?.grossAmount, 100.0)
      // 6% de 100 = 6 -> líquido 94.00
      assert.equal(sale1x?.netAmount, 94.0, 'Valor líquido para 1x deve descontar 6% (R$ 94,00)')

      // Caso 3: À vista PIX sem campo parcelas -> default 1
      const orderIdPix = `test_gt_pix_${Date.now()}`
      const reqPix = new Request(`http://localhost:3000/api/webhooks/getfy?token=${getfy.webhookSecret}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'pedido_pago',
          payload: {
            order: {
              id: orderIdPix,
              status: 'completed',
              amount: 50.0,
              currency: 'BRL',
            },
            payment: {
              method: 'pix',
            },
            amount: 50.0,
            product: {
              id: 'prod_pix',
              name: 'Produto Pix'
            }
          }
        })
      })

      const resPix = await getfyPost(reqPix)
      assert.equal(resPix.status, 200)

      const salePix = await prisma.sale.findFirst({
        where: { workspaceId: testWs.id, externalId: orderIdPix }
      })
      assert.ok(salePix, 'Venda Pix deve ser registrada')
      assert.equal(salePix?.installments, 1, 'Parcelas de Pix devem ser 1')
      assert.equal(salePix?.paymentMethod, 'pix')
    } finally {
      await prisma.fee.deleteMany({ where: { workspaceId: testWs.id } })
      await prisma.sale.deleteMany({ where: { workspaceId: testWs.id } })
      await prisma.webhookEvent.deleteMany({ where: { workspaceId: testWs.id } })
      await prisma.integration.deleteMany({ where: { workspaceId: testWs.id } })
      await prisma.workspace.delete({ where: { id: testWs.id } })
    }
  })
})
