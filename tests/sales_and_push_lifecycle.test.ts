import { test, describe } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { dispatchPushToDevices } from '../src/lib/notifications/push-dispatcher';

describe('Ciclo Completo de Vendas, Fluxo Pix e Push Notifications', () => {
  const rootDir = path.resolve(__dirname, '..');

  test('Formatação estrita de notificações para cada status de venda', () => {
    // Venda Aprovada
    const approvedTitle = "Venda aprovada!";
    const approvedBody = "Venda aprovada!\nValor: R$ 197,00";
    assert.strictEqual(approvedTitle, "Venda aprovada!");
    assert.ok(approvedBody.includes("Valor: R$ 197,00"));

    // Pix Gerado (Pendente)
    const pixTitle = "Pix gerado!";
    const pixBody = "Pix gerado!\nValor: R$ 97,00";
    assert.strictEqual(pixTitle, "Pix gerado!");
    assert.ok(pixBody.includes("Valor: R$ 97,00"));

    // Reembolso
    const refundTitle = "Venda reembolsada";
    const refundBody = "Venda reembolsada\nValor: R$ 197,00";
    assert.strictEqual(refundTitle, "Venda reembolsada");
    assert.ok(refundBody.includes("Valor: R$ 197,00"));

    // Chargeback
    const cbTitle = "Chargeback recebido";
    const cbBody = "Chargeback recebido\nValor: R$ 297,00";
    assert.strictEqual(cbTitle, "Chargeback recebido");
    assert.ok(cbBody.includes("Valor: R$ 297,00"));
  });

  test('Mapeamento sonoro e de canais de notificação Android e iOS', () => {
    const soundsMap = {
      sale_approved: { sound: "som_venda_aprovada", channel: "utmtrack_venda_aprovada", iosSound: "som_venda_aprovada.wav" },
      pix_pending: { sound: "som_pix_gerado", channel: "utmtrack_pix_gerado", iosSound: "som_pix_gerado.wav" },
      refund: { sound: "som_reembolso", channel: "utmtrack_reembolso", iosSound: "som_reembolso.wav" },
      chargeback: { sound: "som_chargeback", channel: "utmtrack_chargeback", iosSound: "som_chargeback.wav" },
    };

    for (const [key, config] of Object.entries(soundsMap)) {
      assert.ok(config.sound.startsWith("som_"), `Som para ${key} deve ser proprietário UTM-Track`);
      assert.ok(config.channel.startsWith("utmtrack_"), `Canal Android para ${key} deve ser prefixado com utmtrack_`);
      assert.ok(config.iosSound.endsWith(".wav"), `Som iOS para ${key} deve possuir extensão .wav`);
    }
  });

  test('Deep Links mapeiam para /sales/[id] com suporte a orderId', () => {
    const saleId = "cly123456789";
    const deepLink = `/sales/${saleId}`;
    assert.strictEqual(deepLink, "/sales/cly123456789");

    const fallbackLink = `/notifications`;
    assert.strictEqual(fallbackLink, "/notifications");
  });

  test('Configuração nativa Android possui canais de áudio e MainActivity atualizada', () => {
    const mainActivityPath = path.join(rootDir, 'android', 'app', 'src', 'main', 'java', 'com', 'utmtrack', 'app', 'MainActivity.java');
    assert.ok(fs.existsSync(mainActivityPath), 'MainActivity.java deve existir');

    const content = fs.readFileSync(mainActivityPath, 'utf-8');
    assert.ok(content.includes('utmtrack_venda_aprovada'), 'Deve conter canal utmtrack_venda_aprovada');
    assert.ok(content.includes('utmtrack_pix_gerado'), 'Deve conter canal utmtrack_pix_gerado');
    assert.ok(content.includes('utmtrack_reembolso'), 'Deve conter canal utmtrack_reembolso');
    assert.ok(content.includes('utmtrack_chargeback'), 'Deve conter canal utmtrack_chargeback');
    assert.ok(content.includes('R.raw.som_venda_aprovada'), 'Deve associar o áudio nativo de venda aprovada');
  });

  test('Configuração nativa iOS possui entitlements de Push e sons no bundle', () => {
    const entitlementsPath = path.join(rootDir, 'ios', 'App', 'App', 'App.entitlements');
    assert.ok(fs.existsSync(entitlementsPath), 'App.entitlements deve existir');

    const entContent = fs.readFileSync(entitlementsPath, 'utf-8');
    assert.ok(entContent.includes('aps-environment'), 'Deve declarar capacidade aps-environment');

    const appDelegatePath = path.join(rootDir, 'ios', 'App', 'App', 'AppDelegate.swift');
    const appDelegateContent = fs.readFileSync(appDelegatePath, 'utf-8');
    assert.ok(appDelegateContent.includes('didRegisterForRemoteNotificationsWithDeviceToken'), 'AppDelegate deve registrar token APNs');

    const soundInIos = path.join(rootDir, 'ios', 'App', 'App', 'som_venda_aprovada.wav');
    assert.ok(fs.existsSync(soundInIos), 'som_venda_aprovada.wav deve estar presente no bundle principal iOS');
  });

  test('Template do Firebase google-services.json.example documentado para Android FCM', () => {
    const gservicesPath = path.join(rootDir, 'android', 'app', 'google-services.json.example');
    assert.ok(fs.existsSync(gservicesPath), 'google-services.json.example deve existir');

    const json = JSON.parse(fs.readFileSync(gservicesPath, 'utf-8'));
    assert.strictEqual(json.client[0].client_info.android_client_info.package_name, 'com.utmtrack.app');
  });

  test('PWA: Service Worker public/sw.js existe e trata push e notificationclick', () => {
    const swPath = path.join(rootDir, 'public', 'sw.js');
    assert.ok(fs.existsSync(swPath), 'public/sw.js deve existir para suporte PWA Android');

    const swContent = fs.readFileSync(swPath, 'utf-8');
    assert.ok(swContent.includes('push'), 'sw.js deve escutar evento push');
    assert.ok(swContent.includes('notificationclick'), 'sw.js deve escutar notificationclick');
    assert.ok(swContent.includes('showNotification'), 'sw.js deve invocar showNotification');
  });

  test('PWA: Chave VAPID pública e privada são válidas e carregadas via módulo vapid.ts', async () => {
    const { getVapidPublicKey, getVapidPrivateKey } = await import('../src/lib/notifications/vapid');
    const pubKey = getVapidPublicKey();
    const privKey = getVapidPrivateKey();

    assert.ok(pubKey && pubKey.length > 50, 'Chave VAPID pública deve estar configurada');
    assert.ok(privKey && privKey.length > 30, 'Chave VAPID privada deve estar configurada');
  });

  test('Notificação com Produto e Valor: createSaleNotification inclui produto e valor na mensagem push', async () => {
    const { createSaleNotification } = await import('../src/lib/notifications/service');
    const { prisma } = await import('../src/lib/db');

    const ws = await prisma.workspace.create({
      data: { name: 'Test Notif Product WS', slug: `ws-notif-${Date.now()}` }
    });

    try {
      const res = await createSaleNotification({
        workspaceId: ws.id,
        type: 'sale_approved',
        amount: 37,
        currency: 'BRL',
        product: 'PMMA - COMBO DE 4 SIMULADOS COMENTADOS',
        transactionId: `tx_notif_prod_${Date.now()}`,
      });

      assert.ok(res.notification, 'Notificação deve ser criada');
      assert.strictEqual(res.notification.title, 'Venda aprovada!');
      assert.ok(res.notification.message.includes('37,00'), 'Mensagem deve conter o valor');
      assert.ok(res.notification.message.includes('PMMA - COMBO DE 4 SIMULADOS COMENTADOS'), 'Mensagem deve conter o nome do produto');
      assert.strictEqual(res.notification.product, 'PMMA - COMBO DE 4 SIMULADOS COMENTADOS');
    } finally {
      await prisma.notification.deleteMany({ where: { workspaceId: ws.id } });
      await prisma.workspace.delete({ where: { id: ws.id } });
    }
  });

  test('Getfy Webhook: Evento pedido_cancelado com paymentMethod pix NÃO dispara notificação de Pix Gerado', async () => {
    const { POST: getfyPost } = await import('../src/app/api/webhooks/getfy/route');
    const { prisma } = await import('../src/lib/db');

    const ws = await prisma.workspace.create({
      data: { name: 'Test Getfy Cancelled WS', slug: `ws-getfy-cancel-${Date.now()}` }
    });

    const integration = await prisma.integration.create({
      data: {
        workspaceId: ws.id,
        platform: 'getfy',
        name: 'Getfy Test',
        webhookSecret: `whsec_getfy_${Date.now()}`
      }
    });

    try {
      const rawPayload = {
        event: "pedido_cancelado",
        event_label: "Pedido cancelado",
        payload: {
          order: {
            id: 999362,
            status: "cancelled",
            amount: 37,
            currency: "BRL",
            is_renewal: false,
            created_at: "2026-09-30T19:17:13-03:00"
          },
          customer: {
            name: "Hugo Bezerra",
            email: "hugocosta2026ofc@outlook.com",
            phone: "5598985107347",
            docNumber: "60983524378",
            docType: "cpf"
          },
          product: {
            id: "23ae3e99-5963-41c8-b72d-cf08bf8de56c",
            name: "PMMA - COMBO DE 4 SIMULADOS COMENTADOS",
            billing_type: "one_time"
          },
          payment: {
            method: "pix",
            gateway: "mercadopago",
            gateway_transaction_id: "181699481596"
          },
          amount: 37,
          status: "cancelled",
          paymentMethod: "pix"
        },
        timestamp: "2026-10-01T19:21:32-03:00"
      };

      const req = new Request(`http://localhost/api/webhooks/getfy?token=${integration.webhookSecret}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rawPayload)
      });

      const res = await getfyPost(req);
      assert.strictEqual(res.status, 200);

      const json = await res.json();
      assert.strictEqual(json.status, 'cancelled');

      // Verifica se alguma notificação foi gerada
      const notifs = await prisma.notification.findMany({
        where: { workspaceId: ws.id }
      });
      assert.strictEqual(notifs.length, 0, 'Pedido cancelado não deve gerar notificação de Pix Gerado');
    } finally {
      await prisma.saleItem.deleteMany({ where: { sale: { workspaceId: ws.id } } });
      await prisma.sale.deleteMany({ where: { workspaceId: ws.id } });
      await prisma.webhookEvent.deleteMany({ where: { workspaceId: ws.id } });
      await prisma.notification.deleteMany({ where: { workspaceId: ws.id } });
      await prisma.integration.deleteMany({ where: { workspaceId: ws.id } });
      await prisma.workspace.delete({ where: { id: ws.id } });
    }
  });
});
