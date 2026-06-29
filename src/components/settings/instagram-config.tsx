'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Zap, Loader2, Trash2 } from 'lucide-react';
import { InstagramIcon } from '@/components/icons';
import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';

interface InstagramAccount {
  id: string;
  ig_account_id: string;
  ig_account_name: string;
  status: string;
}

export function InstagramConfig() {
  const [accounts, setAccounts] = useState<InstagramAccount[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadAccounts() {
      const supabase = createClient();
      const { data, error } = await supabase.from('instagram_config').select('*');
      if (error) {
        toast.error('Failed to load Instagram configuration');
      } else {
        setAccounts(data || []);
      }
      setLoading(false);
    }
    loadAccounts();
  }, []);

  async function disconnectAccount(id: string) {
    const supabase = createClient();
    const { error } = await supabase.from('instagram_config').delete().eq('id', id);
    if (error) {
      toast.error('Failed to disconnect account');
    } else {
      toast.success('Account disconnected');
      setAccounts(accounts.filter(a => a.id !== id));
    }
  }

  return (
    <div className="space-y-6 mt-8">
      <Card className="bg-slate-900 border-slate-700 ring-0 ring-transparent">
        <CardHeader>
          <div className="flex items-center gap-2">
            <InstagramIcon className="size-5 text-pink-500" />
            <CardTitle className="text-white">Instagram Business</CardTitle>
          </div>
          <CardDescription className="text-slate-400">
            Connect your Instagram Professional accounts to manage DMs, story replies, and comments.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex justify-center p-8 border border-dashed border-slate-700 rounded-lg bg-slate-900/50">
              <Loader2 className="size-8 text-primary animate-spin" />
            </div>
          ) : accounts.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-8 border border-dashed border-slate-700 rounded-lg bg-slate-900/50">
              <InstagramIcon className="size-10 text-slate-600 mb-4" />
              <h3 className="text-lg font-medium text-slate-300">No Instagram Accounts Connected</h3>
              <p className="text-sm text-slate-500 text-center max-w-md mt-2 mb-6">
                Link your Instagram Professional account (must be connected to a Facebook Page) to start automating your DMs and comments.
              </p>
              <Button render={<a href="/api/meta/auth/login?platform=instagram" />} className="bg-gradient-to-r from-purple-500 via-pink-500 to-orange-500 hover:opacity-90 text-white border-0">
                <Zap className="size-4 mr-2" />
                Connect Instagram
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {accounts.map(acc => (
                <div key={acc.id} className="flex items-center justify-between p-4 rounded-lg border border-slate-700 bg-slate-800/50">
                  <div className="flex items-center gap-3">
                    <div className="bg-pink-500/20 p-2 rounded-full">
                      <InstagramIcon className="size-5 text-pink-500" />
                    </div>
                    <div>
                      <p className="font-medium text-white">{acc.ig_account_name || 'Instagram Account'}</p>
                      <p className="text-xs text-slate-400">ID: {acc.ig_account_id}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-400 ring-1 ring-inset ring-emerald-500/20">
                      Connected
                    </span>
                    <Button variant="ghost" size="sm" onClick={() => disconnectAccount(acc.id)} className="text-red-400 hover:text-red-300 hover:bg-red-400/10">
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              ))}
              <div className="pt-4 border-t border-slate-800">
                <Button render={<a href="/api/meta/auth/login?platform=instagram" />} variant="outline" className="w-full border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white">
                  Connect Another Account
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
