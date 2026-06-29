'use client';

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Zap, Loader2, Trash2 } from 'lucide-react';
import { FacebookIcon } from '@/components/icons';
import { useState, useEffect } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';

interface FacebookPage {
  id: string;
  page_id: string;
  page_name: string;
  status: string;
}

export function FacebookConfig() {
  const [pages, setPages] = useState<FacebookPage[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadPages() {
      const supabase = createClient();
      const { data, error } = await supabase.from('facebook_config').select('*');
      if (error) {
        toast.error('Failed to load Facebook configuration');
      } else {
        setPages(data || []);
      }
      setLoading(false);
    }
    loadPages();
  }, []);

  async function disconnectPage(id: string) {
    const supabase = createClient();
    const { error } = await supabase.from('facebook_config').delete().eq('id', id);
    if (error) {
      toast.error('Failed to disconnect page');
    } else {
      toast.success('Page disconnected');
      setPages(pages.filter(p => p.id !== id));
    }
  }

  return (
    <div className="space-y-6 mt-8">
      <Card className="bg-slate-900 border-slate-700 ring-0 ring-transparent">
        <CardHeader>
          <div className="flex items-center gap-2">
            <FacebookIcon className="size-5 text-blue-500" />
            <CardTitle className="text-white">Facebook Pages</CardTitle>
          </div>
          <CardDescription className="text-slate-400">
            Connect your Facebook Pages to sync messages, comments, and automate replies.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="flex justify-center p-8 border border-dashed border-slate-700 rounded-lg bg-slate-900/50">
              <Loader2 className="size-8 text-primary animate-spin" />
            </div>
          ) : pages.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-8 border border-dashed border-slate-700 rounded-lg bg-slate-900/50">
              <FacebookIcon className="size-10 text-slate-600 mb-4" />
              <h3 className="text-lg font-medium text-slate-300">No Pages Connected</h3>
              <p className="text-sm text-slate-500 text-center max-w-md mt-2 mb-6">
                Connect your Facebook account to grant permissions and select which pages you want to manage through the omnichannel inbox.
              </p>
              <Button render={<a href="/api/meta/auth/login?platform=facebook" />} className="bg-[#1877F2] hover:bg-[#1877F2]/90 text-white border-0">
                <Zap className="size-4 mr-2" />
                Connect Facebook
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              {pages.map(page => (
                <div key={page.id} className="flex items-center justify-between p-4 rounded-lg border border-slate-700 bg-slate-800/50">
                  <div className="flex items-center gap-3">
                    <div className="bg-blue-500/20 p-2 rounded-full">
                      <FacebookIcon className="size-5 text-blue-500" />
                    </div>
                    <div>
                      <p className="font-medium text-white">{page.page_name}</p>
                      <p className="text-xs text-slate-400">ID: {page.page_id}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-400 ring-1 ring-inset ring-emerald-500/20">
                      Connected
                    </span>
                    <Button variant="ghost" size="sm" onClick={() => disconnectPage(page.id)} className="text-red-400 hover:text-red-300 hover:bg-red-400/10">
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              ))}
              <div className="pt-4 border-t border-slate-800">
                <Button render={<a href="/api/meta/auth/login?platform=facebook" />} variant="outline" className="w-full border-slate-700 text-slate-300 hover:bg-slate-800 hover:text-white">
                  Connect Another Page
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
