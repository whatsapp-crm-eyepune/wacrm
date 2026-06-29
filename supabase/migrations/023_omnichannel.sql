-- ============================================================
-- 023_omnichannel.sql — Add support for FB and Instagram
-- ============================================================

-- 1. Add platform to conversations
ALTER TABLE conversations
ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'whatsapp' CHECK (platform IN ('whatsapp', 'instagram', 'facebook'));

-- 2. Add platform to messages
ALTER TABLE messages
ADD COLUMN IF NOT EXISTS platform TEXT NOT NULL DEFAULT 'whatsapp' CHECK (platform IN ('whatsapp', 'instagram', 'facebook'));

-- 3. Add target_platform to broadcasts
ALTER TABLE broadcasts
ADD COLUMN IF NOT EXISTS target_platform TEXT NOT NULL DEFAULT 'whatsapp' CHECK (target_platform IN ('whatsapp', 'instagram', 'facebook'));

-- 4. Create facebook_config table
CREATE TABLE IF NOT EXISTS facebook_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  page_id TEXT NOT NULL,
  access_token TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected', 'disconnected')),
  connected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

ALTER TABLE facebook_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own fb config" ON facebook_config;
CREATE POLICY "Users can manage own fb config" ON facebook_config FOR ALL USING (auth.uid() = user_id);
DROP TRIGGER IF EXISTS set_updated_at ON facebook_config;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON facebook_config FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- 5. Create instagram_config table
CREATE TABLE IF NOT EXISTS instagram_config (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  ig_account_id TEXT NOT NULL,
  access_token TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'disconnected' CHECK (status IN ('connected', 'disconnected')),
  connected_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id)
);

ALTER TABLE instagram_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage own ig config" ON instagram_config;
CREATE POLICY "Users can manage own ig config" ON instagram_config FOR ALL USING (auth.uid() = user_id);
DROP TRIGGER IF EXISTS set_updated_at ON instagram_config;
CREATE TRIGGER set_updated_at BEFORE UPDATE ON instagram_config FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
