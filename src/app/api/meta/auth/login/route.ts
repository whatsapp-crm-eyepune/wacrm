import { NextResponse } from 'next/server';
import { getMetaOAuthUrl } from '@/lib/meta/oauth';
import { env } from 'process';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const platform = searchParams.get('platform') as 'facebook' | 'instagram';
  
  if (!platform || (platform !== 'facebook' && platform !== 'instagram')) {
    return NextResponse.json({ error: 'Invalid platform parameter' }, { status: 400 });
  }

  const appUrl = env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) {
    return NextResponse.json({ error: 'NEXT_PUBLIC_APP_URL is not configured' }, { status: 500 });
  }

  const redirectUri = `${appUrl}/api/meta/auth/callback`;
  
  // We pass the requested platform via state so the callback knows what we were trying to connect
  const state = JSON.stringify({ platform });

  try {
    const oauthUrl = getMetaOAuthUrl(platform, redirectUri, state);
    return NextResponse.redirect(oauthUrl);
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
