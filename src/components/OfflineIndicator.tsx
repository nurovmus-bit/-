import React from 'react';
import { WifiOff } from 'lucide-react';
import { useOnlineStatus } from '../hooks/usePWAInstall.ts';
import type { AppLang } from '../types.ts';

interface OfflineIndicatorProps {
  lang: AppLang;
}

export const OfflineIndicator: React.FC<OfflineIndicatorProps> = ({ lang }) => {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div
      role="status"
      className="fixed bottom-20 md:bottom-5 left-4 z-50 flex items-center gap-2 rounded-xl bg-amber-500/20 border border-amber-400/50 backdrop-blur-md px-3.5 py-2 text-xs font-medium text-amber-200 shadow-[0_0_20px_rgba(251,191,36,0.2)]"
    >
      <WifiOff className="w-3.5 h-3.5 shrink-0 text-amber-300" />
      <span>
        {lang === 'kg'
          ? 'Интернет жок — кэштеги маалымат көрсөтүлүүдө'
          : 'Нет интернета — используются кэшированные данные'}
      </span>
    </div>
  );
};
