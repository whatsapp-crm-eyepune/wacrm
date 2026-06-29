import { env } from 'process';

export const META_API_VERSION = 'v19.0';
export const META_GRAPH_BASE_URL = `https://graph.facebook.com/${META_API_VERSION}`;

/**
 * Builds the URL to redirect the user to for Meta OAuth.
 */
export function getMetaOAuthUrl(platform: 'facebook' | 'instagram', redirectUri: string, state: string) {
  const appId = env.META_APP_ID;
  if (!appId) {
    throw new Error('META_APP_ID is not configured');
  }

  const scopes = [
    'pages_manage_metadata',
    'pages_messaging',
    'pages_read_engagement',
    'pages_show_list'
  ];

  if (platform === 'instagram') {
    scopes.push('instagram_basic', 'instagram_manage_messages');
  }

  const url = new URL(`https://www.facebook.com/${META_API_VERSION}/dialog/oauth`);
  url.searchParams.set('client_id', appId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('state', state);
  url.searchParams.set('scope', scopes.join(','));
  url.searchParams.set('response_type', 'code');

  return url.toString();
}

/**
 * Exchanges a short-lived authorization code for a short-lived User Access Token.
 */
export async function exchangeCodeForUserToken(code: string, redirectUri: string) {
  const appId = env.META_APP_ID;
  const appSecret = env.META_APP_SECRET;

  if (!appId || !appSecret) {
    throw new Error('META_APP_ID or META_APP_SECRET is not configured');
  }

  const url = new URL(`${META_GRAPH_BASE_URL}/oauth/access_token`);
  url.searchParams.set('client_id', appId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('client_secret', appSecret);
  url.searchParams.set('code', code);

  const res = await fetch(url.toString());
  const data = await res.json();

  if (data.error) {
    throw new Error(`Meta OAuth error: ${data.error.message}`);
  }

  return data.access_token as string;
}

/**
 * Exchanges a short-lived User Access Token for a long-lived User Access Token (lasts ~60 days).
 */
export async function getLongLivedUserToken(shortLivedToken: string) {
  const appId = env.META_APP_ID;
  const appSecret = env.META_APP_SECRET;

  const url = new URL(`${META_GRAPH_BASE_URL}/oauth/access_token`);
  url.searchParams.set('grant_type', 'fb_exchange_token');
  url.searchParams.set('client_id', appId!);
  url.searchParams.set('client_secret', appSecret!);
  url.searchParams.set('fb_exchange_token', shortLivedToken);

  const res = await fetch(url.toString());
  const data = await res.json();

  if (data.error) {
    throw new Error(`Meta OAuth error: ${data.error.message}`);
  }

  return data.access_token as string;
}

/**
 * Fetches the user's Facebook Pages and their Page Access Tokens using a User Access Token.
 */
export async function getUserPages(userAccessToken: string) {
  const url = new URL(`${META_GRAPH_BASE_URL}/me/accounts`);
  url.searchParams.set('access_token', userAccessToken);
  // Also fetch connected Instagram account if any
  url.searchParams.set('fields', 'id,name,access_token,instagram_business_account');

  const res = await fetch(url.toString());
  const data = await res.json();

  if (data.error) {
    throw new Error(`Meta Graph error: ${data.error.message}`);
  }

  return data.data as Array<{
    id: string;
    name: string;
    access_token: string;
    instagram_business_account?: {
      id: string;
    };
  }>;
}
