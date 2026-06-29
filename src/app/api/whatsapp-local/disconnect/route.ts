import { NextResponse } from 'next/server';
import { env } from 'process';

export async function POST(request: Request) {
  const body = await request.json();
  const { accountId } = body;

  if (!accountId) {
    return NextResponse.json({ error: 'accountId is required' }, { status: 400 });
  }

  const engineUrl = env.WHATSAPP_ENGINE_URL || 'http://localhost:3001';

  try {
    const res = await fetch(`${engineUrl}/api/disconnect`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accountId })
    });
    const data = await res.json();
    return NextResponse.json(data);
  } catch (error: any) {
    console.error('Failed to disconnect via engine:', error.message);
    return NextResponse.json({ error: 'Failed to communicate with engine' }, { status: 500 });
  }
}
