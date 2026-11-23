import React, { useState } from 'react';
import { Check, Copy, Download, MoreVertical, Share, Smartphone, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall.ts';
import type { AppLang } from '../types.ts';

interface PWAInstallButtonProps {
  lang: AppLang;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({ lang }) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const isKg = lang === 'kg';

  if (isInstalled) {
    return null;
  }

  const isInIframe = typeof window !== 'undefined' && window.self !== window.top;
  const appUrl = typeof window !== 'undefined' ? window.location.origin : '';

  async function handleClick() {
    if (isInstallable) {
      const accepted = await install();
      if (!accepted) {
        setShowGuide(true);
      }
      return;
    }
    setShowGuide(true);
  }

  function handleCopyLink() {
    if (!appUrl) return;
    void navigator.clipboard.writeText(appUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void handleClick()}
        className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-semibold text-cyan-200 bg-cyan-400/12 hover:bg-cyan-400/20 border border-cyan-400/45 rounded-lg shadow-[0_0_14px_rgba(34,211,238,0.18)] transition-all whitespace-nowrap shrink-0 cursor-pointer"
        title={isKg ? 'Телефондун экранына иконка катары орнотуу' : 'Установить на экран телефона'}
      >
        {isInstallable ? (
          <Download className="w-3.5 h-3.5 shrink-0 text-cyan-300" />
        ) : (
          <Smartphone className="w-3.5 h-3.5 shrink-0 text-cyan-300" />
        )}
        <span>{isKg ? 'Орнотуу' : 'Установить'}</span>
      </button>

      {showGuide && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
          onClick={() => setShowGuide(false)}
        >
          <div
            className="w-full max-w-md rounded-2xl bg-[#0e131f] p-6 shadow-[0_0_45px_rgba(34,211,238,0.16)] border border-cyan-500/30 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-cyan-400 text-slate-950 flex items-center justify-center shrink-0 shadow-[0_0_16px_rgba(34,211,238,0.45)]">
                  <Smartphone className="w-4 h-4 stroke-[2.2]" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white leading-tight">
                    {isKg ? 'Телефондун экранына орнотуу' : 'Установка на экран телефона'}
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {isKg
                      ? 'Кадимки тиркемедей 1 басуу менен ачылып турат'
                      : 'Будет открываться как обычное приложение в 1 нажатие'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="p-1 text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {isInIframe && (
              <div className="p-3 rounded-xl bg-amber-500/12 border border-amber-400/35 text-xs text-amber-200 space-y-2">
                <p className="leading-relaxed">
                  {isKg
                    ? 'Азыр сайт алдын ала көрүү терезесинде ачылып турат. Телефондун экранына орнотуу үчүн шилтемени көчүрүп, телефондогу Chrome же Safari браузеринде ачыңыз:'
                    : 'Сейчас сайт открыт в окне предпросмотра. Чтобы установить на экран, скопируйте ссылку и откройте её в Chrome или Safari на телефоне:'}
                </p>
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold bg-[#090d16] border border-amber-400/40 hover:border-amber-300 text-amber-200 rounded-lg transition-colors cursor-pointer"
                >
                  {copiedUrl ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>{isKg ? 'Шилтеме көчүрүлдү ✓' : 'Ссылка скопирована ✓'}</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>{isKg ? 'Сайттын шилтемесин көчүрүү' : 'Скопировать ссылку сайта'}</span>
                    </>
                  )}
                </button>
              </div>
            )}

            <div className="space-y-3 text-sm text-slate-200">
              <div
                className={`p-3.5 rounded-xl border ${
                  isIOS ? 'bg-cyan-400/10 border-cyan-400/35' : 'bg-[#090d16] border-slate-800'
                }`}
              >
                <div className="text-xs font-bold text-white mb-1.5">iPhone / iPad (Safari)</div>
                <ol className="space-y-1.5 text-xs text-slate-300">
                  <li className="flex items-start gap-2">
                    <span className="font-mono font-bold text-cyan-300">1.</span>
                    <span>
                      {isKg ? (
                        <>
                          Төмөнкү панелдеги{' '}
                          <strong className="inline-flex items-center gap-0.5 text-white">
                            <Share className="w-3 h-3" /> Бөлүшүү
                          </strong>{' '}
                          баскычын басыңыз.
                        </>
                      ) : (
                        <>
                          Нажмите{' '}
                          <strong className="inline-flex items-center gap-0.5 text-white">
                            <Share className="w-3 h-3" /> Поделиться
                          </strong>{' '}
                          внизу экрана Safari.
                        </>
                      )}
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="font-mono font-bold text-cyan-300">2.</span>
                    <span>
                      {isKg ? (
                        <>
                          <strong className="text-white">«Башкы экранга кошуу»</strong> (На экран
                          «Домой») → <strong className="text-white">«Кошуу»</strong> басыңыз.
                        </>
                      ) : (
                        <>
                          Выберите <strong className="text-white">«На экран Домой»</strong> →{' '}
                          <strong className="text-white">«Добавить»</strong>.
                        </>
                      )}
                    </span>
                  </li>
                </ol>
              </div>

              <div
                className={`p-3.5 rounded-xl border ${
                  !isIOS ? 'bg-cyan-400/10 border-cyan-400/35' : 'bg-[#090d16] border-slate-800'
                }`}
              >
                <div className="text-xs font-bold text-white mb-1.5">Android (Chrome)</div>
                <ol className="space-y-1.5 text-xs text-slate-300">
                  <li className="flex items-start gap-2">
                    <span className="font-mono font-bold text-cyan-300">1.</span>
                    <span>
                      {isKg ? (
                        <>
                          Жогорку оң бурчтагы{' '}
                          <strong className="inline-flex items-center gap-0.5 text-white">
                            <MoreVertical className="w-3 h-3" /> 3 чекит
                          </strong>{' '}
                          менюсун ачыңыз.
                        </>
                      ) : (
                        <>
                          Нажмите меню{' '}
                          <strong className="inline-flex items-center gap-0.5 text-white">
                            <MoreVertical className="w-3 h-3" /> 3 точки
                          </strong>{' '}
                          в правом верхнем углу Chrome.
                        </>
                      )}
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="font-mono font-bold text-cyan-300">2.</span>
                    <span>
                      {isKg ? (
                        <>
                          <strong className="text-white">«Тиркемени орнотуу»</strong> же{' '}
                          <strong className="text-white">«Башкы экранга кошуу»</strong> тандаңыз.
                        </>
                      ) : (
                        <>
                          Нажмите <strong className="text-white">«Установить приложение»</strong>{' '}
                          или <strong className="text-white">«Добавить на гл. экран»</strong>.
                        </>
                      )}
                    </span>
                  </li>
                </ol>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              {!isInIframe && (
                <button
                  type="button"
                  onClick={handleCopyLink}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2.5 px-3 text-xs font-medium text-slate-200 bg-slate-800 hover:bg-slate-700 rounded-xl transition-colors cursor-pointer"
                >
                  {copiedUrl ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copiedUrl ? (isKg ? 'Көчүрүлдү' : 'Скопировано') : isKg ? 'Шилтемени көчүрүү' : 'Копировать ссылку'}</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="flex-1 rounded-xl bg-cyan-400 hover:bg-cyan-300 py-2.5 text-xs font-bold text-slate-950 shadow-[0_0_18px_rgba(34,211,238,0.32)] transition-colors cursor-pointer"
              >
                {isKg ? 'Түшүнүктүү' : 'Понятно'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
