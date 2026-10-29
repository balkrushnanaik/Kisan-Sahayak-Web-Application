import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { CheckCircle2, X, AlertCircle } from 'lucide-react';

type Toast = { id: number; message: string; tone: 'success' | 'error' | 'info' };
type ToastApi = { showToast: (message: string, tone?: Toast['tone']) => void };
const ToastContext = createContext<ToastApi>({ showToast: () => undefined });

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const showToast = useCallback((message: string, tone: Toast['tone'] = 'success') => {
    const id = Date.now() + Math.floor(Math.random() * 1000);
    setItems((old) => [...old, { id, message, tone }].slice(-4));
    // No hidden network or timer side effects; each item is dismissed by its close control.
  }, []);
  const value = useMemo(() => ({ showToast }), [showToast]);
  return <ToastContext.Provider value={value}>{children}<div aria-live="polite" className="fixed right-3 top-3 z-[100] flex w-[min(92vw,360px)] flex-col gap-2">{items.map((item) => <div key={item.id} className={`flex items-start gap-3 rounded-xl border bg-white p-3.5 shadow-lg ${item.tone === 'error' ? 'border-red-200' : item.tone === 'success' ? 'border-forest/20' : 'border-line'}`}><span className={item.tone === 'error' ? 'text-red-700' : item.tone === 'success' ? 'text-forest' : 'text-blue-700'}>{item.tone === 'error' ? <AlertCircle size={18}/> : <CheckCircle2 size={18}/>}</span><p className="flex-1 text-sm leading-5 text-ink">{item.message}</p><button aria-label="Dismiss notification" onClick={() => setItems((old) => old.filter((x) => x.id !== item.id))} className="text-muted hover:text-ink"><X size={15}/></button></div>)}</div></ToastContext.Provider>;
}
export function useToast() { return useContext(ToastContext); }
