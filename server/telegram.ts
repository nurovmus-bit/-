import crypto from 'node:crypto';
import type { LedgerSpace, TelegramDefaultMode } from '../src/types.ts';

const TELEGRAM_API_BASE = 'https://api.telegram.org';

export function isTelegramTokenConfigured(): boolean {
  return Boolean(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_BOT_TOKEN.trim().length > 15);
}

export function isTelegramSecretConfigured(): boolean {
  return Boolean(
    process.env.TELEGRAM_WEBHOOK_SECRET && process.env.TELEGRAM_WEBHOOK_SECRET.trim().length >= 8
  );
}

export function verifyTelegramSecretHeader(headerVal: string | undefined): boolean {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET?.trim() ?? '';
  if (!expected || !headerVal) return false;
  const bufA = Buffer.from(headerVal);
  const bufB = Buffer.from(expected);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function getPublicWebhookUrl(fallbackOrigin?: string): string {
  const raw = process.env.APP_URL?.trim() || fallbackOrigin || '';
  if (!raw || raw === 'MY_APP_URL') return '';
  const clean = raw.replace(/\/+$/, '');
  return `${clean}/api/telegram/webhook`;
}

export async function getTelegramBotInfo(): Promise<{ username: string | null }> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) return { username: null };
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${TELEGRAM_API_BASE}/bot${token}/getMe`, { signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) return { username: null };
    const json = (await res.json()) as { ok?: boolean; result?: { username?: string } };
    return { username: json.ok && json.result?.username ? `@${json.result.username}` : null };
  } catch {
    return { username: null };
  }
}

export async function registerTelegramWebhook(webhookUrl: string): Promise<{ ok: boolean; description: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET?.trim();
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN серверде коюлган эмес (Settings → Secrets бөлүмүнө кошуңуз)');
  }
  if (!secret || secret.length < 8) {
    throw new Error('TELEGRAM_WEBHOOK_SECRET (8+ символ) серверде коюлган эмес');
  }
  if (!webhookUrl.startsWith('https://')) {
    throw new Error('Telegram Webhook үчүн HTTPS дареги талап кылынат');
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  const res = await fetch(`${TELEGRAM_API_BASE}/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: secret,
      allowed_updates: ['message'],
    }),
    signal: controller.signal,
  });
  clearTimeout(timer);

  const json = (await res.json()) as { ok?: boolean; description?: string };
  if (!res.ok || !json.ok) {
    throw new Error(json.description || `Telegram API катасы (${res.status})`);
  }
  return { ok: true, description: json.description || 'Webhook ийгиликтүү кошулду' };
}

export async function sendTelegramMessage(chatId: string | number, text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token || !chatId) return false;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const res = await fetch(`${TELEGRAM_API_BASE}/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: String(chatId),
        text: text.slice(0, 3900),
      }),
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res.ok;
  } catch {
    return false;
  }
}

export async function downloadTelegramPhotoBase64(
  fileId: string
): Promise<{ base64: string; mimeType: string }> {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    throw new Error('TELEGRAM_BOT_TOKEN не настроен');
  }

  const infoController = new AbortController();
  const infoTimer = setTimeout(() => infoController.abort(), 7000);
  const infoRes = await fetch(
    `${TELEGRAM_API_BASE}/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`,
    { signal: infoController.signal }
  );
  clearTimeout(infoTimer);

  if (!infoRes.ok) {
    throw new Error(`Telegram getFile катасы (${infoRes.status})`);
  }

  const infoJson = (await infoRes.json()) as {
    ok?: boolean;
    result?: { file_path?: string; file_size?: number };
  };
  const filePath = infoJson.result?.file_path;
  if (!filePath || !/^[a-zA-Z0-9._/-]+$/.test(filePath) || filePath.includes('..')) {
    throw new Error('Жараксыз Telegram файл жолу');
  }
  if (infoJson.result?.file_size && infoJson.result.file_size > 8 * 1024 * 1024) {
    throw new Error('Сүрөт 8 МБдан чоң');
  }

  const fileController = new AbortController();
  const fileTimer = setTimeout(() => fileController.abort(), 12000);
  const fileRes = await fetch(`${TELEGRAM_API_BASE}/file/bot${token}/${filePath}`, {
    signal: fileController.signal,
  });
  clearTimeout(fileTimer);

  if (!fileRes.ok) {
    throw new Error(`Telegram файл жүктөө катасы (${fileRes.status})`);
  }

  const arrBuf = await fileRes.arrayBuffer();
  const base64 = Buffer.from(arrBuf).toString('base64');
  const lower = filePath.toLowerCase();
  const mimeType = lower.endsWith('.png')
    ? 'image/png'
    : lower.endsWith('.webp')
      ? 'image/webp'
      : 'image/jpeg';

  return { base64, mimeType };
}

export function resolveTelegramRouting(
  captionOrText: string,
  defaultMode: TelegramDefaultMode
): {
  space: LedgerSpace;
  forcedType: 'income' | 'expense';
  paymentMethod: 'cash' | 'cashless';
  siteSyncStatus: 'not_applicable' | 'pending';
  routeLabel: string;
} {
  const lower = captionOrText.toLowerCase();

  const isCash = /(#нал|#наличный|#накталай|\bналичн|\bнакталай)/i.test(lower);
  const isClient = /(#клиент|#приход|#оплата|#сайт|\bклиенттен\b|\bот клиента\b)/i.test(lower);
  const isBusinessExp = /(#бизнес|#закуп|#товар|#офис)/i.test(lower);
  const isFamilyExp = /(#үй|#семья|#семейный|#дом)/i.test(lower);

  if (isClient) {
    return {
      space: 'business',
      forcedType: 'income',
      paymentMethod: isCash ? 'cash' : 'cashless',
      siteSyncStatus: 'pending',
      routeLabel: 'Клиенттен приход → Сайтка',
    };
  }
  if (isBusinessExp) {
    return {
      space: 'business',
      forcedType: 'expense',
      paymentMethod: isCash ? 'cash' : 'cashless',
      siteSyncStatus: 'not_applicable',
      routeLabel: isCash ? 'Бизнес чыгым (Нал)' : 'Бизнес чыгым (Безнал)',
    };
  }
  if (isFamilyExp) {
    return {
      space: 'family',
      forcedType: 'expense',
      paymentMethod: isCash ? 'cash' : 'cashless',
      siteSyncStatus: 'not_applicable',
      routeLabel: isCash ? 'Үй-бүлө чыгымы (Нал)' : 'Үй-бүлө чыгымы (Безнал)',
    };
  }

  // Fallback to configured workspace default mode
  if (defaultMode === 'client_income') {
    return {
      space: 'business',
      forcedType: 'income',
      paymentMethod: isCash ? 'cash' : 'cashless',
      siteSyncStatus: 'pending',
      routeLabel: 'Клиенттен приход → Сайтка',
    };
  }
  if (defaultMode === 'business_expense') {
    return {
      space: 'business',
      forcedType: 'expense',
      paymentMethod: isCash ? 'cash' : 'cashless',
      siteSyncStatus: 'not_applicable',
      routeLabel: 'Бизнес чыгым (Безнал)',
    };
  }
  return {
    space: 'family',
    forcedType: 'expense',
    paymentMethod: isCash ? 'cash' : 'cashless',
    siteSyncStatus: 'not_applicable',
    routeLabel: isCash ? 'Үй-бүлө чыгымы (Нал)' : 'Үй-бүлө чыгымы (Безнал)',
  };
}
