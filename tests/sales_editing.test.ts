import { test, describe } from 'node:test';
import assert from 'node:assert';
import { prisma } from '../src/lib/db';
import { PATCH as patchSale, GET as getSale } from '../src/app/api/sales/[id]/route';

describe('Edição de Vendas (PATCH /api/sales/[id])', () => {
  test('Edita valores bruto e líquido, status, parcelas e recalcula líquido por taxas', async () => {
    // 1. Cria workspace e usuário
    const user = await prisma.user.create({
      data: {
        email: `test-edit-sale-${Date.now()}@example.com`,
        name: 'Edit Sale User',
        role: 'ADMIN',
      },
    });

    const workspace = await prisma.workspace.create({
      data: {
        name: 'Workspace Edit Sale',
        slug: `ws-edit-sale-${Date.now()}`,
      },
    });

    await prisma.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId: user.id,
        role: 'owner',
      },
    });

    // Configura taxa ativa: 3% para cartão parcelado
    await prisma.fee.create({
      data: {
        workspaceId: workspace.id,
        name: 'Taxa Cartão Parcelado',
        type: 'gateway',
        paymentMethod: 'card_installments',
        percentage: 3.0,
        fixedAmount: 0,
        isActive: true,
      },
    });

    // 2. Cria venda inicial com valor errado
    const sale = await prisma.sale.create({
      data: {
        workspaceId: workspace.id,
        platform: 'getfy',
        externalId: 'PEDIDO_ERRADO_123',
        status: 'pending',
        paymentMethod: 'pix',
        installments: 1,
        grossAmount: 50.0,
        netAmount: 50.0,
        currency: 'BRL',
        utmCampaign: 'campanha_antiga',
        customerEmail: 'antigo@cliente.com',
        orderedAt: new Date(),
      },
    });

    // Cria notificação associada
    const notif = await prisma.notification.create({
      data: {
        workspaceId: workspace.id,
        type: 'sale_pending',
        title: 'Pix gerado!',
        message: 'Pix gerado no valor de R$ 50,00',
        amount: 50.0,
        saleId: sale.id,
      },
    });

    try {
      // 3. Testa edição direta de valores (bruto R$ 200, líquido R$ 190, status aprovado, cartão 12x)
      const patchReq = new Request(`http://localhost:3000/api/sales/${sale.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-test-user-id': user.id,
        },
        body: JSON.stringify({
          grossAmount: 200.0,
          netAmount: 190.0,
          status: 'approved',
          paymentMethod: 'card',
          installments: 12,
          externalId: 'PEDIDO_CORRETO_123',
          utmCampaign: 'campanha_correta',
          customerEmail: 'correto@cliente.com',
        }),
      });

      const patchRes = await patchSale(patchReq, { params: Promise.resolve({ id: sale.id }) });
      assert.strictEqual(patchRes.status, 200, 'PATCH deve responder com status 200');

      const patchData = await patchRes.json();
      assert.strictEqual(patchData.success, true);
      assert.strictEqual(patchData.sale.grossAmount, 200.0);
      assert.strictEqual(patchData.sale.netAmount, 190.0);
      assert.strictEqual(patchData.sale.status, 'approved');
      assert.strictEqual(patchData.sale.paymentMethod, 'card');
      assert.strictEqual(patchData.sale.installments, 12);
      assert.strictEqual(patchData.sale.externalId, 'PEDIDO_CORRETO_123');
      assert.strictEqual(patchData.sale.utmCampaign, 'campanha_correta');
      assert.strictEqual(patchData.sale.customerEmail, 'correto@cliente.com');

      // Verifica se no banco os dados foram persistidos
      const updatedInDb = await prisma.sale.findUnique({ where: { id: sale.id } });
      assert.strictEqual(updatedInDb?.grossAmount, 200.0);
      assert.strictEqual(updatedInDb?.netAmount, 190.0);
      assert.strictEqual(updatedInDb?.status, 'approved');

      // Verifica se a notificação teve o amount sincronizado
      const updatedNotif = await prisma.notification.findUnique({ where: { id: notif.id } });
      assert.strictEqual(updatedNotif?.amount, 200.0, 'Notificação deve sincronizar novo valor bruto');

      // 4. Testa recálculo automático do líquido pelas taxas (recalculateNet: true)
      // Bruto = 200, Taxa de cartão parcelado (12x) = 3% (R$ 6,00) -> Líquido deve ser R$ 194,00
      const autoCalcReq = new Request(`http://localhost:3000/api/sales/${sale.id}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-test-user-id': user.id,
        },
        body: JSON.stringify({
          grossAmount: 200.0,
          recalculateNet: true,
        }),
      });

      const autoCalcRes = await patchSale(autoCalcReq, { params: Promise.resolve({ id: sale.id }) });
      assert.strictEqual(autoCalcRes.status, 200);

      const autoCalcData = await autoCalcRes.json();
      assert.strictEqual(autoCalcData.sale.netAmount, 194.0, 'Líquido recalculado deve ser 194.00 (200 - 3%)');
    } finally {
      await prisma.notification.deleteMany({ where: { workspaceId: workspace.id } });
      await prisma.fee.deleteMany({ where: { workspaceId: workspace.id } });
      await prisma.sale.deleteMany({ where: { workspaceId: workspace.id } });
      await prisma.workspaceMember.deleteMany({ where: { workspaceId: workspace.id } });
      await prisma.workspace.delete({ where: { id: workspace.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});
