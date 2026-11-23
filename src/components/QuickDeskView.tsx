import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowDownLeft,
  Banknote,
  Briefcase,
  Camera,
  Check,
  CheckCircle2,
  ClipboardPaste,
  Clock,
  Copy,
  Download,
  Search,
  Send,
  SlidersHorizontal,
  Sparkles,
  Target,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { api } from '../api.ts';
import { CURRENCIES, convertFromKgs, formatMoney } from '../constants.ts';
import type {
  AppLang,
  CatalogItem,
  CurrencyCode,
  LedgerSpace,
  MonthlyLimits,
  PaymentMethod,
  StagedGood,
  Transaction,
} from '../types.ts';

interface QuickDeskViewProps {
  lang: AppLang;
  transactions: Transaction[];
  goods: StagedGood[];
  clients: CatalogItem[];
  businessNomenclature: CatalogItem[];
  familyNomenclature: CatalogItem[];
  displayCurrency: CurrencyCode;
  ratesToKgs: Record<CurrencyCode, number>;
  monthlyLimits: MonthlyLimits;
  onUpdateLimits: (payload: { familyMonthlyKgs: number; businessMonthlyKgs: number }) => Promise<void>;
  onTransactionCreated: (tx: Transaction) => void;
  onTransactionUpdated: (tx: Transaction) => void;
  onTransactionDeleted: (tx: Transaction) => Promise<void>;
  onGoodCreated: (good: StagedGood) => void;
  onGoodUpdated: (good: StagedGood) => void;
  onGoodDeleted: (id: string) => void;
  onOpenCameraScanner: () => void;
  onOpenCatalogManager: () => void;
}

type QuickPadTab = 'family' | 'business' | 'client_income';

const QUICK_AMOUNTS = [100, 500, 1000, 5000];

function escapeCsvCell(value: string | number | null | undefined): string {
  const str = String(value ?? '');
  const safe = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function QuickDeskView({
  lang,
  transactions,
  goods,
  clients,
  businessNomenclature,
  familyNomenclature,
  displayCurrency,
  ratesToKgs,
  monthlyLimits,
  onUpdateLimits,
  onTransactionCreated,
  onTransactionUpdated,
  onTransactionDeleted,
  onGoodCreated,
  onGoodUpdated,
  onGoodDeleted,
  onOpenCameraScanner,
  onOpenCatalogManager,
}: QuickDeskViewProps) {
  const isKg = lang === 'kg';
  const [padTab, setPadTab] = useState<QuickPadTab>('family');

  // Auto-focus refs for 2-second logging
  const famAmountRef = useRef<HTMLInputElement | null>(null);
  const bizAmountRef = useRef<HTMLInputElement | null>(null);
  const clientAmountRef = useRef<HTMLInputElement | null>(null);

  // --- Family Expense (8 nomenclature) ---
  const [familyMethod, setFamilyMethod] = useState<PaymentMethod>('cash');
  const [famCategory, setFamCategory] = useState('');
  const [famAmount, setFamAmount] = useState('');
  const [famCurrency, setFamCurrency] = useState<CurrencyCode>('KGS');
  const [famNote, setFamNote] = useState('');

  // --- Business Expense & Goods (30 nomenclature) ---
  const [bizMethod, setBizMethod] = useState<PaymentMethod>('cash');
  const [bizSearch, setBizSearch] = useState('');
  const [bizCategory, setBizCategory] = useState('');
  const [bizAmount, setBizAmount] = useState('');
  const [bizCurrency, setBizCurrency] = useState<CurrencyCode>('KGS');
  const [bizNote, setBizNote] = useState('');

  // --- Unified Business & Staged Goods to Website options ---
  const [alsoStageToSite, setAlsoStageToSite] = useState(false);
  const [goodName, setGoodName] = useState('');
  const [goodSku, setGoodSku] = useState('');
  const [goodQty, setGoodQty] = useState('1');
  const [goodUnit, setGoodUnit] = useState('шт');
  const [goodSellPrice, setGoodSellPrice] = useState('');
  const [goodSupplier, setGoodSupplier] = useState('');

  // --- Forwarded Receipt text ---
  const [forwardText, setForwardText] = useState('');
  const [forwardingBusy, setForwardingBusy] = useState(false);

  // --- Client Income Auto-List (30 clients → Website Queue) ---
  const [clientSearch, setClientSearch] = useState('');
  const [clientName, setClientName] = useState('');
  const [clientContact, setClientContact] = useState('');
  const [clientAmount, setClientAmount] = useState('');
  const [clientCurrency, setClientCurrency] = useState<CurrencyCode>('KGS');
  const [clientMethod, setClientMethod] = useState<PaymentMethod>('cashless');
  const [clientNote, setClientNote] = useState('');

  // Queue filters & notifications
  const [clientQueueFilter, setClientQueueFilter] = useState<'pending' | 'synced'>('pending');
  const [goodsQueueFilter, setGoodsQueueFilter] = useState<'pending' | 'uploaded'>('pending');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Inline Monthly Limits editor
  const [limitsOpen, setLimitsOpen] = useState(false);
  const [famLimitInput, setFamLimitInput] = useState('');
  const [bizLimitInput, setBizLimitInput] = useState('');
  const [savingLimits, setSavingLimits] = useState(false);
  const [dismissedAlertMonth, setDismissedAlertMonth] = useState<string | null>(null);

  const todayStr = new Date().toISOString().slice(0, 10);
  const currentMonthStr = todayStr.slice(0, 7);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 3500);
    return () => clearTimeout(t);
  }, [notice]);

  useEffect(() => {
    if (!famCategory && familyNomenclature.length > 0) {
      setFamCategory(familyNomenclature[0].name);
    }
  }, [familyNomenclature, famCategory]);

  useEffect(() => {
    if (!bizCategory && businessNomenclature.length > 0) {
      setBizCategory(businessNomenclature[0].name);
    }
  }, [businessNomenclature, bizCategory]);

  const toDisplay = (kgs: number) => convertFromKgs(kgs, displayCurrency, ratesToKgs);

  const filteredBizNomenclature = useMemo(() => {
    const q = bizSearch.trim().toLowerCase();
    if (!q) return businessNomenclature;
    return businessNomenclature.filter((item) => item.name.toLowerCase().includes(q));
  }, [businessNomenclature, bizSearch]);

  const topBizNomenclature = useMemo(() => {
    const counts = new Map<string, number>();
    for (const tx of transactions) {
      if (tx.type === 'expense' && tx.space === 'business') {
        counts.set(tx.category, (counts.get(tx.category) ?? 0) + 1);
      }
    }
    return businessNomenclature
      .map((item) => ({ item, count: counts.get(item.name) ?? 0 }))
      .filter((entry) => entry.count > 0)
      .sort((a, b) => b.count - a.count || a.item.sortOrder - b.item.sortOrder)
      .slice(0, 5);
  }, [transactions, businessNomenclature]);

  const filteredClients = useMemo(() => {
    const q = clientSearch.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter(
      (c) => c.name.toLowerCase().includes(q) || c.phone.toLowerCase().includes(q)
    );
  }, [clients, clientSearch]);

  const stats = useMemo(() => {
    let familyCashKgs = 0;
    let familyCashlessKgs = 0;
    let businessCashKgs = 0;
    let businessCashlessKgs = 0;
    let pendingClientsCount = 0;
    let pendingClientsKgs = 0;
    let familyMonthKgs = 0;
    let businessMonthKgs = 0;

    for (const tx of transactions) {
      if (tx.type === 'expense') {
        const isCurrentMonth = tx.date.startsWith(currentMonthStr);
        if (tx.space === 'family') {
          if (tx.paymentMethod === 'cash') familyCashKgs += tx.amountInKgs;
          else familyCashlessKgs += tx.amountInKgs;
          if (isCurrentMonth) familyMonthKgs += tx.amountInKgs;
        } else if (tx.space === 'business') {
          if (tx.paymentMethod === 'cash') businessCashKgs += tx.amountInKgs;
          else businessCashlessKgs += tx.amountInKgs;
          if (isCurrentMonth) businessMonthKgs += tx.amountInKgs;
        }
      }
      if (tx.space === 'business' && tx.type === 'income' && tx.siteSyncStatus === 'pending') {
        pendingClientsCount++;
        pendingClientsKgs += tx.amountInKgs;
      }
    }

    const pendingGoods = goods.filter((g) => g.siteStatus === 'pending');
    const familyTotalKgs = familyCashKgs + familyCashlessKgs;
    const businessTotalKgs = businessCashKgs + businessCashlessKgs;
    const combinedExpKgs = familyTotalKgs + businessTotalKgs;

    const famLimKgs = monthlyLimits.familyMonthlyKgs;
    const bizLimKgs = monthlyLimits.businessMonthlyKgs;
    const familyLimitPct = famLimKgs > 0 ? (familyMonthKgs / famLimKgs) * 100 : null;
    const businessLimitPct = bizLimKgs > 0 ? (businessMonthKgs / bizLimKgs) * 100 : null;

    return {
      familyTotal: toDisplay(familyTotalKgs),
      familyCash: toDisplay(familyCashKgs),
      familyCashless: toDisplay(familyCashlessKgs),
      familyMonth: toDisplay(familyMonthKgs),
      familyLimitDisplay: famLimKgs > 0 ? toDisplay(famLimKgs) : 0,
      familyLimitPct,
      businessTotal: toDisplay(businessTotalKgs),
      businessCash: toDisplay(businessCashKgs),
      businessCashless: toDisplay(businessCashlessKgs),
      businessMonth: toDisplay(businessMonthKgs),
      businessLimitDisplay: bizLimKgs > 0 ? toDisplay(bizLimKgs) : 0,
      businessLimitPct,
      familySharePct: combinedExpKgs > 0 ? (familyTotalKgs / combinedExpKgs) * 100 : 0,
      businessSharePct: combinedExpKgs > 0 ? (businessTotalKgs / combinedExpKgs) * 100 : 0,
      pendingClientsCount,
      pendingClientsTotal: toDisplay(pendingClientsKgs),
      pendingGoodsCount: pendingGoods.length,
    };
  }, [transactions, goods, displayCurrency, ratesToKgs, monthlyLimits, currentMonthStr]);

  function openLimitsEditor() {
    setFamLimitInput(monthlyLimits.familyMonthlyKgs > 0 ? String(monthlyLimits.familyMonthlyKgs) : '');
    setBizLimitInput(monthlyLimits.businessMonthlyKgs > 0 ? String(monthlyLimits.businessMonthlyKgs) : '');
    setLimitsOpen((prev) => !prev);
  }

  async function handleSaveLimits(e: React.FormEvent) {
    e.preventDefault();
    const fam = famLimitInput.trim() ? Number(famLimitInput.replace(',', '.')) : 0;
    const biz = bizLimitInput.trim() ? Number(bizLimitInput.replace(',', '.')) : 0;
    if (!Number.isFinite(fam) || fam < 0 || !Number.isFinite(biz) || biz < 0) {
      setError(isKg ? 'Лимитти туура жазыңыз' : 'Введите корректную сумму лимита');
      return;
    }
    setSavingLimits(true);
    setError(null);
    try {
      await onUpdateLimits({ familyMonthlyKgs: fam, businessMonthlyKgs: biz });
      setLimitsOpen(false);
      setDismissedAlertMonth(null);
      setNotice(isKg ? 'Айлык лимит сакталды ✓' : 'Месячный лимит сохранён ✓');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения лимита');
    } finally {
      setSavingLimits(false);
    }
  }

  const todayExpenses = useMemo(
    () =>
      transactions
        .filter((tx) => tx.type === 'expense' && tx.date === todayStr && tx.space !== 'personal')
        .slice(0, 6),
    [transactions, todayStr]
  );

  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const canPasteFamily = padTab === 'family' && familyMethod === 'cashless';
      const canPasteBiz = padTab === 'business' && bizMethod === 'cashless';
      const canPasteClient = padTab === 'client_income';
      if (!canPasteFamily && !canPasteBiz && !canPasteClient) return;

      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            void processForwardedImage(
              file,
              padTab === 'family' ? 'family' : 'business',
              padTab === 'client_income' ? 'income' : 'expense',
              padTab === 'client_income' ? 'pending' : 'not_applicable'
            );
            break;
          }
        }
      }
    }
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [padTab, familyMethod, bizMethod]);

  function bumpAmount(current: string, setter: (v: string) => void, add: number) {
    const base = Number(current.replace(',', '.')) || 0;
    setter(String(Math.round((base + add) * 100) / 100));
  }

  async function processForwardedImage(
    file: File,
    targetSpace: LedgerSpace,
    forcedType: 'income' | 'expense',
    syncStatus: 'not_applicable' | 'pending'
  ) {
    setForwardingBusy(true);
    setError(null);
    setNotice(null);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(new Error('Не удалось прочитать файл'));
        reader.readAsDataURL(file);
      });

      const res = await api.scanReceiptImage({
        imageBase64: dataUrl,
        mimeType: file.type || 'image/jpeg',
        preferredSpace: targetSpace,
        autoSave: true,
        sourceChannel: 'ocr_upload',
        forcedType,
        siteSyncStatus: syncStatus,
      });

      if (res.savedTransaction) {
        onTransactionCreated(res.savedTransaction);
        setNotice(
          isKg
            ? `Чек таанылды жана жазылды: ${res.savedTransaction.merchant} (${formatMoney(res.savedTransaction.amount, res.savedTransaction.currency)})`
            : `Чек распознан и записан: ${res.savedTransaction.merchant} (${formatMoney(res.savedTransaction.amount, res.savedTransaction.currency)})`
        );
      } else {
        setError(isKg ? 'Чектен сумма табылган жок.' : 'Сумма на чеке не распознана.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка распознавания чека');
    } finally {
      setForwardingBusy(false);
    }
  }

  async function handleForwardedTextSubmit(e: React.FormEvent, targetSpace: 'family' | 'business') {
    e.preventDefault();
    if (forwardText.trim().length < 5) return;
    setForwardingBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.parseReceiptText({
        text: forwardText.trim(),
        preferredSpace: targetSpace,
        autoSave: true,
        forcedType: 'expense',
        siteSyncStatus: 'not_applicable',
      });
      if (res.savedTransaction) {
        onTransactionCreated(res.savedTransaction);
        setForwardText('');
        setNotice(
          isKg
            ? `Безнал чек жазылды: ${res.savedTransaction.merchant} — ${formatMoney(res.savedTransaction.amount, res.savedTransaction.currency)}`
            : `Безналичный чек записан: ${res.savedTransaction.merchant} — ${formatMoney(res.savedTransaction.amount, res.savedTransaction.currency)}`
        );
      } else {
        setError(isKg ? 'Тексттен сумма аныкталган жок.' : 'Не удалось извлечь сумму.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка разбора');
    } finally {
      setForwardingBusy(false);
    }
  }

  async function handleExpenseSubmit(e: React.FormEvent, space: 'family' | 'business') {
    e.preventDefault();
    const rawAmt = space === 'family' ? famAmount : bizAmount;
    const curr = space === 'family' ? famCurrency : bizCurrency;
    const cat =
      space === 'family'
        ? famCategory || familyNomenclature[0]?.name || 'Үй-бүлө чыгымы'
        : bizCategory || businessNomenclature[0]?.name || 'Бизнес чыгымы';
    const note = space === 'family' ? famNote : bizNote;
    const method = space === 'family' ? familyMethod : bizMethod;

    const num = Number(rawAmt.replace(',', '.'));
    if (!Number.isFinite(num) || num <= 0) {
      setError(isKg ? 'Сумманы туура жазыңыз' : 'Введите положительную сумму');
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);

    try {
      if (space === 'business' && alsoStageToSite) {
        const qty = Number(goodQty.replace(',', '.'));
        if (!Number.isFinite(qty) || qty <= 0) {
          setError(isKg ? 'Санын туура жазыңыз' : 'Укажите корректное количество');
          setSaving(false);
          return;
        }
        const sell = goodSellPrice.trim() ? Number(goodSellPrice.replace(',', '.')) : null;
        const resolvedName = goodName.trim() || cat;
        const unitCost = Math.round((num / qty) * 100) / 100;

        const res = await api.createGood({
          productName: resolvedName,
          category: cat,
          sku: goodSku.trim(),
          quantity: qty,
          unit: goodUnit.trim() || 'шт',
          unitCost,
          currency: curr,
          sellingPrice: sell && Number.isFinite(sell) && sell > 0 ? sell : null,
          supplier: goodSupplier.trim(),
          paymentMethod: method,
          receiptRef: null,
          notes: note.trim(),
          recordAsBusinessExpense: true,
        });
        onGoodCreated(res.good);
        if (res.linkedTransaction) {
          onTransactionCreated(res.linkedTransaction);
        }
        setBizAmount('');
        setBizNote('');
        setGoodName('');
        setGoodSku('');
        setGoodQty('1');
        setGoodSellPrice('');
        setGoodSupplier('');
        setNotice(
          isKg
            ? `Бизнеске жазылды жана «Сайтка» кошулду: ${resolvedName}`
            : `Записано в бизнес и добавлено «На сайт»: ${resolvedName}`
        );
        return;
      }

      const res = await api.createTransaction({
        space,
        type: 'expense',
        paymentMethod: method,
        siteSyncStatus: 'not_applicable',
        amount: Math.round(num * 100) / 100,
        currency: curr,
        category: cat,
        projectId: null,
        merchant: cat,
        description: note.trim(),
        paymentSource: method === 'cash' ? 'Наличные' : 'MBank',
        date: todayStr,
        receiptRef: null,
        sourceChannel: 'manual',
      });
      onTransactionCreated(res.transaction);
      if (space === 'family') {
        setFamAmount('');
        setFamNote('');
      } else {
        setBizAmount('');
        setBizNote('');
      }
      setNotice(
        `${space === 'family' ? (isKg ? 'Үй-бүлө' : 'Семья') : 'Бизнес'} · ${cat}: ${formatMoney(res.transaction.amount, res.transaction.currency)}`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  }

  async function handleClientIncomeSubmit(e: React.FormEvent) {
    e.preventDefault();
    const num = Number(clientAmount.replace(',', '.'));
    if (!clientName.trim()) {
      setError(isKg ? 'Тизмеден клиентти тандаңыз же атын жазыңыз' : 'Выберите клиента из списка');
      return;
    }
    if (!Number.isFinite(num) || num <= 0) {
      setError(isKg ? 'Сумманы туура жазыңыз' : 'Введите сумму');
      return;
    }
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.createTransaction({
        space: 'business',
        type: 'income',
        paymentMethod: clientMethod,
        siteSyncStatus: 'pending',
        clientContact: clientContact.trim() || null,
        amount: Math.round(num * 100) / 100,
        currency: clientCurrency,
        category: 'Клиенттен төлөм',
        projectId: null,
        merchant: clientName.trim(),
        description: clientNote.trim() || 'Сайтка түшүрүү керек',
        paymentSource: clientMethod === 'cash' ? 'Наличные' : 'MBank',
        date: todayStr,
        receiptRef: null,
        sourceChannel: 'manual',
      });
      onTransactionCreated(res.transaction);
      setClientName('');
      setClientContact('');
      setClientAmount('');
      setClientNote('');
      setClientSearch('');
      setNotice(
        isKg
          ? `Клиент «Сайтка түшүрүү» кезегине кошулду: ${res.transaction.merchant}`
          : `Оплата клиента добавлена в очередь «На сайт»: ${res.transaction.merchant}`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  }

  async function toggleClientSiteStatus(tx: Transaction) {
    const next = tx.siteSyncStatus === 'synced' ? 'pending' : 'synced';
    const res = await api.updateTransaction(tx.id, { siteSyncStatus: next });
    onTransactionUpdated(res.transaction);
  }

  async function toggleGoodSiteStatus(good: StagedGood) {
    const next = good.siteStatus === 'uploaded' ? 'pending' : 'uploaded';
    const res = await api.updateGood(good.id, { siteStatus: next });
    onGoodUpdated(res.good);
  }

  function copyText(id: string, text: string) {
    void navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  }

  function exportPendingGoodsCsv() {
    const list = goods.filter((g) => g.siteStatus === 'pending');
    const headers = ['SKU', 'Товар', 'Саны', 'Ед.', 'Закупка', 'Валюта', 'Сатуу баасы', 'Поставщик', 'Эскертүү'];
    const rows = list.map((g) => [
      g.sku,
      g.productName,
      g.quantity,
      g.unit,
      g.unitCost,
      g.currency,
      g.sellingPrice ?? '',
      g.supplier,
      g.notes,
    ]);
    const csv = '\uFEFF' + [headers, ...rows].map((r) => r.map(escapeCsvCell).join(';')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tovary-na-sait-${todayStr}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const clientQueue = useMemo(
    () =>
      transactions.filter(
        (tx) =>
          tx.space === 'business' &&
          tx.type === 'income' &&
          tx.siteSyncStatus === clientQueueFilter
      ),
    [transactions, clientQueueFilter]
  );

  const goodsQueue = useMemo(
    () => goods.filter((g) => g.siteStatus === goodsQueueFilter),
    [goods, goodsQueueFilter]
  );

  return (
    <div className="space-y-6">
      {/* Floating Neon Toast */}
      {notice && (
        <div
          role="status"
          className="fixed bottom-20 md:bottom-6 right-4 md:right-6 z-40 max-w-sm flex items-center gap-2.5 px-4 py-3 rounded-xl bg-[#0e131f]/95 border border-emerald-400/50 text-emerald-100 shadow-[0_0_28px_rgba(52,211,153,0.28)] backdrop-blur-md text-xs font-medium"
        >
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
          <span className="leading-snug">{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            className="ml-1 text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 3-Card Summary Strip + Neon Expense Ratio Bar */}
      <div className="bg-[#0e131f]/95 border border-slate-800/90 rounded-2xl shadow-[0_0_32px_rgba(0,0,0,0.45)] overflow-hidden">
        <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-slate-800/90">
          <div className="p-5">
            <div className="text-xs font-medium text-slate-400">
              {isKg ? 'Үй-бүлө чыгымы (8 номенкл.)' : 'Семейные расходы (8)'}
            </div>
            <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-cyan-300 drop-shadow-[0_0_12px_rgba(34,211,238,0.28)]">
              {formatMoney(stats.familyTotal, displayCurrency)}
            </div>
            <div className="mt-1.5 text-xs font-mono text-slate-400 tabular-nums">
              Нал {formatMoney(stats.familyCash, displayCurrency)} · Безнал{' '}
              {formatMoney(stats.familyCashless, displayCurrency)}
            </div>
            {stats.familyLimitPct !== null && (
              <div className="mt-3 pt-2.5 border-t border-slate-800">
                <div className="flex items-center justify-between text-[11px] font-mono tabular-nums">
                  <span className="text-slate-400">
                    {isKg ? 'Бул айда:' : 'За месяц:'} {formatMoney(stats.familyMonth, displayCurrency)} /{' '}
                    {formatMoney(stats.familyLimitDisplay, displayCurrency)}
                  </span>
                  <span
                    className={`font-semibold ${
                      stats.familyLimitPct >= 100
                        ? 'text-rose-400'
                        : stats.familyLimitPct >= 80
                          ? 'text-amber-300'
                          : 'text-cyan-300'
                    }`}
                  >
                    {stats.familyLimitPct.toFixed(0)}%
                  </span>
                </div>
                <div className="mt-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      stats.familyLimitPct >= 100
                        ? 'bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.8)]'
                        : stats.familyLimitPct >= 80
                          ? 'bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.7)]'
                          : 'bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.7)]'
                    }`}
                    style={{ width: `${Math.min(100, stats.familyLimitPct)}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="p-5">
            <div className="flex items-center justify-between gap-2 text-xs font-medium text-slate-400">
              <span>{isKg ? 'Бизнес · Товар чыгымы (30)' : 'Бизнес и товары (30)'}</span>
              {stats.pendingGoodsCount > 0 && (
                <span className="font-mono font-semibold text-amber-300 tabular-nums">
                  {isKg ? `Сайтка: ${stats.pendingGoodsCount}` : `На сайт: ${stats.pendingGoodsCount}`}
                </span>
              )}
            </div>
            <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-fuchsia-300 drop-shadow-[0_0_12px_rgba(217,70,239,0.28)]">
              {formatMoney(stats.businessTotal, displayCurrency)}
            </div>
            <div className="mt-1.5 text-xs font-mono text-slate-400 tabular-nums">
              Нал {formatMoney(stats.businessCash, displayCurrency)} · Безнал{' '}
              {formatMoney(stats.businessCashless, displayCurrency)}
            </div>
            {stats.businessLimitPct !== null && (
              <div className="mt-3 pt-2.5 border-t border-slate-800">
                <div className="flex items-center justify-between text-[11px] font-mono tabular-nums">
                  <span className="text-slate-400">
                    {isKg ? 'Бул айда:' : 'За месяц:'} {formatMoney(stats.businessMonth, displayCurrency)} /{' '}
                    {formatMoney(stats.businessLimitDisplay, displayCurrency)}
                  </span>
                  <span
                    className={`font-semibold ${
                      stats.businessLimitPct >= 100
                        ? 'text-rose-400'
                        : stats.businessLimitPct >= 80
                          ? 'text-amber-300'
                          : 'text-fuchsia-300'
                    }`}
                  >
                    {stats.businessLimitPct.toFixed(0)}%
                  </span>
                </div>
                <div className="mt-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      stats.businessLimitPct >= 100
                        ? 'bg-rose-500 shadow-[0_0_10px_rgba(244,63,94,0.8)]'
                        : stats.businessLimitPct >= 80
                          ? 'bg-amber-400 shadow-[0_0_10px_rgba(251,191,36,0.7)]'
                          : 'bg-fuchsia-500 shadow-[0_0_10px_rgba(217,70,239,0.7)]'
                    }`}
                    style={{ width: `${Math.min(100, stats.businessLimitPct)}%` }}
                  />
                </div>
              </div>
            )}
          </div>

          <div className="p-5">
            <div className="text-xs font-medium text-slate-400">
              {isKg ? 'Клиенттен акча → Сайтка (30)' : 'Клиенты → На сайт (30)'}
            </div>
            <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-emerald-300 drop-shadow-[0_0_12px_rgba(52,211,153,0.28)]">
              {stats.pendingClientsCount} {isKg ? 'күтүүдө' : 'ожидают'}
            </div>
            <div className="mt-1.5 text-xs font-mono text-slate-400 tabular-nums">
              {formatMoney(stats.pendingClientsTotal, displayCurrency)}
            </div>
          </div>
        </div>

        <div className="px-5 py-3 bg-[#090d16]/80 border-t border-slate-800/90 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-4 text-xs text-slate-400">
            <span className="font-medium text-slate-300">
              {isKg ? 'Үй-бүлө vs Бизнес:' : 'Семья vs Бизнес:'}
            </span>
            <span className="font-mono tabular-nums text-cyan-300 font-semibold">
              {isKg ? 'Үй-бүлө' : 'Семья'} {stats.familySharePct.toFixed(0)}%
            </span>
            <span className="text-slate-700">·</span>
            <span className="font-mono tabular-nums text-fuchsia-300 font-semibold">
              Бизнес {stats.businessSharePct.toFixed(0)}%
            </span>
          </div>
          <div className="flex items-center gap-3 flex-1 min-w-[180px] justify-end">
            <div className="flex-1 max-w-xs h-1.5 bg-slate-800 rounded-full overflow-hidden flex">
              <div
                className="h-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)] transition-all"
                style={{ width: `${stats.familySharePct}%` }}
              />
              <div
                className="h-full bg-fuchsia-500 shadow-[0_0_8px_rgba(217,70,239,0.8)] transition-all"
                style={{ width: `${stats.businessSharePct}%` }}
              />
            </div>
            <button
              type="button"
              onClick={openLimitsEditor}
              className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-cyan-200 bg-[#0e131f] border border-cyan-500/35 hover:border-cyan-400 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Target className="w-3.5 h-3.5 text-cyan-300" />
              <span>{isKg ? 'Айлык лимит' : 'Лимит'}</span>
            </button>
          </div>
        </div>

        {/* Inline Monthly Limits Editor */}
        {limitsOpen && (
          <form
            onSubmit={(e) => void handleSaveLimits(e)}
            className="px-5 py-4 bg-[#0b101b] border-t border-cyan-500/20 grid grid-cols-1 sm:grid-cols-12 gap-3 items-end"
          >
            <div className="sm:col-span-4">
              <label className="block text-xs font-medium text-slate-300 mb-1">
                {isKg ? 'Үй-бүлө айлык лимити (сом)' : 'Месячный лимит семьи (сом)'}
              </label>
              <input
                type="number"
                min="0"
                step="100"
                value={famLimitInput}
                onChange={(e) => setFamLimitInput(e.target.value)}
                placeholder={isKg ? 'Мисалы: 50000 (0 = өчүрүү)' : 'Например: 50000 (0 = откл.)'}
                className="w-full px-3 py-2 text-sm font-mono bg-[#07090f] text-white placeholder:text-slate-500 border border-slate-700 rounded-xl focus:outline-none focus:border-cyan-400"
              />
            </div>
            <div className="sm:col-span-4">
              <label className="block text-xs font-medium text-slate-300 mb-1">
                {isKg ? 'Бизнес айлык лимити (сом)' : 'Месячный лимит бизнеса (сом)'}
              </label>
              <input
                type="number"
                min="0"
                step="100"
                value={bizLimitInput}
                onChange={(e) => setBizLimitInput(e.target.value)}
                placeholder={isKg ? 'Мисалы: 200000 (0 = өчүрүү)' : 'Например: 200000 (0 = откл.)'}
                className="w-full px-3 py-2 text-sm font-mono bg-[#07090f] text-white placeholder:text-slate-500 border border-slate-700 rounded-xl focus:outline-none focus:border-fuchsia-400"
              />
            </div>
            <div className="sm:col-span-4 flex items-center gap-2">
              <button
                type="submit"
                disabled={savingLimits}
                className="flex-1 py-2 px-4 text-xs font-bold bg-cyan-400 hover:bg-cyan-300 text-slate-950 rounded-xl shadow-[0_0_16px_rgba(34,211,238,0.3)] transition-colors cursor-pointer"
              >
                {savingLimits ? '...' : isKg ? 'Сактоо' : 'Сохранить'}
              </button>
              <button
                type="button"
                onClick={() => setLimitsOpen(false)}
                className="py-2 px-3 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-xl transition-colors cursor-pointer"
              >
                {isKg ? 'Жабуу' : 'Отмена'}
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Soft Monthly Limit Alert Banner */}
      {dismissedAlertMonth !== currentMonthStr &&
        ((stats.familyLimitPct !== null && stats.familyLimitPct >= 85) ||
          (stats.businessLimitPct !== null && stats.businessLimitPct >= 85)) && (
          <div
            className={`flex items-start justify-between gap-3 px-4 py-3 rounded-xl border text-xs ${
              (stats.familyLimitPct ?? 0) >= 100 || (stats.businessLimitPct ?? 0) >= 100
                ? 'bg-rose-500/15 border-rose-500/45 text-rose-200'
                : 'bg-amber-500/15 border-amber-400/45 text-amber-200'
            }`}
          >
            <div className="flex items-start gap-2.5">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                {stats.familyLimitPct !== null && stats.familyLimitPct >= 85 && (
                  <div>
                    <strong>{isKg ? 'Үй-бүлө айлык лимити:' : 'Лимит семьи:'}</strong>{' '}
                    {stats.familyLimitPct >= 100
                      ? isKg
                        ? `Лимиттен ашты (${stats.familyLimitPct.toFixed(0)}%) — ${formatMoney(stats.familyMonth, displayCurrency)} / ${formatMoney(stats.familyLimitDisplay, displayCurrency)}`
                        : `Лимит превышен (${stats.familyLimitPct.toFixed(0)}%) — ${formatMoney(stats.familyMonth, displayCurrency)} / ${formatMoney(stats.familyLimitDisplay, displayCurrency)}`
                      : isKg
                        ? `Лимитке жакындады (${stats.familyLimitPct.toFixed(0)}%) — ${formatMoney(stats.familyMonth, displayCurrency)} / ${formatMoney(stats.familyLimitDisplay, displayCurrency)}`
                        : `Приближается к лимиту (${stats.familyLimitPct.toFixed(0)}%) — ${formatMoney(stats.familyMonth, displayCurrency)} / ${formatMoney(stats.familyLimitDisplay, displayCurrency)}`}
                  </div>
                )}
                {stats.businessLimitPct !== null && stats.businessLimitPct >= 85 && (
                  <div>
                    <strong>{isKg ? 'Бизнес айлык лимити:' : 'Лимит бизнеса:'}</strong>{' '}
                    {stats.businessLimitPct >= 100
                      ? isKg
                        ? `Лимиттен ашты (${stats.businessLimitPct.toFixed(0)}%) — ${formatMoney(stats.businessMonth, displayCurrency)} / ${formatMoney(stats.businessLimitDisplay, displayCurrency)}`
                        : `Лимит превышен (${stats.businessLimitPct.toFixed(0)}%) — ${formatMoney(stats.businessMonth, displayCurrency)} / ${formatMoney(stats.businessLimitDisplay, displayCurrency)}`
                      : isKg
                        ? `Лимитке жакындады (${stats.businessLimitPct.toFixed(0)}%) — ${formatMoney(stats.businessMonth, displayCurrency)} / ${formatMoney(stats.businessLimitDisplay, displayCurrency)}`
                        : `Приближается к лимиту (${stats.businessLimitPct.toFixed(0)}%) — ${formatMoney(stats.businessMonth, displayCurrency)} / ${formatMoney(stats.businessLimitDisplay, displayCurrency)}`}
                  </div>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setDismissedAlertMonth(currentMonthStr)}
              className="p-0.5 opacity-70 hover:opacity-100 cursor-pointer"
              title={isKg ? 'Жашыруу' : 'Скрыть'}
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

      {error && (
        <div className="flex items-center justify-between gap-3 p-3.5 rounded-xl bg-rose-500/15 border border-rose-500/45 text-xs text-rose-200">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} className="text-rose-300 hover:text-white cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Primary Focal Anchor: Fast Entry Desk */}
      <div className="bg-[#0e131f]/95 border border-cyan-500/20 rounded-2xl shadow-[0_0_40px_rgba(0,0,0,0.5)] overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-800/90 flex flex-wrap items-center justify-between gap-3 bg-[#090d16]/60">
          <div className="flex flex-wrap items-center gap-1 p-1 bg-[#07090f] border border-slate-800 rounded-xl">
            <button
              type="button"
              onClick={() => setPadTab('family')}
              className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg transition-all whitespace-nowrap cursor-pointer ${
                padTab === 'family'
                  ? 'bg-cyan-400 text-slate-950 shadow-[0_0_16px_rgba(34,211,238,0.4)]'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Banknote className="w-3.5 h-3.5" />
              <span>{isKg ? `Үй-бүлө (${familyNomenclature.length})` : `Семья (${familyNomenclature.length})`}</span>
            </button>
            <button
              type="button"
              onClick={() => setPadTab('business')}
              className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg transition-all whitespace-nowrap cursor-pointer ${
                padTab === 'business'
                  ? 'bg-fuchsia-500 text-white shadow-[0_0_16px_rgba(217,70,239,0.45)]'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <Briefcase className="w-3.5 h-3.5" />
              <span>
                {isKg
                  ? `Бизнес · Товар (${businessNomenclature.length})`
                  : `Бизнес · Товары (${businessNomenclature.length})`}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setPadTab('client_income')}
              className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-lg transition-all whitespace-nowrap cursor-pointer ${
                padTab === 'client_income'
                  ? 'bg-emerald-400 text-slate-950 shadow-[0_0_16px_rgba(52,211,153,0.4)]'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              <ArrowDownLeft className="w-3.5 h-3.5" />
              <span>{isKg ? `Клиенттер (${clients.length})` : `Клиенты (${clients.length})`}</span>
            </button>
          </div>

          <button
            type="button"
            onClick={onOpenCatalogManager}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-200 bg-[#090d16] border border-slate-700/90 hover:border-cyan-400/50 hover:text-cyan-200 rounded-xl transition-colors whitespace-nowrap cursor-pointer"
          >
            <SlidersHorizontal className="w-3.5 h-3.5 text-cyan-400" />
            <span>{isKg ? 'Базаны оңдоо (30 · 30 · 8)' : 'Открыть Базу (30 · 30 · 8)'}</span>
          </button>
        </div>

        <div className="p-5 sm:p-6">
          {/* TAB 1: FAMILY EXPENSE (8 Nomenclature) */}
          {padTab === 'family' && (
            <div className="space-y-5">
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setFamilyMethod('cash')}
                  className={`px-4 py-2 text-xs font-semibold rounded-xl border transition-all cursor-pointer ${
                    familyMethod === 'cash'
                      ? 'bg-cyan-400/18 text-cyan-200 border-cyan-400/70 shadow-[0_0_14px_rgba(34,211,238,0.2)]'
                      : 'bg-[#090d16] text-slate-400 border-slate-800 hover:border-slate-600 hover:text-white'
                  }`}
                >
                  {isKg ? 'Накталай (Нал)' : 'Наличные'}
                </button>
                <button
                  type="button"
                  onClick={() => setFamilyMethod('cashless')}
                  className={`px-4 py-2 text-xs font-semibold rounded-xl border transition-all cursor-pointer ${
                    familyMethod === 'cashless'
                      ? 'bg-cyan-400/18 text-cyan-200 border-cyan-400/70 shadow-[0_0_14px_rgba(34,211,238,0.2)]'
                      : 'bg-[#090d16] text-slate-400 border-slate-800 hover:border-slate-600 hover:text-white'
                  }`}
                >
                  {isKg ? 'Безнал / MBank (Чек переслать / Ctrl+V)' : 'Безнал / MBank (Чек / Ctrl+V)'}
                </button>
              </div>

              {familyMethod === 'cash' ? (
                <form onSubmit={(e) => void handleExpenseSubmit(e, 'family')} className="space-y-4">
                  {/* 8 Family Nomenclature Touch Grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    {familyNomenclature.map((item, idx) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          setFamCategory(item.name);
                          famAmountRef.current?.focus();
                        }}
                        className={`min-h-[44px] px-3.5 py-2.5 text-left text-xs font-medium rounded-xl border transition-all cursor-pointer truncate active:scale-[0.99] ${
                          famCategory === item.name
                            ? 'bg-cyan-400 text-slate-950 border-cyan-300 font-semibold shadow-[0_0_18px_rgba(34,211,238,0.38)]'
                            : 'bg-[#090d16] text-slate-200 border-slate-800 hover:border-cyan-400/50 hover:text-white'
                        }`}
                      >
                        <span className={`font-mono mr-1.5 ${famCategory === item.name ? 'text-slate-900/70' : 'text-cyan-400/70'}`}>
                          {idx + 1}.
                        </span>
                        {item.name}
                      </button>
                    ))}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                    <div className="sm:col-span-3">
                      <label className="block text-xs font-medium text-slate-300 mb-1.5 truncate">
                        {isKg ? `Сумма (${famCategory || 'Үй-бүлө'})` : `Сумма (${famCategory || 'Семья'})`}
                      </label>
                      <input
                        ref={famAmountRef}
                        type="number"
                        step="0.01"
                        min="1"
                        required
                        value={famAmount}
                        onChange={(e) => setFamAmount(e.target.value)}
                        placeholder="1500"
                        className="w-full px-3.5 py-2.5 text-base font-mono font-semibold bg-[#090d16] text-cyan-200 placeholder:text-slate-600 border border-slate-700 rounded-xl focus:outline-none focus:border-cyan-400"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-medium text-slate-300 mb-1.5">Валюта</label>
                      <select
                        value={famCurrency}
                        onChange={(e) => setFamCurrency(e.target.value as CurrencyCode)}
                        className="w-full px-3 py-2.5 text-sm bg-[#090d16] text-slate-100 border border-slate-700 rounded-xl focus:outline-none focus:border-cyan-400"
                      >
                        {CURRENCIES.map((c) => (
                          <option key={c.code} value={c.code}>
                            {c.code}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="sm:col-span-5">
                      <label className="block text-xs font-medium text-slate-300 mb-1.5">
                        {isKg ? 'Эскертүү (керек болсо)' : 'Комментарий (необязательно)'}
                      </label>
                      <input
                        type="text"
                        value={famNote}
                        onChange={(e) => setFamNote(e.target.value)}
                        placeholder={isKg ? 'Мисалы: Базардан алынды...' : 'Например: На рынке...'}
                        className="w-full px-3.5 py-2.5 text-sm bg-[#090d16] text-slate-100 placeholder:text-slate-500 border border-slate-700 rounded-xl focus:outline-none focus:border-cyan-400"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <button
                        type="submit"
                        disabled={saving}
                        className="w-full py-2.5 px-4 text-sm font-bold bg-cyan-400 hover:bg-cyan-300 active:scale-[0.99] text-slate-950 rounded-xl shadow-[0_0_20px_rgba(34,211,238,0.38)] transition-all cursor-pointer"
                      >
                        {saving ? '...' : isKg ? 'Жазуу' : 'Записать'}
                      </button>
                    </div>
                  </div>

                  {/* Quick-amount buttons */}
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] text-slate-400 mr-1">
                      {isKg ? 'Тез сумма:' : 'Быстро:'}
                    </span>
                    {QUICK_AMOUNTS.map((amt) => (
                      <button
                        key={amt}
                        type="button"
                        onClick={() => {
                          bumpAmount(famAmount, setFamAmount, amt);
                          famAmountRef.current?.focus();
                        }}
                        className="px-2.5 py-1 text-xs font-mono text-cyan-200 bg-[#090d16] border border-slate-800 hover:border-cyan-400/60 hover:bg-cyan-400/10 rounded-lg transition-colors cursor-pointer"
                      >
                        +{amt.toLocaleString('ru-RU')}
                      </button>
                    ))}
                    {famAmount && (
                      <button
                        type="button"
                        onClick={() => setFamAmount('')}
                        className="px-2 py-1 text-[11px] text-slate-400 hover:text-rose-300 cursor-pointer"
                      >
                        {isKg ? 'Тазалоо' : 'Сброс'}
                      </button>
                    )}
                  </div>
                </form>
              ) : (
                <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                  <div className="lg:col-span-6 space-y-2.5">
                    <label className="block border-2 border-dashed border-cyan-500/40 hover:border-cyan-400 bg-cyan-400/5 rounded-2xl p-6 text-center transition-colors cursor-pointer">
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void processForwardedImage(f, 'family', 'expense', 'not_applicable');
                        }}
                      />
                      <ClipboardPaste className="w-6 h-6 text-cyan-300 mx-auto" />
                      <p className="mt-2 text-sm font-semibold text-white">
                        {isKg ? 'MBank чек таштаңыз же Ctrl+V басыңыз' : 'Перетащите чек MBank или Ctrl+V'}
                      </p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {isKg ? 'Үй-бүлөлүк безнал чыгымга автоматтык түшөт' : 'Автоматически запишется в семейный безнал'}
                      </p>
                    </label>
                    <button
                      type="button"
                      onClick={onOpenCameraScanner}
                      className="w-full flex items-center justify-center gap-2 py-2.5 text-xs font-medium text-slate-200 bg-[#090d16] border border-slate-700 hover:border-cyan-400/50 rounded-xl transition-colors cursor-pointer"
                    >
                      <Camera className="w-4 h-4 text-cyan-300" />
                      <span>{isKg ? 'Камера менен тартуу' : 'Сканировать камерой'}</span>
                    </button>
                  </div>
                  <form
                    onSubmit={(e) => void handleForwardedTextSubmit(e, 'family')}
                    className="lg:col-span-6 flex flex-col justify-between gap-2.5"
                  >
                    <textarea
                      rows={4}
                      value={forwardText}
                      onChange={(e) => setForwardText(e.target.value)}
                      placeholder={isKg ? 'MBank чек текстин же SMSти чаптаңыз...' : 'Вставьте текст чека MBank...'}
                      className="w-full p-3.5 text-xs font-mono bg-[#090d16] text-slate-100 placeholder:text-slate-500 border border-slate-700 rounded-xl focus:outline-none focus:border-cyan-400"
                    />
                    <button
                      type="submit"
                      disabled={forwardingBusy || forwardText.trim().length < 5}
                      className="flex items-center justify-center gap-2 py-2.5 text-sm font-bold bg-cyan-400 hover:bg-cyan-300 disabled:opacity-50 text-slate-950 rounded-xl shadow-[0_0_18px_rgba(34,211,238,0.32)] transition-colors cursor-pointer"
                    >
                      <Send className="w-4 h-4" />
                      <span>{forwardingBusy ? '...' : isKg ? 'Чекти таанып жазуу' : 'Распознать и записать'}</span>
                    </button>
                  </form>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: UNIFIED BUSINESS & GOODS (30 Nomenclature Auto-List) */}
          {padTab === 'business' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2.5">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setBizMethod('cash')}
                    className={`px-4 py-2 text-xs font-semibold rounded-xl border transition-all cursor-pointer ${
                      bizMethod === 'cash'
                        ? 'bg-fuchsia-500/20 text-fuchsia-200 border-fuchsia-400/70 shadow-[0_0_14px_rgba(217,70,239,0.22)]'
                        : 'bg-[#090d16] text-slate-400 border-slate-800 hover:border-slate-600 hover:text-white'
                    }`}
                  >
                    {isKg ? 'Накталай (Нал)' : 'Наличные'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setBizMethod('cashless')}
                    className={`px-4 py-2 text-xs font-semibold rounded-xl border transition-all cursor-pointer ${
                      bizMethod === 'cashless'
                        ? 'bg-fuchsia-500/20 text-fuchsia-200 border-fuchsia-400/70 shadow-[0_0_14px_rgba(217,70,239,0.22)]'
                        : 'bg-[#090d16] text-slate-400 border-slate-800 hover:border-slate-600 hover:text-white'
                    }`}
                  >
                    {isKg ? 'Безнал / MBank (Чек / Ctrl+V)' : 'Безнал / MBank (Чек / Ctrl+V)'}
                  </button>
                </div>

                <div className="relative w-full sm:w-72">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={bizSearch}
                    onChange={(e) => setBizSearch(e.target.value)}
                    placeholder={isKg ? '30 номенклатурадан издөө...' : 'Поиск по 30 статьям...'}
                    className="w-full pl-8 pr-8 py-2 text-xs bg-[#090d16] text-slate-100 placeholder:text-slate-500 border border-slate-700 rounded-xl focus:outline-none focus:border-fuchsia-400"
                  />
                  {bizSearch && (
                    <button
                      type="button"
                      onClick={() => setBizSearch('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Auto-pinned Top-5 Frequent Business Nomenclatures */}
              {!bizSearch.trim() && topBizNomenclature.length > 0 && (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-1.5 text-[11px] font-medium text-fuchsia-300/90">
                    <Sparkles className="w-3.5 h-3.5 text-fuchsia-400" />
                    <span>{isKg ? 'Көп колдонулган (Топ-5)' : 'Часто используемые (Топ-5)'}</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {topBizNomenclature.map(({ item, count }) => {
                      const active = bizCategory === item.name;
                      return (
                        <button
                          key={`top-${item.id}`}
                          type="button"
                          onClick={() => {
                            setBizCategory(item.name);
                            bizAmountRef.current?.focus();
                          }}
                          className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-all cursor-pointer active:scale-[0.99] flex items-center gap-1.5 ${
                            active
                              ? 'bg-fuchsia-500 text-white border-fuchsia-400 shadow-[0_0_16px_rgba(217,70,239,0.45)]'
                              : 'bg-fuchsia-500/10 text-fuchsia-200 border-fuchsia-500/35 hover:border-fuchsia-400 hover:bg-fuchsia-500/20'
                          }`}
                        >
                          <span className="truncate max-w-[180px]">{item.name}</span>
                          <span
                            className={`font-mono text-[10px] tabular-nums ${
                              active ? 'text-fuchsia-100' : 'text-fuchsia-300/80'
                            }`}
                          >
                            ×{count}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Scrollable 30-item Business Nomenclature Selector */}
              <div className="max-h-48 overflow-y-auto thin-scroll p-2 bg-[#07090f] border border-slate-800 rounded-xl grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
                {filteredBizNomenclature.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setBizCategory(item.name);
                      bizAmountRef.current?.focus();
                    }}
                    className={`min-h-[38px] px-3 py-1.5 text-left text-xs font-medium rounded-lg border transition-all cursor-pointer truncate active:scale-[0.99] ${
                      bizCategory === item.name
                        ? 'bg-fuchsia-500 text-white border-fuchsia-400 font-semibold shadow-[0_0_16px_rgba(217,70,239,0.4)]'
                        : 'bg-[#0e131f] text-slate-200 border-slate-800/90 hover:border-fuchsia-400/50 hover:text-white'
                    }`}
                  >
                    <span className={bizCategory === item.name ? 'text-fuchsia-100 font-mono mr-1.5' : 'text-fuchsia-400/70 font-mono mr-1.5'}>
                      {item.sortOrder}.
                    </span>
                    {item.name}
                  </button>
                ))}
              </div>

              <form onSubmit={(e) => void handleExpenseSubmit(e, 'business')} className="space-y-3.5">
                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                  <div className="sm:col-span-3">
                    <label className="block text-xs font-medium text-slate-300 mb-1.5 truncate">
                      {`Сумма (${bizCategory || 'Бизнес'})`}
                    </label>
                    <input
                      ref={bizAmountRef}
                      type="number"
                      step="0.01"
                      min="1"
                      required
                      value={bizAmount}
                      onChange={(e) => setBizAmount(e.target.value)}
                      placeholder="5000"
                      className="w-full px-3.5 py-2.5 text-base font-mono font-semibold bg-[#090d16] text-fuchsia-200 placeholder:text-slate-600 border border-slate-700 rounded-xl focus:outline-none focus:border-fuchsia-400"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">Валюта</label>
                    <select
                      value={bizCurrency}
                      onChange={(e) => setBizCurrency(e.target.value as CurrencyCode)}
                      className="w-full px-3 py-2.5 text-sm bg-[#090d16] text-slate-100 border border-slate-700 rounded-xl focus:outline-none focus:border-fuchsia-400"
                    >
                      {CURRENCIES.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.code}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="sm:col-span-5">
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      {isKg ? 'Комментарий (керек болсо)' : 'Комментарий (необязательно)'}
                    </label>
                    <input
                      type="text"
                      value={bizNote}
                      onChange={(e) => setBizNote(e.target.value)}
                      placeholder={isKg ? 'Кимге же эмнеге...' : 'Детали...'}
                      className="w-full px-3.5 py-2.5 text-sm bg-[#090d16] text-slate-100 placeholder:text-slate-500 border border-slate-700 rounded-xl focus:outline-none focus:border-fuchsia-400"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <button
                      type="submit"
                      disabled={saving}
                      className="w-full py-2.5 px-4 text-sm font-bold bg-fuchsia-500 hover:bg-fuchsia-400 active:scale-[0.99] text-white rounded-xl shadow-[0_0_20px_rgba(217,70,239,0.42)] transition-all cursor-pointer"
                    >
                      {saving ? '...' : isKg ? 'Жазуу' : 'Записать'}
                    </button>
                  </div>
                </div>

                {/* Quick-amount buttons */}
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[11px] text-slate-400 mr-1">
                    {isKg ? 'Тез сумма:' : 'Быстро:'}
                  </span>
                  {QUICK_AMOUNTS.map((amt) => (
                    <button
                      key={amt}
                      type="button"
                      onClick={() => {
                        bumpAmount(bizAmount, setBizAmount, amt);
                        bizAmountRef.current?.focus();
                      }}
                      className="px-2.5 py-1 text-xs font-mono text-fuchsia-200 bg-[#090d16] border border-slate-800 hover:border-fuchsia-400/60 hover:bg-fuchsia-500/15 rounded-lg transition-colors cursor-pointer"
                    >
                      +{amt.toLocaleString('ru-RU')}
                    </button>
                  ))}
                  {bizAmount && (
                    <button
                      type="button"
                      onClick={() => setBizAmount('')}
                      className="px-2 py-1 text-[11px] text-slate-400 hover:text-rose-300 cursor-pointer"
                    >
                      {isKg ? 'Тазалоо' : 'Сброс'}
                    </button>
                  )}
                </div>

                {/* Integrated Website Staging Option */}
                <div className="pt-2.5 border-t border-slate-800 space-y-3">
                  <label className="inline-flex items-center gap-2 text-xs font-medium text-slate-300 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={alsoStageToSite}
                      onChange={(e) => setAlsoStageToSite(e.target.checked)}
                      className="w-4 h-4 rounded border-slate-600 bg-[#090d16] accent-fuchsia-500"
                    />
                    <span>
                      {isKg
                        ? 'Ошол эле учурда «Сайтка түшүрүү» товар тизмесине кошуу'
                        : 'Также добавить в очередь товаров «На сайт»'}
                    </span>
                  </label>

                  {alsoStageToSite && (
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-2.5 p-3.5 bg-[#090d16] border border-fuchsia-500/25 rounded-xl">
                      <div className="sm:col-span-4">
                        <label className="block text-[11px] font-medium text-slate-400 mb-1">
                          {isKg ? 'Товардын аты (бош болсо номенкл.)' : 'Название товара (опционально)'}
                        </label>
                        <input
                          type="text"
                          value={goodName}
                          onChange={(e) => setGoodName(e.target.value)}
                          placeholder={bizCategory || 'Товардын аты'}
                          className="w-full px-2.5 py-1.5 text-xs bg-[#0e131f] text-white placeholder:text-slate-500 border border-slate-700 rounded-lg"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-[11px] font-medium text-slate-400 mb-1">SKU</label>
                        <input
                          type="text"
                          value={goodSku}
                          onChange={(e) => setGoodSku(e.target.value)}
                          placeholder="SKU-101"
                          className="w-full px-2.5 py-1.5 text-xs font-mono bg-[#0e131f] text-white placeholder:text-slate-500 border border-slate-700 rounded-lg"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-[11px] font-medium text-slate-400 mb-1">
                          {isKg ? 'Саны' : 'Кол-во'}
                        </label>
                        <div className="flex gap-1">
                          <input
                            type="number"
                            step="1"
                            min="1"
                            value={goodQty}
                            onChange={(e) => setGoodQty(e.target.value)}
                            className="w-full px-2 py-1.5 text-xs font-mono bg-[#0e131f] text-white border border-slate-700 rounded-lg"
                          />
                          <input
                            type="text"
                            value={goodUnit}
                            onChange={(e) => setGoodUnit(e.target.value)}
                            className="w-11 px-1.5 py-1.5 text-xs bg-[#0e131f] text-white border border-slate-700 rounded-lg"
                          />
                        </div>
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-[11px] font-medium text-slate-400 mb-1">
                          {isKg ? 'Сатуу баасы' : 'Продажа'}
                        </label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={goodSellPrice}
                          onChange={(e) => setGoodSellPrice(e.target.value)}
                          placeholder="1950"
                          className="w-full px-2.5 py-1.5 text-xs font-mono bg-[#0e131f] text-white placeholder:text-slate-500 border border-slate-700 rounded-lg"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-[11px] font-medium text-slate-400 mb-1">Поставщик</label>
                        <input
                          type="text"
                          value={goodSupplier}
                          onChange={(e) => setGoodSupplier(e.target.value)}
                          placeholder="Дордой"
                          className="w-full px-2.5 py-1.5 text-xs bg-[#0e131f] text-white placeholder:text-slate-500 border border-slate-700 rounded-lg"
                        />
                      </div>
                    </div>
                  )}
                </div>
              </form>

              {bizMethod === 'cashless' && (
                <div className="pt-2 border-t border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
                  <span>
                    {isKg
                      ? 'Же MBank чекти Ctrl+V кылып чаптаңыз же файл тандаңыз:'
                      : 'Или вставьте чек MBank (Ctrl+V) / загрузите файл:'}
                  </span>
                  <label className="inline-flex items-center gap-1.5 text-fuchsia-300 font-medium cursor-pointer hover:underline">
                    <Upload className="w-3.5 h-3.5" />
                    <span>{forwardingBusy ? '...' : isKg ? 'MBank чек жүктөө' : 'Загрузить чек'}</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void processForwardedImage(f, 'business', 'expense', 'not_applicable');
                      }}
                    />
                  </label>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: CLIENT INCOME AUTO-LIST (30 Clients → Website Transfer) */}
          {padTab === 'client_income' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="relative flex-1 min-w-[220px] max-w-md">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={clientSearch}
                    onChange={(e) => setClientSearch(e.target.value)}
                    placeholder={
                      isKg
                        ? '30 клиенттин авто-тизмесинен издөө...'
                        : 'Поиск по авто-списку из 30 клиентов...'
                    }
                    className="w-full pl-8 pr-8 py-2 text-xs bg-[#090d16] text-slate-100 placeholder:text-slate-500 border border-slate-700 rounded-xl focus:outline-none focus:border-emerald-400"
                  />
                  {clientSearch && (
                    <button
                      type="button"
                      onClick={() => setClientSearch('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <label className="inline-flex items-center gap-1.5 text-xs text-emerald-300 font-medium cursor-pointer hover:underline">
                  <Upload className="w-3.5 h-3.5" />
                  <span>{forwardingBusy ? '...' : isKg ? 'MBank чектен (же Ctrl+V)' : 'Чек MBank (или Ctrl+V)'}</span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void processForwardedImage(f, 'business', 'income', 'pending');
                    }}
                  />
                </label>
              </div>

              {/* 30-Client Quick Auto-List Grid */}
              <div className="max-h-48 overflow-y-auto thin-scroll p-2 bg-[#07090f] border border-slate-800 rounded-xl grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-1.5">
                {filteredClients.map((c) => {
                  const selected = clientName === c.name;
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => {
                        setClientName(c.name);
                        setClientContact(c.phone);
                        clientAmountRef.current?.focus();
                      }}
                      className={`min-h-[38px] px-3 py-1.5 text-left text-xs rounded-lg border transition-all cursor-pointer truncate active:scale-[0.99] ${
                        selected
                          ? 'bg-emerald-400 text-slate-950 border-emerald-300 font-semibold shadow-[0_0_16px_rgba(52,211,153,0.4)]'
                          : 'bg-[#0e131f] text-slate-200 border-slate-800 hover:border-emerald-400/50 hover:text-white'
                      }`}
                    >
                      <span className={selected ? 'text-slate-900/70 font-mono mr-1.5' : 'text-emerald-400/70 font-mono mr-1.5'}>
                        {c.sortOrder}.
                      </span>
                      <span className="font-medium">{c.name}</span>
                      {c.phone && (
                        <span className={`ml-1.5 font-mono text-[11px] ${selected ? 'text-slate-900/70' : 'text-slate-400'}`}>
                          {c.phone}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              <form onSubmit={handleClientIncomeSubmit} className="grid grid-cols-1 sm:grid-cols-12 gap-3 items-end">
                <div className="sm:col-span-3">
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    {isKg ? 'Тандалган клиент' : 'Выбранный клиент'}
                  </label>
                  <input
                    type="text"
                    required
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                    placeholder={isKg ? 'Жогорудан басып тандаңыз' : 'Выберите из списка выше'}
                    className="w-full px-3.5 py-2.5 text-sm bg-[#090d16] text-white placeholder:text-slate-500 border border-slate-700 rounded-xl focus:outline-none focus:border-emerald-400"
                  />
                </div>
                <div className="sm:col-span-3">
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">Сумма</label>
                  <div className="flex gap-1.5">
                    <input
                      ref={clientAmountRef}
                      type="number"
                      step="0.01"
                      min="1"
                      required
                      value={clientAmount}
                      onChange={(e) => setClientAmount(e.target.value)}
                      placeholder="15000"
                      className="flex-1 min-w-0 px-3.5 py-2.5 text-base font-mono font-semibold bg-[#090d16] text-emerald-300 placeholder:text-slate-600 border border-slate-700 rounded-xl focus:outline-none focus:border-emerald-400"
                    />
                    <select
                      value={clientCurrency}
                      onChange={(e) => setClientCurrency(e.target.value as CurrencyCode)}
                      className="w-18 px-1.5 py-2.5 text-xs bg-[#090d16] text-slate-100 border border-slate-700 rounded-xl"
                    >
                      {CURRENCIES.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.code}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    {isKg ? 'Төлөм' : 'Способ'}
                  </label>
                  <select
                    value={clientMethod}
                    onChange={(e) => setClientMethod(e.target.value as PaymentMethod)}
                    className="w-full px-2.5 py-2.5 text-xs bg-[#090d16] text-slate-100 border border-slate-700 rounded-xl"
                  >
                    <option value="cashless">MBank / Безнал</option>
                    <option value="cash">{isKg ? 'Накталай' : 'Наличные'}</option>
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    {isKg ? 'Заказ / Эскертүү' : 'Заказ / Заметка'}
                  </label>
                  <input
                    type="text"
                    value={clientNote}
                    onChange={(e) => setClientNote(e.target.value)}
                    placeholder="#1048"
                    className="w-full px-3 py-2.5 text-sm bg-[#090d16] text-white placeholder:text-slate-500 border border-slate-700 rounded-xl focus:outline-none focus:border-emerald-400"
                  />
                </div>
                <div className="sm:col-span-2">
                  <button
                    type="submit"
                    disabled={saving}
                    className="w-full py-2.5 px-3 text-sm font-bold bg-emerald-400 hover:bg-emerald-300 active:scale-[0.99] text-slate-950 rounded-xl shadow-[0_0_20px_rgba(52,211,153,0.38)] transition-all cursor-pointer"
                  >
                    {saving ? '...' : isKg ? 'Сайтка кошуу' : 'На сайт'}
                  </button>
                </div>
              </form>
            </div>
          )}
        </div>
      </div>

      {/* Today's Recent Expenses Strip */}
      {todayExpenses.length > 0 && (
        <div className="bg-[#0e131f]/95 border border-slate-800/90 rounded-2xl overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-800/90 flex items-center justify-between bg-[#090d16]/60">
            <div className="flex items-center gap-2 text-xs font-semibold text-slate-200">
              <Clock className="w-3.5 h-3.5 text-cyan-400" />
              <span>{isKg ? 'Бүгүн жазылган акыркы чыгымдар' : 'Сегодняшние расходы'}</span>
            </div>
            <span className="text-xs font-mono text-slate-400 tabular-nums">
              {todayExpenses.length} {isKg ? 'жазуу' : 'зап.'}
            </span>
          </div>
          <div className="divide-y divide-slate-800/80">
            {todayExpenses.map((tx) => (
              <div
                key={tx.id}
                className="px-5 py-2.5 flex items-center justify-between gap-3 text-xs hover:bg-slate-800/40 transition-colors"
              >
                <div className="min-w-0 flex items-center gap-2">
                  <span
                    className={`font-semibold shrink-0 ${
                      tx.space === 'family' ? 'text-cyan-300' : 'text-fuchsia-300'
                    }`}
                  >
                    {tx.space === 'family' ? (isKg ? 'Үй-бүлө' : 'Семья') : 'Бизнес'}
                  </span>
                  <span className="text-slate-600">·</span>
                  <span className="font-semibold text-white truncate">{tx.category}</span>
                  {tx.description && (
                    <>
                      <span className="text-slate-600 hidden sm:inline">·</span>
                      <span className="text-slate-400 truncate hidden sm:inline">{tx.description}</span>
                    </>
                  )}
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-slate-400">
                    {tx.paymentMethod === 'cash' ? 'Нал' : 'MBank'}
                  </span>
                  <span className="font-mono font-semibold text-white tabular-nums">
                    {formatMoney(tx.amount, tx.currency)}
                  </span>
                  <button
                    type="button"
                    onClick={() => void onTransactionDeleted(tx)}
                    className="p-1 text-slate-500 hover:text-rose-400 transition-colors cursor-pointer"
                    title={isKg ? 'Өчүрүү' : 'Удалить'}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Bottom Side-by-Side Website Transfer Queues */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-stretch">
        {/* Queue 1: Client Payments → Website */}
        <div className="bg-[#0e131f]/95 border border-slate-800/90 rounded-2xl overflow-hidden flex flex-col">
          <div className="px-5 py-3.5 border-b border-slate-800/90 flex items-center justify-between gap-2 bg-[#090d16]/60">
            <h3 className="text-sm font-bold text-white">
              {isKg ? 'Клиенттен келген акча → Сайтка' : 'Оплаты клиентов → На сайт'}
            </h3>
            <div className="inline-flex p-0.5 bg-[#07090f] border border-slate-800 rounded-lg text-xs">
              <button
                type="button"
                onClick={() => setClientQueueFilter('pending')}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                  clientQueueFilter === 'pending' ? 'bg-emerald-400/20 text-emerald-300' : 'text-slate-400'
                }`}
              >
                {isKg ? 'Күтүүдө' : 'Ждут'}
              </button>
              <button
                type="button"
                onClick={() => setClientQueueFilter('synced')}
                className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                  clientQueueFilter === 'synced' ? 'bg-emerald-400/20 text-emerald-300' : 'text-slate-400'
                }`}
              >
                {isKg ? 'Сайтка түштү' : 'На сайте'}
              </button>
            </div>
          </div>

          <div className="divide-y divide-slate-800/80 flex-1 max-h-96 overflow-y-auto thin-scroll">
            {clientQueue.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                {isKg ? 'Тизме бош.' : 'Список пуст.'}
              </div>
            ) : (
              clientQueue.map((tx) => (
                <div key={tx.id} className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-slate-800/40 transition-colors">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-white truncate">{tx.merchant}</div>
                    <div className="text-xs text-slate-400">
                      {tx.date} · {tx.paymentMethod === 'cash' ? 'Нал' : 'MBank'}
                      {tx.clientContact ? ` · ${tx.clientContact}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="font-mono text-sm font-bold text-emerald-300 tabular-nums">
                      {formatMoney(tx.amount, tx.currency)}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        copyText(
                          tx.id,
                          `${tx.merchant} | ${tx.amount} ${tx.currency} | ${tx.date}${tx.clientContact ? ` | ${tx.clientContact}` : ''}`
                        )
                      }
                      className="p-1.5 text-slate-400 hover:text-cyan-300 cursor-pointer"
                      title={isKg ? 'Көчүрүү' : 'Копировать'}
                    >
                      {copiedId === tx.id ? (
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                    <button
                      type="button"
                      onClick={() => void toggleClientSiteStatus(tx)}
                      className={`px-2.5 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                        tx.siteSyncStatus === 'pending'
                          ? 'bg-emerald-400 hover:bg-emerald-300 text-slate-950'
                          : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                      }`}
                    >
                      {tx.siteSyncStatus === 'pending'
                        ? isKg
                          ? 'Сайтка түштү ✓'
                          : 'Внесено ✓'
                        : isKg
                          ? 'Кайтаруу'
                          : 'Вернуть'}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Queue 2: Business / Goods → Website */}
        <div className="bg-[#0e131f]/95 border border-slate-800/90 rounded-2xl overflow-hidden flex flex-col">
          <div className="px-5 py-3.5 border-b border-slate-800/90 flex items-center justify-between gap-2 bg-[#090d16]/60">
            <h3 className="text-sm font-bold text-white">
              {isKg ? 'Бизнес / Товар → Сайтка' : 'Бизнес / Товары → На сайт'}
            </h3>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={exportPendingGoodsCsv}
                className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-200 border border-slate-700 rounded-lg hover:border-cyan-400/60 hover:text-cyan-200 cursor-pointer"
              >
                <Download className="w-3 h-3" />
                <span>CSV</span>
              </button>
              <div className="inline-flex p-0.5 bg-[#07090f] border border-slate-800 rounded-lg text-xs">
                <button
                  type="button"
                  onClick={() => setGoodsQueueFilter('pending')}
                  className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                    goodsQueueFilter === 'pending' ? 'bg-fuchsia-500/25 text-fuchsia-200' : 'text-slate-400'
                  }`}
                >
                  {isKg ? 'Күтүүдө' : 'Ждут'}
                </button>
                <button
                  type="button"
                  onClick={() => setGoodsQueueFilter('uploaded')}
                  className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                    goodsQueueFilter === 'uploaded' ? 'bg-fuchsia-500/25 text-fuchsia-200' : 'text-slate-400'
                  }`}
                >
                  {isKg ? 'Сайтка кирди' : 'На сайте'}
                </button>
              </div>
            </div>
          </div>

          <div className="divide-y divide-slate-800/80 flex-1 max-h-96 overflow-y-auto thin-scroll">
            {goodsQueue.length === 0 ? (
              <div className="p-8 text-center text-xs text-slate-500">
                {isKg ? 'Товар жок.' : 'Товаров нет.'}
              </div>
            ) : (
              goodsQueue.map((g) => (
                <div key={g.id} className="px-5 py-3 flex items-center justify-between gap-3 hover:bg-slate-800/40 transition-colors">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-white truncate">
                      {g.productName}{' '}
                      {g.sku && <span className="font-mono text-xs text-slate-400">({g.sku})</span>}
                    </div>
                    <div className="text-xs text-slate-400 font-mono tabular-nums">
                      {g.quantity} {g.unit} × {formatMoney(g.unitCost, g.currency)}
                      {g.sellingPrice ? ` → ${formatMoney(g.sellingPrice, 'KGS')}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      onClick={() => void toggleGoodSiteStatus(g)}
                      className={`px-2.5 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap ${
                        g.siteStatus === 'pending'
                          ? 'bg-fuchsia-500 hover:bg-fuchsia-400 text-white'
                          : 'bg-slate-800 text-slate-300 hover:bg-slate-700'
                      }`}
                    >
                      {g.siteStatus === 'pending'
                        ? isKg
                          ? 'Сайтка кирди ✓'
                          : 'На сайте ✓'
                        : isKg
                          ? 'Кайтаруу'
                          : 'Вернуть'}
                    </button>
                    <button
                      type="button"
                      onClick={() => void api.deleteGood(g.id).then(() => onGoodDeleted(g.id))}
                      className="p-1.5 text-slate-500 hover:text-rose-400 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
