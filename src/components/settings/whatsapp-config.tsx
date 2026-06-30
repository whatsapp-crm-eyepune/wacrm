'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, Loader2, QrCode, Trash2, Smartphone, AlertTriangle } from 'lucide-react';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';

type EngineStatus = 'INITIALIZING' | 'QR_READY' | 'AUTHENTICATING' | 'CONNECTED' | 'ENGINE_OFFLINE' | 'ERROR';

export function WhatsAppConfig() {
  const { accountId, loading: authLoading, profileLoading } = useAuth();
  
  const [status, setStatus] = useState<EngineStatus>('INITIALIZING');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [qrData, setQrData] = useState<string | null>(null);
  const [connectedPhone, setConnectedPhone] = useState<string | null>(null);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  
  // Use a ref to track current status for the polling interval
  // This avoids the stale closure problem where the interval captures an old `status` value
  const statusRef = useRef<EngineStatus>('INITIALIZING');

  const fetchStatus = useCallback(async () => {
    if (!accountId) return;

    try {
      const res = await fetch(`/api/whatsapp-local/status?accountId=${accountId}`);
      if (!res.ok) {
        setStatus('ENGINE_OFFLINE');
        statusRef.current = 'ENGINE_OFFLINE';
        // Clear stale data on error
        setQrData(null);
        setConnectedPhone(null);
        return;
      }
      
      const data = await res.json();
      const newStatus = data.status as EngineStatus;
      setStatus(newStatus);
      statusRef.current = newStatus;
      
      // *** FIX: Explicitly clear stale data for each state transition ***
      if (newStatus === 'ERROR') {
        setErrorMessage(data.message || 'Unknown error');
        setQrData(null);
        setConnectedPhone(null);
      } else if (newStatus === 'QR_READY') {
        setQrData(data.qr);
        setErrorMessage(null);
        setConnectedPhone(null);
      } else if (newStatus === 'CONNECTED') {
        setConnectedPhone(data.phone);
        setQrData(null); // *** Clear QR when connected ***
        setErrorMessage(null);
      } else if (newStatus === 'AUTHENTICATING') {
        setQrData(null); // *** Clear QR immediately when authenticating ***
        setErrorMessage(null);
        setConnectedPhone(null);
      } else if (newStatus === 'INITIALIZING') {
        setQrData(null);
        setErrorMessage(null);
        setConnectedPhone(null);
      }
    } catch (err) {
      console.error('Failed to fetch engine status', err);
      setStatus('ENGINE_OFFLINE');
      statusRef.current = 'ENGINE_OFFLINE';
    }
  }, [accountId]);

  useEffect(() => {
    if (authLoading || profileLoading || !accountId) return;
    
    // Initial fetch
    fetchStatus();

    // Poll every 3 seconds — keep polling even when CONNECTED so we detect disconnections.
    // If you want to reduce server load, you can poll less frequently when CONNECTED.
    const intervalId = setInterval(() => {
      fetchStatus();
    }, 3000);

    return () => clearInterval(intervalId);
  }, [authLoading, profileLoading, accountId, fetchStatus]);

  async function handleDisconnect() {
    if (!accountId) return;
    setIsDisconnecting(true);
    try {
      const res = await fetch('/api/whatsapp-local/disconnect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId })
      });
      if (res.ok) {
        toast.success('Disconnected successfully');
        setStatus('INITIALIZING');
        statusRef.current = 'INITIALIZING';
        setConnectedPhone(null);
        setQrData(null);
      } else {
        toast.error('Failed to disconnect');
      }
    } catch (err) {
      toast.error('An error occurred');
    } finally {
      setIsDisconnecting(false);
      fetchStatus();
    }
  }

  async function handleRetry() {
    if (!accountId) return;
    setStatus('INITIALIZING');
    statusRef.current = 'INITIALIZING';
    setErrorMessage(null);
    setQrData(null);
    try {
      await fetch('/api/whatsapp-local/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accountId })
      });
    } catch (err) {}
    fetchStatus();
  }

  return (
    <div className="space-y-6 mt-8">
      <Card className="bg-slate-900 border-slate-700 ring-0 ring-transparent">
        <CardHeader>
          <div className="flex items-center gap-2">
            <Smartphone className="size-5 text-emerald-500" />
            <CardTitle className="text-white">WhatsApp Web Connection</CardTitle>
          </div>
          <CardDescription className="text-slate-400">
            Connect your standard WhatsApp number by scanning a QR code. No Meta Business API required.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          
          {status === 'ENGINE_OFFLINE' && (
            <div className="flex flex-col items-center justify-center p-8 border border-dashed border-red-900/50 rounded-lg bg-red-950/20">
              <AlertTriangle className="size-10 text-red-500 mb-4" />
              <h3 className="text-lg font-medium text-red-400">Engine Offline</h3>
              <p className="text-sm text-red-400/80 text-center max-w-md mt-2">
                The WhatsApp Microservice is currently unreachable. Make sure it is deployed and running, and WHATSAPP_ENGINE_URL is configured in your Vercel environment.
              </p>
            </div>
          )}

          {status === 'INITIALIZING' && (
            <div className="flex flex-col items-center justify-center p-8 border border-dashed border-slate-700 rounded-lg bg-slate-900/50">
              <Loader2 className="size-10 text-emerald-500 animate-spin mb-4" />
              <h3 className="text-lg font-medium text-slate-300">Initializing Engine...</h3>
              <p className="text-sm text-slate-500 text-center max-w-md mt-2">
                Starting up your dedicated WhatsApp Web client. This usually takes a few seconds.
              </p>
            </div>
          )}

          {status === 'ERROR' && (
            <div className="flex flex-col items-center justify-center p-8 border border-dashed border-red-900/50 rounded-lg bg-red-950/20">
              <AlertTriangle className="size-10 text-red-500 mb-4" />
              <h3 className="text-lg font-medium text-red-400">Initialization Failed</h3>
              <p className="text-sm text-red-400/80 text-center max-w-md mt-2 whitespace-pre-wrap">
                {errorMessage}
              </p>
              <Button onClick={handleRetry} className="mt-4" variant="outline">
                Retry Connection
              </Button>
            </div>
          )}

          {status === 'QR_READY' && qrData && (
            <div className="flex flex-col items-center justify-center p-8 border border-dashed border-emerald-900/50 rounded-lg bg-emerald-950/10">
              <h3 className="text-lg font-medium text-slate-300 mb-4">Scan QR Code to Connect</h3>
              <div className="bg-white p-4 rounded-xl mb-4">
                <img 
                  src={`https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(qrData)}`} 
                  alt="WhatsApp QR Code"
                  className="size-[200px]"
                />
              </div>
              <ol className="text-sm text-slate-400 text-left list-decimal list-inside space-y-2 mt-2">
                <li>Open WhatsApp on your phone</li>
                <li>Tap Menu or Settings and select <strong>Linked Devices</strong></li>
                <li>Tap on <strong>Link a Device</strong></li>
                <li>Point your phone to this screen to capture the code</li>
              </ol>
            </div>
          )}

          {status === 'AUTHENTICATING' && (
            <div className="flex flex-col items-center justify-center p-8 border border-dashed border-emerald-900/50 rounded-lg bg-emerald-950/10">
              <Loader2 className="size-10 text-emerald-500 animate-spin mb-4" />
              <h3 className="text-lg font-medium text-slate-300">Authenticating...</h3>
              <p className="text-sm text-slate-500 text-center max-w-md mt-2">
                QR code scanned! Logging into WhatsApp Web. This may take up to 30 seconds.
              </p>
            </div>
          )}

          {status === 'CONNECTED' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 rounded-lg border border-slate-700 bg-slate-800/50">
                <div className="flex items-center gap-3">
                  <div className="bg-emerald-500/20 p-2 rounded-full">
                    <CheckCircle2 className="size-5 text-emerald-500" />
                  </div>
                  <div>
                    <p className="font-medium text-white">Connected Number</p>
                    <p className="text-sm text-slate-400">{connectedPhone || 'Unknown'}</p>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center rounded-full bg-emerald-500/10 px-2 py-1 text-xs font-medium text-emerald-400 ring-1 ring-inset ring-emerald-500/20">
                    Active
                  </span>
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={handleDisconnect} 
                    disabled={isDisconnecting}
                    className="text-red-400 hover:text-red-300 hover:bg-red-400/10"
                  >
                    {isDisconnecting ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4 mr-2" />}
                    {isDisconnecting ? '' : 'Disconnect'}
                  </Button>
                </div>
              </div>
            </div>
          )}

        </CardContent>
      </Card>
    </div>
  );
}
