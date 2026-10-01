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
})
