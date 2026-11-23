import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  BarChart3,
  BookOpen,
  Camera,
  Database,
  LogOut,
  NotebookPen,
  Send,
} from 'lucide-react';
import { api, setAuthToken } from './api.ts';
import { CURRENCIES } from './constants.ts';
import { AuthScreen } from './components/AuthScreen.tsx';
import { QuickDeskView } from './components/QuickDeskView.tsx';
import { CatalogBaseView } from './components/CatalogBaseView.tsx';
import { HistoryAnalyticsView } from './components/HistoryAnalyticsView.tsx';
import { TelegramBotView } from './components/TelegramBotView.tsx';
import { ReceiptScannerView } from './components/ReceiptScannerView.tsx';
import { TransactionModal } from './components/TransactionModal.tsx';
import { PWAInstallButton } from './components/PWAInstallButton.tsx';
import { OfflineIndicator } from './components/OfflineIndicator.tsx';
import type {
  AppLang,
  CatalogItem,
  CurrencyCode,
  LedgerSpace,
  MonthlyLimits,
  PaymentMethod,
  RealtimeEvent,
  SiteSyncStatus,
  StagedGood,
  TelegramInboxItem,
  Transaction,
  UserProfile,
} from './types.ts';

type NavTab = 'quick' | 'base' | 'history' | 'telegram' | 'scanner';

const MAIN_TABS: {
  id: Exclude<NavTab, 'scanner'>;
  labelKg: string;
  labelRu: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: 'quick', labelKg: 'Күндөлүк', labelRu: 'Блокнот', icon: NotebookPen },
  { id: 'base', labelKg: 'База', labelRu: 'База', icon: Database },
  { id: 'history', labelKg: 'Анализ · Тарых', labelRu: 'Анализ и история', icon: BarChart3 },
  { id: 'telegram', labelKg: 'Telegram-бот', labelRu: 'Telegram-бот', icon: Send },
];

const DISPLAY_CURRENCIES: CurrencyCode[] = ['KGS', 'USD', 'RUB'];

const DEFAULT_RATES: Record<CurrencyCode, number> = CURRENCIES.reduce(
  (acc, item) => {
    acc[item.code] = item.defaultRateToKgs;
    return acc;
  },
  {} as Record<CurrencyCode, number>
);

export default function App() {
  const [bootChecked, setBootChecked] = useState(false);
  const [hasUsers, setHasUsers] = useState(false);
  const [user, setUser] = useState<UserProfile | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const [lang, setLang] = useState<AppLang>('kg');
  const [activeTab, setActiveTab] = useState<NavTab>('quick');
  const [displayCurrency, setDisplayCurrency] = useState<CurrencyCode>('KGS');

  // Core data state (single-owner)
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [goods, setGoods] = useState<StagedGood[]>([]);
  const [clients, setClients] = useState<CatalogItem[]>([]);
  const [businessNomenclature, setBusinessNomenclature] = useState<CatalogItem[]>([]);
  const [familyNomenclature, setFamilyNomenclature] = useState<CatalogItem[]>([]);
  const [telegramInbox, setTelegramInbox] = useState<TelegramInboxItem[]>([]);
  const [monthlyLimits, setMonthlyLimits] = useState<MonthlyLimits>({
    familyMonthlyKgs: 0,
    businessMonthlyKgs: 0,
    updatedAt: null,
  });
  const [ratesToKgs, setRatesToKgs] = useState<Record<CurrencyCode, number>>(DEFAULT_RATES);
  const [dataLoading, setDataLoading] = useState(false);

  // Real-time WebSocket (keeps browser updated immediately when Telegram bot receives a receipt)
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Modals
  const [txModalOpen, setTxModalOpen] = useState(false);
  const [editingTx, setEditingTx] = useState<Transaction | null>(null);

  useEffect(() => {
    api
      .authStatus()
      .then((res) => setHasUsers(res.hasUsers))
      .catch(() => setHasUsers(false))
      .finally(() => setBootChecked(true));
  }, []);

  const refreshCatalog = useCallback(async () => {
    try {
      const cat = await api.getCatalog();
      setClients(cat.clients);
      setBusinessNomenclature(cat.businessExpenses);
      setFamilyNomenclature(cat.familyExpenses);
    } catch {
      // ignore
    }
  }, []);

  const loadWorkspaceData = useCallback(async () => {
    setDataLoading(true);
    try {
      const [txRes, goodsRes, catRes, tgRes, rateRes, meRes, limitsRes] = await Promise.all([
        api.getTransactions(),
        api.getGoods(),
        api.getCatalog(),
        api.getTelegramConfig(),
        api.getRates(),
        api.me(),
        api.getLimits().catch(() => ({
          limits: { familyMonthlyKgs: 0, businessMonthlyKgs: 0, updatedAt: null },
        })),
      ]);
      setTransactions(txRes.transactions);
      setGoods(goodsRes.goods);
      setClients(catRes.clients);
      setBusinessNomenclature(catRes.businessExpenses);
      setFamilyNomenclature(catRes.familyExpenses);
      setTelegramInbox(tgRes.inbox);
      setRatesToKgs(rateRes.rates);
      setUser(meRes.user);
      setMonthlyLimits(limitsRes.limits);
    } catch (err) {
      console.error('Failed to load data:', err);
    } finally {
      setDataLoading(false);
    }
  }, []);

  useEffect(() => {
    if (token && user) {
      void loadWorkspaceData();
    }
  }, [token, loadWorkspaceData]);

  // Silent real-time sync for Telegram bot receipts & multi-device updates
  useEffect(() => {
    if (!token) return;
    let disposed = false;

    function connect() {
      if (disposed) return;
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        ws.send(JSON.stringify({ type: 'auth', token }));
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(String(event.data)) as RealtimeEvent;
          switch (msg.type) {
            case 'transaction:created':
              setTransactions((prev) =>
                prev.some((t) => t.id === msg.transaction.id) ? prev : [msg.transaction, ...prev]
              );
              break;
            case 'transaction:updated':
              setTransactions((prev) =>
                prev.map((t) => (t.id === msg.transaction.id ? msg.transaction : t))
              );
              break;
            case 'transaction:deleted':
              setTransactions((prev) => prev.filter((t) => t.id !== msg.id));
              break;
            case 'good:created':
              setGoods((prev) =>
                prev.some((g) => g.id === msg.good.id) ? prev : [msg.good, ...prev]
              );
              break;
            case 'good:updated':
              setGoods((prev) => prev.map((g) => (g.id === msg.good.id ? msg.good : g)));
              break;
            case 'good:deleted':
              setGoods((prev) => prev.filter((g) => g.id !== msg.id));
              break;
            case 'telegram:received':
              setTelegramInbox((prev) =>
                prev.some((i) => i.id === msg.item.id) ? prev : [msg.item, ...prev].slice(0, 40)
              );
              break;
            case 'catalog:changed':
              void refreshCatalog();
              break;
            case 'limits:changed':
              setMonthlyLimits(msg.limits);
              break;
            default:
              break;
          }
        } catch {
          // ignore malformed messages
        }
      };

      ws.onclose = () => {
        if (!disposed) {
          reconnectTimerRef.current = setTimeout(() => {
            connect();
          }, 4000);
        }
      };
    }

    connect();
    return () => {
      disposed = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) wsRef.current.close();
    };
  }, [token]);

  async function handleLogout() {
    try {
      await api.logout();
    } catch {
      // ignore
    }
    setAuthToken(null);
    setToken(null);
    setUser(null);
    setHasUsers(true);
    setTransactions([]);
    setGoods([]);
    setClients([]);
    setBusinessNomenclature([]);
    setFamilyNomenclature([]);
    setTelegramInbox([]);
  }

  async function handleSaveTransaction(payload: {
    id?: string;
    space: LedgerSpace;
    type: 'income' | 'expense';
    paymentMethod: PaymentMethod;
    siteSyncStatus: SiteSyncStatus;
    amount: number;
    currency: CurrencyCode;
    category: string;
    projectId: string | null;
    merchant: string;
    description: string;
    paymentSource: string;
    date: string;
    receiptRef: string | null;
  }) {
    if (payload.id) {
      const { id, ...rest } = payload;
      const res = await api.updateTransaction(id, rest);
      setTransactions((prev) => prev.map((t) => (t.id === res.transaction.id ? res.transaction : t)));
    } else {
      const res = await api.createTransaction({ ...payload, sourceChannel: 'manual' });
      setTransactions((prev) =>
        prev.some((t) => t.id === res.transaction.id) ? prev : [res.transaction, ...prev]
      );
    }
  }

  async function handleDeleteTransaction(tx: Transaction) {
    await api.deleteTransaction(tx.id);
    setTransactions((prev) => prev.filter((item) => item.id !== tx.id));
  }

  async function handleUpdateLimits(payload: { familyMonthlyKgs: number; businessMonthlyKgs: number }) {
    const res = await api.updateLimits(payload);
    setMonthlyLimits(res.limits);
  }

  if (!bootChecked) {
    return (
      <div className="min-h-screen bg-[#07090f] flex items-center justify-center text-sm font-medium text-cyan-300">
        КнигаСчёт...
      </div>
    );
  }

  if (!user || !token) {
    return (
      <AuthScreen
        hasUsers={hasUsers}
        lang={lang}
        onChangeLang={setLang}
        onAuthenticated={(u, t) => {
          setUser(u);
          setToken(t);
          setHasUsers(true);
        }}
      />
    );
  }

  const isKg = lang === 'kg';
  const pendingSiteTotal =
    transactions.filter(
      (t) => t.space === 'business' && t.type === 'income' && t.siteSyncStatus === 'pending'
    ).length + goods.filter((g) => g.siteStatus === 'pending').length;

  return (
    <div className="min-h-screen text-slate-100 flex flex-col pb-16 md:pb-0">
      {/* Dark Translucent Neon Top Bar */}
      <header className="bg-[#090d16]/88 backdrop-blur-md border-b border-cyan-500/20 sticky top-0 z-30 shadow-[0_1px_24px_rgba(0,0,0,0.55)]">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-15 flex items-center justify-between gap-4 sm:gap-6">
          {/* Brand */}
          <button
            type="button"
            onClick={() => setActiveTab('quick')}
            className="flex items-center gap-2.5 shrink-0 cursor-pointer group"
          >
            <div className="w-8 h-8 rounded-xl bg-cyan-400 group-hover:bg-cyan-300 text-slate-950 flex items-center justify-center transition-all shadow-[0_0_18px_rgba(34,211,238,0.45)]">
              <BookOpen className="w-4 h-4 stroke-[2.2]" />
            </div>
            <span className="text-base font-bold tracking-tight text-white whitespace-nowrap">
              Книга<span className="text-cyan-300">Счёт</span>
            </span>
          </button>

          {/* Desktop 4 Clean Text Tabs with Neon Underline */}
          <nav className="hidden md:flex items-center gap-1 h-full">
            {MAIN_TABS.map((tab) => {
              const Icon = tab.icon;
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`relative h-full flex items-center gap-2 px-3.5 text-sm font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                    active ? 'text-cyan-300' : 'text-slate-400 hover:text-white'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${active ? 'text-cyan-300' : 'text-slate-500'}`} />
                  <span>{isKg ? tab.labelKg : tab.labelRu}</span>
                  {tab.id === 'quick' && pendingSiteTotal > 0 && (
                    <span className="font-mono text-xs font-semibold text-fuchsia-300 tabular-nums">
                      ({pendingSiteTotal})
                    </span>
                  )}
                  {active && (
                    <span className="absolute bottom-0 inset-x-2 h-0.5 bg-cyan-400 rounded-t-full shadow-[0_0_12px_rgba(34,211,238,0.9)]" />
                  )}
                </button>
              );
            })}
          </nav>

          {/* Compact Right Utilities */}
          <div className="flex items-center gap-2 shrink-0">
            <PWAInstallButton lang={lang} />
            <button
              type="button"
              onClick={() => setActiveTab(activeTab === 'scanner' ? 'quick' : 'scanner')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-all whitespace-nowrap shrink-0 cursor-pointer ${
                activeTab === 'scanner'
                  ? 'bg-cyan-400 text-slate-950 border-cyan-300 font-semibold shadow-[0_0_16px_rgba(34,211,238,0.45)]'
                  : 'bg-[#0e131f] text-slate-200 border-slate-700/90 hover:border-cyan-400/50 hover:text-cyan-200'
              }`}
              title={isKg ? 'Камерадан чек сканерлөө' : 'Сканер чеков'}
            >
              <Camera className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{isKg ? 'Чек сканер' : 'Сканер'}</span>
            </button>

            <div className="inline-flex p-0.5 bg-[#0e131f] border border-slate-800 rounded-lg text-xs">
              <button
                type="button"
                onClick={() => setLang('kg')}
                className={`px-2 py-1 font-medium rounded-md transition-colors cursor-pointer ${
                  isKg ? 'bg-cyan-400/20 text-cyan-200 border border-cyan-400/30' : 'text-slate-400 hover:text-white'
                }`}
              >
                КГ
              </button>
              <button
                type="button"
                onClick={() => setLang('ru')}
                className={`px-2 py-1 font-medium rounded-md transition-colors cursor-pointer ${
                  !isKg ? 'bg-cyan-400/20 text-cyan-200 border border-cyan-400/30' : 'text-slate-400 hover:text-white'
                }`}
              >
                РУ
              </button>
            </div>

            <select
              aria-label="Валюта"
              value={displayCurrency}
              onChange={(e) => setDisplayCurrency(e.target.value as CurrencyCode)}
              className="px-2 py-1.5 text-xs font-mono font-medium bg-[#0e131f] border border-slate-700/90 hover:border-cyan-400/50 rounded-lg text-cyan-200 cursor-pointer"
            >
              {DISPLAY_CURRENCIES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => void handleLogout()}
              className="p-1.5 text-slate-400 hover:text-rose-400 rounded-lg transition-colors cursor-pointer"
              title={isKg ? 'Чыгуу' : 'Выйти'}
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-6">
        {dataLoading && transactions.length === 0 ? (
          <div className="bg-[#0e131f] border border-slate-800 rounded-2xl p-10 text-center text-sm text-cyan-300">
            {isKg ? 'Жүктөлүүдө...' : 'Загрузка...'}
          </div>
        ) : (
          <>
            {activeTab === 'quick' && (
              <QuickDeskView
                lang={lang}
                transactions={transactions}
                goods={goods}
                clients={clients}
                businessNomenclature={businessNomenclature}
                familyNomenclature={familyNomenclature}
                displayCurrency={displayCurrency}
                ratesToKgs={ratesToKgs}
                monthlyLimits={monthlyLimits}
                onUpdateLimits={handleUpdateLimits}
                onTransactionCreated={(tx) =>
                  setTransactions((prev) =>
                    prev.some((item) => item.id === tx.id) ? prev : [tx, ...prev]
                  )
                }
                onTransactionUpdated={(tx) =>
                  setTransactions((prev) => prev.map((item) => (item.id === tx.id ? tx : item)))
                }
                onTransactionDeleted={handleDeleteTransaction}
                onGoodCreated={(good) =>
                  setGoods((prev) => (prev.some((g) => g.id === good.id) ? prev : [good, ...prev]))
                }
                onGoodUpdated={(good) =>
                  setGoods((prev) => prev.map((g) => (g.id === good.id ? good : g)))
                }
                onGoodDeleted={(id) => setGoods((prev) => prev.filter((g) => g.id !== id))}
                onOpenCameraScanner={() => setActiveTab('scanner')}
                onOpenCatalogManager={() => setActiveTab('base')}
              />
            )}

            {activeTab === 'base' && (
              <CatalogBaseView
                lang={lang}
                clients={clients}
                businessExpenses={businessNomenclature}
                familyExpenses={familyNomenclature}
                onRefresh={refreshCatalog}
              />
            )}

            {activeTab === 'history' && (
              <HistoryAnalyticsView
                lang={lang}
                transactions={transactions}
                displayCurrency={displayCurrency}
                ratesToKgs={ratesToKgs}
                monthlyLimits={monthlyLimits}
                onUpdateLimits={handleUpdateLimits}
                onEditTransaction={(tx) => {
                  setEditingTx(tx);
                  setTxModalOpen(true);
                }}
                onDeleteTransaction={handleDeleteTransaction}
              />
            )}

            {activeTab === 'telegram' && (
              <TelegramBotView
                lang={lang}
                userRole={user.role}
                inbox={telegramInbox}
                onRefreshInbox={() =>
                  void api.getTelegramConfig().then((r) => setTelegramInbox(r.inbox))
                }
              />
            )}

            {activeTab === 'scanner' && (
              <ReceiptScannerView
                lang={lang}
                familyNomenclature={familyNomenclature}
                businessNomenclature={businessNomenclature}
                clients={clients}
                onTransactionSaved={(tx) => {
                  setTransactions((prev) =>
                    prev.some((item) => item.id === tx.id) ? prev : [tx, ...prev]
                  );
                  setActiveTab('quick');
                }}
              />
            )}
          </>
        )}
      </main>

      {/* Mobile Ergonomic Bottom Thumb Bar (Dark Neon) */}
      <nav
        aria-label="Mobile navigation"
        className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-[#090d16]/95 backdrop-blur-md border-t border-cyan-500/20 px-2 py-1.5 grid grid-cols-4 gap-1"
      >
        {MAIN_TABS.map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`flex flex-col items-center justify-center gap-0.5 py-1.5 rounded-xl text-[11px] font-medium transition-colors ${
                active
                  ? 'text-cyan-300 bg-cyan-400/12 border border-cyan-400/25'
                  : 'text-slate-400 border border-transparent'
              }`}
            >
              <Icon className={`w-4 h-4 ${active ? 'text-cyan-300' : 'text-slate-500'}`} />
              <span className="truncate max-w-full px-1">
                {tab.id === 'history'
                  ? 'Анализ'
                  : tab.id === 'telegram'
                    ? 'Бот'
                    : isKg
                      ? tab.labelKg
                      : tab.labelRu}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Offline connectivity indicator */}
      <OfflineIndicator lang={lang} />

      {/* Edit Transaction Modal */}
      <TransactionModal
        open={txModalOpen}
        lang={lang}
        familyNomenclature={familyNomenclature}
        businessNomenclature={businessNomenclature}
        onClose={() => {
          setTxModalOpen(false);
          setEditingTx(null);
        }}
        editing={editingTx}
        onSubmit={handleSaveTransaction}
      />
    </div>
  );
}
