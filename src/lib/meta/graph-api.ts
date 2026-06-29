// ============================================================
// Graph API wrappers for Facebook Messenger and Instagram Direct
// ============================================================

const GRAPH_API_VERSION = 'v19.0'
const GRAPH_API_BASE = `https://graph.facebook.com/${GRAPH_API_VERSION}`

interface SendMessageParams {
  pageId: string
  accessToken: string
  recipientId: string
  text: string
  platform: 'facebook' | 'instagram'
}

/**
 * Sends a message via Facebook Messenger or Instagram Direct.
 * Note: `pageId` is used as the sender ID for both FB and IG (IG uses the connected FB page).
 */
export async function sendMetaMessage({
  pageId,
  accessToken,
  recipientId,
  text,
  platform
}: SendMessageParams) {
  const url = `${GRAPH_API_BASE}/${pageId}/messages`
  
  const payload = {
    recipient: { id: recipientId },
    message: { text }
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify(payload)
  })

  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(`Failed to send ${platform} message: ${errorBody}`)
  }

  return response.json()
}

interface ReplyCommentParams {
  commentId: string
  accessToken: string
  text: string
}

/**
 * Replies to a specific Facebook or Instagram comment.
 */
export async function replyToComment({
  commentId,
  accessToken,
  text
}: ReplyCommentParams) {
  const url = `${GRAPH_API_BASE}/${commentId}/replies`
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify({ message: text })
  })

  if (!response.ok) {
    const errorBody = await response.text()
    throw new Error(`Failed to reply to comment: ${errorBody}`)
  }

  return response.json()
}
