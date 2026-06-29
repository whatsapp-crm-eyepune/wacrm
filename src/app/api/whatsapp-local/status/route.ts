import { NextResponse } from 'next/server';
import { env } from 'process';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get('accountId');

  if (!accountId) {
    return NextResponse.json({ error: 'accountId is required' }, { status: 400 });
  }

  const engineUrl = env.WHATSAPP_ENGINE_URL || 'http://localhost:3001';

  try {
    const res = await fetch(`${engineUrl}/api/status?accountId=${accountId}`, {
      cache: 'no-store'
    });
    if (!res.ok) {
      throw new Error(`Engine returned ${res.status}`);
    }
    const data = await res.json();
    
    // Auto-update the Supabase database to 'connected' if the engine is CONNECTED.
    // This allows the Inbox UI to correctly hide the 'WhatsApp is not connected' banner.
    if (data.status === 'CONNECTED') {
      const { createClient } = require('@supabase/supabase-js');
      const supabase = createClient(
        env.NEXT_PUBLIC_SUPABASE_URL!,
        env.SUPABASE_SERVICE_ROLE_KEY!
      );
      await supabase
        .from('whatsapp_config')
        .update({ status: 'connected' })
        .eq('account_id', accountId);
    }
    
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Failed to fetch status from engine:', error.message);
    return NextResponse.json({ status: 'ENGINE_OFFLINE' }, { status: 503 });
  }
}
