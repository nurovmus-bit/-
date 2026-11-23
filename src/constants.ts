import type { CurrencyCode, LedgerSpace, UserRole } from './types.ts';

export const SPACES: { id: LedgerSpace; label: string; shortLabel: string; description: string }[] = [
  {
    id: 'business',
    label: 'Бизнес',
    shortLabel: 'Бизнес',
    description: 'Выручка, поставщики, ФОТ, аренда, налоги и проекты компании',
  },
  {
    id: 'family',
    label: 'Семейный',
    shortLabel: 'Семья',
    description: 'Общий бюджет дома, продукты, коммунальные услуги, образование и отдых',
  },
  {
    id: 'personal',
    label: 'Личный',
    shortLabel: 'Личный',
    description: 'Личные доходы, накопления, здоровье, транспорт и повседневные траты',
  },
];

export const SPACE_LABELS: Record<LedgerSpace, string> = {
  business: 'Бизнес',
  family: 'Семейный',
  personal: 'Личный',
};

export const ROLE_META: Record<
  UserRole,
  { label: string; description: string; permissions: string }
> = {
  owner: {
    label: 'Владелец',
    description: 'Полный контроль над всеми контурами, участниками и банковскими API',
    permissions: 'Все права',
  },
  admin: {
    label: 'Бухгалтер / Админ',
    description: 'Учёт, редактирование и удаление операций, бюджеты, импорт выписок и управление доступом',
    permissions: 'Чтение, запись, удаление, импорт',
  },
  editor: {
    label: 'Участник',
    description: 'Добавление операций, сканирование чеков MBank и правка собственных записей в разрешённых контурах',
    permissions: 'Чтение, добавление, правка своих',
  },
  viewer: {
    label: 'Наблюдатель',
    description: 'Только просмотр транзакций, бюджетов и аналитических отчётов в разрешённых контурах',
    permissions: 'Только просмотр и отчёты',
  },
};

export const CURRENCIES: {
  code: CurrencyCode;
  symbol: string;
  name: string;
  country: string;
  defaultRateToKgs: number;
}[] = [
  { code: 'KGS', symbol: 'с', name: 'Кыргызский сом', country: 'Кыргызстан', defaultRateToKgs: 1 },
  { code: 'USD', symbol: '$', name: 'Доллар США', country: 'США', defaultRateToKgs: 87.45 },
  { code: 'EUR', symbol: '€', name: 'Евро', country: 'Еврозона', defaultRateToKgs: 94.8 },
  { code: 'RUB', symbol: '₽', name: 'Российский рубль', country: 'Россия', defaultRateToKgs: 0.94 },
  { code: 'KZT', symbol: '₸', name: 'Казахстанский тенге', country: 'Казахстан', defaultRateToKgs: 0.175 },
  { code: 'UZS', symbol: 'сўм', name: 'Узбекский сум', country: 'Узбекистан', defaultRateToKgs: 0.0068 },
  { code: 'TRY', symbol: '₺', name: 'Турецкая лира', country: 'Турция', defaultRateToKgs: 2.48 },
  { code: 'GBP', symbol: '£', name: 'Фунт стерлингов', country: 'Великобритания', defaultRateToKgs: 111.2 },
  { code: 'AED', symbol: 'د.إ', name: 'Дирхам ОАЭ', country: 'ОАЭ', defaultRateToKgs: 23.81 },
  { code: 'CNY', symbol: '¥', name: 'Китайский юань', country: 'Китай', defaultRateToKgs: 12.08 },
];

export const CURRENCY_MAP: Record<CurrencyCode, (typeof CURRENCIES)[number]> = CURRENCIES.reduce(
  (acc, item) => {
    acc[item.code] = item;
    return acc;
  },
  {} as Record<CurrencyCode, (typeof CURRENCIES)[number]>
);

export const CATEGORIES_BY_SPACE: Record<LedgerSpace, { income: string[]; expense: string[] }> = {
  business: {
    income: [
      'Выручка от продаж',
      'Оплата от клиентов (B2B)',
      'Консалтинг и услуги',
      'Инвестиции и займы',
      'Возврат от поставщиков',
    ],
    expense: [
      'Закупка товара и сырья',
      'Аренда офиса и склада',
      'Зарплата и подрядчики',
      'Маркетинг и реклама',
      'Логистика и доставка',
      'Налоги и бухгалтерия',
      'Связь, ПО и подписки',
      'Командировки и ГСМ',
      'Банковские комиссии',
    ],
  },
  family: {
    income: [
      'Зарплата семьи',
      'Доход от бизнеса в семью',
      'Аренда недвижимости',
      'Пособия и кэшбэк',
      'Семейные переводы',
    ],
    expense: [
      'Продукты и супермаркеты',
      'Коммунальные услуги и интернет',
      'Образование и кружки',
      'Медицина и аптека',
      'Дом, ремонт и быт',
      'Семейный отдых и поездки',
      'Одежда и обувь',
      'Транспорт и топливо',
    ],
  },
  personal: {
    income: [
      'Личный доход',
      'Фриланс и премии',
      'Дивиденды и проценты',
      'Переводы от близких',
    ],
    expense: [
      'Кафе и рестораны',
      'Спорт и здоровье',
      'Саморазвитие и книги',
      'Подписки и сервисы',
      'Такси и транспорт',
      'Подарки и хобби',
      'Личные покупки',
    ],
  },
};

export const PAYMENT_SOURCES = [
  'MBank',
  'MBank Бизнес',
  'DemirBank',
  'Optima Bank',
  'Расчётный счёт',
  'Карта Visa / Elcart',
  'Наличные',
  'Kaspi / Т-Банк',
  'Банковский API',
];

export const BANK_PROVIDERS: {
  id: 'mbank' | 'demirbank' | 'optima' | 'kaspi' | 'tbank' | 'custom_api';
  label: string;
  country: string;
  defaultCurrency: CurrencyCode;
  hint: string;
}[] = [
  {
    id: 'mbank',
    label: 'MBank (МБанк)',
    country: 'Кыргызстан',
    defaultCurrency: 'KGS',
    hint: 'Выписки CSV/JSON, Open API шлюз и квитанции переводов MBank',
  },
  {
    id: 'demirbank',
    label: 'DemirBank',
    country: 'Кыргызстан',
    defaultCurrency: 'KGS',
    hint: 'Корпоративный и карточный импорт операций (KGS / USD / EUR)',
  },
  {
    id: 'optima',
    label: 'Optima Bank',
    country: 'Кыргызстан',
    defaultCurrency: 'KGS',
    hint: 'Импорт выписок и вебхуков расчётного счёта',
  },
  {
    id: 'kaspi',
    label: 'Kaspi Bank',
    country: 'Казахстан',
    defaultCurrency: 'KZT',
    hint: 'Автоматический импорт операций в тенге с конвертацией',
  },
  {
    id: 'tbank',
    label: 'Т-Банк / Сбер Бизнес',
    country: 'Россия',
    defaultCurrency: 'RUB',
    hint: 'Open API и выписки по рублёвым счетам',
  },
  {
    id: 'custom_api',
    label: 'Пользовательский Open Banking API',
    country: 'Международный',
    defaultCurrency: 'USD',
    hint: 'Подключение любого HTTPS JSON-эндпоинта или входящего Webhook',
  },
];

export function formatMoney(
  amount: number,
  currency: CurrencyCode = 'KGS',
  showSign = false
): string {
  const meta = CURRENCY_MAP[currency] ?? CURRENCY_MAP.KGS;
  const abs = Math.abs(amount);
  const formatted = new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: currency === 'UZS' ? 0 : abs % 1 === 0 ? 0 : 2,
    maximumFractionDigits: currency === 'UZS' ? 0 : 2,
  }).format(abs);
  const sign = amount < 0 ? '−' : showSign && amount > 0 ? '+' : '';
  return `${sign}${formatted} ${meta.symbol}`;
}

export function convertFromKgs(
  amountInKgs: number,
  targetCurrency: CurrencyCode,
  ratesToKgs: Record<CurrencyCode, number>
): number {
  const rate = ratesToKgs[targetCurrency] || CURRENCY_MAP[targetCurrency]?.defaultRateToKgs || 1;
  return amountInKgs / rate;
}
