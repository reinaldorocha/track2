import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getUserWorkspaceId } from '@/lib/workspace'
import { importMetaAdsCsv } from '@/lib/meta/csv-importer'

export async function POST(req: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const workspaceId = await getUserWorkspaceId(session.user.id)
    if (!workspaceId) {
      return NextResponse.json({ error: 'Workspace não encontrado' }, { status: 404 })
    }

    let csvContent = ''
    let adAccountId: string | undefined

    const contentType = req.headers.get('content-type') || ''

    if (contentType.includes('multipart/form-data')) {
      const formData = await req.formData()
      const file = formData.get('file') as File | null
      const accId = formData.get('adAccountId') as string | null

      if (!file) {
        return NextResponse.json({ error: 'Nenhum arquivo enviado' }, { status: 400 })
      }

      csvContent = await file.text()
      if (accId && accId !== 'all') {
        adAccountId = accId
      }
    } else {
      const body = await req.json()
      csvContent = body.csvText || ''
      adAccountId = body.adAccountId
    }

    if (!csvContent || csvContent.trim().length === 0) {
      return NextResponse.json({ error: 'Conteúdo do CSV vazio ou inválido' }, { status: 400 })
    }

    const result = await importMetaAdsCsv(workspaceId, csvContent, adAccountId)

    if (!result.success) {
      return NextResponse.json({ error: result.error || 'Erro ao processar CSV' }, { status: 400 })
    }

    return NextResponse.json(result)
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : 'Erro interno ao importar CSV'
    console.error('[Import Meta CSV] Erro:', error)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
