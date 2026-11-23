import React, { useEffect, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  RefreshCw,
  Send,
  ShieldCheck,
  Webhook,
} from 'lucide-react';
import { api } from '../api.ts';
import type {
  AppLang,
  TelegramConfig,
  TelegramDefaultMode,
  TelegramInboxItem,
  UserRole,
} from '../types.ts';

interface TelegramBotViewProps {
  lang: AppLang;
  userRole: UserRole;
  inbox: TelegramInboxItem[];
  onRefreshInbox: () => void;
}

export function TelegramBotView({ lang, userRole, inbox, onRefreshInbox }: TelegramBotViewProps) {
  const isKg = lang === 'kg';
  const canConfigure = userRole === 'owner' || userRole === 'admin';

  const [config, setConfig] = useState<TelegramConfig | null>(null);
  const [chatIdsText, setChatIdsText] = useState('');
  const [defaultMode, setDefaultMode] = useState<TelegramDefaultMode>('family_expense');
  const [autoReply, setAutoReply] = useState(true);
  const [dailyChatId, setDailyChatId] = useState('');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activating, setActivating] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadConfig() {
    setLoading(true);
    try {
      const res = await api.getTelegramConfig();
      setConfig(res.config);
      setChatIdsText(res.config.allowedChatIds.join(', '));
      setDefaultMode(res.config.defaultPhotoMode);
      setAutoReply(res.config.autoReply);
      setDailyChatId(res.config.dailySummaryChatId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка загрузки настроек бота');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadConfig();
  }, []);

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const ids = chatIdsText
        .split(/[\s,;]+/)
        .map((s) => s.trim())
        .filter(Boolean);
      const res = await api.updateTelegramConfig({
        allowedChatIds: ids,
        defaultPhotoMode: defaultMode,
        autoReply,
        dailySummaryChatId: dailyChatId.trim(),
      });
      setChatIdsText(res.allowedChatIds.join(', '));
      setNotice(isKg ? 'Telegram-бот жөндөөлөрү сакталды ✓' : 'Настройки Telegram-бота сохранены ✓');
      await loadConfig();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения');
    } finally {
      setSaving(false);
    }
  }

  async function handleRegisterWebhook() {
    setActivating(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.registerTelegramWebhook();
      setNotice(res.description || (isKg ? 'Webhook кошулду ✓' : 'Webhook подключён ✓'));
      await loadConfig();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка регистрации Webhook');
    } finally {
      setActivating(false);
    }
  }

  if (loading && !config) {
    return (
      <div className="bg-[#0e131f] border border-slate-800 rounded-2xl p-10 text-center text-sm text-cyan-300">
        {isKg ? 'Telegram-бот жөндөөлөрү жүктөлүүдө...' : 'Загрузка настроек Telegram-бота...'}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <h2 className="text-xl font-bold text-white">
            {isKg
              ? 'Telegram-бот: MBank чектерди «Переслать» менен жазуу'
              : 'Telegram-бот для пересылки чеков MBank'}
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            {isKg
              ? 'Сайтка кирбей эле, Telegramдагы ботуңузга чек сүрөтүн же команданы жиберсеңиз — автоматтык таанылып, реалдуу убакытта таблицага түшөт.'
              : 'Пересылайте скриншоты квитанций MBank прямо в вашего бота — он распознает сумму, валюту и контрагента и мгновенно синхронизирует запись.'}
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            void loadConfig();
            onRefreshInbox();
          }}
          className="flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-slate-200 bg-[#0e131f] border border-slate-700 hover:border-cyan-400/50 rounded-xl cursor-pointer self-start"
        >
          <RefreshCw className="w-3.5 h-3.5 text-cyan-300" />
          <span>{isKg ? 'Жаңыртуу' : 'Обновить'}</span>
        </button>
      </div>

      {notice && (
        <div className="flex items-center gap-2.5 p-3.5 rounded-xl bg-emerald-500/15 border border-emerald-400/40 text-sm text-emerald-200">
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
          <span>{notice}</span>
        </div>
      )}
      {error && (
        <div className="p-3.5 rounded-xl bg-rose-500/15 border border-rose-500/45 text-sm text-rose-200">
          {error}
        </div>
      )}

      {/* Server Connection Status & Setup Guide */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-[#0e131f]/95 border border-slate-800/90 rounded-2xl p-6 space-y-5">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-semibold text-white">
              {isKg ? '1. Сервердик байланыш жана Webhook' : '1. Подключение бота на сервере'}
            </h3>
            <span
              className={`text-xs font-semibold ${
                config?.botConfigured && config?.webhookSecretConfigured
                  ? 'text-emerald-300'
                  : 'text-amber-300'
              }`}
            >
              {config?.botConfigured && config?.webhookSecretConfigured
                ? `${config.botUsername || 'Bot'} · ${isKg ? 'Даяр' : 'Готов'}`
                : isKg
                  ? 'Секреттер күтүлүүдө'
                  : 'Ожидает настройки секретов'}
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
            <div className="p-3.5 rounded-xl border border-slate-800 bg-[#090d16]">
              <div className="font-mono font-semibold text-cyan-300">TELEGRAM_BOT_TOKEN</div>
              <div className="mt-1 text-slate-400">
                {config?.botConfigured
                  ? isKg
                    ? `Кошулган (${config.botUsername || 'активдүү'}) ✓`
                    : `Настроен на сервере (${config.botUsername || 'активен'}) ✓`
                  : isKg
                    ? 'Settings → Secrets бөлүмүнө @BotFather токенин кошуңуз'
                    : 'Добавьте токен от @BotFather в Settings → Secrets'}
              </div>
            </div>
            <div className="p-3.5 rounded-xl border border-slate-800 bg-[#090d16]">
              <div className="font-mono font-semibold text-cyan-300">TELEGRAM_WEBHOOK_SECRET</div>
              <div className="mt-1 text-slate-400">
                {config?.webhookSecretConfigured
                  ? isKg
                    ? 'Кошулган (Webhook корголгон) ✓'
                    : 'Настроен (Webhook защищён) ✓'
                  : isKg
                    ? 'Settings → Secrets бөлүмүнө каалаган 16+ символдук сөз кошуңуз'
                    : 'Добавьте произвольную секретную строку (16+ симв.) в Secrets'}
              </div>
            </div>
          </div>

          {config?.webhookUrl && (
            <div className="space-y-1.5">
              <div className="text-xs font-medium text-slate-400">Webhook URL</div>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-3 py-2 text-xs font-mono bg-[#090d16] border border-slate-800 rounded-xl text-cyan-200 truncate">
                  {config.webhookUrl}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(config.webhookUrl);
                    setCopiedUrl(true);
                    setTimeout(() => setCopiedUrl(false), 1600);
                  }}
                  className="px-3 py-2 text-xs font-medium bg-[#090d16] border border-slate-700 hover:border-cyan-400/60 text-slate-200 rounded-xl cursor-pointer shrink-0"
                >
                  {copiedUrl ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          )}

          {canConfigure && (
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-800">
              <div className="text-xs text-slate-400">
                {config?.webhookRegisteredAt
                  ? `${isKg ? 'Акыркы активдештирүү:' : 'Последняя регистрация:'} ${config.webhookRegisteredAt.slice(0, 16).replace('T', ' ')}`
                  : isKg
                    ? 'Токенди Secretsке кошкондон кийин Webhookту 1 баскыч менен активдештириңиз.'
                    : 'После добавления секретов активируйте Webhook одной кнопкой.'}
              </div>
              <button
                type="button"
                disabled={activating || !config?.botConfigured || !config?.webhookSecretConfigured}
                onClick={() => void handleRegisterWebhook()}
                className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold bg-cyan-400 hover:bg-cyan-300 disabled:opacity-45 text-slate-950 rounded-xl shadow-[0_0_16px_rgba(34,211,238,0.3)] cursor-pointer"
              >
                <Webhook className="w-3.5 h-3.5" />
                <span>
                  {activating
                    ? '...'
                    : isKg
                      ? 'Webhookту Telegramга кошуу'
                      : 'Активировать Webhook в Telegram'}
                </span>
              </button>
            </div>
          )}

          {/* Routing & Allowed Chat IDs Form */}
          <form onSubmit={handleSaveSettings} className="pt-4 border-t border-slate-800 space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <ShieldCheck className="w-4 h-4 text-cyan-400" />
              <span>
                {isKg ? '2. Уруксат берилген чаттар жана маршруттоо' : '2. Разрешённые чаты и правила записи'}
              </span>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                {isKg
                  ? 'Уруксат берилген Telegram Chat IDлер (үтүр менен бөлүңүз)'
                  : 'Разрешённые Telegram Chat ID (через запятую)'}
              </label>
              <input
                type="text"
                disabled={!canConfigure}
                value={chatIdsText}
                onChange={(e) => setChatIdsText(e.target.value)}
                placeholder="123456789, 987654321"
                className="w-full px-3 py-2 text-sm font-mono bg-[#090d16] text-white placeholder:text-slate-500 border border-slate-700 rounded-xl focus:outline-none focus:border-cyan-400 disabled:opacity-50"
              />
              <p className="mt-1 text-xs text-slate-400">
                {isKg
                  ? 'Өзүңүздүн Chat IDңизди билүү үчүн ботуңузга /start деп жазыңыз — бот дароо санды кайтарат. Бөтөн адамдар жаза албайт.'
                  : 'Напишите боту /start — он сразу ответит вашим Chat ID. Посторонние чаты автоматически блокируются.'}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  {isKg
                    ? 'Хештегсиз чек сүрөтү кайда түшсүн?'
                    : 'Куда записывать чек без хештега?'}
                </label>
                <select
                  disabled={!canConfigure}
                  value={defaultMode}
                  onChange={(e) => setDefaultMode(e.target.value as TelegramDefaultMode)}
                  className="w-full px-3 py-2 text-sm bg-[#090d16] text-slate-100 border border-slate-700 rounded-xl disabled:opacity-50"
                >
                  <option value="family_expense">
                    {isKg ? 'Үй-бүлөлүк безнал чыгым' : 'Семейный безнал расход'}
                  </option>
                  <option value="client_income">
                    {isKg ? 'Клиенттен приход → Сайтка' : 'Приход от клиента → На сайт'}
                  </option>
                  <option value="business_expense">
                    {isKg ? 'Бизнес безнал чыгым' : 'Бизнес-расход (безнал)'}
                  </option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  {isKg ? 'Кечки отчёт жөнөтүлүүчү Chat ID' : 'Chat ID для итогов дня'}
                </label>
                <input
                  type="text"
                  disabled={!canConfigure}
                  value={dailyChatId}
                  onChange={(e) => setDailyChatId(e.target.value)}
                  placeholder="123456789"
                  className="w-full px-3 py-2 text-sm font-mono bg-[#090d16] text-white placeholder:text-slate-500 border border-slate-700 rounded-xl focus:outline-none focus:border-cyan-400 disabled:opacity-50"
                />
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  disabled={!canConfigure}
                  checked={autoReply}
                  onChange={(e) => setAutoReply(e.target.checked)}
                  className="rounded border-slate-600 bg-[#090d16] accent-cyan-400"
                />
                <span>
                  {isKg
                    ? 'Чек жазылгандан кийин Telegramга тастыктоо жообун жиберүү'
                    : 'Отправлять подтверждение в Telegram после записи чека'}
                </span>
              </label>

              {canConfigure && (
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 text-xs font-bold bg-fuchsia-500 hover:bg-fuchsia-400 text-white rounded-xl shadow-[0_0_16px_rgba(217,70,239,0.35)] cursor-pointer"
                >
                  {saving ? '...' : isKg ? 'Жөндөөлөрдү сактоо' : 'Сохранить настройки'}
                </button>
              )}
            </div>
          </form>
        </div>

        {/* Right Column: Command Cheat Sheet & Setup Steps */}
        <div className="lg:col-span-5 space-y-6">
          <div className="bg-[#0e131f]/95 border border-slate-800/90 rounded-2xl p-6 space-y-4">
            <div className="flex items-center gap-2 text-base font-semibold text-white">
              <Send className="w-4 h-4 text-cyan-400" />
              <span>{isKg ? 'Бот менен кантип иштөө керек' : 'Как пользоваться ботом'}</span>
            </div>

            <div className="space-y-3 text-xs text-slate-300">
              <div className="p-3.5 rounded-xl bg-[#090d16] border border-slate-800">
                <div className="font-semibold text-white">
                  {isKg ? '1. MBank чек сүрөтүн переслать кылуу' : '1. Пересылка фото чека MBank'}
                </div>
                <p className="mt-1 text-slate-400">
                  {isKg
                    ? 'Жөн эле чек сүрөтүн жибериңиз — демейки боюнча Үй-бүлөлүк безнал чыгымга түшөт.'
                    : 'Просто перешлите скриншот квитанции — он автоматически распознается и запишется.'}
                </p>
              </div>

              <div className="p-3.5 rounded-xl bg-[#090d16] border border-slate-800">
                <div className="font-semibold text-white">
                  {isKg ? '2. Сүрөткө хештег кошуу' : '2. Хештеги в подписи к чеку'}
                </div>
                <ul className="mt-1.5 space-y-1 font-mono text-cyan-300">
                  <li>#клиент — <span className="text-slate-300 font-sans">{isKg ? 'Клиенттен приход → Сайтка' : 'Приход клиента → На сайт'}</span></li>
                  <li>#бизнес — <span className="text-slate-300 font-sans">{isKg ? 'Бизнес чыгым' : 'Бизнес-расход'}</span></li>
                  <li>#үй / #семья — <span className="text-slate-300 font-sans">{isKg ? 'Үй-бүлөлүк чыгым' : 'Семейный расход'}</span></li>
                </ul>
              </div>

              <div className="p-3.5 rounded-xl bg-[#090d16] border border-slate-800">
                <div className="font-semibold text-white">
                  {isKg ? '3. Тез тексттик командалар' : '3. Быстрые текстовые команды'}
                </div>
                <ul className="mt-1.5 space-y-1.5 font-mono text-fuchsia-300">
                  <li>/нал 1500 Базар</li>
                  <li>/клиент Айбек 12000 Заказ #1051</li>
                  <li>/итоги — <span className="text-slate-300 font-sans">{isKg ? 'Күндүн жыйынтыгы' : 'Отчёт за сегодня'}</span></li>
                  <li>/start — <span className="text-slate-300 font-sans">{isKg ? 'Chat ID билүү' : 'Узнать свой Chat ID'}</span></li>
                </ul>
              </div>
            </div>
          </div>

          <div className="bg-[#0e131f]/95 border border-slate-800/90 rounded-2xl p-6 space-y-2.5 text-xs text-slate-400">
            <div className="text-sm font-semibold text-white">
              {isKg ? 'Ботту 2 мүнөттө ачуу (@BotFather)' : 'Быстрое создание бота (@BotFather)'}
            </div>
            <ol className="list-decimal list-inside space-y-1.5">
              <li>{isKg ? 'Telegramдан @BotFather ачып /newbot жазыңыз.' : 'Откройте @BotFather в Telegram и отправьте /newbot.'}</li>
              <li>{isKg ? 'Алынган токенди сервердин Secrets жөндөөлөрүнө TELEGRAM_BOT_TOKEN деп кошуңуз.' : 'Добавьте токен в настройки Secrets на сервере как TELEGRAM_BOT_TOKEN.'}</li>
              <li>{isKg ? 'TELEGRAM_WEBHOOK_SECRET үчүн каалаган сыр сөз (16+ символ) кошуп, сол жактагы «Webhookту кошуу» баскычын басыңыз.' : 'Добавьте TELEGRAM_WEBHOOK_SECRET (строка 16+ симв.) и нажмите «Активировать Webhook».'}</li>
            </ol>
          </div>
        </div>
      </div>

      {/* Live Telegram Inbox Log */}
      <div className="bg-[#0e131f]/95 border border-slate-800/90 rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-[#090d16]/60">
          <div>
            <h3 className="text-base font-semibold text-white">
              {isKg ? 'Telegram аркылуу келген чектердин тарыхы' : 'Журнал входящих чеков из Telegram'}
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              {isKg ? 'Акыркы 40 билдирүү реалдуу убакытта жаңырат' : 'Последние 40 сообщений обновляются в реальном времени'}
            </p>
          </div>
          <span className="text-xs font-mono text-cyan-300">{inbox.length}</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-800 bg-[#090d16]/80 text-xs text-slate-400">
                <th className="text-left font-medium px-6 py-3">{isKg ? 'Убактысы' : 'Время'}</th>
                <th className="text-left font-medium px-3 py-3">{isKg ? 'Жөнөтүүчү' : 'Отправитель'}</th>
                <th className="text-left font-medium px-3 py-3">{isKg ? 'Бөлүм' : 'Маршрут'}</th>
                <th className="text-left font-medium px-3 py-3">{isKg ? 'Натыйжа' : 'Результат'}</th>
                <th className="text-right font-medium px-6 py-3">{isKg ? 'Статус' : 'Статус'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/80">
              {inbox.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-10 text-center text-sm text-slate-500">
                    {isKg
                      ? 'Азырынча Telegramдан чек келе элек. Ботко биринчи чекти переслать кылганда ал ушул жерде көрүнөт.'
                      : 'Входящих сообщений от бота пока нет. После подключения Webhook пересланные чеки появятся здесь.'}
                  </td>
                </tr>
              ) : (
                inbox.map((item) => (
                  <tr key={item.id} className="hover:bg-slate-800/40">
                    <td className="px-6 py-3 font-mono text-xs text-slate-400 whitespace-nowrap">
                      {item.createdAt.slice(0, 16).replace('T', ' ')}
                    </td>
                    <td className="px-3 py-3">
                      <div className="text-sm font-medium text-white">{item.senderName}</div>
                      <div className="text-xs font-mono text-slate-500">ID: {item.chatId}</div>
                    </td>
                    <td className="px-3 py-3 text-xs text-slate-300">{item.routedTo}</td>
                    <td className="px-3 py-3">
                      <div className="text-xs font-medium text-white">{item.summary}</div>
                      {item.caption && (
                        <div className="text-xs text-slate-400 truncate max-w-xs">{item.caption}</div>
                      )}
                    </td>
                    <td className="px-6 py-3 text-right text-xs font-semibold">
                      {item.status === 'saved' ? (
                        <span className="text-emerald-400">{isKg ? 'Сакталды ✓' : 'Записано ✓'}</span>
                      ) : item.status === 'ignored' ? (
                        <span className="text-slate-400">{isKg ? 'Өткөрүлдү' : 'Пропущено'}</span>
                      ) : (
                        <span className="text-rose-400">{isKg ? 'Ката' : 'Ошибка'}</span>
                      )}
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
