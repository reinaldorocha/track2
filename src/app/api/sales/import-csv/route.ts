import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { prisma } from '@/lib/db'
import { getUserWorkspaceId } from '@/lib/workspace'
import { importGetfySalesCsv, previewGetfyCsv } from '@/lib/integrations/getfy-csv-importer'

export async function POST(req: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Não autorizado' }, { status: 401 })
    }

    const workspaceId = await getUserWorkspaceId(session.user.id)
    if (!workspaceId) {
      return NextResponse.json({ error: 'Workspace não encontrado' }, { status: 404 })
    }

    let csvContent = ''
    let action: 'preview' | 'import' = 'import'
    let triggerCapi = false
    let updateExisting = true

    const { searchParams } = new URL(req.url)
    const queryAction = searchParams.get('action')
    if (queryAction === 'preview') action = 'preview'

    const contentType = req.headers.get('content-type') || ''

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData()
      const file = formData.get('file') as File | null
      const formAction = formData.get('action') as string | null
      const formTriggerCapi = formData.get('triggerCapi') as string | null
      const formUpdateExisting = formData.get('updateExisting') as string | null

      if (!file) {
        return NextResponse.json({ error: 'Nenhum arquivo CSV enviado' }, { status: 400 })
      }

      csvContent = await file.text()
      if (formAction === 'preview') action = 'preview'
      if (formTriggerCapi === 'true') triggerCapi = true
      if (formUpdateExisting === 'false') updateExisting = false
    } else {
      const body = await req.json().catch(() => ({}))
      csvContent = body.csvText || ''
      if (body.action === 'preview') action = 'preview'
      if (body.triggerCapi === true) triggerCapi = true
      if (body.updateExisting === false) updateExisting = false
    }

    if (!csvContent || csvContent.trim().length === 0) {
      return NextResponse.json({ error: 'Conteúdo do CSV vazio ou inválido' }, { status: 400 })
    }

    if (action === 'preview') {
      const fees = await prisma.fee.findMany({
        where: { workspaceId, isActive: true }
      })
      const previewResult = previewGetfyCsv(csvContent, 5, fees)
      if (!previewResult.success) {
        return NextResponse.json({ error: previewResult.error || 'Erro ao processar pré-visualização do CSV' }, { status: 400 })
      }
      return NextResponse.json(previewResult)
    }

    const result = await importGetfySalesCsv(workspaceId, csvContent, {
      triggerCapi,
      updateExisting
    })

    if (!result.success && result.totalRows === 0) {
      return NextResponse.json({ error: result.error || 'Erro ao importar CSV' }, { status: 400 })
    }

    return NextResponse.json(result)
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Erro interno ao importar vendas da Getfy'
    console.error('[Import Getfy CSV] Erro:', error)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

