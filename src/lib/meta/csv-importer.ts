import { prisma } from '@/lib/db'

export interface MetaCsvRow {
  accountName: string
  accountId: string
  campaignName: string
  campaignId: string
  adSetName: string
  adSetId: string
  adName: string
  adId: string
  date: string // YYYY-MM-DD
  currency: string
  spend: number
  impressions: number
  reach: number
  clicks: number
  cpc: number
  conversions: number
  initiateCheckouts: number
}

export interface ImportCsvResult {
  success: boolean
  rowsProcessed: number
  campaignsImported: number
  adSetsImported: number
  adsImported: number
  insightsCreated: number
  minDate: string
  maxDate: string
  adAccountName: string
  error?: string
}

/**
 * Utilitário para quebrar linhas e colunas de CSV respeitando aspas RFC 4180
 */
function parseCsvLines(csvText: string): string[][] {
  const result: string[][] = []
  let currentRow: string[] = []
  let currentField = ''
  let inQuotes = false

  // Detectar delimitador provável (vírgula ou ponto-e-vírgula)
  const firstLine = csvText.split(/\r\n|\n|\r/)[0] || ''
  const commaCount = (firstLine.match(/,/g) || []).length
  const semiCount = (firstLine.match(/;/g) || []).length
  const delimiter = semiCount > commaCount ? ';' : ','

  for (let i = 0; i < csvText.length; i++) {
    const char = csvText[i]
    const nextChar = csvText[i + 1]

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          currentField += '"'
          i++ // pular aspa duplicada
        } else {
          inQuotes = false
        }
      } else {
        currentField += char
      }
    } else {
      if (char === '"') {
        inQuotes = true
      } else if (char === delimiter) {
        currentRow.push(currentField.trim())
        currentField = ''
      } else if (char === '\r') {
        if (nextChar === '\n') {
          i++
        }
        currentRow.push(currentField.trim())
        if (currentRow.some(c => c.length > 0)) {
          result.push(currentRow)
        }
        currentRow = []
        currentField = ''
      } else if (char === '\n') {
        currentRow.push(currentField.trim())
        if (currentRow.some(c => c.length > 0)) {
          result.push(currentRow)
        }
        currentRow = []
        currentField = ''
      } else {
        currentField += char
      }
    }
  }

  if (currentField.length > 0 || currentRow.length > 0) {
    currentRow.push(currentField.trim())
    if (currentRow.some(c => c.length > 0)) {
      result.push(currentRow)
    }
  }

  return result
}

function cleanNumber(val: string | undefined | null): number {
  if (!val) return 0
  const cleaned = val.trim().replace(/^"/, '').replace(/"$/, '').replace(/\s+/g, '')
  if (!cleaned) return 0

  // Se tiver vírgula como decimal (ex: "7,58")
  if (cleaned.includes(',') && !cleaned.includes('.')) {
    const num = parseFloat(cleaned.replace(',', '.'))
    return isNaN(num) ? 0 : num
  }
  // Se tiver ponto como decimal (ex: "7.58")
  const num = parseFloat(cleaned.replace(',', ''))
  return isNaN(num) ? 0 : num
}

function cleanInteger(val: string | undefined | null): number {
  return Math.round(cleanNumber(val))
}

function normalizeDate(val: string | undefined | null): string | null {
  if (!val) return null
  const cleaned = val.trim().replace(/^"/, '').replace(/"$/, '')
  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(cleaned)) {
    return cleaned
  }
  // DD/MM/YYYY
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(cleaned)) {
    const [d, m, y] = cleaned.split('/')
    return `${y}-${m}-${d}`
  }
  return null
}

function normalizeHeader(h: string): string {
  return h
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
}

/**
 * Importa histórico de relatórios CSV do Meta Ads diretamente para o banco de dados
 */
export async function importMetaAdsCsv(
  workspaceId: string,
  csvText: string,
  targetAdAccountId?: string
): Promise<ImportCsvResult> {
  const lines = parseCsvLines(csvText)
  if (lines.length < 2) {
    return {
      success: false,
      rowsProcessed: 0,
      campaignsImported: 0,
      adSetsImported: 0,
      adsImported: 0,
      insightsCreated: 0,
      minDate: '',
      maxDate: '',
      adAccountName: '',
      error: 'O arquivo CSV está vazio ou não possui linhas de dados válidas.'
    }
  }

  const rawHeaders = lines[0]
  const headerMap = new Map<string, number>()
  rawHeaders.forEach((h, idx) => {
    headerMap.set(normalizeHeader(h), idx)
  })

  // Encontrar índices das colunas principais
  const getCol = (possibleNames: string[]): number => {
    for (const name of possibleNames) {
      const idx = headerMap.get(normalizeHeader(name))
      if (idx !== undefined) return idx
    }
    return -1
  }

  const accountNameIdx = getCol(['Nome da conta', 'Account name'])
  const accountIdIdx = getCol(['Identificacao da conta', 'ID da conta', 'Account ID'])
  const campaignNameIdx = getCol(['Nome da campanha', 'Campaign name'])
  const campaignIdIdx = getCol(['Identificacao da campanha', 'ID da campanha', 'Campaign ID'])
  const adSetNameIdx = getCol(['Nome do conjunto de anuncios', 'Nome do conjunto', 'Ad set name'])
  const adSetIdIdx = getCol(['Identificacao do conjunto de anuncios', 'ID do conjunto', 'Ad set ID'])
  const adNameIdx = getCol(['Nome do anuncio', 'Anuncios', 'Ad name'])
  const adIdIdx = getCol(['Identificacao do anuncio', 'ID do anuncio', 'Ad ID'])
  const dayIdx = getCol(['Dia', 'Day', 'Date', 'Inicio dos relatorios'])
  const spendIdx = getCol(['Valor gasto (BRL)', 'Valor gasto', 'Amount spent (BRL)', 'Amount spent', 'Gasto'])
  const impressionsIdx = getCol(['Impressoes', 'Impressions'])
  const reachIdx = getCol(['Alcance', 'Reach'])
  const clicksIdx = getCol(['Cliques no link', 'Cliques', 'Link clicks', 'Clicks'])
  const purchasesIdx = getCol(['Compras no site', 'Compras', 'Purchases', 'Website purchases'])
  const icIdx = getCol(['Finalizacoes de compra iniciadas', 'Iniciacoes de compra', 'Initiate checkouts', 'Adds to cart'])

  if (campaignNameIdx === -1 || dayIdx === -1 || spendIdx === -1) {
    return {
      success: false,
      rowsProcessed: 0,
      campaignsImported: 0,
      adSetsImported: 0,
      adsImported: 0,
      insightsCreated: 0,
      minDate: '',
      maxDate: '',
      adAccountName: '',
      error: 'Colunas obrigatórias não encontradas no CSV (Nome da Campanha, Dia e Valor Gasto).'
    }
  }

  // 1. Identificar ou criar a conta de anúncios
  let rawAccountId = ''
  let rawAccountName = ''
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i]
    if (accountIdIdx !== -1 && row[accountIdIdx]) {
      rawAccountId = row[accountIdIdx].replace(/^act_/, '').trim()
    }
    if (accountNameIdx !== -1 && row[accountNameIdx]) {
      rawAccountName = row[accountNameIdx].trim()
    }
    if (rawAccountId) break
  }

  let adAccount = null
  if (targetAdAccountId && targetAdAccountId !== 'all') {
    adAccount = await prisma.adAccount.findFirst({
      where: { id: targetAdAccountId, workspaceId }
    })
  }

  if (!adAccount && rawAccountId) {
    adAccount = await prisma.adAccount.findFirst({
      where: {
        workspaceId,
        OR: [
          { externalId: rawAccountId },
          { externalId: `act_${rawAccountId}` }
        ]
      }
    })
  }

  if (!adAccount) {
    adAccount = await prisma.adAccount.findFirst({
      where: { workspaceId }
    })
  }

  if (!adAccount) {
    const effectiveExtId = rawAccountId ? `act_${rawAccountId}` : `act_manual_${Date.now()}`
    adAccount = await prisma.adAccount.create({
      data: {
        workspaceId,
        externalId: effectiveExtId,
        name: rawAccountName || 'Conta de Anúncios Meta',
        currency: 'BRL',
        status: 'active'
      }
    })
  }

  // Estruturas de agregação em memória para desempenho máximo
  const campaignsMap = new Map<string, { id: string; name: string }>()
  const adSetsMap = new Map<string, { id: string; name: string; campaignId: string }>()
  const adsMap = new Map<string, { id: string; name: string; adSetId: string }>()

  // Agregações diárias
  // key: `${campaignExternalId}__${date}`
  const campaignDailyMap = new Map<string, {
    campaignExternalId: string
    date: string
    spend: number
    impressions: number
    reach: number
    clicks: number
    conversions: number
    ic: number
  }>()

  // key: `${adSetExternalId}__${date}`
  const adSetDailyMap = new Map<string, {
    adSetExternalId: string
    date: string
    spend: number
    impressions: number
    reach: number
    clicks: number
    conversions: number
    ic: number
  }>()

  // key: `${adExternalId}__${date}`
  const adDailyMap = new Map<string, {
    adExternalId: string
    date: string
    spend: number
    impressions: number
    reach: number
    clicks: number
    conversions: number
    ic: number
  }>()

  let minDate = '9999-99-99'
  let maxDate = '0000-00-00'
  let rowsCount = 0

  for (let i = 1; i < lines.length; i++) {
    const row = lines[i]
    if (!row || row.length === 0) continue

    const campaignName = row[campaignNameIdx] ? row[campaignNameIdx].trim() : ''
    const date = normalizeDate(row[dayIdx])
    if (!campaignName || !date) continue

    const campaignExtId = campaignIdIdx !== -1 && row[campaignIdIdx] ? row[campaignIdIdx].trim() : `camp_${campaignName.toLowerCase().replace(/[^a-z0-9]/g, '_')}`
    const adSetName = adSetNameIdx !== -1 && row[adSetNameIdx] ? row[adSetNameIdx].trim() : 'Conjunto Padrão'
    const adSetExtId = adSetIdIdx !== -1 && row[adSetIdIdx] ? row[adSetIdIdx].trim() : `adset_${adSetName.toLowerCase().replace(/[^a-z0-9]/g, '_')}`
    const adName = adNameIdx !== -1 && row[adNameIdx] ? row[adNameIdx].trim() : 'Anúncio Padrão'
    const adExtId = adIdIdx !== -1 && row[adIdIdx] ? row[adIdIdx].trim() : `ad_${adName.toLowerCase().replace(/[^a-z0-9]/g, '_')}`

    const spend = cleanNumber(row[spendIdx])
    const impressions = impressionsIdx !== -1 ? cleanInteger(row[impressionsIdx]) : 0
    const reach = reachIdx !== -1 ? cleanInteger(row[reachIdx]) : impressions
    const clicks = clicksIdx !== -1 ? cleanInteger(row[clicksIdx]) : 0
    const conversions = purchasesIdx !== -1 ? cleanInteger(row[purchasesIdx]) : 0
    const ic = icIdx !== -1 ? cleanInteger(row[icIdx]) : 0

    if (date < minDate) minDate = date
    if (date > maxDate) maxDate = date
    rowsCount++

    // Registrar entidades
    campaignsMap.set(campaignExtId, { id: campaignExtId, name: campaignName })
    adSetsMap.set(adSetExtId, { id: adSetExtId, name: adSetName, campaignId: campaignExtId })
    adsMap.set(adExtId, { id: adExtId, name: adName, adSetId: adSetExtId })

    // Agregar Campanha
    const campKey = `${campaignExtId}__${date}`
    const curCamp = campaignDailyMap.get(campKey) || {
      campaignExternalId: campaignExtId,
      date,
      spend: 0,
      impressions: 0,
      reach: 0,
      clicks: 0,
      conversions: 0,
      ic: 0
    }
    curCamp.spend += spend
    curCamp.impressions += impressions
    curCamp.reach += reach
    curCamp.clicks += clicks
    curCamp.conversions += conversions
    curCamp.ic += ic
    campaignDailyMap.set(campKey, curCamp)

    // Agregar Conjunto
    const asKey = `${adSetExtId}__${date}`
    const curAs = adSetDailyMap.get(asKey) || {
      adSetExternalId: adSetExtId,
      date,
      spend: 0,
      impressions: 0,
      reach: 0,
      clicks: 0,
      conversions: 0,
      ic: 0
    }
    curAs.spend += spend
    curAs.impressions += impressions
    curAs.reach += reach
    curAs.clicks += clicks
    curAs.conversions += conversions
    curAs.ic += ic
    adSetDailyMap.set(asKey, curAs)

    // Agregar Anúncio
    const adKey = `${adExtId}__${date}`
    const curAd = adDailyMap.get(adKey) || {
      adExternalId: adExtId,
      date,
      spend: 0,
      impressions: 0,
      reach: 0,
      clicks: 0,
      conversions: 0,
      ic: 0
    }
    curAd.spend += spend
    curAd.impressions += impressions
    curAd.reach += reach
    curAd.clicks += clicks
    curAd.conversions += conversions
    curAd.ic += ic
    adDailyMap.set(adKey, curAd)
  }

  // 2. Gravar Campanhas no PostgreSQL
  const dbCampaignMap = new Map<string, string>() // externalId -> dbId
  for (const [extId, c] of campaignsMap) {
    const dbC = await prisma.campaign.upsert({
      where: {
        adAccountId_externalId: {
          adAccountId: adAccount.id,
          externalId: extId
        }
      },
      update: {
        name: c.name,
        lastSyncAt: new Date()
      },
      create: {
        workspaceId,
        adAccountId: adAccount.id,
        externalId: extId,
        name: c.name,
        status: 'ACTIVE',
        lastSyncAt: new Date()
      }
    })
    dbCampaignMap.set(extId, dbC.id)
  }

  // 3. Gravar Conjuntos de Anúncios (AdSets)
  const dbAdSetMap = new Map<string, string>()
  for (const [extId, as] of adSetsMap) {
    const campDbId = dbCampaignMap.get(as.campaignId)
    if (!campDbId) continue

    const dbAs = await prisma.adSet.upsert({
      where: {
        campaignId_externalId: {
          campaignId: campDbId,
          externalId: extId
        }
      },
      update: {
        name: as.name,
        lastSyncAt: new Date()
      },
      create: {
        workspaceId,
        campaignId: campDbId,
        externalId: extId,
        name: as.name,
        status: 'ACTIVE',
        lastSyncAt: new Date()
      }
    })
    dbAdSetMap.set(extId, dbAs.id)
  }

  // 4. Gravar Anúncios (Ads)
  const dbAdMap = new Map<string, string>()
  for (const [extId, ad] of adsMap) {
    const asDbId = dbAdSetMap.get(ad.adSetId)
    if (!asDbId) continue

    const dbAd = await prisma.ad.upsert({
      where: {
        adSetId_externalId: {
          adSetId: asDbId,
          externalId: extId
        }
      },
      update: {
        name: ad.name,
        lastSyncAt: new Date()
      },
      create: {
        workspaceId,
        adSetId: asDbId,
        externalId: extId,
        name: ad.name,
        status: 'ACTIVE',
        lastSyncAt: new Date()
      }
    })
    dbAdMap.set(extId, dbAd.id)
  }

  let insightsCount = 0

  // 5. Gravar Campaign Insights diários
  for (const [, item] of campaignDailyMap) {
    const dbId = dbCampaignMap.get(item.campaignExternalId)
    if (!dbId) continue

    const [y, m, d] = item.date.split('-').map(Number)
    const dateStart = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0))
    const dateStop = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999))

    const ctr = item.impressions > 0 ? (item.clicks / item.impressions) * 100 : 0
    const cpc = item.clicks > 0 ? item.spend / item.clicks : 0
    const cpm = item.impressions > 0 ? (item.spend / item.impressions) * 1000 : 0
    const frequency = item.reach > 0 ? item.impressions / item.reach : 1

    const actionsJson = JSON.stringify([
      { action_type: 'offsite_conversion.fb_pixel_purchase', value: String(item.conversions) },
      { action_type: 'purchase', value: String(item.conversions) },
      { action_type: 'offsite_conversion.fb_pixel_initiate_checkout', value: String(item.ic) },
      { action_type: 'initiate_checkout', value: String(item.ic) }
    ])

    await prisma.campaignInsight.upsert({
      where: {
        campaignId_dateStart_dateStop: {
          campaignId: dbId,
          dateStart,
          dateStop
        }
      },
      update: {
        spend: item.spend,
        impressions: item.impressions,
        reach: item.reach,
        clicks: item.clicks,
        uniqueClicks: item.clicks,
        ctr,
        cpc,
        cpm,
        frequency,
        conversions: item.conversions,
        conversionValue: 0,
        actions: actionsJson
      },
      create: {
        campaignId: dbId,
        dateStart,
        dateStop,
        spend: item.spend,
        impressions: item.impressions,
        reach: item.reach,
        clicks: item.clicks,
        uniqueClicks: item.clicks,
        ctr,
        cpc,
        cpm,
        frequency,
        conversions: item.conversions,
        conversionValue: 0,
        actions: actionsJson
      }
    })
    insightsCount++
  }

  // 6. Gravar AdSet Insights diários
  for (const [, item] of adSetDailyMap) {
    const dbId = dbAdSetMap.get(item.adSetExternalId)
    if (!dbId) continue

    const [y, m, d] = item.date.split('-').map(Number)
    const dateStart = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0))
    const dateStop = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999))

    const ctr = item.impressions > 0 ? (item.clicks / item.impressions) * 100 : 0
    const cpc = item.clicks > 0 ? item.spend / item.clicks : 0
    const cpm = item.impressions > 0 ? (item.spend / item.impressions) * 1000 : 0
    const frequency = item.reach > 0 ? item.impressions / item.reach : 1

    const actionsJson = JSON.stringify([
      { action_type: 'offsite_conversion.fb_pixel_purchase', value: String(item.conversions) },
      { action_type: 'offsite_conversion.fb_pixel_initiate_checkout', value: String(item.ic) }
    ])

    await prisma.adSetInsight.upsert({
      where: {
        adSetId_dateStart_dateStop: {
          adSetId: dbId,
          dateStart,
          dateStop
        }
      },
      update: {
        spend: item.spend,
        impressions: item.impressions,
        reach: item.reach,
        clicks: item.clicks,
        ctr,
        cpc,
        cpm,
        frequency,
        conversions: item.conversions,
        conversionValue: 0,
        actions: actionsJson
      },
      create: {
        adSetId: dbId,
        dateStart,
        dateStop,
        spend: item.spend,
        impressions: item.impressions,
        reach: item.reach,
        clicks: item.clicks,
        ctr,
        cpc,
        cpm,
        frequency,
        conversions: item.conversions,
        conversionValue: 0,
        actions: actionsJson
      }
    })
  }

  // 7. Gravar Ad Insights diários
  for (const [, item] of adDailyMap) {
    const dbId = dbAdMap.get(item.adExternalId)
    if (!dbId) continue

    const [y, m, d] = item.date.split('-').map(Number)
    const dateStart = new Date(Date.UTC(y, m - 1, d, 0, 0, 0, 0))
    const dateStop = new Date(Date.UTC(y, m - 1, d, 23, 59, 59, 999))

    const ctr = item.impressions > 0 ? (item.clicks / item.impressions) * 100 : 0
    const cpc = item.clicks > 0 ? item.spend / item.clicks : 0
    const cpm = item.impressions > 0 ? (item.spend / item.impressions) * 1000 : 0
    const frequency = item.reach > 0 ? item.impressions / item.reach : 1

    const actionsJson = JSON.stringify([
      { action_type: 'offsite_conversion.fb_pixel_purchase', value: String(item.conversions) },
      { action_type: 'offsite_conversion.fb_pixel_initiate_checkout', value: String(item.ic) }
    ])

    await prisma.adInsight.upsert({
      where: {
        adId_dateStart_dateStop: {
          adId: dbId,
          dateStart,
          dateStop
        }
      },
      update: {
        spend: item.spend,
        impressions: item.impressions,
        reach: item.reach,
        clicks: item.clicks,
        ctr,
        cpc,
        cpm,
        frequency,
        conversions: item.conversions,
        conversionValue: 0,
        actions: actionsJson
      },
      create: {
        adId: dbId,
        dateStart,
        dateStop,
        spend: item.spend,
        impressions: item.impressions,
        reach: item.reach,
        clicks: item.clicks,
        ctr,
        cpc,
        cpm,
        frequency,
        conversions: item.conversions,
        conversionValue: 0,
        actions: actionsJson
      }
    })
  }

  // Atualizar data de último sync da conta
  await prisma.adAccount.update({
    where: { id: adAccount.id },
    data: { lastSyncAt: new Date() }
  })

  return {
    success: true,
    rowsProcessed: rowsCount,
    campaignsImported: campaignsMap.size,
    adSetsImported: adSetsMap.size,
    adsImported: adsMap.size,
    insightsCreated: insightsCount,
    minDate,
    maxDate,
    adAccountName: adAccount.name
  }
}
