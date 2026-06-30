-- Run this in your Supabase SQL Editor!

-- 1. Create table for Automation Rules
CREATE TABLE IF NOT EXISTS public.saas_rules (
    id UUID DEFAULT extensions.uuid_generate_v4() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    trigger_type TEXT DEFAULT 'keyword',
    keyword TEXT NOT NULL,
    response TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. Create table for Knowledge Bases
CREATE TABLE IF NOT EXISTS public.saas_knowledge (
    id UUID DEFAULT extensions.uuid_generate_v4() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
    text TEXT,
    url TEXT,
    scraped_text TEXT,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. Create table for User WhatsApp Settings (Optional, for storing active session phone numbers)
CREATE TABLE IF NOT EXISTS public.saas_whatsapp_sessions (
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    phone_number TEXT,
    status TEXT DEFAULT 'DISCONNECTED',
    last_connected TIMESTAMP WITH TIME ZONE
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.saas_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saas_knowledge ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saas_whatsapp_sessions ENABLE ROW LEVEL SECURITY;

-- Create Policies so users can only see and edit their own data
CREATE POLICY "Users can manage their own rules" ON public.saas_rules
    FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their own knowledge" ON public.saas_knowledge
    FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users can manage their own sessions" ON public.saas_whatsapp_sessions
    FOR ALL USING (auth.uid() = user_id);
