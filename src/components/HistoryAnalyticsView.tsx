import React, { useMemo, useState } from 'react';
import { Check, CheckCircle2, Copy, Download, Pencil, Search, Send, Trash2 } from 'lucide-react';
import { api } from '../api.ts';
import { convertFromKgs, formatMoney } from '../constants.ts';
import type { AppLang, CurrencyCode, MonthlyLimits, Transaction } from '../types.ts';

interface HistoryAnalyticsViewProps {
  lang: AppLang;
  transactions: Transaction[];
  displayCurrency: CurrencyCode;
  ratesToKgs: Record<CurrencyCode, number>;
  monthlyLimits: MonthlyLimits;
  onUpdateLimits: (payload: { familyMonthlyKgs: number; businessMonthlyKgs: number }) => Promise<void>;
  onEditTransaction: (tx: Transaction) => void;
  onDeleteTransaction: (tx: Transaction) => Promise<void>;
}

type PeriodKey = 'today' | '7d' | '30d' | 'all';

function escapeCsvCell(value: string | number | null | undefined): string {
  const str = String(value ?? '');
  const safe = /^[=+\-@\t\r]/.test(str) ? `'${str}` : str;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function HistoryAnalyticsView({
  lang,
  transactions,
  displayCurrency,
  ratesToKgs,
  monthlyLimits,
  onEditTransaction,
  onDeleteTransaction,
}: HistoryAnalyticsViewProps) {
  const isKg = lang === 'kg';
  const [period, setPeriod] = useState<PeriodKey>('30d');
  const [spaceFilter, setSpaceFilter] = useState<'all' | 'family' | 'business'>('all');
  const [methodFilter, setMethodFilter] = useState<'all' | 'cash' | 'cashless'>('all');
  const [search, setSearch] = useState('');
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [copiedSummary, setCopiedSummary] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const toDisplay = (kgs: number) => convertFromKgs(kgs, displayCurrency, ratesToKgs);

  async function handleDailySummary(mode: 'copy' | 'telegram') {
    setSummaryBusy(true);
    setNotice(null);
    try {
      const res = await api.sendTelegramDailySummary();
      if (mode === 'copy' || !res.sent) {
        await navigator.clipboard.writeText(res.summaryText);
        setCopiedSummary(true);
        setTimeout(() => setCopiedSummary(false), 1800);
        setNotice(
          isKg
            ? 'Күндүн отчёту көчүрүлдү — WhatsApp же Telegramга чаптай берсеңиз болот ✓'
            : 'Итоги дня скопированы в буфер обмена ✓'
        );
      } else {
        setNotice(isKg ? 'Күндүн жыйынтыгы Telegramга жөнөтүлдү ✓' : 'Итоги дня отправлены в Telegram ✓');
      }
    } catch {
      // ignore
    } finally {
      setSummaryBusy(false);
    }
  }

  const periodExpenses = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const now = Date.now();
    return transactions.filter((tx) => {
      if (tx.type !== 'expense') return false;
      if (tx.space === 'personal') return false;
      if (period === 'today') return tx.date === today;
      if (period === '7d') return (now - new Date(tx.date).getTime()) / 86400000 <= 7;
      if (period === '30d') return (now - new Date(tx.date).getTime()) / 86400000 <= 30;
      return true;
    });
  }, [transactions, period]);

  const summary = useMemo(() => {
    let famCash = 0;
    let famCashless = 0;
    let bizCash = 0;
    let bizCashless = 0;

    for (const tx of periodExpenses) {
      if (tx.space === 'family') {
        if (tx.paymentMethod === 'cash') famCash += tx.amountInKgs;
        else famCashless += tx.amountInKgs;
      } else if (tx.space === 'business') {
        if (tx.paymentMethod === 'cash') bizCash += tx.amountInKgs;
        else bizCashless += tx.amountInKgs;
      }
    }

    const famTotal = famCash + famCashless;
    const bizTotal = bizCash + bizCashless;
    const allTotal = famTotal + bizTotal;

    const currentMonth = new Date().toISOString().slice(0, 7);
    let monthFamKgs = 0;
    let monthBizKgs = 0;
    for (const tx of transactions) {
      if (tx.type !== 'expense' || !tx.date.startsWith(currentMonth)) continue;
      if (tx.space === 'family') monthFamKgs += tx.amountInKgs;
      else if (tx.space === 'business') monthBizKgs += tx.amountInKgs;
    }

    return {
      allTotal: toDisplay(allTotal),
      allCash: toDisplay(famCash + bizCash),
      allCashless: toDisplay(famCashless + bizCashless),
      famTotal: toDisplay(famTotal),
      famCash: toDisplay(famCash),
      famCashless: toDisplay(famCashless),
      bizTotal: toDisplay(bizTotal),
      bizCash: toDisplay(bizCash),
      bizCashless: toDisplay(bizCashless),
      famPct: allTotal > 0 ? (famTotal / allTotal) * 100 : 0,
      bizPct: allTotal > 0 ? (bizTotal / allTotal) * 100 : 0,
      famMonth: toDisplay(monthFamKgs),
      bizMonth: toDisplay(monthBizKgs),
      famLimit: monthlyLimits.familyMonthlyKgs > 0 ? toDisplay(monthlyLimits.familyMonthlyKgs) : 0,
      bizLimit: monthlyLimits.businessMonthlyKgs > 0 ? toDisplay(monthlyLimits.businessMonthlyKgs) : 0,
      famLimitPct:
        monthlyLimits.familyMonthlyKgs > 0
          ? (monthFamKgs / monthlyLimits.familyMonthlyKgs) * 100
          : null,
      bizLimitPct:
        monthlyLimits.businessMonthlyKgs > 0
          ? (monthBizKgs / monthlyLimits.businessMonthlyKgs) * 100
          : null,
    };
  }, [periodExpenses, transactions, monthlyLimits, displayCurrency, ratesToKgs]);

  const nomenclatureBreakdown = useMemo(() => {
    const build = (sp: 'family' | 'business') => {
      const map = new Map<string, number>();
      let total = 0;
      for (const tx of periodExpenses) {
        if (tx.space !== sp) continue;
        const val = toDisplay(tx.amountInKgs);
        map.set(tx.category, (map.get(tx.category) ?? 0) + val);
        total += val;
      }
      return Array.from(map.entries())
        .map(([category, amount]) => ({
          category,
          amount,
          pct: total > 0 ? (amount / total) * 100 : 0,
        }))
        .sort((a, b) => b.amount - a.amount);
    };
    return { family: build('family'), business: build('business') };
  }, [periodExpenses, displayCurrency, ratesToKgs]);

  const dailySeries = useMemo(() => {
    const days: { date: string; label: string; family: number; business: number; total: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const iso = d.toISOString().slice(0, 10);
      const label = `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;
      days.push({ date: iso, label, family: 0, business: 0, total: 0 });
    }
    const byDate = new Map(days.map((d) => [d.date, d]));
    for (const tx of transactions) {
      if (tx.type !== 'expense' || tx.space === 'personal') continue;
      const slot = byDate.get(tx.date);
      if (!slot) continue;
      const val = toDisplay(tx.amountInKgs);
      if (tx.space === 'family') slot.family += val;
      else if (tx.space === 'business') slot.business += val;
      slot.total = slot.family + slot.business;
    }
    const maxVal = Math.max(1, ...days.map((d) => d.total));
    return { days, maxVal };
  }, [transactions, displayCurrency, ratesToKgs]);

  const visibleList = useMemo(() => {
    const q = search.trim().toLowerCase();
    return periodExpenses.filter((tx) => {
      if (spaceFilter !== 'all' && tx.space !== spaceFilter) return false;
      if (methodFilter !== 'all' && tx.paymentMethod !== methodFilter) return false;
      if (q) {
        const hay = `${tx.merchant} ${tx.category} ${tx.description} ${tx.receiptRef ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [periodExpenses, spaceFilter, methodFilter, search]);

  function exportCsv() {
    const header = ['Дата', 'Бөлүм', 'Номенклатура', 'Төлөм', 'Сумма', 'Валюта', 'Комментарий'];
    const rows = visibleList.map((tx) => [
      tx.date,
      tx.space === 'family' ? 'Үй-бүлө' : 'Бизнес',
      tx.category,
      tx.paymentMethod === 'cash' ? 'Нал' : 'Безнал',
      tx.amount,
      tx.currency,
      tx.description || tx.merchant,
    ]);
    const csv = '\uFEFF' + [header, ...rows].map((r) => r.map(escapeCsvCell).join(';')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rashody-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-6">
      {/* Period Selector & Actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex p-1 bg-[#0e131f] border border-slate-800 rounded-xl">
          {(
            [
              ['today', isKg ? 'Бүгүн' : 'Сегодня'],
              ['7d', isKg ? '7 күн' : '7 дней'],
              ['30d', isKg ? '30 күн' : '30 дней'],
              ['all', isKg ? 'Баары' : 'Всё время'],
            ] as [PeriodKey, string][]
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setPeriod(key)}
              className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-colors cursor-pointer ${
                period === key
                  ? 'bg-cyan-400 text-slate-950 shadow-[0_0_14px_rgba(34,211,238,0.35)]'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={summaryBusy}
            onClick={() => void handleDailySummary('copy')}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-200 bg-[#0e131f] border border-slate-700 hover:border-cyan-400/50 rounded-xl transition-colors cursor-pointer"
          >
            {copiedSummary ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5 text-cyan-300" />}
            <span>{isKg ? 'Күндүн отчёту' : 'Итоги дня'}</span>
          </button>
          <button
            type="button"
            disabled={summaryBusy}
            onClick={() => void handleDailySummary('telegram')}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-slate-950 bg-cyan-400 hover:bg-cyan-300 rounded-xl shadow-[0_0_16px_rgba(34,211,238,0.3)] transition-colors cursor-pointer"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Telegram</span>
          </button>
          <button
            type="button"
            onClick={exportCsv}
            className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-200 bg-[#0e131f] border border-slate-700 hover:border-cyan-400/50 rounded-xl transition-colors cursor-pointer"
          >
            <Download className="w-3.5 h-3.5 text-fuchsia-300" />
            <span>Excel (CSV)</span>
          </button>
        </div>
      </div>

      {notice && (
        <div className="flex items-center gap-2 p-3.5 rounded-xl bg-emerald-500/15 border border-emerald-400/40 text-xs text-emerald-200">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
          <span>{notice}</span>
        </div>
      )}

      {/* 3-Card Expense-Only Summary */}
      <div className="bg-[#0e131f]/95 border border-slate-800/90 rounded-2xl grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-slate-800/90">
        <div className="p-5">
          <div className="text-xs font-medium text-slate-400">
            {isKg ? 'Жалпы чыгым (Үй-бүлө + Бизнес)' : 'Всего расходов (Семья + Бизнес)'}
          </div>
          <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-white">
            {formatMoney(summary.allTotal, displayCurrency)}
          </div>
          <div className="mt-1.5 text-xs font-mono text-slate-400 tabular-nums">
            Нал {formatMoney(summary.allCash, displayCurrency)} · Безнал{' '}
            {formatMoney(summary.allCashless, displayCurrency)}
          </div>
        </div>

        <div className="p-5">
          <div className="text-xs font-medium text-slate-400">
            {isKg ? 'Үй-бүлөлүк чыгым' : 'Семейные расходы'} ({summary.famPct.toFixed(0)}%)
          </div>
          <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-cyan-300">
            {formatMoney(summary.famTotal, displayCurrency)}
          </div>
          <div className="mt-1.5 text-xs font-mono text-slate-400 tabular-nums">
            Нал {formatMoney(summary.famCash, displayCurrency)} · Безнал{' '}
            {formatMoney(summary.famCashless, displayCurrency)}
          </div>
          {summary.famLimitPct !== null && (
            <div className="mt-2.5 pt-2 border-t border-slate-800 text-[11px] font-mono tabular-nums flex items-center justify-between">
              <span className="text-slate-400">
                {isKg ? 'Айлык лимит:' : 'Лимит/мес:'} {formatMoney(summary.famMonth, displayCurrency)} /{' '}
                {formatMoney(summary.famLimit, displayCurrency)}
              </span>
              <span
                className={`font-semibold ${
                  summary.famLimitPct >= 100
                    ? 'text-rose-400'
                    : summary.famLimitPct >= 80
                      ? 'text-amber-300'
                      : 'text-cyan-300'
                }`}
              >
                {summary.famLimitPct.toFixed(0)}%
              </span>
            </div>
          )}
        </div>

        <div className="p-5">
          <div className="text-xs font-medium text-slate-400">
            {isKg ? 'Бизнес чыгымы' : 'Бизнес-расходы'} ({summary.bizPct.toFixed(0)}%)
          </div>
          <div className="mt-1.5 text-2xl font-bold font-mono tabular-nums text-fuchsia-300">
            {formatMoney(summary.bizTotal, displayCurrency)}
          </div>
          <div className="mt-1.5 text-xs font-mono text-slate-400 tabular-nums">
            Нал {formatMoney(summary.bizCash, displayCurrency)} · Безнал{' '}
            {formatMoney(summary.bizCashless, displayCurrency)}
          </div>
          {summary.bizLimitPct !== null && (
            <div className="mt-2.5 pt-2 border-t border-slate-800 text-[11px] font-mono tabular-nums flex items-center justify-between">
              <span className="text-slate-400">
                {isKg ? 'Айлык лимит:' : 'Лимит/мес:'} {formatMoney(summary.bizMonth, displayCurrency)} /{' '}
                {formatMoney(summary.bizLimit, displayCurrency)}
              </span>
              <span
                className={`font-semibold ${
                  summary.bizLimitPct >= 100
                    ? 'text-rose-400'
                    : summary.bizLimitPct >= 80
                      ? 'text-amber-300'
                      : 'text-fuchsia-300'
                }`}
              >
                {summary.bizLimitPct.toFixed(0)}%
              </span>
            </div>
          )}
        </div>
      </div>

      {/* 7-Day Daily Expense Visual Chart (Neon Cyan vs Neon Fuchsia) */}
      <div className="bg-[#0e131f]/95 border border-slate-800/90 rounded-2xl p-5">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <h3 className="text-sm font-semibold text-white">
            {isKg ? 'Акыркы 7 күндүн чыгым динамикасы' : 'Динамика расходов за 7 дней'}
          </h3>
          <div className="flex items-center gap-4 text-xs text-slate-400">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.8)] inline-block" />
              {isKg ? 'Үй-бүлө' : 'Семья'}
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-xs bg-fuchsia-500 shadow-[0_0_8px_rgba(217,70,239,0.8)] inline-block" />
              Бизнес
            </span>
          </div>
        </div>

        <div className="grid grid-cols-7 gap-2 sm:gap-4 items-end h-36 pt-4">
          {dailySeries.days.map((day) => {
            const famH = Math.round((day.family / dailySeries.maxVal) * 100);
            const bizH = Math.round((day.business / dailySeries.maxVal) * 100);
            return (
              <div key={day.date} className="h-full flex flex-col items-center justify-end gap-1.5">
                <span className="text-[10px] font-mono tabular-nums text-slate-400 truncate max-w-full">
                  {day.total > 0 ? Math.round(day.total).toLocaleString('ru-RU') : '0'}
                </span>
                <div className="w-full max-w-[36px] flex-1 flex flex-col justify-end gap-0.5">
                  {day.business > 0 && (
                    <div
                      className="w-full bg-fuchsia-500 shadow-[0_0_12px_rgba(217,70,239,0.45)] rounded-t-md transition-all"
                      style={{ height: `${Math.max(6, bizH)}%` }}
                      title={`Бизнес: ${formatMoney(day.business, displayCurrency)}`}
                    />
                  )}
                  {day.family > 0 && (
                    <div
                      className={`w-full bg-cyan-400 shadow-[0_0_12px_rgba(34,211,238,0.45)] transition-all ${
                        day.business > 0 ? 'rounded-b-md' : 'rounded-md'
                      }`}
                      style={{ height: `${Math.max(6, famH)}%` }}
                      title={`${isKg ? 'Үй-бүлө' : 'Семья'}: ${formatMoney(day.family, displayCurrency)}`}
                    />
                  )}
                  {day.total === 0 && <div className="w-full h-1 bg-slate-800 rounded-full" />}
                </div>
                <span className="text-[11px] font-mono text-slate-400">{day.label}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Nomenclature Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {(
          [
            [
              'family',
              isKg ? 'Үй-бүлө чыгымдары (номенклатура боюнча)' : 'Семейные расходы по статьям',
              'bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.65)]',
            ],
            [
              'business',
              isKg ? 'Бизнес чыгымдары (номенклатура боюнча)' : 'Бизнес-расходы по номенклатуре',
              'bg-fuchsia-500 shadow-[0_0_10px_rgba(217,70,239,0.65)]',
            ],
          ] as const
        ).map(([key, title, barColor]) => (
          <div key={key} className="bg-[#0e131f]/95 border border-slate-800/90 rounded-2xl p-5 space-y-3.5">
            <h3 className="text-sm font-semibold text-white">{title}</h3>
            {nomenclatureBreakdown[key].length === 0 ? (
              <div className="py-4 text-xs text-slate-500">{isKg ? 'Чыгым жок' : 'Нет расходов'}</div>
            ) : (
              <div className="space-y-3 max-h-72 overflow-y-auto thin-scroll pr-1">
                {nomenclatureBreakdown[key].map((item) => (
                  <div key={item.category}>
                    <div className="flex items-baseline justify-between gap-2 text-xs">
                      <span className="text-slate-200 truncate">{item.category}</span>
                      <span className="font-mono tabular-nums text-white shrink-0">
                        {formatMoney(item.amount, displayCurrency)}{' '}
                        <span className="text-slate-400">({item.pct.toFixed(0)}%)</span>
                      </span>
                    </div>
                    <div className="mt-1 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${barColor}`}
                        style={{ width: `${Math.min(100, Math.max(3, item.pct))}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Expense History Table */}
      <div className="bg-[#0e131f]/95 border border-slate-800/90 rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-slate-800/90 flex flex-wrap items-center gap-3 bg-[#090d16]/60">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={isKg ? 'Чыгымдардан издөө...' : 'Поиск по расходам...'}
              className="w-full pl-9 pr-3 py-1.5 text-sm bg-[#090d16] text-white placeholder:text-slate-500 border border-slate-700 rounded-xl focus:outline-none focus:border-cyan-400"
            />
          </div>

          <select
            value={spaceFilter}
            onChange={(e) => setSpaceFilter(e.target.value as 'all' | 'family' | 'business')}
            className="px-3 py-1.5 text-xs bg-[#090d16] text-slate-200 border border-slate-700 rounded-xl"
          >
            <option value="all">{isKg ? 'Үй-бүлө + Бизнес' : 'Семья + Бизнес'}</option>
            <option value="family">{isKg ? 'Үй-бүлө гана' : 'Только семья'}</option>
            <option value="business">{isKg ? 'Бизнес гана' : 'Только бизнес'}</option>
          </select>

          <select
            value={methodFilter}
            onChange={(e) => setMethodFilter(e.target.value as 'all' | 'cash' | 'cashless')}
            className="px-3 py-1.5 text-xs bg-[#090d16] text-slate-200 border border-slate-700 rounded-xl"
          >
            <option value="all">Нал + Безнал</option>
            <option value="cash">{isKg ? 'Накталай гана' : 'Только наличные'}</option>
            <option value="cashless">{isKg ? 'Безнал гана' : 'Только безнал'}</option>
          </select>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 bg-[#090d16]/80 text-xs text-slate-400">
                <th className="text-left font-medium px-5 py-3">Дата</th>
                <th className="text-left font-medium px-3 py-3">{isKg ? 'Бөлүм' : 'Раздел'}</th>
                <th className="text-left font-medium px-3 py-3">{isKg ? 'Номенклатура / Эскертүү' : 'Статья / Описание'}</th>
                <th className="text-left font-medium px-3 py-3">{isKg ? 'Төлөм' : 'Оплата'}</th>
                <th className="text-right font-medium px-5 py-3">Сумма</th>
                <th className="text-right font-medium px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {visibleList.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-5 py-10 text-center text-sm text-slate-500">
                    {isKg ? 'Чыгым табылган жок.' : 'Расходов нет.'}
                  </td>
                </tr>
              ) : (
                visibleList.map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-800/40 transition-colors">
                    <td className="px-5 py-3 font-mono text-xs text-slate-400 whitespace-nowrap">
                      {tx.date}
                    </td>
                    <td className="px-3 py-3 text-xs font-semibold whitespace-nowrap">
                      <span className={tx.space === 'family' ? 'text-cyan-300' : 'text-fuchsia-300'}>
                        {tx.space === 'family' ? (isKg ? 'Үй-бүлө' : 'Семья') : 'Бизнес'}
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <div className="font-medium text-white">{tx.category}</div>
                      {(tx.description || (tx.merchant && tx.merchant !== tx.category)) && (
                        <div className="text-xs text-slate-400">
                          {tx.merchant !== tx.category ? tx.merchant : ''}
                          {tx.merchant !== tx.category && tx.description ? ' · ' : ''}
                          {tx.description}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-400 whitespace-nowrap">
                      {tx.paymentMethod === 'cash' ? (isKg ? 'Накталай' : 'Наличные') : tx.paymentSource}
                    </td>
                    <td className="px-5 py-3 text-right font-mono font-semibold tabular-nums text-white whitespace-nowrap">
                      {formatMoney(tx.amount, tx.currency)}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => onEditTransaction(tx)}
                        className="p-1.5 text-slate-400 hover:text-cyan-300 cursor-pointer"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void onDeleteTransaction(tx)}
                        className="p-1.5 text-slate-400 hover:text-rose-400 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
