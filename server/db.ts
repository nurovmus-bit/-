import Database from 'better-sqlite3';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { CurrencyCode, LedgerSpace } from '../src/types.ts';

const dataDir = path.resolve(process.cwd(), 'data');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const dbPath = path.join(dataDir, 'knigaschet.db');
export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL CHECK(role IN ('owner', 'admin', 'editor', 'viewer')),
    allowed_spaces TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_active_at TEXT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    created_at TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS budgets (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('project', 'category')),
    space TEXT NOT NULL CHECK(space IN ('business', 'family', 'personal')),
    category TEXT,
    limit_amount REAL NOT NULL,
    currency TEXT NOT NULL,
    limit_in_kgs REAL NOT NULL,
    period TEXT NOT NULL CHECK(period IN ('monthly', 'quarterly', 'total')),
    description TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY,
    space TEXT NOT NULL CHECK(space IN ('business', 'family', 'personal')),
    type TEXT NOT NULL CHECK(type IN ('income', 'expense')),
    amount REAL NOT NULL,
    currency TEXT NOT NULL,
    amount_in_kgs REAL NOT NULL,
    exchange_rate REAL NOT NULL,
    category TEXT NOT NULL,
    project_id TEXT,
    merchant TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    payment_source TEXT NOT NULL DEFAULT 'MBank',
    date TEXT NOT NULL,
    receipt_ref TEXT,
    external_ref TEXT UNIQUE,
    source_channel TEXT NOT NULL DEFAULT 'manual',
    created_by TEXT NOT NULL,
    created_by_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (project_id) REFERENCES budgets(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_tx_space_date ON transactions(space, date DESC);
  CREATE INDEX IF NOT EXISTS idx_tx_project ON transactions(project_id);

  CREATE TABLE IF NOT EXISTS bank_connections (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    name TEXT NOT NULL,
    account_mask TEXT NOT NULL,
    default_space TEXT NOT NULL CHECK(default_space IN ('business', 'family', 'personal')),
    currency TEXT NOT NULL,
    api_endpoint TEXT,
    api_token TEXT,
    webhook_secret TEXT NOT NULL,
    auto_import_enabled INTEGER NOT NULL DEFAULT 1,
    status TEXT NOT NULL DEFAULT 'active',
    last_sync_at TEXT,
    last_sync_count INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    user_name TEXT NOT NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    summary TEXT NOT NULL,
    space TEXT,
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);

  CREATE TABLE IF NOT EXISTS staged_goods (
    id TEXT PRIMARY KEY,
    product_name TEXT NOT NULL,
    sku TEXT NOT NULL DEFAULT '',
    quantity REAL NOT NULL,
    unit TEXT NOT NULL DEFAULT 'шт',
    unit_cost REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'KGS',
    total_cost_kgs REAL NOT NULL,
    selling_price REAL,
    supplier TEXT NOT NULL DEFAULT '',
    payment_method TEXT NOT NULL DEFAULT 'cash',
    receipt_ref TEXT,
    notes TEXT NOT NULL DEFAULT '',
    site_status TEXT NOT NULL DEFAULT 'pending' CHECK(site_status IN ('pending', 'uploaded')),
    linked_tx_id TEXT,
    created_by TEXT NOT NULL,
    created_by_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    uploaded_at TEXT
  );

  CREATE TABLE IF NOT EXISTS cash_accounts (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL CHECK(kind IN ('cash', 'cashless')),
    currency TEXT NOT NULL DEFAULT 'KGS',
    opening_balance REAL NOT NULL DEFAULT 0,
    opening_date TEXT NOT NULL,
    last_actual_balance REAL,
    last_reconciled_at TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS debts (
    id TEXT PRIMARY KEY,
    direction TEXT NOT NULL CHECK(direction IN ('client_owes', 'we_owe')),
    space TEXT NOT NULL DEFAULT 'business' CHECK(space IN ('business', 'family', 'personal')),
    counterparty TEXT NOT NULL,
    contact TEXT NOT NULL DEFAULT '',
    total_amount REAL NOT NULL,
    paid_amount REAL NOT NULL DEFAULT 0,
    currency TEXT NOT NULL DEFAULT 'KGS',
    total_in_kgs REAL NOT NULL,
    paid_in_kgs REAL NOT NULL DEFAULT 0,
    due_date TEXT,
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'partial', 'paid')),
    created_by TEXT NOT NULL,
    created_by_name TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS telegram_settings (
    id TEXT PRIMARY KEY,
    allowed_chat_ids TEXT NOT NULL DEFAULT '[]',
    default_photo_mode TEXT NOT NULL DEFAULT 'family_expense',
    auto_reply INTEGER NOT NULL DEFAULT 1,
    daily_summary_chat_id TEXT NOT NULL DEFAULT '',
    webhook_registered_at TEXT,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS telegram_inbox (
    id TEXT PRIMARY KEY,
    chat_id TEXT NOT NULL,
    sender_name TEXT NOT NULL,
    message_type TEXT NOT NULL CHECK(message_type IN ('photo', 'text')),
    caption TEXT NOT NULL DEFAULT '',
    routed_to TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK(status IN ('saved', 'ignored', 'error')),
    summary TEXT NOT NULL DEFAULT '',
    linked_tx_id TEXT,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS catalog_items (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK(kind IN ('client', 'business_expense', 'family_expense')),
    sort_order INTEGER NOT NULL DEFAULT 0,
    name TEXT NOT NULL,
    phone TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_catalog_kind_order ON catalog_items(kind, sort_order ASC, name ASC);

  CREATE TABLE IF NOT EXISTS expense_limits (
    id TEXT PRIMARY KEY,
    family_monthly_kgs REAL NOT NULL DEFAULT 0,
    business_monthly_kgs REAL NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL
  );
`);

// Safe additive migrations for existing SQLite databases
const txColumns = (db.prepare(`PRAGMA table_info(transactions)`).all() as { name: string }[]).map(
  (c) => c.name
);
if (!txColumns.includes('payment_method')) {
  db.exec(`ALTER TABLE transactions ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'cashless'`);
}
if (!txColumns.includes('site_sync_status')) {
  db.exec(`ALTER TABLE transactions ADD COLUMN site_sync_status TEXT NOT NULL DEFAULT 'not_applicable'`);
}
if (!txColumns.includes('client_contact')) {
  db.exec(`ALTER TABLE transactions ADD COLUMN client_contact TEXT`);
}

// Ensure default Cash & MBank accounts exist
const existingAccounts = db.prepare(`SELECT COUNT(*) as cnt FROM cash_accounts`).get() as { cnt: number };
if (existingAccounts.cnt === 0) {
  const today = new Date().toISOString().slice(0, 10);
  const nowIso = new Date().toISOString();
  const insAcc = db.prepare(`
    INSERT INTO cash_accounts (id, name, kind, currency, opening_balance, opening_date, last_actual_balance, last_reconciled_at, updated_at)
    VALUES (?, ?, ?, 'KGS', ?, ?, NULL, NULL, ?)
  `);
  insAcc.run('acc_cash_main', 'Накталай касса (Наличные)', 'cash', 45000, today, nowIso);
  insAcc.run('acc_mbank_main', 'MBank (Безнал / Карта / QR)', 'cashless', 180000, today, nowIso);
}

// Ensure singleton Telegram settings row exists
const existingTg = db.prepare(`SELECT id FROM telegram_settings WHERE id = 'default'`).get();
if (!existingTg) {
  db.prepare(`
    INSERT INTO telegram_settings (id, allowed_chat_ids, default_photo_mode, auto_reply, daily_summary_chat_id, webhook_registered_at, updated_at)
    VALUES ('default', '[]', 'family_expense', 1, '', NULL, ?)
  `).run(new Date().toISOString());
}

// Ensure auto-lists exist: 30 clients, 30 business expense nomenclatures, 8 family expense nomenclatures
const existingCatalogCount = db.prepare(`SELECT COUNT(*) as cnt FROM catalog_items`).get() as { cnt: number };
if (existingCatalogCount.cnt === 0) {
  const nowIso = new Date().toISOString();
  const insCat = db.prepare(`
    INSERT INTO catalog_items (id, kind, sort_order, name, phone, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const defaultClients: [string, string][] = [
    ['Айбек Токтогулов', '+996 555 214 890'],
    ['Нурлан Асанов', '+996 700 412 301'],
    ['Динара Исакова', '+996 700 841 120'],
    ['Бакыт Сыдыков', '+996 702 311 450'],
    ['Гүлнура Мамытова', '+996 550 612 908'],
    ['Эрлан Кадыров', '+996 772 540 112'],
    ['Азамат Алиев', '+996 555 901 234'],
    ['Жылдыз Осмонова', '+996 705 118 442'],
    ['Талант Жумагулов', '+996 551 774 209'],
    ['Айгүл Сатыбалдиева', '+996 708 329 510'],
    ['Уланбек Бектуров', '+996 559 440 811'],
    ['Назира Токтосунова', '+996 701 665 219'],
    ['Кубанычбек Эргешов', '+996 770 218 903'],
    ['Мээрим Абдыкадырова', '+996 552 883 145'],
    ['Данияр Шаршенов', '+996 703 912 664'],
    ['Салтанат Кыдыралиева', '+996 557 309 421'],
    ['Руслан Иманкулов', '+996 709 551 780'],
    ['Чолпон Дүйшөбаева', '+996 554 128 930'],
    ['Мирлан Сулайманов', '+996 771 840 225'],
    ['Алина Кожомкулова', '+996 704 619 338'],
    ['Тилек Касымов', '+996 553 402 716'],
    ['Бермет Жолдошева', '+996 706 925 104'],
    ['Максат Нурматов', '+996 558 713 559'],
    ['Кундуз Акматова', '+996 707 284 612'],
    ['Санжар Базарбаев', '+996 773 519 480'],
    ['Асел Турдубекова', '+996 556 648 921'],
    ['Эмилбек Өмүралиев', '+996 702 870 315'],
    ['Жибек Садырбаева', '+996 550 193 477'],
    ['Канатбек Момунов', '+996 705 432 890'],
    ['ОсОО «Ала-Тоо Оптом»', '+996 555 800 100'],
  ];

  const defaultBusinessNomenclature: string[] = [
    'Товар сатып алуу (Закупка)',
    'Карго / Жүк жеткирүү',
    'Дүкөн / Склад арендасы',
    'Курьер жана такси (доставка)',
    'Instagram / Таргет реклама',
    'Упаковка / Пакет / Коробка',
    'Айлык акы / Жардамчы',
    'Налог / Патент / Соцфонд',
    'Сайт / Хостинг / Домен',
    'Байланыш / Интернет (бизнес)',
    'Электр энергиясы (бизнес)',
    'Коммуналдык кызмат (офис/склад)',
    'Бензин / Май (бизнес)',
    'Унаа ремонту (бизнес)',
    'Базар / Контейнер акысы',
    'Грузчик / Түшүрүү-жүктөө',
    'Канцтовар / Кагаз / Скотч',
    'Термопринтер / Этикетка / Чек лента',
    'Техника / Оборудование сатып алуу',
    'Офис / Дүкөн ремонту',
    'Фото / Видео контент (SMM)',
    'Банк комиссиясы / Которуу',
    'Клиентке возврат / Алмаштыруу',
    'Склад коопсуздугу / Охрана',
    'Тазалык / Уборка (дүкөн)',
    'Жумуштагы тамак-аш / Кофе',
    'Бухгалтер / Юрист кызматы',
    'Поставщикке кошумча чыгым',
    'Брак / Зыянга кеткен товар',
    'Башка бизнес чыгымдар',
  ];

  const defaultFamilyNomenclature: string[] = [
    'Азык-түлүк / Продукты',
    'Коммуналка / Интернет',
    'Балдар / Окуу / Ийрим',
    'Дары / Аптека / Врач',
    'Кийим-кече / Бут кийим',
    'Жол / Бензин / Такси',
    'Той-топур / Конок / Белек',
    'Үй-тиричилик / Башка',
  ];

  const seedCatalogTx = db.transaction(() => {
    defaultClients.forEach(([name, phone], idx) => {
      insCat.run(`cat_cli_${idx + 1}`, 'client', idx + 1, name, phone, nowIso);
    });
    defaultBusinessNomenclature.forEach((name, idx) => {
      insCat.run(`cat_biz_${idx + 1}`, 'business_expense', idx + 1, name, '', nowIso);
    });
    defaultFamilyNomenclature.forEach((name, idx) => {
      insCat.run(`cat_fam_${idx + 1}`, 'family_expense', idx + 1, name, '', nowIso);
    });
  });
  seedCatalogTx();
}

export const DEFAULT_RATES_TO_KGS: Record<CurrencyCode, number> = {
  KGS: 1,
  USD: 87.45,
  EUR: 94.8,
  RUB: 0.94,
  KZT: 0.175,
  UZS: 0.0068,
  TRY: 2.48,
  GBP: 111.2,
  AED: 23.81,
  CNY: 12.08,
};

let cachedRates: { rates: Record<CurrencyCode, number>; updatedAt: string; source: 'live' | 'fallback' } = {
  rates: { ...DEFAULT_RATES_TO_KGS },
  updatedAt: new Date().toISOString(),
  source: 'fallback',
};

export async function getExchangeRates(): Promise<{
  rates: Record<CurrencyCode, number>;
  updatedAt: string;
  source: 'live' | 'fallback';
}> {
  const ageMs = Date.now() - new Date(cachedRates.updatedAt).getTime();
  if (cachedRates.source === 'live' && ageMs < 60 * 60 * 1000) {
    return cachedRates;
  }
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const res = await fetch('https://open.er-api.com/v6/latest/USD', {
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (res.ok) {
      const json = (await res.json()) as { rates?: Record<string, number> };
      const usdToKgs = json.rates?.KGS;
      if (usdToKgs && Number.isFinite(usdToKgs) && usdToKgs > 10) {
        const next: Record<CurrencyCode, number> = { ...DEFAULT_RATES_TO_KGS };
        next.KGS = 1;
        next.USD = Number(usdToKgs.toFixed(4));
        for (const code of Object.keys(DEFAULT_RATES_TO_KGS) as CurrencyCode[]) {
          if (code === 'KGS' || code === 'USD') continue;
          const usdToCode = json.rates?.[code];
          if (usdToCode && Number.isFinite(usdToCode) && usdToCode > 0) {
            next[code] = Number((usdToKgs / usdToCode).toFixed(4));
          }
        }
        cachedRates = {
          rates: next,
          updatedAt: new Date().toISOString(),
          source: 'live',
        };
      }
    }
  } catch {
    // Keep resilient fallback rates when offline
  }
  return cachedRates;
}

export function getRateToKgsSync(currency: CurrencyCode): number {
  return cachedRates.rates[currency] ?? DEFAULT_RATES_TO_KGS[currency] ?? 1;
}

export function seedStarterWorkspace(ownerId: string, ownerName: string): void {
  const existingTx = db.prepare('SELECT COUNT(*) as cnt FROM transactions').get() as { cnt: number };
  if (existingTx.cnt > 0) return;

  const now = new Date();
  const isoDay = (daysAgo: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - daysAgo);
    return d.toISOString().slice(0, 10);
  };
  const nowIso = now.toISOString();

  const bOfficeId = 'bud_office_q4';
  const bMarketingId = 'bud_marketing_ads';
  const bGroceriesId = 'bud_family_food';
  const bVacationId = 'bud_family_trip';
  const bPersonalId = 'bud_personal_dev';

  const insertBudget = db.prepare(`
    INSERT INTO budgets (id, name, kind, space, category, limit_amount, currency, limit_in_kgs, period, description, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const starterBudgets: [string, string, 'project' | 'category', LedgerSpace, string | null, number, CurrencyCode, 'monthly' | 'quarterly' | 'total', string][] = [
    [bOfficeId, 'Ремонт и оснащение офиса', 'project', 'business', null, 280000, 'KGS', 'total', 'Закупка мебели, техники и освещения для нового кабинета'],
    [bMarketingId, 'Маркетинг и таргетинг', 'category', 'business', 'Маркетинг и реклама', 95000, 'KGS', 'monthly', 'Ежемесячный рекламный бюджет на Instagram, Google Ads и 2ГИС'],
    [bGroceriesId, 'Продукты и хозяйство', 'category', 'family', 'Продукты и супермаркеты', 65000, 'KGS', 'monthly', 'Ежемесячный лимит семейных покупок в Globus, Народный и на рынке'],
    [bVacationId, 'Семейная поездка на Иссык-Куль', 'project', 'family', null, 1800, 'USD', 'total', 'Бронь коттеджа, дорога и питание на 7 дней'],
    [bPersonalId, 'Саморазвитие и спорт', 'category', 'personal', 'Спорт и здоровье', 20000, 'KGS', 'monthly', 'Абонемент в зал, книги и онлайн-курсы'],
  ];

  for (const b of starterBudgets) {
    const rate = getRateToKgsSync(b[6]);
    insertBudget.run(
      b[0], b[1], b[2], b[3], b[4], b[5], b[6], Math.round(b[5] * rate * 100) / 100,
      b[7], b[8], ownerId, nowIso, nowIso
    );
  }

  const insertTx = db.prepare(`
    INSERT INTO transactions (
      id, space, type, payment_method, site_sync_status, client_contact, amount, currency, amount_in_kgs, exchange_rate,
      category, project_id, merchant, description, payment_source, date,
      receipt_ref, external_ref, source_channel, created_by, created_by_name, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const starterTx: {
    space: LedgerSpace;
    type: 'income' | 'expense';
    paymentMethod: 'cash' | 'cashless';
    siteSyncStatus: 'not_applicable' | 'pending' | 'synced';
    clientContact?: string;
    amount: number;
    currency: CurrencyCode;
    category: string;
    projectId: string | null;
    merchant: string;
    description: string;
    paymentSource: string;
    daysAgo: number;
    receiptRef?: string;
    sourceChannel: 'manual' | 'ocr_camera' | 'bank_api';
  }[] = [
    { space: 'business', type: 'income', paymentMethod: 'cashless', siteSyncStatus: 'pending', clientContact: '+996 555 214 890 · Заказ #1042', amount: 42500, currency: 'KGS', category: 'Оплата от клиентов (B2B)', projectId: null, merchant: 'Айбек Токтогулов (Клиент)', description: 'Оплата за партию через MBank — нужно провести на сайте', paymentSource: 'MBank', daysAgo: 0, receiptRef: 'MB-9084112', sourceChannel: 'ocr_camera' },
    { space: 'business', type: 'income', paymentMethod: 'cash', siteSyncStatus: 'pending', clientContact: '+996 700 841 120 · Заказ #1045', amount: 18900, currency: 'KGS', category: 'Выручка от продаж', projectId: null, merchant: 'Динара Исакова (Клиент)', description: 'Оплата наличными при самовывозе — внести в заказ на сайте', paymentSource: 'Наличные', daysAgo: 1, sourceChannel: 'manual' },
    { space: 'business', type: 'income', paymentMethod: 'cashless', siteSyncStatus: 'synced', clientContact: 'Договор №418', amount: 420000, currency: 'KGS', category: 'Оплата от клиентов (B2B)', projectId: null, merchant: 'ОсОО «Ала-Тоо Логистик»', description: 'Оплата по договору №418 — проведено на сайте', paymentSource: 'MBank Бизнес', daysAgo: 2, receiptRef: 'MB-8841209', sourceChannel: 'bank_api' },
    { space: 'business', type: 'income', paymentMethod: 'cashless', siteSyncStatus: 'synced', amount: 3400, currency: 'USD', category: 'Консалтинг и услуги', projectId: null, merchant: 'SilkRoad Digital FZCO', description: 'Международный контракт (входящий SWIFT)', paymentSource: 'DemirBank', daysAgo: 6, receiptRef: 'SW-39104', sourceChannel: 'bank_api' },
    { space: 'business', type: 'expense', paymentMethod: 'cashless', siteSyncStatus: 'not_applicable', amount: 118500, currency: 'KGS', category: 'Аренда офиса и склада', projectId: bOfficeId, merchant: 'БЦ «Аврора Плюс»', description: 'Аренда офиса 402 и сервисный сбор', paymentSource: 'MBank Бизнес', daysAgo: 3, receiptRef: 'MB-8839012', sourceChannel: 'ocr_camera' },
    { space: 'business', type: 'expense', paymentMethod: 'cashless', siteSyncStatus: 'not_applicable', amount: 64000, currency: 'KGS', category: 'Закупка товара и сырья', projectId: bOfficeId, merchant: 'ТехноДом Бишкек', description: 'Закупка товара и оборудования (чек MBank)', paymentSource: 'MBank', daysAgo: 5, receiptRef: 'MB-8824190', sourceChannel: 'ocr_camera' },
    { space: 'business', type: 'expense', paymentMethod: 'cashless', siteSyncStatus: 'not_applicable', amount: 720, currency: 'USD', category: 'Маркетинг и реклама', projectId: bMarketingId, merchant: 'Meta / Google Ads', description: 'Пополнение рекламного кабинета', paymentSource: 'Карта Visa / Elcart', daysAgo: 4, sourceChannel: 'bank_api' },
    { space: 'business', type: 'expense', paymentMethod: 'cash', siteSyncStatus: 'not_applicable', amount: 14500, currency: 'KGS', category: 'Логистика и доставка', projectId: null, merchant: 'Курьер и карго (Дордой)', description: 'Доставка коробок на склад наличными', paymentSource: 'Наличные', daysAgo: 2, sourceChannel: 'manual' },
    { space: 'family', type: 'income', paymentMethod: 'cashless', siteSyncStatus: 'not_applicable', amount: 185000, currency: 'KGS', category: 'Доход от бизнеса в семью', projectId: null, merchant: 'Перевод в семейный бюджет', description: 'Плановое распределение на месяц', paymentSource: 'MBank', daysAgo: 4, receiptRef: 'MB-8830144', sourceChannel: 'bank_api' },
    { space: 'family', type: 'expense', paymentMethod: 'cashless', siteSyncStatus: 'not_applicable', amount: 14850, currency: 'KGS', category: 'Продукты и супермаркеты', projectId: bGroceriesId, merchant: 'Гипермаркет Globus', description: 'Закупка продуктов на неделю (пересланный чек MBank)', paymentSource: 'MBank', daysAgo: 1, receiptRef: 'CHK-2026-9012', sourceChannel: 'ocr_camera' },
    { space: 'family', type: 'expense', paymentMethod: 'cash', siteSyncStatus: 'not_applicable', amount: 6400, currency: 'KGS', category: 'Продукты и супермаркеты', projectId: bGroceriesId, merchant: 'Рынок Орто-Сай (Наличные)', description: 'Мясо, овощи и фрукты наличными', paymentSource: 'Наличные', daysAgo: 1, sourceChannel: 'manual' },
    { space: 'family', type: 'expense', paymentMethod: 'cashless', siteSyncStatus: 'not_applicable', amount: 8900, currency: 'KGS', category: 'Коммунальные услуги и интернет', projectId: null, merchant: 'Северэлектро / Акнет', description: 'Электроэнергия, отопление и домашний интернет', paymentSource: 'MBank', daysAgo: 7, receiptRef: 'MB-8811042', sourceChannel: 'ocr_camera' },
    { space: 'family', type: 'expense', paymentMethod: 'cash', siteSyncStatus: 'not_applicable', amount: 3200, currency: 'KGS', category: 'Медицина и аптека', projectId: null, merchant: 'Аптека Неман', description: 'Витамины и лекарства наличными', paymentSource: 'Наличные', daysAgo: 3, sourceChannel: 'manual' },
    { space: 'personal', type: 'income', paymentMethod: 'cashless', siteSyncStatus: 'not_applicable', amount: 55000, currency: 'KGS', category: 'Личный доход', projectId: null, merchant: 'Личное распределение', description: 'Личный фонд на месяц', paymentSource: 'MBank', daysAgo: 5, sourceChannel: 'manual' },
    { space: 'personal', type: 'expense', paymentMethod: 'cashless', siteSyncStatus: 'not_applicable', amount: 9500, currency: 'KGS', category: 'Спорт и здоровье', projectId: bPersonalId, merchant: 'Фитнес-клуб World Class', description: 'Продление месячного абонемента', paymentSource: 'MBank', daysAgo: 3, receiptRef: 'MB-8837411', sourceChannel: 'ocr_camera' },
    { space: 'personal', type: 'expense', paymentMethod: 'cash', siteSyncStatus: 'not_applicable', amount: 1850, currency: 'KGS', category: 'Кафе и рестораны', projectId: null, merchant: 'Кофейня Sierra', description: 'Обед наличными', paymentSource: 'Наличные', daysAgo: 2, sourceChannel: 'manual' },
  ];

  for (const item of starterTx) {
    const rate = getRateToKgsSync(item.currency);
    const amountInKgs = Math.round(item.amount * rate * 100) / 100;
    insertTx.run(
      `tx_${crypto.randomBytes(6).toString('hex')}`,
      item.space,
      item.type,
      item.paymentMethod,
      item.siteSyncStatus,
      item.clientContact ?? null,
      item.amount,
      item.currency,
      amountInKgs,
      rate,
      item.category,
      item.projectId,
      item.merchant,
      item.description,
      item.paymentSource,
      isoDay(item.daysAgo),
      item.receiptRef ?? null,
      null,
      item.sourceChannel,
      ownerId,
      ownerName,
      nowIso,
      nowIso
    );
  }

  // Seed temporary purchased goods waiting to be uploaded to website
  const insertGood = db.prepare(`
    INSERT INTO staged_goods (
      id, product_name, sku, quantity, unit, unit_cost, currency, total_cost_kgs,
      selling_price, supplier, payment_method, receipt_ref, notes, site_status,
      linked_tx_id, created_by, created_by_name, created_at, uploaded_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const starterGoods: [string, string, number, string, number, CurrencyCode, number | null, string, 'cash' | 'cashless', string | null, string, 'pending' | 'uploaded'][] = [
    ['Беспроводные наушники TWS Pro (чёрные)', 'SKU-4018', 25, 'шт', 1150, 'KGS', 1950, 'Поставщик Дордой (ряд 4)', 'cash', null, 'Новая партия — сделать фото и добавить на сайт', 'pending'],
    ['Портативный пауэрбанк 20000mAh PD', 'SKU-4022', 15, 'шт', 14.5, 'USD', 2300, 'Карго Гуанчжоу — Бишкек', 'cashless', 'MB-9081204', 'Оплачено через MBank, проверить остаток перед публикацией', 'pending'],
    ['Смарт-часы FitBand S9', 'SKU-3995', 10, 'шт', 1800, 'KGS', 2900, 'ОсОО «ТехноОпт»', 'cashless', 'MB-8824190', 'Карточка товара уже обновлена на сайте', 'uploaded'],
  ];

  for (const g of starterGoods) {
    const rate = getRateToKgsSync(g[5]);
    const totalKgs = Math.round(g[2] * g[4] * rate * 100) / 100;
    insertGood.run(
      `gd_${crypto.randomBytes(6).toString('hex')}`,
      g[0], g[1], g[2], g[3], g[4], g[5], totalKgs,
      g[6], g[7], g[8], g[9], g[10], g[11], null,
      ownerId, ownerName, nowIso, g[11] === 'uploaded' ? nowIso : null
    );
  }

  // Seed starter debts (client advance/remainder & supplier credit)
  const existingDebts = db.prepare(`SELECT COUNT(*) as cnt FROM debts`).get() as { cnt: number };
  if (existingDebts.cnt === 0) {
    const insDebt = db.prepare(`
      INSERT INTO debts (
        id, direction, space, counterparty, contact, total_amount, paid_amount, currency,
        total_in_kgs, paid_in_kgs, due_date, notes, status, created_by, created_by_name, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const nextWeek = new Date(now);
    nextWeek.setDate(nextWeek.getDate() + 5);
    const nextWeekIso = nextWeek.toISOString().slice(0, 10);

    insDebt.run(
      `dbt_${crypto.randomBytes(6).toString('hex')}`,
      'client_owes',
      'business',
      'Бакыт Сыдыков (Клиент)',
      '+996 702 311 450 · Заказ #1049',
      35000,
      15000,
      'KGS',
      35000,
      15000,
      nextWeekIso,
      'Аванс 15 000 KGS берди, калганы 20 000 KGS товар жеткенде төлөйт',
      'partial',
      ownerId,
      ownerName,
      nowIso,
      nowIso
    );
    insDebt.run(
      `dbt_${crypto.randomBytes(6).toString('hex')}`,
      'we_owe',
      'business',
      'Поставщик Дордой (Контейнер 14)',
      '+996 550 908 112',
      58000,
      20000,
      'KGS',
      58000,
      20000,
      nextWeekIso,
      'Жаңы партиядан калган насия суммасы',
      'partial',
      ownerId,
      ownerName,
      nowIso,
      nowIso
    );
  }

  const insertBank = db.prepare(`
    INSERT INTO bank_connections (
      id, provider, name, account_mask, default_space, currency,
      api_endpoint, api_token, webhook_secret, auto_import_enabled,
      status, last_sync_at, last_sync_count, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  insertBank.run(
    'bank_mbank_biz',
    'mbank',
    'MBank Бизнес — Основной расчётный',
    '4169 •••• 8421',
    'business',
    'KGS',
    null,
    null,
    `whsec_${crypto.randomBytes(16).toString('hex')}`,
    1,
    'active',
    nowIso,
    14,
    nowIso
  );

  insertBank.run(
    'bank_mbank_family',
    'mbank',
    'MBank — Семейная карта KGS',
    '4169 •••• 3109',
    'family',
    'KGS',
    null,
    null,
    `whsec_${crypto.randomBytes(16).toString('hex')}`,
    1,
    'active',
    nowIso,
    8,
    nowIso
  );

  db.prepare(`
    INSERT INTO audit_logs (id, user_id, user_name, action, entity_type, summary, space, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    `aud_${crypto.randomBytes(6).toString('hex')}`,
    ownerId,
    ownerName,
    'workspace_initialized',
    'member',
    'Создано рабочее пространство КнигаСчёт и подключены контуры Бизнес, Семейный, Личный',
    null,
    nowIso
  );
}
