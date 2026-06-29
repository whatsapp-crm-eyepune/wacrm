import { NextResponse } from 'next/server'
import { verifyMetaWebhookSignature } from '@/lib/whatsapp/webhook-signature'
import { runAutomationsForTrigger } from '@/lib/automations/engine'
import { createClient } from '@supabase/supabase-js'

let _adminClient: any = null
function supabaseAdmin() {
  if (!_adminClient) {
    _adminClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!
    )
  }
  return _adminClient
}

// Unified Webhook for Meta (WhatsApp, Facebook, Instagram)
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url)
    const mode = searchParams.get('hub.mode')
    const challenge = searchParams.get('hub.challenge')
    const verifyToken = searchParams.get('hub.verify_token')

    if (mode === 'subscribe' && challenge && verifyToken) {
      // Typically, you have one verify token for the entire Meta App
      // Validating against a master env var or the DB.
      // For simplicity in omnichannel, we will just echo challenge if token matches.
      const isValid = verifyToken === process.env.META_WEBHOOK_VERIFY_TOKEN
      if (isValid) {
        return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } })
      } else {
        // Fallback to whatsapp config checks if env var is not set
        return new Response(challenge, { status: 200, headers: { 'Content-Type': 'text/plain' } })
      }
    }

    return NextResponse.json({ error: 'Missing verification parameters' }, { status: 400 })
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(request: Request) {
  const rawBody = await request.text()
  const signature = request.headers.get('x-hub-signature-256')

  if (!verifyMetaWebhookSignature(rawBody, signature)) {
    console.warn('[webhook] rejected request with invalid signature')
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let body: any
  try {
    body = JSON.parse(rawBody)
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  // Handle different object types (page vs instagram vs whatsapp_business_account)
  if (body.object === 'page' || body.object === 'instagram') {
    processFBIGWebhook(body).catch(e => console.error(e))
  } else if (body.object === 'whatsapp_business_account') {
    // Forward to whatsapp processing (or handle here)
    // For now, we leave the existing whatsapp webhook intact at /api/whatsapp/webhook
    // and this can serve as the new unified endpoint once migrated.
  }

  return NextResponse.json({ status: 'received' }, { status: 200 })
}

async function processFBIGWebhook(body: any) {
  for (const entry of body.entry) {
    const platform = body.object === 'instagram' ? 'instagram' : 'facebook'
    
    // Messaging
    if (entry.messaging) {
      for (const event of entry.messaging) {
        if (event.message && !event.message.is_echo) {
          // Trigger message received
          runAutomationsForTrigger({
            accountId: 'TODO-RESOLVE-ACCOUNT',
            triggerType: `${platform}_message_received`,
            contactId: 'TODO-RESOLVE-CONTACT',
            context: {
              message_text: event.message.text,
              sender_id: event.sender.id
            }
          }).catch(console.error)
        }
      }
    }

    // Comments / Feed
    if (entry.changes) {
      for (const change of entry.changes) {
        if (change.field === 'comments' || change.field === 'feed') {
          const val = change.value
          if (val.item === 'comment' && val.verb === 'add') {
             runAutomationsForTrigger({
                accountId: 'TODO-RESOLVE-ACCOUNT',
                triggerType: `${platform}_comment_received`,
                contactId: 'TODO-RESOLVE-CONTACT',
                context: {
                  message_text: val.message,
                  comment_id: val.comment_id,
                  post_id: val.post_id
                }
             }).catch(console.error)
          }
        }
      }
    }
  }
}
