import { useState } from 'react';
import { Download } from 'lucide-react';
import { StateIllustration } from '@/components/illustrations';
import { useStorageIssues, getOriginalStorage, clearEvents, resetPrefs } from '@/lib/store';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

export function StorageNotice() {
  const issues = useStorageIssues();
  const [reset, setReset] = useState<'events' | 'prefs' | null>(null);
  const [failed, setFailed] = useState(false);
  const backup = (area: 'events' | 'prefs') => {
    const raw = getOriginalStorage(area);
    if (raw === null) return;
    const url = URL.createObjectURL(new Blob([raw], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = `vantyr-original-${area}.json`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <>
    {issues.map((i) => <div key={i.area} role="alert" className="mb-5 flex flex-wrap items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950" data-testid={`status-storage-${i.area}`}>
      <StateIllustration kind="storage" className="mt-0.5 w-14 shrink-0" />
      <div className="min-w-0 flex-1"><p className="font-medium">{i.area === 'events' ? 'Event history' : 'Preferences'}: {i.kind === 'write' ? 'not saved' : 'storage needs attention'}</p><p className="mt-1">{i.message}</p>
        {i.kind === 'invalid' && <div className="mt-3 flex flex-wrap gap-4">
          <button onClick={() => backup(i.area)} className="inline-flex items-center gap-1 underline" data-testid={`button-backup-${i.area}`}><Download className="h-3 w-3" />Export original data</button>
          <button onClick={() => { setFailed(false); setReset(i.area); }} className="underline" data-testid={`button-recover-${i.area}`}>Reset damaged {i.area === 'events' ? 'history' : 'preferences'}</button>
        </div>}
      </div>
    </div>)}
    <AlertDialog open={reset !== null} onOpenChange={(open) => { if (!open) setReset(null); }}>
      <AlertDialogContent><AlertDialogHeader>
        <AlertDialogTitle>Reset damaged {reset === 'events' ? 'event history' : 'preferences'}?</AlertDialogTitle>
        <AlertDialogDescription>{reset === 'events' ? 'This permanently clears the stored history, including any usable events.' : 'This replaces all stored preferences with defaults.'} Export the original data first if you need to retain it. This cannot be undone.</AlertDialogDescription>
      </AlertDialogHeader><AlertDialogFooter>
        {failed && <p role="alert" className="text-sm text-high">Data was not reset. Browser storage is blocked or unavailable. Allow storage, then retry.</p>}
        <AlertDialogCancel>Cancel</AlertDialogCancel>
        <AlertDialogAction onClick={(e) => {
          const saved = reset === 'events' ? clearEvents() : reset === 'prefs' ? resetPrefs() : false;
          if (!saved) { e.preventDefault(); setFailed(true); }
        }}>Reset stored data</AlertDialogAction>
      </AlertDialogFooter></AlertDialogContent>
    </AlertDialog>
  </>;
}
