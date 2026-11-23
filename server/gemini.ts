import { GoogleGenAI, Type } from '@google/genai';
import { getExchangeRates } from './db.ts';
import type { CurrencyCode, LedgerSpace, OcrReceiptResult, TransactionType } from '../src/types.ts';

const ALLOWED_CURRENCIES: CurrencyCode[] = [
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

const ALLOWED_SPACES: LedgerSpace[] = ['business', 'family', 'personal'];

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY не настроен на сервере. Добавьте ключ в настройках Secrets.');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

const receiptResponseSchema = {
  type: Type.OBJECT,
  properties: {
    isMbankReceipt: {
      type: Type.BOOLEAN,
      description: 'True if this is an MBank / МБанк mobile app receipt, transfer slip, or QR payment receipt.',
    },
    documentType: {
      type: Type.STRING,
      description: 'One of: mbank_transfer, mbank_payment, store_receipt, invoice, other',
    },
    type: {
      type: Type.STRING,
      description: 'Transaction direction: expense or income',
    },
    merchant: {
      type: Type.STRING,
      description: 'Store name, recipient name, service provider, or counterparty.',
    },
    amount: {
      type: Type.NUMBER,
      description: 'Total numeric amount paid or received (positive number).',
    },
    currency: {
      type: Type.STRING,
      description: 'ISO 4217 currency code: KGS, USD, EUR, RUB, KZT, UZS, TRY, GBP, AED, or CNY.',
    },
    date: {
      type: Type.STRING,
      description: 'Transaction date in YYYY-MM-DD format.',
    },
    suggestedSpace: {
      type: Type.STRING,
      description: 'Best matching space: business, family, or personal.',
    },
    suggestedCategory: {
      type: Type.STRING,
      description: 'Concise Russian category name matching standard business/family/personal accounting.',
    },
    paymentSource: {
      type: Type.STRING,
      description: 'Payment method or bank name, e.g. MBank, DemirBank, Карта Visa / Elcart, Наличные.',
    },
    receiptNumber: {
      type: Type.STRING,
      description: 'Receipt number, fiscal ID, or MBank transaction/operation reference if visible.',
    },
    commission: {
      type: Type.NUMBER,
      description: 'Bank transfer fee/commission if shown, else 0.',
    },
    lineItems: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          quantity: { type: Type.NUMBER },
          price: { type: Type.NUMBER },
        },
      },
      description: 'Individual items on the receipt if present.',
    },
    rawTextSummary: {
      type: Type.STRING,
      description: 'Short structured Russian summary of key details read from the receipt.',
    },
    confidenceNote: {
      type: Type.STRING,
      description: 'Short note in Russian about recognition clarity or any ambiguous fields.',
    },
  },
  required: [
    'isMbankReceipt',
    'documentType',
    'type',
    'merchant',
    'amount',
    'currency',
    'date',
    'suggestedSpace',
    'suggestedCategory',
    'paymentSource',
    'receiptNumber',
    'commission',
    'lineItems',
    'rawTextSummary',
    'confidenceNote',
  ],
};

function normalizeCurrency(raw: unknown): CurrencyCode {
  if (typeof raw === 'string') {
    const upper = raw.trim().toUpperCase();
    if (ALLOWED_CURRENCIES.includes(upper as CurrencyCode)) {
      return upper as CurrencyCode;
    }
    if (upper.includes('СОМ') || upper === 'KGS' || upper === 'С') return 'KGS';
    if (upper.includes('$') || upper.includes('USD')) return 'USD';
    if (upper.includes('€') || upper.includes('EUR')) return 'EUR';
    if (upper.includes('₽') || upper.includes('РУБ') || upper.includes('RUR')) return 'RUB';
    if (upper.includes('₸') || upper.includes('ТЕНГЕ') || upper.includes('KZT')) return 'KZT';
    if (upper.includes('СУМ') || upper.includes('UZS')) return 'UZS';
    if (upper.includes('₺') || upper.includes('TL') || upper.includes('TRY')) return 'TRY';
    if (upper.includes('£') || upper.includes('GBP')) return 'GBP';
    if (upper.includes('AED') || upper.includes('ДИРХ')) return 'AED';
    if (upper.includes('¥') || upper.includes('CNY') || upper.includes('RMB')) return 'CNY';
  }
  return 'KGS';
}

function normalizeDate(raw: unknown): string {
  if (typeof raw === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) {
    return raw.trim();
  }
  return new Date().toISOString().slice(0, 10);
}

async function normalizeOcrPayload(
  rawJson: Record<string, unknown>,
  preferredSpace?: LedgerSpace
): Promise<OcrReceiptResult> {
  const ratesInfo = await getExchangeRates();
  const currency = normalizeCurrency(rawJson.currency);
  const amount =
    typeof rawJson.amount === 'number' && Number.isFinite(rawJson.amount) && rawJson.amount > 0
      ? Math.round(rawJson.amount * 100) / 100
      : 0;
  const rate = ratesInfo.rates[currency] ?? 1;
  const convertedAmountKgs = Math.round(amount * rate * 100) / 100;

  const parsedSpace =
    typeof rawJson.suggestedSpace === 'string' &&
    ALLOWED_SPACES.includes(rawJson.suggestedSpace as LedgerSpace)
      ? (rawJson.suggestedSpace as LedgerSpace)
      : preferredSpace ?? 'business';

  const txType: TransactionType = rawJson.type === 'income' ? 'income' : 'expense';
  const validDocTypes = ['mbank_transfer', 'mbank_payment', 'store_receipt', 'invoice', 'other'] as const;
  const documentType = validDocTypes.includes(
    rawJson.documentType as (typeof validDocTypes)[number]
  )
    ? (rawJson.documentType as OcrReceiptResult['documentType'])
    : rawJson.isMbankReceipt
      ? 'mbank_payment'
      : 'store_receipt';

  const lineItems = Array.isArray(rawJson.lineItems)
    ? rawJson.lineItems.slice(0, 30).map((item: unknown) => {
        const obj = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>;
        return {
          name: typeof obj.name === 'string' ? obj.name.slice(0, 120) : 'Позиция',
          quantity: typeof obj.quantity === 'number' && obj.quantity > 0 ? obj.quantity : 1,
          price: typeof obj.price === 'number' && obj.price >= 0 ? obj.price : 0,
        };
      })
    : [];

  return {
    isMbankReceipt: Boolean(rawJson.isMbankReceipt),
    documentType,
    type: txType,
    merchant:
      typeof rawJson.merchant === 'string' && rawJson.merchant.trim()
        ? rawJson.merchant.trim().slice(0, 120)
        : 'Неизвестный контрагент',
    amount,
    currency,
    date: normalizeDate(rawJson.date),
    suggestedSpace: preferredSpace ?? parsedSpace,
    suggestedCategory:
      typeof rawJson.suggestedCategory === 'string' && rawJson.suggestedCategory.trim()
        ? rawJson.suggestedCategory.trim().slice(0, 80)
        : txType === 'income'
          ? 'Выручка от продаж'
          : 'Продукты и супермаркеты',
    paymentSource:
      typeof rawJson.paymentSource === 'string' && rawJson.paymentSource.trim()
        ? rawJson.paymentSource.trim().slice(0, 60)
        : rawJson.isMbankReceipt
          ? 'MBank'
          : 'Карта Visa / Elcart',
    receiptNumber:
      typeof rawJson.receiptNumber === 'string' ? rawJson.receiptNumber.trim().slice(0, 80) : '',
    commission:
      typeof rawJson.commission === 'number' && Number.isFinite(rawJson.commission) && rawJson.commission >= 0
        ? rawJson.commission
        : 0,
    lineItems,
    rawTextSummary:
      typeof rawJson.rawTextSummary === 'string' ? rawJson.rawTextSummary.trim().slice(0, 500) : '',
    confidenceNote:
      typeof rawJson.confidenceNote === 'string'
        ? rawJson.confidenceNote.trim().slice(0, 240)
        : 'Распознано автоматически',
    convertedAmountKgs,
    exchangeRateToKgs: rate,
  };
}

export async function recognizeReceiptImage(
  base64Data: string,
  mimeType: string,
  preferredSpace?: LedgerSpace
): Promise<OcrReceiptResult> {
  const ai = getGeminiClient();
  const today = new Date().toISOString().slice(0, 10);

  const prompt = `Ты — высокоточный финансовый OCR-движок системы учёта «КнигаСчёт».
Проанализируй изображение чека, фискальной квитанции, счёта или скриншота квитанции из мобильного банка (включая квитанции MBank / МБанк Кыргызстан, QR-оплаты, банковские переводы и бумажные чеки разных стран).

Правила извлечения:
1. Определи, является ли документ квитанцией MBank (МБанк): логотип MBank, зелёная/белая квитанция перевода, "Квитанция об оплате", "Перевод по номеру", реквизиты ОАО "Коммерческий банк КЫРГЫЗСТАН" / MBANK.
2. Извлеки итоговую сумму (total) как положительное число. Если указана комиссия отдельно, запиши её в commission.
3. Точно определи валюту разных стран по символам, тексту и языку чека: KGS (сом / с), USD ($), EUR (€), RUB (₽ / руб), KZT (₸ / тг), UZS (сум / so'm), TRY (₺ / TL), GBP (£), AED (د.إ), CNY (¥).
4. Определи направление операции: 'income' (входящий перевод, пополнение, зачисление) или 'expense' (оплата, покупка, исходящий перевод).
5. Извлеки дату операции в формате YYYY-MM-DD. Если год или дата не видны, используй ${today}.
6. Извлеки контрагента/магазин/получателя, номер квитанции/транзакции и позиции чека (если есть).
7. Предложи подходящий контур ('business', 'family', 'personal') и категорию на русском языке.
Ответь строго в JSON по заданной схеме.`;

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: {
      parts: [
        {
          inlineData: {
            mimeType,
            data: base64Data,
          },
        },
        { text: prompt },
      ],
    },
    config: {
      responseMimeType: 'application/json',
      responseSchema: receiptResponseSchema,
    },
  });

  const text = (response.text ?? '{}').trim();
  const parsed = JSON.parse(text) as Record<string, unknown>;
  return normalizeOcrPayload(parsed, preferredSpace);
}

export async function recognizeReceiptText(
  receiptText: string,
  preferredSpace?: LedgerSpace
): Promise<OcrReceiptResult> {
  const ai = getGeminiClient();
  const today = new Date().toISOString().slice(0, 10);

  const prompt = `Ты — финансовый парсер квитанций, SMS и push-уведомлений банков (включая MBank / МБанк, DemirBank, Optima, Kaspi, Т-Банк) и чеков разных стран.
Разбери следующий текст квитанции/уведомления и верни структурированный JSON. Если дата не указана, используй ${today}.
Текст документа:
"""
${receiptText.slice(0, 4000)}
"""`;

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: prompt,
    config: {
      responseMimeType: 'application/json',
      responseSchema: receiptResponseSchema,
    },
  });

  const text = (response.text ?? '{}').trim();
  const parsed = JSON.parse(text) as Record<string, unknown>;
  return normalizeOcrPayload(parsed, preferredSpace);
}
