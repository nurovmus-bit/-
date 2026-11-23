import React, { useEffect, useMemo, useState } from 'react';
import {
  CheckCircle2,
  ClipboardList,
  Database,
  Plus,
  Save,
  Search,
  Trash2,
} from 'lucide-react';
import { api } from '../api.ts';
import type { AppLang, CatalogItem, CatalogKind } from '../types.ts';

interface CatalogBaseViewProps {
  lang: AppLang;
  clients: CatalogItem[];
  businessExpenses: CatalogItem[];
  familyExpenses: CatalogItem[];
  onRefresh: () => Promise<void>;
}

interface DraftRow {
  id: string;
  name: string;
  phone: string;
}

export function CatalogBaseView({
  lang,
  clients,
  businessExpenses,
  familyExpenses,
  onRefresh,
}: CatalogBaseViewProps) {
  const isKg = lang === 'kg';
  const [activeKind, setActiveKind] = useState<CatalogKind>('business_expense');
  const [search, setSearch] = useState('');

  const [drafts, setDrafts] = useState<DraftRow[]>([]);
  const [dirty, setDirty] = useState(false);

  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');

  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState('');

  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sourceList = useMemo(() => {
    if (activeKind === 'client') return clients;
    if (activeKind === 'business_expense') return businessExpenses;
    return familyExpenses;
  }, [activeKind, clients, businessExpenses, familyExpenses]);

  useEffect(() => {
    setDrafts(sourceList.map((i) => ({ id: i.id, name: i.name, phone: i.phone })));
    setDirty(false);
    setBulkOpen(false);
    setError(null);
  }, [sourceList, activeKind]);

  const filteredDrafts = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return drafts.map((d, idx) => ({ ...d, idx }));
    return drafts
      .map((d, idx) => ({ ...d, idx }))
      .filter((d) => d.name.toLowerCase().includes(q) || d.phone.toLowerCase().includes(q));
  }, [drafts, search]);

  function handleDraftChange(id: string, field: 'name' | 'phone', value: string) {
    setDrafts((prev) => prev.map((row) => (row.id === id ? { ...row, [field]: value } : row)));
    setDirty(true);
    setNotice(null);
  }

  async function handleSaveAllManual() {
    const validRows = drafts
      .map((r) => ({ name: r.name.trim(), phone: r.phone.trim() }))
      .filter((r) => r.name.length > 0);
    if (validRows.length === 0) {
      setError(isKg ? 'Жок дегенде 1 аталыш болушу керек' : 'Нужно хотя бы 1 название');
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.replaceCatalogList(activeKind, validRows);
      await onRefresh();
      setDirty(false);
      setNotice(
        isKg
          ? `База сакталды (${validRows.length} жазуу) ✓`
          : `База сохранена (${validRows.length} записей) ✓`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения');
    } finally {
      setBusy(false);
    }
  }

  async function handleAddRow(e: React.FormEvent) {
    e.preventDefault();
    if (!newName.trim()) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.createCatalogItem({
        kind: activeKind,
        name: newName.trim(),
        phone: activeKind === 'client' ? newPhone.trim() : '',
      });
      setNewName('');
      setNewPhone('');
      await onRefresh();
      setNotice(isKg ? 'Жаңы жазуу кошулду ✓' : 'Новая запись добавлена ✓');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка добавления');
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteRow(id: string) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.deleteCatalogItem(id);
      await onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка удаления');
    } finally {
      setBusy(false);
    }
  }

  function openBulkReplace() {
    const lines = drafts.map((d) =>
      activeKind === 'client' && d.phone ? `${d.name} | ${d.phone}` : d.name
    );
    setBulkText(lines.join('\n'));
    setBulkOpen(true);
  }

  async function handleApplyBulkReplace(e: React.FormEvent) {
    e.preventDefault();
    const lines = bulkText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const parsed = lines
      .map((line) => {
        const cleanLine = line.replace(/^\d+[.)]\s*/, '');
        if (activeKind === 'client' && cleanLine.includes('|')) {
          const [n, p] = cleanLine.split('|');
          return { name: (n ?? '').trim(), phone: (p ?? '').trim() };
        }
        return { name: cleanLine.trim(), phone: '' };
      })
      .filter((x) => x.name.length > 0);

    if (parsed.length === 0) {
      setError(isKg ? 'Тизме бош болбошу керек' : 'Список не должен быть пустым');
      return;
    }

    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await api.replaceCatalogList(activeKind, parsed);
      await onRefresh();
      setBulkOpen(false);
      setNotice(
        isKg
          ? `Бүт тизме алмаштырылды (${parsed.length} жазуу) ✓`
          : `Весь список заменён (${parsed.length} записей) ✓`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения списка');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-4 border-b border-slate-800">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-400/15 border border-cyan-400/40 text-cyan-300 flex items-center justify-center shrink-0">
            <Database className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-white">
              {isKg ? 'Номенклатуралар жана Клиенттер базасы' : 'База номенклатур и клиентов'}
            </h2>
            <p className="mt-0.5 text-sm text-slate-400">
              {isKg
                ? 'Каалаган сапты басып кол менен өзгөртүңүз да «Сактоо» баскычын басыңыз — Күндөлүктө дароо жаңырат.'
                : 'Редактируйте любые названия прямо в таблице или замените весь список целиком.'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => (bulkOpen ? setBulkOpen(false) : openBulkReplace())}
            className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-200 bg-[#0e131f] border border-slate-700 hover:border-cyan-400/50 rounded-xl cursor-pointer"
          >
            <ClipboardList className="w-3.5 h-3.5 text-cyan-300" />
            <span>
              {bulkOpen
                ? isKg
                  ? 'Таблицага кайтуу'
                  : 'К таблице'
                : isKg
                  ? 'Тизме менен алмаштыруу'
                  : 'Заменить списком'}
            </span>
          </button>

          {!bulkOpen && (
            <button
              type="button"
              disabled={busy || !dirty}
              onClick={() => void handleSaveAllManual()}
              className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold bg-cyan-400 hover:bg-cyan-300 disabled:opacity-40 text-slate-950 rounded-xl shadow-[0_0_16px_rgba(34,211,238,0.3)] cursor-pointer"
            >
              <Save className="w-3.5 h-3.5" />
              <span>
                {busy
                  ? '...'
                  : isKg
                    ? 'Өзгөртүүлөрдү сактоо'
                    : 'Сохранить изменения'}
              </span>
            </button>
          )}
        </div>
      </div>

      {notice && (
        <div className="flex items-center gap-2 p-3.5 rounded-xl bg-emerald-500/15 border border-emerald-400/40 text-sm text-emerald-200">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
          <span>{notice}</span>
        </div>
      )}
      {error && (
        <div className="p-3.5 rounded-xl bg-rose-500/15 border border-rose-500/45 text-sm text-rose-200">
          {error}
        </div>
      )}

      {/* 3 Base Tabs */}
      <div className="bg-[#0e131f]/95 border border-slate-800/90 rounded-2xl overflow-hidden">
        <div className="px-5 py-3.5 border-b border-slate-800/90 flex flex-wrap items-center justify-between gap-3 bg-[#090d16]/70">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => {
                setActiveKind('business_expense');
                setSearch('');
              }}
              className={`px-3.5 py-2 text-xs font-semibold rounded-xl border cursor-pointer transition-all ${
                activeKind === 'business_expense'
                  ? 'bg-fuchsia-500 text-white border-fuchsia-400 shadow-[0_0_16px_rgba(217,70,239,0.4)]'
                  : 'bg-[#0e131f] text-slate-300 border-slate-700 hover:border-fuchsia-400/50'
              }`}
            >
              {isKg
                ? `Бизнес · Товар (${businessExpenses.length})`
                : `Бизнес · Товары (${businessExpenses.length})`}
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveKind('family_expense');
                setSearch('');
              }}
              className={`px-3.5 py-2 text-xs font-semibold rounded-xl border cursor-pointer transition-all ${
                activeKind === 'family_expense'
                  ? 'bg-cyan-400 text-slate-950 border-cyan-300 shadow-[0_0_16px_rgba(34,211,238,0.4)]'
                  : 'bg-[#0e131f] text-slate-300 border-slate-700 hover:border-cyan-400/50'
              }`}
            >
              {isKg
                ? `Үй-бүлө номенклатура (${familyExpenses.length})`
                : `Семья (${familyExpenses.length})`}
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveKind('client');
                setSearch('');
              }}
              className={`px-3.5 py-2 text-xs font-semibold rounded-xl border cursor-pointer transition-all ${
                activeKind === 'client'
                  ? 'bg-emerald-400 text-slate-950 border-emerald-300 shadow-[0_0_16px_rgba(52,211,153,0.4)]'
                  : 'bg-[#0e131f] text-slate-300 border-slate-700 hover:border-emerald-400/50'
              }`}
            >
              {isKg ? `Клиенттер (${clients.length})` : `Клиенты (${clients.length})`}
            </button>
          </div>

          {!bulkOpen && (
            <div className="relative w-full sm:w-64">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={isKg ? 'Базадан издөө...' : 'Поиск по базе...'}
                className="w-full pl-8 pr-3 py-1.5 text-xs bg-[#090d16] text-white placeholder:text-slate-500 border border-slate-700 rounded-xl focus:outline-none focus:border-cyan-400"
              />
            </div>
          )}
        </div>

        {bulkOpen ? (
          <form onSubmit={handleApplyBulkReplace} className="p-5 space-y-3.5">
            <div className="text-xs text-slate-400">
              {activeKind === 'client'
                ? isKg
                  ? 'Ар бир сапка бир клиент жазыңыз (телефон кошкуңуз келсе «|» белгиси менен бөлүңүз, мисалы: Азамат | +996 555 112233):'
                  : 'По одному клиенту на строку (телефон можно указать через «|», например: Азамат | +996 555 112233):'
                : isKg
                  ? 'Ар бир сапка бир номенклатура жазып же Excel/WhatsAppтан көчүрүп чаптаңыз:'
                  : 'Введите по одной статье на строку или вставьте готовый список из Excel/заметок:'}
            </div>
            <textarea
              rows={14}
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              className="w-full p-3.5 text-sm font-mono leading-relaxed bg-[#090d16] text-slate-100 border border-slate-700 rounded-xl focus:outline-none focus:border-cyan-400"
            />
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs text-slate-400">
                {bulkText
                  .split(/\r?\n/)
                  .map((s) => s.trim())
                  .filter(Boolean).length}{' '}
                {isKg ? 'сап' : 'строк'}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setBulkOpen(false)}
                  className="px-4 py-2 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-xl cursor-pointer"
                >
                  {isKg ? 'Жабуу' : 'Отмена'}
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-5 py-2 text-xs font-bold bg-cyan-400 hover:bg-cyan-300 text-slate-950 rounded-xl shadow-[0_0_16px_rgba(34,211,238,0.3)] cursor-pointer"
                >
                  {busy
                    ? '...'
                    : isKg
                      ? 'Бүт тизмени алмаштыруу'
                      : 'Заменить весь список'}
                </button>
              </div>
            </div>
          </form>
        ) : (
          <div>
            {/* Quick Add Row */}
            <form
              onSubmit={handleAddRow}
              className="px-5 py-3.5 border-b border-slate-800 flex flex-wrap items-center gap-2.5 bg-[#090d16]/40"
            >
              <input
                type="text"
                required
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder={
                  activeKind === 'client'
                    ? isKg
                      ? 'Жаңы клиент кошуу...'
                      : 'Добавить нового клиента...'
                    : isKg
                      ? 'Жаңы номенклатура кошуу...'
                      : 'Добавить новую номенклатуру...'
                }
                className="flex-1 min-w-[200px] px-3 py-2 text-sm bg-[#090d16] text-white placeholder:text-slate-500 border border-slate-700 rounded-xl focus:outline-none focus:border-cyan-400"
              />
              {activeKind === 'client' && (
                <input
                  type="text"
                  value={newPhone}
                  onChange={(e) => setNewPhone(e.target.value)}
                  placeholder="+996 ..."
                  className="w-44 px-3 py-2 text-sm font-mono bg-[#090d16] text-white placeholder:text-slate-500 border border-slate-700 rounded-xl focus:outline-none focus:border-emerald-400"
                />
              )}
              <button
                type="submit"
                disabled={busy}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold bg-cyan-400 hover:bg-cyan-300 text-slate-950 rounded-xl cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>{isKg ? 'Кошуу' : 'Добавить'}</span>
              </button>
            </form>

            {/* Editable Rows Grid */}
            <div
              className={
                activeKind === 'client'
                  ? 'divide-y divide-slate-800/80'
                  : 'p-4 grid grid-cols-1 md:grid-cols-2 gap-2.5'
              }
            >
              {filteredDrafts.length === 0 ? (
                <div className="col-span-full p-8 text-center text-sm text-slate-500">
                  {isKg ? 'Эч нерсе табылган жок.' : 'Ничего не найдено.'}
                </div>
              ) : (
                filteredDrafts.map((row) => (
                  <div
                    key={row.id}
                    className={
                      activeKind === 'client'
                        ? 'px-5 py-2.5 flex items-center gap-3 hover:bg-slate-800/40'
                        : 'flex items-center gap-2.5 p-1.5 rounded-xl bg-[#090d16] border border-slate-800 hover:border-slate-700 transition-colors'
                    }
                  >
                    <span className="w-7 text-right text-xs font-mono text-cyan-400/70 shrink-0 tabular-nums">
                      {row.idx + 1}.
                    </span>
                    <input
                      type="text"
                      value={row.name}
                      onChange={(e) => handleDraftChange(row.id, 'name', e.target.value)}
                      className="flex-1 min-w-0 px-3 py-1.5 text-sm text-white bg-[#0e131f] border border-slate-700/80 hover:border-slate-600 focus:border-cyan-400 rounded-lg focus:outline-none"
                    />
                    {activeKind === 'client' && (
                      <input
                        type="text"
                        value={row.phone}
                        onChange={(e) => handleDraftChange(row.id, 'phone', e.target.value)}
                        placeholder="+996 ..."
                        className="w-36 sm:w-44 px-3 py-1.5 text-xs font-mono text-emerald-200 bg-[#0e131f] border border-slate-700/80 hover:border-slate-600 focus:border-emerald-400 rounded-lg focus:outline-none"
                      />
                    )}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void handleDeleteRow(row.id)}
                      className="p-1.5 text-slate-500 hover:text-rose-400 transition-colors cursor-pointer shrink-0"
                      title={isKg ? 'Өчүрүү' : 'Удалить'}
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))
              )}
            </div>

            {dirty && (
              <div className="sticky bottom-16 md:bottom-0 px-5 py-3.5 border-t border-cyan-400/40 bg-[#090d16]/95 backdrop-blur-md flex items-center justify-between gap-3">
                <span className="text-xs font-semibold text-cyan-200">
                  {isKg
                    ? 'Сактала элек өзгөртүүлөр бар'
                    : 'Есть несохранённые изменения'}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void handleSaveAllManual()}
                  className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold bg-cyan-400 hover:bg-cyan-300 text-slate-950 rounded-xl cursor-pointer shadow-[0_0_18px_rgba(34,211,238,0.4)]"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{busy ? '...' : isKg ? 'Баарын сактоо' : 'Сохранить всё'}</span>
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
