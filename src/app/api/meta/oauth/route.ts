import { auth } from '@/lib/auth'
import { NextResponse } from 'next/server'
import { getUserWorkspaceId } from '@/lib/workspace'
import { generateOAuthState, getMetaRedirectUri, getAppBaseUrl, META_OAUTH_SCOPES } from '@/lib/meta/oauth'

export async function GET(request: Request) {
  const baseUrl = getAppBaseUrl(request)
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.redirect(new URL('/login', baseUrl))
  }

  const workspaceId = await getUserWorkspaceId(session.user.id)
  if (!workspaceId) {
    return NextResponse.redirect(new URL('/meta-ads?error=no_workspace', baseUrl))
  }
  
  const appId = process.env.META_APP_ID
  if (!appId) {
    return NextResponse.redirect(
      new URL('/meta-ads?error=meta_app_id_missing', baseUrl)
    )
  }

  const redirectUri = getMetaRedirectUri(request)
  const state = generateOAuthState(session.user.id, workspaceId)

  const params = new URLSearchParams({
    client_id: appId,
    redirect_uri: redirectUri,
    scope: META_OAUTH_SCOPES,
    response_type: 'code',
    state,
  })

  console.log('[Meta OAuth] Redirecionando para Meta OAuth Dialog. AppID:', appId, 'RedirectUri:', redirectUri)
  return NextResponse.redirect(`https://www.facebook.com/v21.0/dialog/oauth?${params.toString()}`)
}


