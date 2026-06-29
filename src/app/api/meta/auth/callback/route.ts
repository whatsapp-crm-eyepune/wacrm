import { NextResponse } from 'next/server';
import { exchangeCodeForUserToken, getLongLivedUserToken, getUserPages } from '@/lib/meta/oauth';
import { env } from 'process';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get('code');
  const stateStr = searchParams.get('state');
  const error = searchParams.get('error');

  const appUrl = env.NEXT_PUBLIC_APP_URL || '';

  if (error) {
    return NextResponse.redirect(`${appUrl}/settings?error=${error}`);
  }

  if (!code || !stateStr) {
    return NextResponse.redirect(`${appUrl}/settings?error=missing_params`);
  }

  try {
    const state = JSON.parse(stateStr);
    const platform = state.platform as 'facebook' | 'instagram';
    const redirectUri = `${appUrl}/api/meta/auth/callback`;

    // 1. Exchange code for short-lived user token
    const shortLivedToken = await exchangeCodeForUserToken(code, redirectUri);

    // 2. Exchange for long-lived user token
    const longLivedToken = await getLongLivedUserToken(shortLivedToken);

    // 3. Fetch connected pages
    const pages = await getUserPages(longLivedToken);

    // 4. Save to DB using a service role client (we don't have user session here easily without cookie passing, 
    // but typically OAuth callbacks should use the session if it's stored in a cookie.
    // Wait, since this is Next.js App Router and the user initiated this flow, their Supabase cookies might be present.
    // Let's use standard Supabase auth to get the user.)
    
    // Actually we need to import createClient from '@/lib/supabase/server' or do it manually.
    // We'll use the service role key and assume they pass an accountId in state if we needed to, or rely on cookies.
    // Let's rely on cookies using standard Next.js setup.
    const { createClient } = await import('@/lib/supabase/server');
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.redirect(`${appUrl}/settings?error=unauthorized`);
    }

    // We need the user's account ID. We can get it from the account_members table.
    const { data: memberData } = await supabase
      .from('account_members')
      .select('account_id')
      .eq('user_id', user.id)
      .single();

    const accountId = memberData?.account_id;
    if (!accountId) {
      return NextResponse.redirect(`${appUrl}/settings?error=no_account`);
    }

    // Upsert configurations
    if (platform === 'facebook') {
      for (const page of pages) {
        await supabase.from('facebook_config').upsert({
          account_id: accountId,
          page_id: page.id,
          page_name: page.name,
          access_token: page.access_token,
          status: 'connected',
          updated_at: new Date().toISOString()
        }, { onConflict: 'account_id, page_id' });
      }
    } else if (platform === 'instagram') {
      for (const page of pages) {
        if (page.instagram_business_account) {
          await supabase.from('instagram_config').upsert({
            account_id: accountId,
            ig_account_id: page.instagram_business_account.id,
            ig_account_name: page.name, // Instagram name might be different, but we use page name for reference
            access_token: page.access_token,
            status: 'connected',
            updated_at: new Date().toISOString()
          }, { onConflict: 'account_id, ig_account_id' });
        }
      }
    }

    // Success, redirect back to Channels tab
    return NextResponse.redirect(`${appUrl}/settings?tab=channels&success=connected`);
  } catch (err: any) {
    console.error('Meta OAuth callback error:', err);
    return NextResponse.redirect(`${appUrl}/settings?error=auth_failed`);
  }
}
