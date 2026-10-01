import { NextResponse } from 'next/server'
import { auth } from '@/lib/auth'
import { getUserWorkspaceId } from '@/lib/workspace'
import { getOrCreateWorkspaceIntegrations, rotateIntegrationSecret } from '@/lib/integrations/service'

export async function GET(req: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const workspaceId = await getUserWorkspaceId(session.user.id)
    if (!workspaceId) {
      return NextResponse.json({ error: 'No workspace' }, { status: 404 })
    }

    const { origin } = new URL(req.url)
    const integrations = await getOrCreateWorkspaceIntegrations(workspaceId, origin)

    return NextResponse.json({
      workspaceId,
      integrations
    })
  } catch (error) {
    console.error('[API Integrations] Error listing integrations:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const session = await auth()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const workspaceId = await getUserWorkspaceId(session.user.id)
    if (!workspaceId) {
      return NextResponse.json({ error: 'No workspace' }, { status: 404 })
    }

    const body = await req.json().catch(() => ({}))
    const { action, platform } = body

    if (action === 'rotate' && platform) {
      const { origin } = new URL(req.url)
      const updated = await rotateIntegrationSecret(workspaceId, platform, origin)
      return NextResponse.json({
        success: true,
        integration: updated
      })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (error) {
    console.error('[API Integrations] Error rotating secret:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
