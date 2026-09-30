import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import readline from 'readline/promises'
import { stdin as input, stdout as output } from 'process'

const prisma = new PrismaClient()

async function main() {
  console.log('=====================================================')
  console.log(' UTM-TRACK — CRIAÇÃO DE NOVO USUÁRIO ADMIN & WORKSPACE')
  console.log('=====================================================\n')

  const rl = readline.createInterface({ input, output })

  try {
    const name = (await rl.question('Nome do Administrador: ')).trim()
    if (!name) throw new Error('Nome é obrigatório')

    const email = (await rl.question('E-mail de Acesso: ')).trim().toLowerCase()
    if (!email || !email.includes('@')) throw new Error('E-mail inválido')

    const password = (await rl.question('Senha (mínimo 6 caracteres): ')).trim()
    if (!password || password.length < 6) throw new Error('Senha deve ter pelo menos 6 caracteres')

    const wsNameInput = (await rl.question('Nome do Workspace/Empresa (Enter para usar o seu nome): ')).trim()
    const wsName = wsNameInput || `${name} Workspace`

    console.log('\nCriando conta de Administrador...')
    const hashedPassword = await bcrypt.hash(password, 10)

    const baseSlug = wsName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'ws'
    const slug = `${baseSlug}-${Math.random().toString(36).substring(2, 6)}`

    // 1. Criar novo usuário e novo workspace
    const user = await prisma.user.upsert({
      where: { email },
      update: {
        name,
        password: hashedPassword,
        role: 'ADMIN',
        status: 'ACTIVE'
      },
      create: {
        name,
        email,
        password: hashedPassword,
        role: 'ADMIN',
        status: 'ACTIVE'
      }
    })

    const workspace = await prisma.workspace.create({
      data: {
        name: wsName,
        slug,
        timezone: 'America/Sao_Paulo',
        currency: 'BRL',
        members: {
          create: {
            userId: user.id,
            role: 'owner'
          }
        }
      }
    })

    console.log(`✅ Novo Administrador criado com sucesso: ${email}`)
    console.log(`🏢 Novo Workspace limpo criado: "${workspace.name}" (slug: ${workspace.slug})\n`)

    // Perguntar se quer apagar a conta demo e o workspace demo
    const deleteDemo = (await rl.question('Deseja excluir a conta e workspace de teste (demo@utmtrack.com)? (S/n): ')).trim().toLowerCase()

    if (deleteDemo === '' || deleteDemo === 's' || deleteDemo === 'sim' || deleteDemo === 'y' || deleteDemo === 'yes') {
      console.log('\nRemovendo workspace e dados de teste...')
      const demoWs = await prisma.workspace.findUnique({
        where: { slug: 'workspace-demo' }
      })

      if (demoWs) {
        const wsId = demoWs.id
        // Excluir em cascata todos os dados do workspace demo
        await prisma.auditLog.deleteMany({ where: { workspaceId: wsId } }).catch(() => {})
        await prisma.syncLog.deleteMany({ where: { workspaceId: wsId } }).catch(() => {})
        await prisma.notificationSound.deleteMany({ where: { workspaceId: wsId } }).catch(() => {})
        await prisma.notificationPreference.deleteMany({ where: { workspaceId: wsId } }).catch(() => {})
        await prisma.notification.deleteMany({ where: { workspaceId: wsId } }).catch(() => {})
        await prisma.device.deleteMany({ where: { workspaceId: wsId } }).catch(() => {})
        await prisma.rule.deleteMany({ where: { workspaceId: wsId } }).catch(() => {})
        await prisma.tax.deleteMany({ where: { workspaceId: wsId } }).catch(() => {})
        await prisma.fee.deleteMany({ where: { workspaceId: wsId } }).catch(() => {})
        await prisma.expense.deleteMany({ where: { workspaceId: wsId } }).catch(() => {})
        await prisma.webhookEndpoint.deleteMany({ where: { workspaceId: wsId } }).catch(() => {})
        await prisma.integration.deleteMany({ where: { workspaceId: wsId } }).catch(() => {})
        await prisma.sale.deleteMany({ where: { workspaceId: wsId } }).catch(() => {})
        await prisma.product.deleteMany({ where: { workspaceId: wsId } }).catch(() => {})
        await prisma.trackingEvent.deleteMany({ where: { workspaceId: wsId } }).catch(() => {})
        await prisma.trackingSession.deleteMany({ where: { workspaceId: wsId } }).catch(() => {})
        await prisma.utmLink.deleteMany({ where: { workspaceId: wsId } }).catch(() => {})
        await prisma.pixel.deleteMany({ where: { workspaceId: wsId } }).catch(() => {})

        // Anúncios e campanhas da demo
        const adAccounts = await prisma.adAccount.findMany({ where: { workspaceId: wsId }, select: { id: true } })
        for (const acc of adAccounts) {
          const camps = await prisma.campaign.findMany({ where: { adAccountId: acc.id }, select: { id: true } })
          for (const c of camps) {
            const adSets = await prisma.adSet.findMany({ where: { campaignId: c.id }, select: { id: true } })
            for (const s of adSets) {
              await prisma.ad.deleteMany({ where: { adSetId: s.id } }).catch(() => {})
            }
            await prisma.adSet.deleteMany({ where: { campaignId: c.id } }).catch(() => {})
          }
          await prisma.campaign.deleteMany({ where: { adAccountId: acc.id } }).catch(() => {})
        }
        await prisma.adAccount.deleteMany({ where: { workspaceId: wsId } }).catch(() => {})

        await prisma.workspaceMember.deleteMany({ where: { workspaceId: wsId } }).catch(() => {})
        await prisma.workspace.delete({ where: { id: wsId } }).catch(() => {})
        console.log('🗑️ Workspace demo e dados de teste removidos com sucesso!')
      }

      // Remover usuário demo se diferente do novo
      if (email !== 'demo@utmtrack.com') {
        const demoUser = await prisma.user.findUnique({ where: { email: 'demo@utmtrack.com' } })
        if (demoUser) {
          await prisma.session.deleteMany({ where: { userId: demoUser.id } }).catch(() => {})
          await prisma.account.deleteMany({ where: { userId: demoUser.id } }).catch(() => {})
          await prisma.workspaceMember.deleteMany({ where: { userId: demoUser.id } }).catch(() => {})
          await prisma.user.delete({ where: { id: demoUser.id } }).catch(() => {})
          console.log('🗑️ Usuário demo@utmtrack.com removido!')
        }
      }
    }

    console.log('\n=====================================================')
    console.log(' 🎉 SISTEMA CONFIGURADO E PRONTO PARA USO!')
    console.log('=====================================================')
    console.log(`Faça login com: ${email} e acesse seu novo workspace "${wsName}".\n`)

  } catch (err: any) {
    console.error('\n❌ Erro:', err.message || err)
  } finally {
    rl.close()
    await prisma.$disconnect()
  }
}

main()
