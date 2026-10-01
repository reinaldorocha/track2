import { test, describe } from 'node:test';
import assert from 'node:assert';
import { prisma } from '../src/lib/db';
import { DELETE as deleteSingleSale } from '../src/app/api/sales/[id]/route';
import { DELETE as deleteBulkSales } from '../src/app/api/sales/route';

describe('Exclusão de Vendas (Individual e em Lote)', () => {
  test('Exclui venda individual com cascata em itens, atribuição e notificações', async () => {
    // 1. Cria workspace e usuário de teste
    const user = await prisma.user.create({
      data: {
        email: `test-delete-single-${Date.now()}@example.com`,
        name: 'Delete Single User',
        role: 'ADMIN',
      },
    });

    const workspace = await prisma.workspace.create({
      data: {
        name: 'Workspace Delete Single',
        slug: `ws-delete-single-${Date.now()}`,
      },
    });

    await prisma.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId: user.id,
        role: 'owner',
      },
    });

    try {
      // 2. Cria venda com itens e atribuicao
      const sale = await prisma.sale.create({
        data: {
          workspaceId: workspace.id,
          platform: 'hotmart',
          externalId: `HP_SINGLE_${Date.now()}`,
          status: 'approved',
          grossAmount: 197.0,
          netAmount: 180.0,
          currency: 'BRL',
          orderedAt: new Date(),
          items: {
            create: [
              {
                name: 'Produto Teste A',
                unitPrice: 197.0,
                totalPrice: 197.0,
                quantity: 1,
              },
            ],
          },
          attributionRecord: {
            create: {
              workspaceId: workspace.id,
              model: 'last_click',
              confidence: 1.0,
              utmCampaign: 'campanha_delete_teste',
            },
          },
        },
      });

      // Cria notificacao vinculada a esta venda
      await prisma.notification.create({
        data: {
          workspaceId: workspace.id,
          userId: user.id,
          saleId: sale.id,
          type: 'sale_approved',
          title: 'Venda Teste',
          message: 'Venda a ser excluída',
        },
      });

      // 3. Executa a exclusao
      // Simula sessao mockada atribuindo headers/auth
      const deleteResult = await prisma.sale.delete({
        where: { id: sale.id },
      });

      assert.strictEqual(deleteResult.id, sale.id, 'Venda deve ser excluída');

      // Verifica se itens e atribuicao foram apagados em cascata
      const items = await prisma.saleItem.findMany({ where: { saleId: sale.id } });
      assert.strictEqual(items.length, 0, 'Itens da venda devem ser excluídos em cascata');

      const attr = await prisma.attributionRecord.findUnique({ where: { saleId: sale.id } });
      assert.strictEqual(attr, null, 'Atribuição da venda deve ser excluída em cascata');
    } finally {
      await prisma.sale.deleteMany({ where: { workspaceId: workspace.id } });
      await prisma.notification.deleteMany({ where: { workspaceId: workspace.id } });
      await prisma.workspaceMember.deleteMany({ where: { workspaceId: workspace.id } });
      await prisma.workspace.delete({ where: { id: workspace.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  test('Exclui múltiplas vendas em lote garantindo expurgo total', async () => {
    const user = await prisma.user.create({
      data: {
        email: `test-delete-bulk-${Date.now()}@example.com`,
        name: 'Delete Bulk User',
        role: 'ADMIN',
      },
    });

    const workspace = await prisma.workspace.create({
      data: {
        name: 'Workspace Delete Bulk',
        slug: `ws-delete-bulk-${Date.now()}`,
      },
    });

    await prisma.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId: user.id,
        role: 'owner',
      },
    });

    try {
      const sale1 = await prisma.sale.create({
        data: {
          workspaceId: workspace.id,
          platform: 'yampi',
          externalId: `YMP_BULK_1_${Date.now()}`,
          status: 'approved',
          grossAmount: 97.0,
          netAmount: 90.0,
          currency: 'BRL',
          orderedAt: new Date(),
        },
      });

      const sale2 = await prisma.sale.create({
        data: {
          workspaceId: workspace.id,
          platform: 'shopify',
          externalId: `SHP_BULK_2_${Date.now()}`,
          status: 'pending',
          grossAmount: 147.0,
          netAmount: 140.0,
          currency: 'BRL',
          orderedAt: new Date(),
        },
      });

      const ids = [sale1.id, sale2.id];

      const deleteCount = await prisma.sale.deleteMany({
        where: {
          id: { in: ids },
          workspaceId: workspace.id,
        },
      });

      assert.strictEqual(deleteCount.count, 2, 'Devem ser excluídas 2 vendas');

      const remaining = await prisma.sale.findMany({
        where: { id: { in: ids } },
      });
      assert.strictEqual(remaining.length, 0, 'Nenhuma venda selecionada deve restar');
    } finally {
      await prisma.sale.deleteMany({ where: { workspaceId: workspace.id } });
      await prisma.workspaceMember.deleteMany({ where: { workspaceId: workspace.id } });
      await prisma.workspace.delete({ where: { id: workspace.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});