import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import axios from 'axios'
import { prisma } from '../src/lib/db'
import { encrypt } from '../src/lib/encryption'
import { syncAdAccount } from '../src/lib/meta/sync'
import { summarizeMetaSyncError } from '../src/lib/meta/rate-limit'

async function createAccount() {
  const workspace = await prisma.workspace.create({ data: { name: 'Meta Sync Test', slug: `meta-sync-${Date.now()}-${Math.random().toString(36).slice(2)}` } })
  const account = await prisma.adAccount.create({ data: { workspaceId: workspace.id, externalId: 'act_123', name: 'Conta teste',
    currency: 'BRL', timezone: 'America/Sao_Paulo', accessTokenEnc: encrypt('test-token') } })
  return { workspace, account }
}

describe('Meta Ads sync sob limite de requisições', () => {
  it('busca conjuntos e anúncios uma vez por conta mesmo com várias campanhas', async () => {
    const { workspace, account } = await createAccount()
    const original = axios.get
    const paths: string[] = []
    try {
      axios.get = (async (url: string) => {
        paths.push(url)
        if (url.endsWith('/campaigns')) return { data: { data: [{ id: 'c1', name: 'C1' }, { id: 'c2', name: 'C2' }] } }
        if (url.endsWith('/adsets')) return { data: { data: [{ id: 's1', campaign_id: 'c1', name: 'S1' }, { id: 's2', campaign_id: 'c2', name: 'S2' }] } }
        if (url.endsWith('/ads')) return { data: { data: [{ id: 'a1', adset_id: 's1', name: 'A1' }, { id: 'a2', adset_id: 's2', name: 'A2' }] } }
        if (url.endsWith('/insights')) return { data: { data: [] } }
        throw new Error(`URL inesperada: ${url}`)
      }) as typeof axios.get
      const result = await syncAdAccount(workspace.id, account.id)
      assert.equal(result.success, true)
      assert.equal(result.campaigns, 2)
      assert.equal(result.adSets, 2)
      assert.equal(result.ads, 2)
      assert.equal(paths.filter(path => path.endsWith('/adsets')).length, 1)
      assert.equal(paths.filter(path => path.endsWith('/ads')).length, 1)
    } finally {
      axios.get = original
      await prisma.workspace.delete({ where: { id: workspace.id } })
    }
  })

  it('para no primeiro limite, registra erro curto e evita repetição imediata', async () => {
    const { workspace, account } = await createAccount()
    const original = axios.get
    const paths: string[] = []
    try {
      axios.get = (async (url: string) => {
        paths.push(url)
        if (url.endsWith('/campaigns')) return { data: { data: [{ id: 'c1', name: 'C1' }] } }
        const error = Object.assign(new Error('Meta limit'), { isAxiosError: true,
          response: { status: 400, data: { error: { code: 17, message: 'User request limit reached' } } } })
        throw error
      }) as typeof axios.get
      const first = await syncAdAccount(workspace.id, account.id)
      assert.equal(first.success, false)
      assert.equal(first.rateLimited, true)
      assert.equal(paths.length, 2)
      const log = await prisma.syncLog.findFirst({ where: { adAccountId: account.id }, orderBy: { startedAt: 'desc' } })
      assert.equal(log?.status, 'failed')
      assert.ok((log?.errorMessage?.length || 0) < 200)
      const second = await syncAdAccount(workspace.id, account.id)
      assert.equal(second.rateLimited, true)
      assert.equal(paths.length, 2)
      assert.equal(summarizeMetaSyncError('Conjuntos A: User request limit reached; Conjuntos B: User request limit reached'),
        'Limite de requisições da Meta atingido. A coleta foi interrompida e será retomada após o intervalo de espera.')
    } finally {
      axios.get = original
      await prisma.workspace.delete({ where: { id: workspace.id } })
    }
  })
})
