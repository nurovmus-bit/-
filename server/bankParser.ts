import crypto from 'node:crypto';
import dns from 'node:dns/promises';
import net from 'node:net';
import type { CurrencyCode, LedgerSpace, TransactionType } from '../src/types.ts';

export interface ParsedBankRecord {
  date: string;
  type: TransactionType;
  amount: number;
  currency: CurrencyCode;
  merchant: string;
  description: string;
  category: string;
  externalRef: string;
  receiptRef: string | null;
}

const VALID_CURRENCIES: CurrencyCode[] = [
  'KGS',
  'USD',
  'EUR',
  'RUB',
  'KZT',
  'UZS',
  'TRY',
  'GBP',
  'AED',
  'CNY',
];

function guessCurrency(raw: unknown, fallback: CurrencyCode): CurrencyCode {
  if (typeof raw !== 'string' || !raw.trim()) return fallback;
  const s = raw.trim().toUpperCase();
  if (VALID_CURRENCIES.includes(s as CurrencyCode)) return s as CurrencyCode;
  if (s.includes('СОМ') || s === 'С') return 'KGS';
  if (s.includes('$') || s.includes('USD')) return 'USD';
  if (s.includes('€') || s.includes('EUR')) return 'EUR';
  if (s.includes('₽') || s.includes('РУБ')) return 'RUB';
  if (s.includes('₸') || s.includes('KZT')) return 'KZT';
  if (s.includes('UZS') || s.includes('СУМ')) return 'UZS';
  if (s.includes('TRY') || s.includes('₺')) return 'TRY';
  if (s.includes('GBP') || s.includes('£')) return 'GBP';
  if (s.includes('AED')) return 'AED';
  if (s.includes('CNY') || s.includes('¥')) return 'CNY';
  return fallback;
}

function guessCategory(text: string, type: TransactionType, space: LedgerSpace): string {
  const lower = text.toLowerCase();
  if (type === 'income') {
    if (lower.includes('зарплат') || lower.includes('salary')) return 'Зарплата семьи';
    if (lower.includes('договор') || lower.includes('счет') || lower.includes('b2b') || lower.includes('оплата')) {
      return space === 'business' ? 'Оплата от клиентов (B2B)' : 'Личный доход';
    }
    return space === 'business' ? 'Выручка от продаж' : space === 'family' ? 'Семейные переводы' : 'Личный доход';
  }
  if (lower.includes('globus') || lower.includes('народный') || lower.includes('фрунзе') || lower.includes('продукт') || lower.includes('маркет')) {
    return 'Продукты и супермаркеты';
  }
  if (lower.includes('аренд') || lower.includes('офис') || lower.includes('бц')) return 'Аренда офиса и склада';
  if (lower.includes('реклам') || lower.includes('meta') || lower.includes('google ads') || lower.includes('instagram')) {
    return 'Маркетинг и реклама';
  }
  if (lower.includes('северэлектро') || lower.includes('акнет') || lower.includes('комм') || lower.includes('бишкектепло')) {
    return 'Коммунальные услуги и интернет';
  }
  if (lower.includes('яндекс') || lower.includes('такси') || lower.includes('азс') || lower.includes('газпром') || lower.includes('топлив')) {
    return space === 'business' ? 'Логистика и доставка' : 'Транспорт и топливо';
  }
  if (lower.includes('кафе') || lower.includes('кофе') || lower.includes('рестор') || lower.includes('sierra')) {
    return 'Кафе и рестораны';
  }
  if (lower.includes('налог') || lower.includes('гнс') || lower.includes('соцфонд')) return 'Налоги и бухгалтерия';
  if (lower.includes('аптек') || lower.includes('клиник') || lower.includes('мед')) return 'Медицина и аптека';
  return space === 'business' ? 'Закупка товара и сырья' : space === 'family' ? 'Дом, ремонт и быт' : 'Личные покупки';
}

function normalizeDateString(raw: string): string {
  const s = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const dmy = s.match(/^(\d{2})[./-](\d{2})[./-](\d{4})/);
  if (dmy) return `${dmy[3]}-${dmy[2]}-${dmy[1]}`;
  return new Date().toISOString().slice(0, 10);
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      out.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  out.push(current.trim());
  return out;
}

export function parseBankStatementContent(
  content: string,
  defaultCurrency: CurrencyCode,
  defaultSpace: LedgerSpace,
  connectionId: string
): ParsedBankRecord[] {
  const trimmed = content.trim();
  if (!trimmed) return [];

  // JSON format (array or { transactions: [...] })
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed) as unknown;
    const rows = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).transactions)
        ? ((parsed as Record<string, unknown>).transactions as unknown[])
        : [];

    const results: ParsedBankRecord[] = [];
    for (let i = 0; i < Math.min(rows.length, 500); i++) {
      const item = rows[i];
      if (!item || typeof item !== 'object') continue;
      const obj = item as Record<string, unknown>;
      const rawAmount = Number(
        typeof obj.amount === 'string'
          ? obj.amount.replace(/\s+/g, '').replace(',', '.')
          : obj.amount
      );
      if (!Number.isFinite(rawAmount) || rawAmount === 0) continue;

      let type: TransactionType = rawAmount < 0 ? 'expense' : 'income';
      if (obj.type === 'expense' || obj.type === 'debit' || obj.direction === 'out') type = 'expense';
      if (obj.type === 'income' || obj.type === 'credit' || obj.direction === 'in') type = 'income';

      const amount = Math.round(Math.abs(rawAmount) * 100) / 100;
      const currency = guessCurrency(obj.currency, defaultCurrency);
      const date = normalizeDateString(String(obj.date ?? obj.timestamp ?? ''));
      const merchant = String(obj.merchant ?? obj.counterparty ?? obj.recipient ?? obj.title ?? 'Банковская операция').slice(0, 120);
      const description = String(obj.description ?? obj.purpose ?? obj.note ?? '').slice(0, 240);
      const receiptRef = obj.receiptRef || obj.reference || obj.id ? String(obj.receiptRef ?? obj.reference ?? obj.id).slice(0, 80) : null;
      const hashInput = `${connectionId}|${date}|${type}|${amount}|${currency}|${merchant}|${receiptRef ?? i}`;
      const externalRef = `bnk_${crypto.createHash('sha256').update(hashInput).digest('hex').slice(0, 20)}`;

      results.push({
        date,
        type,
        amount,
        currency,
        merchant,
        description,
        category:
          typeof obj.category === 'string' && obj.category.trim()
            ? obj.category.trim().slice(0, 80)
            : guessCategory(`${merchant} ${description}`, type, defaultSpace),
        externalRef,
        receiptRef,
      });
    }
    return results;
  }

  // CSV / TSV statement (MBank, DemirBank, Optima, Kaspi, T-Bank)
  const lines = trimmed.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const firstLine = lines[0];
  const delimiter = firstLine.includes(';') ? ';' : firstLine.includes('\t') ? '\t' : ',';
  const headers = splitCsvLine(firstLine, delimiter).map((h) => h.toLowerCase());

  const findCol = (patterns: string[]) =>
    headers.findIndex((h) => patterns.some((p) => h.includes(p)));

  const dateCol = findCol(['дата', 'date', 'время', 'time']);
  const amountCol = findCol(['сумм', 'amount', 'итого', 'sum']);
  const currencyCol = findCol(['валют', 'currency', 'curr']);
  const typeCol = findCol(['тип', 'type', 'операц', 'направл', 'direction']);
  const merchantCol = findCol(['контрагент', 'получател', 'merchant', 'магазин', 'название', 'name', 'отправител']);
  const descCol = findCol(['описан', 'назначен', 'комментар', 'description', 'details', 'purpose']);
  const refCol = findCol(['квитанц', 'номер', 'ref', 'id', 'документ']);

  if (amountCol === -1) return [];

  const results: ParsedBankRecord[] = [];
  for (let i = 1; i < Math.min(lines.length, 501); i++) {
    const cols = splitCsvLine(lines[i], delimiter);
    const rawAmountStr = (cols[amountCol] ?? '').replace(/\s+/g, '').replace(',', '.').replace(/[^\d.+-]/g, '');
    const rawNum = Number(rawAmountStr);
    if (!Number.isFinite(rawNum) || rawNum === 0) continue;

    const rawType = typeCol >= 0 ? (cols[typeCol] ?? '').toLowerCase() : '';
    let type: TransactionType = rawNum < 0 ? 'expense' : 'income';
    if (rawType.includes('расх') || rawType.includes('спис') || rawType.includes('debit') || rawType.includes('expense') || rawType.includes('оплат')) {
      type = 'expense';
    } else if (rawType.includes('прих') || rawType.includes('доход') || rawType.includes('поступ') || rawType.includes('credit') || rawType.includes('income')) {
      type = 'income';
    }

    const amount = Math.round(Math.abs(rawNum) * 100) / 100;
    const date = dateCol >= 0 ? normalizeDateString(cols[dateCol] ?? '') : new Date().toISOString().slice(0, 10);
    const currency = currencyCol >= 0 ? guessCurrency(cols[currencyCol], defaultCurrency) : defaultCurrency;
    const merchant = (merchantCol >= 0 && cols[merchantCol] ? cols[merchantCol] : descCol >= 0 && cols[descCol] ? cols[descCol] : 'Банковская выписка').slice(0, 120);
    const description = descCol >= 0 && cols[descCol] ? cols[descCol].slice(0, 240) : '';
    const receiptRef = refCol >= 0 && cols[refCol] ? cols[refCol].slice(0, 80) : null;
    const hashInput = `${connectionId}|${date}|${type}|${amount}|${currency}|${merchant}|${receiptRef ?? i}`;
    const externalRef = `csv_${crypto.createHash('sha256').update(hashInput).digest('hex').slice(0, 20)}`;

    results.push({
      date,
      type,
      amount,
      currency,
      merchant,
      description,
      category: guessCategory(`${merchant} ${description}`, type, defaultSpace),
      externalRef,
      receiptRef,
    });
  }

  return results;
}

function isPrivateIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const parts = ip.split('.').map(Number);
    if (parts[0] === 10) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 0) return true;
    if (parts[0] === 169 && parts[1] === 254) return true;
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true;
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    return (
      lower === '::1' ||
      lower === '::' ||
      lower.startsWith('fc') ||
      lower.startsWith('fd') ||
      lower.startsWith('fe80') ||
      lower.startsWith('::ffff:127.') ||
      lower.startsWith('::ffff:10.') ||
      lower.startsWith('::ffff:192.168.') ||
      lower.startsWith('::ffff:169.254.')
    );
  }
  return true;
}

export async function validateExternalBankUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error('Некорректный формат URL банковского API');
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('Разрешены только защищённые HTTPS-эндпоинты банковского API');
  }
  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname === 'metadata.google.internal'
  ) {
    throw new Error('Внутренние и локальные хосты запрещены для внешнего API');
  }
  if (net.isIP(hostname) && isPrivateIp(hostname)) {
    throw new Error('Приватные IP-адреса запрещены для внешнего API');
  }
  const resolved = await dns.lookup(hostname, { all: true });
  if (!resolved.length || resolved.some((entry) => isPrivateIp(entry.address))) {
    throw new Error('Адрес банковского API указывает на внутреннюю сеть и заблокирован');
  }
  return parsed;
}
