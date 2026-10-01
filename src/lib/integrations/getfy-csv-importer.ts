import crypto from 'crypto'
import { prisma } from '@/lib/db'
import {
  normalizeSaleStatus,
  normalizeSalePaymentMethod,
  upsertSale,
  InternalSale
} from '@/lib/integrations/normalizer'
import { calculateSaleFee, FeeRule } from '@/lib/calculations/financial-engine'

export interface GetfyCsvRowParsed {
  date: Date
  rawDate: string
  product: string
  customerName: string
  customerEmail: string
  status: 'approved' | 'pending' | 'refunded' | 'chargeback' | 'cancelled'
  rawStatus: string
  paymentMethod: string
  rawMethod: string
  currency: string
  netAmount: number
  grossAmount: number
  externalId: string
}

export interface GetfyImportResult {
  success: boolean
  totalRows: number
  createdCount: number
  updatedCount: number
  failedCount: number
  skippedCount: number
  stats: {
    totalGross: number
    totalNet: number
    countApproved: number
    countPending: number
    countRefunded: number
    countCancelled: number
    countChargeback: number
    minDate: string | null
    maxDate: string | null
    uniqueProducts: string[]
  }
  errors: string[]
  sample?: GetfyCsvRowParsed[]
  error?: string
}

export interface GetfyImportOptions {
  triggerCapi?: boolean
  updateExisting?: boolean
}

/**
 * Remove BOM e divide linhas respeitando RFC 4180 (aspas, quebras de linha e delimitador ; ou ,)
 */
export function parseCsvLines(csvText: string): string[][] {
  if (!csvText) return []

  // Remove Byte Order Mark (BOM) UTF-8 se presente
  const cleanText = csvText.replace(/^\uFEFF/, '')

  const result: string[][] = []
  let currentRow: string[] = []
  let currentField = ''
  let inQuotes = false

  // Detectar delimitador provável (vírgula ou ponto-e-vírgula)
  const firstLine = cleanText.split(/\r\n|\n|\r/)[0] || ''
  const commaCount = (firstLine.match(/,/g) || []).length
  const semiCount = (firstLine.match(/;/g) || []).length
  const delimiter = semiCount >= commaCount ? ';' : ','

  for (let i = 0; i < cleanText.length; i++) {
    const char = cleanText[i]
    const nextChar = cleanText[i + 1]

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          currentField += '"'
          i++ // pular aspa escapada
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

/**
 * Converte data no padrão brasileiro DD/MM/YYYY HH:mm ou ISO para Date respeitando timezone de São Paulo (-03:00)
 */
export function parseBrazilianDateTime(dateStr: string): { date: Date; valid: boolean } {
  if (!dateStr || !dateStr.trim()) {
    return { date: new Date(), valid: false }
  }

  const trimmed = dateStr.trim().replace(/^"|"$/g, '')

  // Padrão DD/MM/YYYY HH:mm ou DD/MM/YYYY HH:mm:ss
  const brMatch = trimmed.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/)
  if (brMatch) {
    const [, d, m, y, h, min, s] = brMatch
    const day = d.padStart(2, '0')
    const month = m.padStart(2, '0')
    const hour = (h || '00').padStart(2, '0')
    const minute = (min || '00').padStart(2, '0')
    const second = (s || '00').padStart(2, '0')

    // Constrói ISO com offset explícito de Brasília (-03:00)
    const iso = `${y}-${month}-${day}T${hour}:${minute}:${second}-03:00`
    const parsed = new Date(iso)
    if (!isNaN(parsed.getTime())) {
      return { date: parsed, valid: true }
    }
  }

  // Fallback padrão
  const fallback = new Date(trimmed)
  if (!isNaN(fallback.getTime())) {
    return { date: fallback, valid: true }
  }

  return { date: new Date(), valid: false }
}

/**
 * Converte valores monetários como "36,63", "1.250,00" ou "56.90" em float numérico
 */
export function parseMoneyValue(val: unknown): number {
  if (typeof val === 'number') {
    return isNaN(val) ? 0 : Math.round(val * 100) / 100
  }
  if (!val) return 0

  let s = String(val).trim().replace(/^"|"$/g, '').replace(/R\$\s?/gi, '').replace(/\s/g, '')
  if (s.includes('.') && s.includes(',')) {
    s = s.replace(/\./g, '').replace(',', '.')
  } else if (s.includes(',')) {
    s = s.replace(',', '.')
  }

  const num = parseFloat(s)
  return isNaN(num) ? 0 : Math.round(num * 100) / 100
}

/**
 * Normaliza cabeçalho para chave conhecida
 */
function normalizeHeaderName(header: string): string {
  return header
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/^"|"$/g, '')
    .trim()
}

/**
 * Mapeia índices de colunas a partir do cabeçalho
 */
export function detectHeaderIndices(headerRow: string[]): {
  dateIdx: number
  productIdx: number
  customerIdx: number
  emailIdx: number
  statusIdx: number
  methodIdx: number
  currencyIdx: number
  netAmountIdx: number
  grossAmountIdx: number
  orderIdIdx: number
  isValid: boolean
} {
  let dateIdx = -1
  let productIdx = -1
  let customerIdx = -1
  let emailIdx = -1
  let statusIdx = -1
  let methodIdx = -1
  let currencyIdx = -1
  let netAmountIdx = -1
  let grossAmountIdx = -1
  let orderIdIdx = -1

  headerRow.forEach((col, idx) => {
    const h = normalizeHeaderName(col)

    if (h === 'data' || h.startsWith('data') || h.includes('date') || h.includes('criado')) {
      if (dateIdx === -1) dateIdx = idx
    } else if (h === 'produto' || h.includes('produto') || h === 'product' || h.includes('oferta') || h.includes('item')) {
      if (productIdx === -1) productIdx = idx
    } else if (h === 'cliente' || h === 'nome' || h.includes('comprador') || h === 'customer' || h.includes('buyer')) {
      if (customerIdx === -1) customerIdx = idx
    } else if (h === 'e-mail' || h === 'email' || h.includes('mail')) {
      if (emailIdx === -1) emailIdx = idx
    } else if (h === 'status' || h === 'situacao' || h === 'estado') {
      if (statusIdx === -1) statusIdx = idx
    } else if (h === 'metodo' || h === 'metodo de pagamento' || h.includes('forma') || h.includes('pagamento') || h.includes('method')) {
      if (methodIdx === -1) methodIdx = idx
    } else if (h === 'moeda' || h === 'currency') {
      if (currencyIdx === -1) currencyIdx = idx
    } else if (h.includes('liquido') || h.includes('net')) {
      netAmountIdx = idx
    } else if (h.includes('bruto') || h.includes('gross') || h.includes('total') || h === 'valor bruto') {
      grossAmountIdx = idx
    } else if (h === 'valor') {
      if (grossAmountIdx === -1) grossAmountIdx = idx
      else if (netAmountIdx === -1) netAmountIdx = idx
    } else if (h === 'id' || h === 'codigo' || h.includes('transacao') || h.includes('order')) {
      orderIdIdx = idx
    }
  })

  // Se valor bruto não foi explicitado, mas valor líquido foi, assume valor líquido como fallback
  if (grossAmountIdx === -1 && netAmountIdx !== -1) {
    grossAmountIdx = netAmountIdx
  } else if (netAmountIdx === -1 && grossAmountIdx !== -1) {
    netAmountIdx = grossAmountIdx
  }

  // Validação mínima: pelo menos data, status ou email, e valor (bruto ou líquido)
  const isValid = dateIdx !== -1 && (statusIdx !== -1 || emailIdx !== -1) && (grossAmountIdx !== -1 || netAmountIdx !== -1)

  return {
    dateIdx,
    productIdx,
    customerIdx,
    emailIdx,
    statusIdx,
    methodIdx,
    currencyIdx,
    netAmountIdx,
    grossAmountIdx,
    orderIdIdx,
    isValid
  }
}

/**
 * Função para pré-visualizar o CSV antes da gravação definitiva
 */
export function previewGetfyCsv(
  csvText: string,
  maxRows = 5,
  fees: FeeRule[] = []
): {
  success: boolean
  totalRows: number
  sample: Array<{
    date: string
    product: string
    customerName: string
    customerEmail: string
    status: string
    paymentMethod: string
    currency: string
    netAmount: number
    grossAmount: number
  }>
  error?: string
} {
  const lines = parseCsvLines(csvText)
  if (lines.length < 2) {
    return { success: false, totalRows: 0, sample: [], error: 'O arquivo CSV está vazio ou contém apenas o cabeçalho.' }
  }

  const indices = detectHeaderIndices(lines[0])
  if (!indices.isValid) {
    return {
      success: false,
      totalRows: 0,
      sample: [],
      error: 'Cabeçalho do CSV não reconhecido como Getfy. Verifique se o arquivo possui as colunas: Data, Produto, Cliente, E-mail, Status, Método e Valor bruto/líquido.'
    }
  }

  const sample: any[] = []
  const dataRows = lines.slice(1)

  for (let i = 0; i < Math.min(dataRows.length, maxRows); i++) {
    const row = dataRows[i]
    if (!row || row.length === 0 || row.every(c => !c.trim())) continue

    const rawDate = indices.dateIdx !== -1 ? row[indices.dateIdx] || '' : ''
    const product = indices.productIdx !== -1 ? row[indices.productIdx] || '' : 'Produto Getfy'
    const customerName = indices.customerIdx !== -1 ? row[indices.customerIdx] || '' : ''
    const email = indices.emailIdx !== -1 ? (row[indices.emailIdx] || '').toLowerCase().trim() : ''
    const rawStatus = indices.statusIdx !== -1 ? row[indices.statusIdx] || '' : 'Pago'
    const rawMethod = indices.methodIdx !== -1 ? row[indices.methodIdx] || '' : 'PIX'
    const currency = indices.currencyIdx !== -1 ? (row[indices.currencyIdx] || 'BRL').trim().toUpperCase() : 'BRL'
    
    // Pega o valor bruto (prioritário da coluna Valor bruto)
    const grossAmount = indices.grossAmountIdx !== -1
      ? parseMoneyValue(row[indices.grossAmountIdx])
      : parseMoneyValue(indices.netAmountIdx !== -1 ? row[indices.netAmountIdx] : 0)

    // O líquido é o sistema que calcula
    let netAmount = grossAmount
    const normalizedMethod = normalizeSalePaymentMethod({ paymentMethod: rawMethod }, 'getfy')
    if (fees && fees.length > 0) {
      const fee = calculateSaleFee(
        { grossAmount, platform: 'getfy', paymentMethod: normalizedMethod, installments: 1 },
        fees
      )
      netAmount = Math.max(0, Math.round((grossAmount - fee) * 100) / 100)
    } else if (indices.netAmountIdx !== -1 && row[indices.netAmountIdx]) {
      const csvNet = parseMoneyValue(row[indices.netAmountIdx])
      if (csvNet > 0 && csvNet <= grossAmount) {
        netAmount = csvNet
      }
    }

    sample.push({
      date: rawDate,
      product: product.replace(/^"|"$/g, ''),
      customerName: customerName.replace(/^"|"$/g, ''),
      customerEmail: email.replace(/^"|"$/g, ''),
      status: rawStatus.replace(/^"|"$/g, ''),
      paymentMethod: rawMethod.replace(/^"|"$/g, ''),
      currency,
      netAmount,
      grossAmount
    })
  }

  return {
    success: true,
    totalRows: dataRows.filter(r => r.some(c => c.trim().length > 0)).length,
    sample
  }
}

/**
 * Importa o CSV de vendas da Getfy no workspace com deduplicação e conciliação
 */
export async function importGetfySalesCsv(
  workspaceId: string,
  csvText: string,
  options: GetfyImportOptions = {}
): Promise<GetfyImportResult> {
  const triggerCapi = options.triggerCapi === true
  const updateExisting = options.updateExisting !== false // default true

  const lines = parseCsvLines(csvText)
  if (lines.length < 2) {
    return {
      success: false,
      totalRows: 0,
      createdCount: 0,
      updatedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      stats: {
        totalGross: 0,
        totalNet: 0,
        countApproved: 0,
        countPending: 0,
        countRefunded: 0,
        countCancelled: 0,
        countChargeback: 0,
        minDate: null,
        maxDate: null,
        uniqueProducts: []
      },
      errors: ['Arquivo CSV vazio ou sem linhas de dados.'],
      error: 'Arquivo CSV vazio ou sem linhas de dados.'
    }
  }

  const indices = detectHeaderIndices(lines[0])
  if (!indices.isValid) {
    return {
      success: false,
      totalRows: 0,
      createdCount: 0,
      updatedCount: 0,
      failedCount: 0,
      skippedCount: 0,
      stats: {
        totalGross: 0,
        totalNet: 0,
        countApproved: 0,
        countPending: 0,
        countRefunded: 0,
        countCancelled: 0,
        countChargeback: 0,
        minDate: null,
        maxDate: null,
        uniqueProducts: []
      },
      errors: ['Formato de colunas inválido. As colunas esperadas incluem Data, Produto, Cliente, E-mail, Status, Método e Valor bruto/líquido.'],
      error: 'Formato de colunas inválido. As colunas esperadas incluem Data, Produto, Cliente, E-mail, Status, Método e Valor bruto/líquido.'
    }
  }

  // Buscar taxas configuradas no workspace para o sistema calcular o valor líquido
  const fees = await prisma.fee.findMany({
    where: { workspaceId, isActive: true }
  })

  const dataRows = lines.slice(1)
  let createdCount = 0
  let updatedCount = 0
  let failedCount = 0
  let skippedCount = 0
  const errors: string[] = []

  let totalGross = 0
  let totalNet = 0
  let countApproved = 0
  let countPending = 0
  let countRefunded = 0
  let countCancelled = 0
  let countChargeback = 0
  let minDateTimestamp: number | null = null
  let maxDateTimestamp: number | null = null
  const productsSet = new Set<string>()

  // Rastreador de hashes gerados para garantir unicidade em linhas repetidas no mesmo CSV
  const generatedIdCounts = new Map<string, number>()

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i]
    const rowNum = i + 2
    if (!row || row.length === 0 || row.every(c => !c.trim())) continue

    try {
      const rawDate = indices.dateIdx !== -1 ? row[indices.dateIdx] || '' : ''
      const product = (indices.productIdx !== -1 ? row[indices.productIdx] || '' : 'Produto Getfy')
        .replace(/^"|"$/g, '')
        .trim()
      const customerName = (indices.customerIdx !== -1 ? row[indices.customerIdx] || '' : '')
        .replace(/^"|"$/g, '')
        .trim()
      const email = (indices.emailIdx !== -1 ? row[indices.emailIdx] || '' : '')
        .replace(/^"|"$/g, '')
        .toLowerCase()
        .trim()
      const rawStatus = (indices.statusIdx !== -1 ? row[indices.statusIdx] || '' : 'Pago')
        .replace(/^"|"$/g, '')
        .trim()
      const rawMethod = (indices.methodIdx !== -1 ? row[indices.methodIdx] || '' : 'PIX')
        .replace(/^"|"$/g, '')
        .trim()
      const currency = indices.currencyIdx !== -1
        ? (row[indices.currencyIdx] || 'BRL').replace(/^"|"$/g, '').trim().toUpperCase()
        : 'BRL'

      // Pega do valor bruto (da nova coluna Valor bruto adicionada)
      const grossAmount = indices.grossAmountIdx !== -1
        ? parseMoneyValue(row[indices.grossAmountIdx])
        : parseMoneyValue(indices.netAmountIdx !== -1 ? row[indices.netAmountIdx] : 0)

      const parsedDateTime = parseBrazilianDateTime(rawDate)
      const orderedAt = parsedDateTime.date

      // Rastrear limites de data
      const timeMs = orderedAt.getTime()
      if (!isNaN(timeMs)) {
        if (minDateTimestamp === null || timeMs < minDateTimestamp) minDateTimestamp = timeMs
        if (maxDateTimestamp === null || timeMs > maxDateTimestamp) maxDateTimestamp = timeMs
      }

      // Normalizar status e método
      const normalizedStatus = normalizeSaleStatus(rawStatus, 'getfy')
      const normalizedMethod = normalizeSalePaymentMethod({ paymentMethod: rawMethod }, 'getfy')

      // O líquido é o sistema que calcula a partir do valor bruto
      let netAmount = grossAmount
      if (fees.length > 0) {
        const fee = calculateSaleFee(
          { grossAmount, platform: 'getfy', paymentMethod: normalizedMethod, installments: 1 },
          fees
        )
        netAmount = Math.max(0, Math.round((grossAmount - fee) * 100) / 100)
      } else if (indices.netAmountIdx !== -1 && row[indices.netAmountIdx]) {
        // Se ainda não foram cadastradas regras de taxas no sistema, usa o valor líquido reportado pelo CSV
        const csvNet = parseMoneyValue(row[indices.netAmountIdx])
        if (csvNet > 0 && csvNet <= grossAmount) {
          netAmount = csvNet
        }
      }

      // Determinar externalId único e determinístico
      let externalId = ''
      if (indices.orderIdIdx !== -1 && row[indices.orderIdIdx]?.trim()) {
        externalId = row[indices.orderIdIdx].replace(/^"|"$/g, '').trim()
      } else {
        // Gera hash determinístico baseado em email + data + produto
        const baseKey = `${email}|${rawDate.trim()}|${product}`
        const hash = crypto.createHash('sha256').update(baseKey).digest('hex').substring(0, 16)
        const currentCount = (generatedIdCounts.get(hash) || 0) + 1
        generatedIdCounts.set(hash, currentCount)
        externalId = currentCount === 1 ? `gtf_${hash}` : `gtf_${hash}_${currentCount}`
      }

      // Verificar se já existe
      const existing = await prisma.sale.findUnique({
        where: {
          workspaceId_platform_externalId: {
            workspaceId,
            platform: 'getfy',
            externalId
          }
        },
        select: { id: true, status: true }
      })

      if (existing && !updateExisting) {
        skippedCount++
        continue
      }

      // Upsert via rotina centralizada
      const internalSale: InternalSale = {
        workspaceId,
        platform: 'getfy',
        externalId,
        externalRef: rawMethod || normalizedMethod,
        paymentMethod: normalizedMethod,
        installments: 1,
        status: normalizedStatus,
        grossAmount,
        netAmount,
        currency,
        customerEmail: email || undefined,
        orderedAt,
        approvedAt: normalizedStatus === 'approved' ? orderedAt : undefined,
        refundedAt: normalizedStatus === 'refunded' ? orderedAt : undefined,
        skipCapi: !triggerCapi,
        productInfo: product ? {
          name: product,
          id: `gtf_prod_${crypto.createHash('md5').update(product).digest('hex').substring(0, 12)}`
        } : undefined
      }

      await upsertSale(internalSale)

      if (existing) {
        updatedCount++
      } else {
        createdCount++
      }

      // Acumular estatísticas
      if (normalizedStatus === 'approved') {
        countApproved++
        totalGross += grossAmount
        totalNet += netAmount
      } else if (normalizedStatus === 'pending') {
        countPending++
      } else if (normalizedStatus === 'refunded') {
        countRefunded++
      } else if (normalizedStatus === 'chargeback') {
        countChargeback++
      } else if (normalizedStatus === 'cancelled') {
        countCancelled++
      }

      if (product) productsSet.add(product)

    } catch (rowErr: unknown) {
      failedCount++
      const msg = rowErr instanceof Error ? rowErr.message : String(rowErr)
      if (errors.length < 10) {
        errors.push(`Linha ${rowNum}: ${msg}`)
      }
    }
  }

  const minDateStr = minDateTimestamp ? new Date(minDateTimestamp).toLocaleDateString('pt-BR') : null
  const maxDateStr = maxDateTimestamp ? new Date(maxDateTimestamp).toLocaleDateString('pt-BR') : null

  return {
    success: createdCount + updatedCount > 0 || (failedCount === 0 && skippedCount > 0),
    totalRows: dataRows.filter(r => r.some(c => c.trim().length > 0)).length,
    createdCount,
    updatedCount,
    failedCount,
    skippedCount,
    stats: {
      totalGross: Math.round(totalGross * 100) / 100,
      totalNet: Math.round(totalNet * 100) / 100,
      countApproved,
      countPending,
      countRefunded,
      countCancelled,
      countChargeback,
      minDate: minDateStr,
      maxDate: maxDateStr,
      uniqueProducts: Array.from(productsSet)
    },
    errors
  }
}

