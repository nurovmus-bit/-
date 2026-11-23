import React, { useEffect, useMemo, useState } from 'react';
import { X } from 'lucide-react';
import { CURRENCIES } from '../constants.ts';
import type {
  AppLang,
  CatalogItem,
  CurrencyCode,
  LedgerSpace,
  PaymentMethod,
  SiteSyncStatus,
  Transaction,
  TransactionType,
} from '../types.ts';

interface TransactionModalProps {
  open: boolean;
  lang: AppLang;
  familyNomenclature: CatalogItem[];
  businessNomenclature: CatalogItem[];
  onClose: () => void;
  editing?: Transaction | null;
  onSubmit: (payload: {
    id?: string;
    space: LedgerSpace;
    type: TransactionType;
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
  }) => Promise<void>;
}

export function TransactionModal({
  open,
  lang,
  familyNomenclature,
  businessNomenclature,
  onClose,
  editing,
  onSubmit,
}: TransactionModalProps) {
  const isKg = lang === 'kg';
  const [space, setSpace] = useState<'family' | 'business'>(
    editing?.space === 'business' ? 'business' : 'family'
  );
  const [type, setType] = useState<TransactionType>(editing?.type ?? 'expense');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>(editing?.paymentMethod ?? 'cash');
  const [siteSyncStatus, setSiteSyncStatus] = useState<SiteSyncStatus>(
    editing?.siteSyncStatus ?? 'not_applicable'
  );
  const [amount, setAmount] = useState<string>(editing ? String(editing.amount) : '');
  const [currency, setCurrency] = useState<CurrencyCode>(editing?.currency ?? 'KGS');
  const [category, setCategory] = useState<string>(editing?.category ?? '');
  const [merchant, setMerchant] = useState<string>(editing?.merchant ?? '');
  const [description, setDescription] = useState<string>(editing?.description ?? '');
  const [date, setDate] = useState<string>(editing?.date ?? new Date().toISOString().slice(0, 10));
  const [receiptRef, setReceiptRef] = useState<string>(editing?.receiptRef ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const liveCategories = useMemo(() => {
    const list = space === 'family' ? familyNomenclature : businessNomenclature;
    return list.map((i) => i.name);
  }, [space, familyNomenclature, businessNomenclature]);

  useEffect(() => {
    if (!open) return;
    const sp: 'family' | 'business' = editing?.space === 'business' ? 'business' : 'family';
    const tp: TransactionType = editing?.type ?? 'expense';
    const fallbackList = sp === 'family' ? familyNomenclature : businessNomenclature;
    setSpace(sp);
    setType(tp);
    setPaymentMethod(editing?.paymentMethod ?? 'cash');
    setSiteSyncStatus(editing?.siteSyncStatus ?? 'not_applicable');
    setAmount(editing ? String(editing.amount) : '');
    setCurrency(editing?.currency ?? 'KGS');
    setCategory(editing?.category ?? fallbackList[0]?.name ?? '');
    setMerchant(editing?.merchant ?? '');
    setDescription(editing?.description ?? '');
    setDate(editing?.date ?? new Date().toISOString().slice(0, 10));
    setReceiptRef(editing?.receiptRef ?? '');
    setError(null);
  }, [open, editing, familyNomenclature, businessNomenclature]);

  if (!open) return null;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const numericAmount = Number(amount.replace(',', '.'));
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      setError(isKg ? 'Сумманы туура жазыңыз' : 'Введите корректную сумму');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await onSubmit({
        id: editing?.id,
        space,
        type,
        paymentMethod,
        siteSyncStatus: space === 'business' && type === 'income' ? siteSyncStatus : 'not_applicable',
        amount: Math.round(numericAmount * 100) / 100,
        currency,
        category: category || liveCategories[0] || 'Чыгым',
        projectId: null,
        merchant: merchant.trim() || category,
        description: description.trim(),
        paymentSource: paymentMethod === 'cash' ? 'Наличные' : 'MBank',
        date,
        receiptRef: receiptRef.trim() || null,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-[#0e131f] border border-cyan-500/30 rounded-2xl shadow-[0_0_45px_rgba(34,211,238,0.16)] w-full max-w-md max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <h3 className="text-base font-semibold text-white">
            {isKg ? 'Чыгымды оңдоо' : 'Редактировать расход'}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSave} className="p-5 space-y-4">
          {type === 'expense' && (
            <div className="grid grid-cols-2 gap-1 p-1 bg-[#07090f] border border-slate-800 rounded-xl text-xs">
              <button
                type="button"
                onClick={() => {
                  setSpace('family');
                  if (familyNomenclature[0]) setCategory(familyNomenclature[0].name);
                }}
                className={`py-1.5 rounded-lg font-semibold cursor-pointer ${
                  space === 'family' ? 'bg-cyan-400 text-slate-950' : 'text-slate-400 hover:text-white'
                }`}
              >
                {isKg ? 'Үй-бүлө (8)' : 'Семья (8)'}
              </button>
              <button
                type="button"
                onClick={() => {
                  setSpace('business');
                  if (businessNomenclature[0]) setCategory(businessNomenclature[0].name);
                }}
                className={`py-1.5 rounded-lg font-semibold cursor-pointer ${
                  space === 'business' ? 'bg-fuchsia-500 text-white' : 'text-slate-400 hover:text-white'
                }`}
              >
                {isKg ? 'Бизнес · Товар (30)' : 'Бизнес · Товары (30)'}
              </button>
            </div>
          )}

          <div className="grid grid-cols-3 gap-2.5">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Сумма</label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full px-3 py-2 text-sm font-mono bg-[#090d16] text-cyan-200 border border-slate-700 rounded-xl"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Валюта</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
                className="w-full px-2.5 py-2 text-sm bg-[#090d16] text-slate-100 border border-slate-700 rounded-xl"
              >
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">Дата</label>
              <input
                type="date"
                required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full px-2.5 py-2 text-xs font-mono bg-[#090d16] text-slate-100 border border-slate-700 rounded-xl"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                {isKg ? 'Номенклатура (Базадан)' : 'Номенклатура (из Базы)'}
              </label>
              <select
                value={liveCategories.includes(category) ? category : '__custom'}
                onChange={(e) => {
                  if (e.target.value !== '__custom') setCategory(e.target.value);
                }}
                className="w-full px-2.5 py-2 text-xs bg-[#090d16] text-slate-100 border border-slate-700 rounded-xl"
              >
                {liveCategories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
                {!liveCategories.includes(category) && category && (
                  <option value="__custom">{category}</option>
                )}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                {isKg ? 'Төлөм түрү' : 'Способ оплаты'}
              </label>
              <div className="grid grid-cols-2 gap-1 p-1 bg-[#07090f] border border-slate-800 rounded-xl text-xs">
                <button
                  type="button"
                  onClick={() => setPaymentMethod('cash')}
                  className={`py-1.5 rounded-lg font-medium cursor-pointer ${
                    paymentMethod === 'cash' ? 'bg-cyan-400/20 text-cyan-200' : 'text-slate-400'
                  }`}
                >
                  Нал
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMethod('cashless')}
                  className={`py-1.5 rounded-lg font-medium cursor-pointer ${
                    paymentMethod === 'cashless' ? 'bg-cyan-400/20 text-cyan-200' : 'text-slate-400'
                  }`}
                >
                  MBank
                </button>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">Комментарий</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3 py-2 text-sm bg-[#090d16] text-white border border-slate-700 rounded-xl"
            />
          </div>

          {error && (
            <div className="p-2.5 rounded-xl bg-rose-500/15 border border-rose-500/45 text-xs text-rose-200">
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-xl cursor-pointer"
            >
              {isKg ? 'Жабуу' : 'Отмена'}
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-5 py-2 text-xs font-bold text-slate-950 bg-cyan-400 hover:bg-cyan-300 rounded-xl shadow-[0_0_16px_rgba(34,211,238,0.3)] cursor-pointer"
            >
              {saving ? '...' : isKg ? 'Сактоо' : 'Сохранить'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
