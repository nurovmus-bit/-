import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';
import {
  db,
  getExchangeRates,
  getRateToKgsSync,
  seedStarterWorkspace,
} from './server/db.ts';
import {
  authenticateToken,
  canManageBanks,
  canManageUsers,
  canReadSpace,
  canWriteSpace,
  createSession,
  hashPassword,
  isValidRole,
  isValidSpace,
  requireAuth,
  rowToUserProfile,
  verifyPassword,
} from './server/auth.ts';
import type { AuthenticatedRequest } from './server/auth.ts';
import { recognizeReceiptImage, recognizeReceiptText } from './server/gemini.ts';
import { parseBankStatementContent, validateExternalBankUrl } from './server/bankParser.ts';
import {
  downloadTelegramPhotoBase64,
  getPublicWebhookUrl,
  getTelegramBotInfo,
  isTelegramSecretConfigured,
  isTelegramTokenConfigured,
  registerTelegramWebhook,
  resolveTelegramRouting,
  sendTelegramMessage,
  verifyTelegramSecretHeader,
} from './server/telegram.ts';
import type {
  AuditLogEntry,
  BankConnection,
  BudgetProject,
  CashAccount,
  CatalogItem,
  CatalogKind,
  CurrencyCode,
  DebtDirection,
  DebtRecord,
  DebtStatus,
  LedgerSpace,
  MonthlyLimits,
  PaymentMethod,
  PresenceUser,
  RealtimeEvent,
  SiteSyncStatus,
  StagedGood,
  TelegramConfig,
  TelegramDefaultMode,
  TelegramInboxItem,
  Transaction,
  UserProfile,
  UserRole,
} from './src/types.ts';

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

function isValidCurrency(val: unknown): val is CurrencyCode {
  return typeof val === 'string' && VALID_CURRENCIES.includes(val as CurrencyCode);
}

interface AuthedSocket {
  ws: WebSocket;
  user: UserProfile;
  connectedAt: string;
}

const activeSockets = new Set<AuthedSocket>();

function broadcastPresence(): void {
  const uniqueMap = new Map<string, PresenceUser>();
  for (const client of activeSockets) {
    if (!uniqueMap.has(client.user.id)) {
      uniqueMap.set(client.user.id, {
        id: client.user.id,
        name: client.user.name,
        role: client.user.role,
        connectedAt: client.connectedAt,
      });
    }
  }
  const payload = JSON.stringify({
    type: 'presence:update',
    users: Array.from(uniqueMap.values()),
  } satisfies RealtimeEvent);

  for (const client of activeSockets) {
    if (client.ws.readyState === WebSocket.OPEN) {
      client.ws.send(payload);
    }
  }
}

function broadcastEvent(event: RealtimeEvent, targetSpace?: LedgerSpace | null): void {
  const payload = JSON.stringify(event);
  for (const client of activeSockets) {
    if (client.ws.readyState !== WebSocket.OPEN) continue;
    if (targetSpace && !client.user.allowedSpaces.includes(targetSpace)) continue;
    client.ws.send(payload);
  }
}

function recordAudit(
  userId: string,
  userName: string,
  action: string,
  entityType: AuditLogEntry['entityType'],
  summary: string,
  space: LedgerSpace | null = null
): AuditLogEntry {
  const entry: AuditLogEntry = {
    id: `aud_${crypto.randomBytes(6).toString('hex')}`,
    userId,
    userName,
    action,
    entityType,
    summary: summary.slice(0, 300),
    space,
    createdAt: new Date().toISOString(),
  };
  db.prepare(
    `INSERT INTO audit_logs (id, user_id, user_name, action, entity_type, summary, space, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    entry.id,
    entry.userId,
    entry.userName,
    entry.action,
    entry.entityType,
    entry.summary,
    entry.space,
    entry.createdAt
  );
  broadcastEvent({ type: 'audit:created', entry }, space);
  return entry;
}

function mapTransactionRow(row: Record<string, unknown>): Transaction {
  return {
    id: String(row.id),
    space: row.space as LedgerSpace,
    type: row.type as Transaction['type'],
    paymentMethod: row.payment_method === 'cash' ? 'cash' : 'cashless',
    siteSyncStatus:
      row.site_sync_status === 'pending' || row.site_sync_status === 'synced'
        ? (row.site_sync_status as SiteSyncStatus)
        : 'not_applicable',
    clientContact: row.client_contact ? String(row.client_contact) : null,
    amount: Number(row.amount),
    currency: row.currency as CurrencyCode,
    amountInKgs: Number(row.amount_in_kgs),
    exchangeRate: Number(row.exchange_rate),
    category: String(row.category),
    projectId: row.project_id ? String(row.project_id) : null,
    merchant: String(row.merchant),
    description: String(row.description ?? ''),
    paymentSource: String(row.payment_source ?? 'MBank'),
    date: String(row.date),
    receiptRef: row.receipt_ref ? String(row.receipt_ref) : null,
    externalRef: row.external_ref ? String(row.external_ref) : null,
    sourceChannel: (row.source_channel as Transaction['sourceChannel']) ?? 'manual',
    createdBy: String(row.created_by),
    createdByName: String(row.created_by_name),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapGoodRow(row: Record<string, unknown>): StagedGood {
  return {
    id: String(row.id),
    productName: String(row.product_name),
    sku: String(row.sku ?? ''),
    quantity: Number(row.quantity),
    unit: String(row.unit ?? 'шт'),
    unitCost: Number(row.unit_cost),
    currency: row.currency as CurrencyCode,
    totalCostKgs: Number(row.total_cost_kgs),
    sellingPrice: row.selling_price !== null && row.selling_price !== undefined ? Number(row.selling_price) : null,
    supplier: String(row.supplier ?? ''),
    paymentMethod: row.payment_method === 'cash' ? 'cash' : 'cashless',
    receiptRef: row.receipt_ref ? String(row.receipt_ref) : null,
    notes: String(row.notes ?? ''),
    siteStatus: row.site_status === 'uploaded' ? 'uploaded' : 'pending',
    linkedTxId: row.linked_tx_id ? String(row.linked_tx_id) : null,
    createdBy: String(row.created_by),
    createdByName: String(row.created_by_name),
    createdAt: String(row.created_at),
    uploadedAt: row.uploaded_at ? String(row.uploaded_at) : null,
  };
}

function mapBudgetRow(row: Record<string, unknown>): BudgetProject {
  return {
    id: String(row.id),
    name: String(row.name),
    kind: row.kind as BudgetProject['kind'],
    space: row.space as LedgerSpace,
    category: row.category ? String(row.category) : null,
    limitAmount: Number(row.limit_amount),
    currency: row.currency as CurrencyCode,
    limitInKgs: Number(row.limit_in_kgs),
    period: row.period as BudgetProject['period'],
    description: String(row.description ?? ''),
    createdBy: String(row.created_by),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapBankRow(row: Record<string, unknown>): BankConnection {
  const secret = String(row.webhook_secret ?? '');
  return {
    id: String(row.id),
    provider: row.provider as BankConnection['provider'],
    name: String(row.name),
    accountMask: String(row.account_mask),
    defaultSpace: row.default_space as LedgerSpace,
    currency: row.currency as CurrencyCode,
    apiEndpoint: row.api_endpoint ? String(row.api_endpoint) : null,
    hasApiToken: Boolean(row.api_token && String(row.api_token).length > 0),
    webhookSecretPrefix: secret.length > 10 ? `${secret.slice(0, 10)}••••` : '••••',
    autoImportEnabled: Boolean(row.auto_import_enabled),
    status: row.status as BankConnection['status'],
    lastSyncAt: row.last_sync_at ? String(row.last_sync_at) : null,
    lastSyncCount: Number(row.last_sync_count ?? 0),
    createdAt: String(row.created_at),
  };
}

function mapAccountRow(row: Record<string, unknown>): CashAccount {
  return {
    id: String(row.id),
    name: String(row.name),
    kind: row.kind === 'cash' ? 'cash' : 'cashless',
    currency: (row.currency as CurrencyCode) || 'KGS',
    openingBalance: Number(row.opening_balance ?? 0),
    openingDate: String(row.opening_date),
    lastActualBalance:
      row.last_actual_balance !== null && row.last_actual_balance !== undefined
        ? Number(row.last_actual_balance)
        : null,
    lastReconciledAt: row.last_reconciled_at ? String(row.last_reconciled_at) : null,
    updatedAt: String(row.updated_at),
  };
}

function mapDebtRow(row: Record<string, unknown>): DebtRecord {
  return {
    id: String(row.id),
    direction: row.direction === 'we_owe' ? 'we_owe' : 'client_owes',
    space: (row.space as LedgerSpace) || 'business',
    counterparty: String(row.counterparty),
    contact: String(row.contact ?? ''),
    totalAmount: Number(row.total_amount),
    paidAmount: Number(row.paid_amount ?? 0),
    currency: (row.currency as CurrencyCode) || 'KGS',
    totalInKgs: Number(row.total_in_kgs),
    paidInKgs: Number(row.paid_in_kgs ?? 0),
    dueDate: row.due_date ? String(row.due_date) : null,
    notes: String(row.notes ?? ''),
    status: (row.status as DebtStatus) || 'open',
    createdBy: String(row.created_by),
    createdByName: String(row.created_by_name),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapTelegramInboxRow(row: Record<string, unknown>): TelegramInboxItem {
  return {
    id: String(row.id),
    chatId: String(row.chat_id),
    senderName: String(row.sender_name),
    messageType: row.message_type === 'photo' ? 'photo' : 'text',
    caption: String(row.caption ?? ''),
    routedTo: String(row.routed_to ?? ''),
    status:
      row.status === 'saved' || row.status === 'ignored' || row.status === 'error'
        ? row.status
        : 'ignored',
    summary: String(row.summary ?? ''),
    linkedTxId: row.linked_tx_id ? String(row.linked_tx_id) : null,
    createdAt: String(row.created_at),
  };
}

function getTelegramSettingsRow(): {
  allowedChatIds: string[];
  defaultPhotoMode: TelegramDefaultMode;
  autoReply: boolean;
  dailySummaryChatId: string;
  webhookRegisteredAt: string | null;
} {
  const row = db
    .prepare(`SELECT * FROM telegram_settings WHERE id = 'default'`)
    .get() as Record<string, unknown> | undefined;

  let allowed: string[] = [];
  if (row?.allowed_chat_ids) {
    try {
      const parsed = JSON.parse(String(row.allowed_chat_ids));
      if (Array.isArray(parsed)) {
        allowed = parsed.map((v) => String(v).trim()).filter(Boolean);
      }
    } catch {
      allowed = [];
    }
  }
  const mode = String(row?.default_photo_mode ?? 'family_expense');
  const defaultPhotoMode: TelegramDefaultMode =
    mode === 'client_income' || mode === 'business_expense' ? mode : 'family_expense';

  return {
    allowedChatIds: allowed,
    defaultPhotoMode,
    autoReply: row ? Boolean(row.auto_reply) : true,
    dailySummaryChatId: row?.daily_summary_chat_id ? String(row.daily_summary_chat_id) : '',
    webhookRegisteredAt: row?.webhook_registered_at ? String(row.webhook_registered_at) : null,
  };
}

function buildDailySummaryText(): string {
  const today = new Date().toISOString().slice(0, 10);
  const todayTxs = db
    .prepare(`SELECT * FROM transactions WHERE date = ?`)
    .all(today) as Record<string, unknown>[];

  let famCash = 0;
  let famCashless = 0;
  let bizCash = 0;
  let bizCashless = 0;
  let bizIncToday = 0;

  for (const r of todayTxs) {
    const kgs = Number(r.amount_in_kgs ?? 0);
    const isCash = r.payment_method === 'cash';
    if (r.type === 'expense') {
      if (r.space === 'family') {
        if (isCash) famCash += kgs;
        else famCashless += kgs;
      } else if (r.space === 'business') {
        if (isCash) bizCash += kgs;
        else bizCashless += kgs;
      }
    } else if (r.space === 'business') {
      bizIncToday += kgs;
    }
  }

  const pendingClients = db
    .prepare(
      `SELECT COUNT(*) as cnt, COALESCE(SUM(amount_in_kgs), 0) as total
       FROM transactions
       WHERE space = 'business' AND type = 'income' AND site_sync_status = 'pending'`
    )
    .get() as { cnt: number; total: number };

  const pendingGoods = db
    .prepare(
      `SELECT COUNT(*) as cnt, COALESCE(SUM(total_cost_kgs), 0) as total
       FROM staged_goods
       WHERE site_status = 'pending'`
    )
    .get() as { cnt: number; total: number };

  const openClientDebts = db
    .prepare(
      `SELECT COUNT(*) as cnt, COALESCE(SUM(total_in_kgs - paid_in_kgs), 0) as rem
       FROM debts
       WHERE direction = 'client_owes' AND status != 'paid'`
    )
    .get() as { cnt: number; rem: number };

  const openSupplierDebts = db
    .prepare(
      `SELECT COUNT(*) as cnt, COALESCE(SUM(total_in_kgs - paid_in_kgs), 0) as rem
       FROM debts
       WHERE direction = 'we_owe' AND status != 'paid'`
    )
    .get() as { cnt: number; rem: number };

  const fmt = (n: number) => `${Math.round(n).toLocaleString('ru-RU')} KGS`;

  return [
    `КнигаСчёт · Күндүн жыйынтыгы (${today})`,
    ``,
    `Үй-бүлөлүк чыгым (бүгүн): ${fmt(famCash + famCashless)}`,
    `  • Нал: ${fmt(famCash)} | Безнал: ${fmt(famCashless)}`,
    `Бизнес чыгым (бүгүн): ${fmt(bizCash + bizCashless)}`,
    `  • Нал: ${fmt(bizCash)} | Безнал: ${fmt(bizCashless)}`,
    `Бизнес приход (бүгүн): +${fmt(bizIncToday)}`,
    ``,
    `Сайтка түшүрүү керек:`,
    `  • Клиенттен приход: ${pendingClients.cnt} даана (${fmt(pendingClients.total)})`,
    `  • Убактылуу товарлар: ${pendingGoods.cnt} даана (${fmt(pendingGoods.total)})`,
    ``,
    `Карыздар / Насия:`,
    `  • Клиенттер бизге карыз: ${openClientDebts.cnt} (${fmt(openClientDebts.rem)})`,
    `  • Биз поставщиктерге карыз: ${openSupplierDebts.cnt} (${fmt(openSupplierDebts.rem)})`,
  ].join('\n');
}

function insertTransactionRecord(params: {
  space: LedgerSpace;
  type: 'income' | 'expense';
  paymentMethod?: PaymentMethod;
  siteSyncStatus?: SiteSyncStatus;
  clientContact?: string | null;
  amount: number;
  currency: CurrencyCode;
  category: string;
  projectId: string | null;
  merchant: string;
  description: string;
  paymentSource: string;
  date: string;
  receiptRef: string | null;
  externalRef: string | null;
  sourceChannel: Transaction['sourceChannel'];
  userId: string;
  userName: string;
}): Transaction {
  const rate = getRateToKgsSync(params.currency);
  const amountInKgs = Math.round(params.amount * rate * 100) / 100;
  const nowIso = new Date().toISOString();
  const id = `tx_${crypto.randomBytes(6).toString('hex')}`;
  const derivedMethod: PaymentMethod =
    params.paymentMethod ??
    (params.paymentSource.toLowerCase().includes('налич') ||
    params.paymentSource.toLowerCase().includes('накта')
      ? 'cash'
      : 'cashless');
  const syncStatus: SiteSyncStatus = params.siteSyncStatus ?? 'not_applicable';

  db.prepare(
    `INSERT INTO transactions (
      id, space, type, payment_method, site_sync_status, client_contact, amount, currency, amount_in_kgs, exchange_rate,
      category, project_id, merchant, description, payment_source, date,
      receipt_ref, external_ref, source_channel, created_by, created_by_name, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    params.space,
    params.type,
    derivedMethod,
    syncStatus,
    params.clientContact ? params.clientContact.slice(0, 120) : null,
    params.amount,
    params.currency,
    amountInKgs,
    rate,
    params.category.slice(0, 80),
    params.projectId,
    params.merchant.slice(0, 120),
    params.description.slice(0, 400),
    params.paymentSource.slice(0, 60),
    params.date,
    params.receiptRef ? params.receiptRef.slice(0, 80) : null,
    params.externalRef ? params.externalRef.slice(0, 80) : null,
    params.sourceChannel,
    params.userId,
    params.userName,
    nowIso,
    nowIso
  );

  const row = db.prepare(`SELECT * FROM transactions WHERE id = ?`).get(id) as Record<string, unknown>;
  return mapTransactionRow(row);
}

async function startServer(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '12mb' }));

  // Warm exchange rates on startup
  void getExchangeRates();

  // ================= AUTH ROUTES =================
  app.get('/api/auth/status', (_req, res) => {
    const countRow = db.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number };
    res.json({ hasUsers: countRow.cnt > 0 });
  });

  app.post('/api/auth/bootstrap', (req, res) => {
    const countRow = db.prepare('SELECT COUNT(*) as cnt FROM users').get() as { cnt: number };
    if (countRow.cnt > 0) {
      res.status(409).json({ error: 'Рабочее пространство уже настроено. Выполните вход.' });
      return;
    }

    const { name, email, password, seedDemo } = req.body ?? {};
    if (typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 80) {
      res.status(400).json({ error: 'Укажите имя (от 2 до 80 символов)' });
      return;
    }
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      res.status(400).json({ error: 'Укажите корректный email' });
      return;
    }
    if (typeof password !== 'string' || password.length < 6 || password.length > 128) {
      res.status(400).json({ error: 'Пароль должен содержать от 6 до 128 символов' });
      return;
    }

    const id = `usr_${crypto.randomBytes(6).toString('hex')}`;
    const cleanEmail = email.trim().toLowerCase();
    const cleanName = name.trim();
    const nowIso = new Date().toISOString();
    const spaces: LedgerSpace[] = ['business', 'family', 'personal'];

    db.prepare(
      `INSERT INTO users (id, name, email, password_hash, role, allowed_spaces, created_at, last_active_at)
       VALUES (?, ?, ?, ?, 'owner', ?, ?, ?)`
    ).run(id, cleanName, cleanEmail, hashPassword(password), JSON.stringify(spaces), nowIso, nowIso);

    if (seedDemo !== false) {
      seedStarterWorkspace(id, cleanName);
    }

    const token = createSession(id);
    const user: UserProfile = {
      id,
      name: cleanName,
      email: cleanEmail,
      role: 'owner',
      allowedSpaces: spaces,
      createdAt: nowIso,
      lastActiveAt: nowIso,
    };

    res.status(201).json({ token, user });
  });

  app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body ?? {};
    if (typeof email !== 'string' || typeof password !== 'string') {
      res.status(400).json({ error: 'Введите email и пароль' });
      return;
    }

    const row = db
      .prepare(`SELECT * FROM users WHERE email = ?`)
      .get(email.trim().toLowerCase()) as
      | {
          id: string;
          name: string;
          email: string;
          password_hash: string;
          role: string;
          allowed_spaces: string;
          created_at: string;
          last_active_at: string | null;
        }
      | undefined;

    if (!row || !verifyPassword(password, row.password_hash)) {
      res.status(401).json({ error: 'Неверный email или пароль' });
      return;
    }

    const token = createSession(row.id);
    res.json({ token, user: rowToUserProfile(row) });
  });

  app.post('/api/auth/logout', requireAuth, (req: AuthenticatedRequest, res) => {
    if (req.tokenHash) {
      db.prepare(`DELETE FROM sessions WHERE token_hash = ?`).run(req.tokenHash);
    }
    res.json({ ok: true });
  });

  app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res) => {
    res.json({ user: req.user });
  });

  // ================= EXCHANGE RATES =================
  app.get('/api/rates', requireAuth, async (_req, res) => {
    const data = await getExchangeRates();
    res.json(data);
  });

  // ================= TRANSACTIONS =================
  app.get('/api/transactions', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    if (user.allowedSpaces.length === 0) {
      res.json({ transactions: [] });
      return;
    }
    const placeholders = user.allowedSpaces.map(() => '?').join(', ');
    const rows = db
      .prepare(
        `SELECT * FROM transactions WHERE space IN (${placeholders}) ORDER BY date DESC, created_at DESC LIMIT 1000`
      )
      .all(...user.allowedSpaces) as Record<string, unknown>[];

    res.json({ transactions: rows.map(mapTransactionRow) });
  });

  app.post('/api/transactions', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    const body = req.body ?? {};
    const {
      space,
      type,
      paymentMethod,
      siteSyncStatus,
      clientContact,
      amount,
      currency,
      category,
      projectId,
      merchant,
      description,
      paymentSource,
      date,
      receiptRef,
      sourceChannel,
    } = body;

    if (!isValidSpace(space)) {
      res.status(400).json({ error: 'Некорректный контур учёта' });
      return;
    }
    if (!canWriteSpace(user, space)) {
      res.status(403).json({ error: 'Недостаточно прав для добавления записей в этот контур' });
      return;
    }
    if (type !== 'income' && type !== 'expense') {
      res.status(400).json({ error: 'Тип операции должен быть income или expense' });
      return;
    }
    const numAmount = Number(amount);
    if (!Number.isFinite(numAmount) || numAmount <= 0 || numAmount > 1_000_000_000) {
      res.status(400).json({ error: 'Сумма должна быть положительным числом' });
      return;
    }
    if (!isValidCurrency(currency)) {
      res.status(400).json({ error: 'Неподдерживаемая валюта' });
      return;
    }
    if (typeof category !== 'string' || category.trim().length < 1) {
      res.status(400).json({ error: 'Укажите категорию операции' });
      return;
    }
    if (typeof merchant !== 'string' || merchant.trim().length < 1) {
      res.status(400).json({ error: 'Укажите контрагента или назначение' });
      return;
    }
    const cleanDate =
      typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
        ? date
        : new Date().toISOString().slice(0, 10);

    let verifiedProjectId: string | null = null;
    if (typeof projectId === 'string' && projectId.trim()) {
      const budget = db
        .prepare(`SELECT id, space FROM budgets WHERE id = ?`)
        .get(projectId.trim()) as { id: string; space: string } | undefined;
      if (budget && budget.space === space) {
        verifiedProjectId = budget.id;
      }
    }

    const allowedChannels = ['manual', 'ocr_camera', 'ocr_upload', 'bank_api', 'bank_file', 'webhook'] as const;
    const channel = allowedChannels.includes(sourceChannel) ? sourceChannel : 'manual';
    const cleanPaymentMethod: PaymentMethod | undefined =
      paymentMethod === 'cash' || paymentMethod === 'cashless' ? paymentMethod : undefined;
    const cleanSyncStatus: SiteSyncStatus =
      siteSyncStatus === 'pending' || siteSyncStatus === 'synced' || siteSyncStatus === 'not_applicable'
        ? siteSyncStatus
        : 'not_applicable';

    const tx = insertTransactionRecord({
      space,
      type,
      paymentMethod: cleanPaymentMethod,
      siteSyncStatus: cleanSyncStatus,
      clientContact: typeof clientContact === 'string' && clientContact.trim() ? clientContact.trim() : null,
      amount: Math.round(numAmount * 100) / 100,
      currency,
      category: category.trim(),
      projectId: verifiedProjectId,
      merchant: merchant.trim(),
      description: typeof description === 'string' ? description.trim() : '',
      paymentSource:
        typeof paymentSource === 'string' && paymentSource.trim()
          ? paymentSource.trim()
          : cleanPaymentMethod === 'cash'
            ? 'Наличные'
            : 'MBank',
      date: cleanDate,
      receiptRef: typeof receiptRef === 'string' && receiptRef.trim() ? receiptRef.trim() : null,
      externalRef: null,
      sourceChannel: channel,
      userId: user.id,
      userName: user.name,
    });

    broadcastEvent({ type: 'transaction:created', transaction: tx }, tx.space);
    recordAudit(
      user.id,
      user.name,
      'tx_create',
      'transaction',
      `${tx.type === 'income' ? 'Приход' : 'Расход'} ${tx.amount} ${tx.currency} — ${tx.merchant}`,
      tx.space
    );

    res.status(201).json({ transaction: tx });
  });

  app.patch('/api/transactions/:id', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    const existingRow = db
      .prepare(`SELECT * FROM transactions WHERE id = ?`)
      .get(req.params.id) as Record<string, unknown> | undefined;

    if (!existingRow) {
      res.status(404).json({ error: 'Операция не найдена' });
      return;
    }

    const existing = mapTransactionRow(existingRow);
    const canModify =
      (user.role === 'owner' || user.role === 'admin') && canReadSpace(user, existing.space)
        ? true
        : user.role === 'editor' &&
          canReadSpace(user, existing.space) &&
          existing.createdBy === user.id;

    if (!canModify) {
      res.status(403).json({ error: 'Нет прав на редактирование этой операции' });
      return;
    }

    const body = req.body ?? {};
    const nextSpace = isValidSpace(body.space) ? body.space : existing.space;
    if (!canWriteSpace(user, nextSpace)) {
      res.status(403).json({ error: 'Нет прав на перенос в указанный контур' });
      return;
    }
    const nextType = body.type === 'income' || body.type === 'expense' ? body.type : existing.type;
    const nextAmount =
      body.amount !== undefined && Number.isFinite(Number(body.amount)) && Number(body.amount) > 0
        ? Math.round(Number(body.amount) * 100) / 100
        : existing.amount;
    const nextCurrency = isValidCurrency(body.currency) ? body.currency : existing.currency;
    const rate = getRateToKgsSync(nextCurrency);
    const nextAmountInKgs = Math.round(nextAmount * rate * 100) / 100;
    const nextCategory =
      typeof body.category === 'string' && body.category.trim()
        ? body.category.trim().slice(0, 80)
        : existing.category;
    const nextMerchant =
      typeof body.merchant === 'string' && body.merchant.trim()
        ? body.merchant.trim().slice(0, 120)
        : existing.merchant;
    const nextDesc =
      typeof body.description === 'string' ? body.description.trim().slice(0, 400) : existing.description;
    const nextPaymentSource =
      typeof body.paymentSource === 'string' && body.paymentSource.trim()
        ? body.paymentSource.trim().slice(0, 60)
        : existing.paymentSource;
    const nextDate =
      typeof body.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.date)
        ? body.date
        : existing.date;
    const nextReceiptRef =
      body.receiptRef !== undefined
        ? typeof body.receiptRef === 'string' && body.receiptRef.trim()
          ? body.receiptRef.trim().slice(0, 80)
          : null
        : existing.receiptRef;

    let nextProjectId: string | null = existing.projectId;
    if (body.projectId !== undefined) {
      if (body.projectId === null || body.projectId === '') {
        nextProjectId = null;
      } else if (typeof body.projectId === 'string') {
        const b = db
          .prepare(`SELECT id, space FROM budgets WHERE id = ?`)
          .get(body.projectId) as { id: string; space: string } | undefined;
        nextProjectId = b && b.space === nextSpace ? b.id : null;
      }
    }

    const nextPaymentMethod: PaymentMethod =
      body.paymentMethod === 'cash' || body.paymentMethod === 'cashless'
        ? body.paymentMethod
        : existing.paymentMethod;
    const nextSiteSyncStatus: SiteSyncStatus =
      body.siteSyncStatus === 'pending' ||
      body.siteSyncStatus === 'synced' ||
      body.siteSyncStatus === 'not_applicable'
        ? body.siteSyncStatus
        : existing.siteSyncStatus;
    const nextClientContact =
      body.clientContact !== undefined
        ? typeof body.clientContact === 'string' && body.clientContact.trim()
          ? body.clientContact.trim().slice(0, 120)
          : null
        : existing.clientContact;

    const updatedAt = new Date().toISOString();
    db.prepare(
      `UPDATE transactions SET
        space = ?, type = ?, payment_method = ?, site_sync_status = ?, client_contact = ?,
        amount = ?, currency = ?, amount_in_kgs = ?, exchange_rate = ?,
        category = ?, project_id = ?, merchant = ?, description = ?, payment_source = ?,
        date = ?, receipt_ref = ?, updated_at = ?
       WHERE id = ?`
    ).run(
      nextSpace,
      nextType,
      nextPaymentMethod,
      nextSiteSyncStatus,
      nextClientContact,
      nextAmount,
      nextCurrency,
      nextAmountInKgs,
      rate,
      nextCategory,
      nextProjectId,
      nextMerchant,
      nextDesc,
      nextPaymentSource,
      nextDate,
      nextReceiptRef,
      updatedAt,
      existing.id
    );

    const updatedRow = db.prepare(`SELECT * FROM transactions WHERE id = ?`).get(existing.id) as Record<
      string,
      unknown
    >;
    const updated = mapTransactionRow(updatedRow);
    broadcastEvent({ type: 'transaction:updated', transaction: updated }, updated.space);
    recordAudit(
      user.id,
      user.name,
      'tx_update',
      'transaction',
      `Обновлена операция «${updated.merchant}» (${updated.amount} ${updated.currency})`,
      updated.space
    );

    res.json({ transaction: updated });
  });

  app.delete('/api/transactions/:id', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    const existingRow = db
      .prepare(`SELECT * FROM transactions WHERE id = ?`)
      .get(req.params.id) as Record<string, unknown> | undefined;

    if (!existingRow) {
      res.status(404).json({ error: 'Операция не найдена' });
      return;
    }

    const existing = mapTransactionRow(existingRow);
    const canDelete =
      (user.role === 'owner' || user.role === 'admin') && canReadSpace(user, existing.space)
        ? true
        : user.role === 'editor' &&
          canReadSpace(user, existing.space) &&
          existing.createdBy === user.id;

    if (!canDelete) {
      res.status(403).json({ error: 'Нет прав на удаление этой операции' });
      return;
    }

    db.prepare(`DELETE FROM transactions WHERE id = ?`).run(existing.id);
    broadcastEvent({ type: 'transaction:deleted', id: existing.id, space: existing.space }, existing.space);
    recordAudit(
      user.id,
      user.name,
      'tx_delete',
      'transaction',
      `Удалена операция «${existing.merchant}» (${existing.amount} ${existing.currency})`,
      existing.space
    );

    res.json({ ok: true });
  });

  // ================= BUDGETS & PROJECTS =================
  app.get('/api/budgets', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    if (user.allowedSpaces.length === 0) {
      res.json({ budgets: [] });
      return;
    }
    const placeholders = user.allowedSpaces.map(() => '?').join(', ');
    const rows = db
      .prepare(`SELECT * FROM budgets WHERE space IN (${placeholders}) ORDER BY created_at DESC`)
      .all(...user.allowedSpaces) as Record<string, unknown>[];

    res.json({ budgets: rows.map(mapBudgetRow) });
  });

  app.post('/api/budgets', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    const { name, kind, space, category, limitAmount, currency, period, description } = req.body ?? {};

    if (!isValidSpace(space) || !canWriteSpace(user, space)) {
      res.status(403).json({ error: 'Недостаточно прав для создания бюджета в этом контуре' });
      return;
    }
    if (typeof name !== 'string' || name.trim().length < 2) {
      res.status(400).json({ error: 'Укажите название проекта или бюджета' });
      return;
    }
    if (kind !== 'project' && kind !== 'category') {
      res.status(400).json({ error: 'Укажите тип: project или category' });
      return;
    }
    const numLimit = Number(limitAmount);
    if (!Number.isFinite(numLimit) || numLimit <= 0) {
      res.status(400).json({ error: 'Лимит бюджета должен быть положительным числом' });
      return;
    }
    const curr: CurrencyCode = isValidCurrency(currency) ? currency : 'KGS';
    const validPeriods = ['monthly', 'quarterly', 'total'] as const;
    const per = validPeriods.includes(period) ? period : 'monthly';
    const rate = getRateToKgsSync(curr);
    const limitInKgs = Math.round(numLimit * rate * 100) / 100;

    const id = `bud_${crypto.randomBytes(6).toString('hex')}`;
    const nowIso = new Date().toISOString();

    db.prepare(
      `INSERT INTO budgets (
        id, name, kind, space, category, limit_amount, currency, limit_in_kgs,
        period, description, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      name.trim().slice(0, 100),
      kind,
      space,
      kind === 'category' && typeof category === 'string' && category.trim() ? category.trim().slice(0, 80) : null,
      Math.round(numLimit * 100) / 100,
      curr,
      limitInKgs,
      per,
      typeof description === 'string' ? description.trim().slice(0, 300) : '',
      user.id,
      nowIso,
      nowIso
    );

    const row = db.prepare(`SELECT * FROM budgets WHERE id = ?`).get(id) as Record<string, unknown>;
    const budget = mapBudgetRow(row);
    broadcastEvent({ type: 'budget:created', budget }, budget.space);
    recordAudit(
      user.id,
      user.name,
      'budget_create',
      'budget',
      `Создан ${budget.kind === 'project' ? 'проект' : 'бюджет категории'} «${budget.name}» (${budget.limitAmount} ${budget.currency})`,
      budget.space
    );

    res.status(201).json({ budget });
  });

  app.delete('/api/budgets/:id', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    const row = db.prepare(`SELECT * FROM budgets WHERE id = ?`).get(req.params.id) as
      | Record<string, unknown>
      | undefined;

    if (!row) {
      res.status(404).json({ error: 'Бюджет не найден' });
      return;
    }
    const budget = mapBudgetRow(row);
    if (!(user.role === 'owner' || user.role === 'admin') || !canReadSpace(user, budget.space)) {
      res.status(403).json({ error: 'Удалять бюджеты могут только владелец и бухгалтер/админ' });
      return;
    }

    db.prepare(`DELETE FROM budgets WHERE id = ?`).run(budget.id);
    broadcastEvent({ type: 'budget:deleted', id: budget.id, space: budget.space }, budget.space);
    recordAudit(
      user.id,
      user.name,
      'budget_delete',
      'budget',
      `Удалён бюджет «${budget.name}»`,
      budget.space
    );
    res.json({ ok: true });
  });

  // ================= MEMBERS & RBAC =================
  app.get('/api/members', requireAuth, (_req, res) => {
    const rows = db
      .prepare(
        `SELECT id, name, email, role, allowed_spaces, created_at, last_active_at FROM users ORDER BY created_at ASC`
      )
      .all() as {
      id: string;
      name: string;
      email: string;
      role: string;
      allowed_spaces: string;
      created_at: string;
      last_active_at: string | null;
    }[];
    res.json({ members: rows.map(rowToUserProfile) });
  });

  app.post('/api/members', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    if (!canManageUsers(user)) {
      res.status(403).json({ error: 'Добавлять участников могут только владелец или администратор' });
      return;
    }

    const { name, email, password, role, allowedSpaces } = req.body ?? {};
    if (typeof name !== 'string' || name.trim().length < 2) {
      res.status(400).json({ error: 'Укажите имя участника' });
      return;
    }
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      res.status(400).json({ error: 'Укажите корректный email' });
      return;
    }
    if (typeof password !== 'string' || password.length < 6) {
      res.status(400).json({ error: 'Установите временный пароль (минимум 6 символов)' });
      return;
    }
    if (!isValidRole(role)) {
      res.status(400).json({ error: 'Некорректная роль' });
      return;
    }
    if (role === 'owner' && user.role !== 'owner') {
      res.status(403).json({ error: 'Назначать роль владельца может только текущий владелец' });
      return;
    }

    const spaces: LedgerSpace[] = Array.isArray(allowedSpaces)
      ? allowedSpaces.filter(isValidSpace)
      : ['family'];
    if (spaces.length === 0) {
      res.status(400).json({ error: 'Выберите хотя бы один доступный контур учёта' });
      return;
    }

    const cleanEmail = email.trim().toLowerCase();
    const exists = db.prepare(`SELECT id FROM users WHERE email = ?`).get(cleanEmail);
    if (exists) {
      res.status(409).json({ error: 'Участник с таким email уже существует' });
      return;
    }

    const id = `usr_${crypto.randomBytes(6).toString('hex')}`;
    const nowIso = new Date().toISOString();
    db.prepare(
      `INSERT INTO users (id, name, email, password_hash, role, allowed_spaces, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(id, name.trim().slice(0, 80), cleanEmail, hashPassword(password), role, JSON.stringify(spaces), nowIso);

    const member: UserProfile = {
      id,
      name: name.trim().slice(0, 80),
      email: cleanEmail,
      role: role as UserRole,
      allowedSpaces: spaces,
      createdAt: nowIso,
    };

    broadcastEvent({ type: 'member:changed' });
    recordAudit(
      user.id,
      user.name,
      'member_add',
      'member',
      `Добавлен участник ${member.name} (${member.role}) с доступом: ${spaces.join(', ')}`
    );

    res.status(201).json({ member });
  });

  app.patch('/api/members/:id', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    if (!canManageUsers(user)) {
      res.status(403).json({ error: 'Изменять права могут только владелец или администратор' });
      return;
    }
    const target = db
      .prepare(`SELECT * FROM users WHERE id = ?`)
      .get(req.params.id) as
      | {
          id: string;
          name: string;
          email: string;
          role: string;
          allowed_spaces: string;
          created_at: string;
          last_active_at: string | null;
        }
      | undefined;

    if (!target) {
      res.status(404).json({ error: 'Участник не найден' });
      return;
    }
    if (target.role === 'owner' && user.role !== 'owner') {
      res.status(403).json({ error: 'Нельзя изменять права владельца' });
      return;
    }

    const { role, allowedSpaces } = req.body ?? {};
    const nextRole = isValidRole(role) ? role : (target.role as UserRole);
    if (nextRole === 'owner' && user.role !== 'owner') {
      res.status(403).json({ error: 'Назначать роль владельца может только владелец' });
      return;
    }
    if (target.id === user.id && target.role === 'owner' && nextRole !== 'owner') {
      res.status(400).json({ error: 'Владелец не может понизить собственную роль' });
      return;
    }

    const nextSpaces: LedgerSpace[] = Array.isArray(allowedSpaces)
      ? allowedSpaces.filter(isValidSpace)
      : rowToUserProfile(target).allowedSpaces;

    if (nextSpaces.length === 0) {
      res.status(400).json({ error: 'У участника должен быть хотя бы один контур' });
      return;
    }

    db.prepare(`UPDATE users SET role = ?, allowed_spaces = ? WHERE id = ?`).run(
      nextRole,
      JSON.stringify(nextSpaces),
      target.id
    );

    // Sync active WebSocket permissions immediately
    for (const sock of activeSockets) {
      if (sock.user.id === target.id) {
        sock.user = { ...sock.user, role: nextRole, allowedSpaces: nextSpaces };
      }
    }

    broadcastEvent({ type: 'member:changed' });
    broadcastPresence();
    recordAudit(
      user.id,
      user.name,
      'member_update',
      'member',
      `Обновлены права для ${target.name}: роль ${nextRole}, контуры ${nextSpaces.join(', ')}`
    );

    res.json({
      member: {
        ...rowToUserProfile(target),
        role: nextRole,
        allowedSpaces: nextSpaces,
      },
    });
  });

  app.delete('/api/members/:id', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    if (!canManageUsers(user)) {
      res.status(403).json({ error: 'Удалять участников могут только владелец или администратор' });
      return;
    }
    if (req.params.id === user.id) {
      res.status(400).json({ error: 'Нельзя удалить собственную учётную запись' });
      return;
    }
    const target = db.prepare(`SELECT id, name, role FROM users WHERE id = ?`).get(req.params.id) as
      | { id: string; name: string; role: string }
      | undefined;

    if (!target) {
      res.status(404).json({ error: 'Участник не найден' });
      return;
    }
    if (target.role === 'owner') {
      res.status(403).json({ error: 'Нельзя удалить владельца пространства' });
      return;
    }

    db.prepare(`DELETE FROM users WHERE id = ?`).run(target.id);
    broadcastEvent({ type: 'member:changed' });
    recordAudit(user.id, user.name, 'member_delete', 'member', `Удалён участник ${target.name}`);
    res.json({ ok: true });
  });

  // ================= AUDIT LOG =================
  app.get('/api/audit', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    const rows = db
      .prepare(`SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 80`)
      .all() as Record<string, unknown>[];

    const entries: AuditLogEntry[] = rows
      .filter((r) => !r.space || user.allowedSpaces.includes(r.space as LedgerSpace))
      .map((r) => ({
        id: String(r.id),
        userId: String(r.user_id),
        userName: String(r.user_name),
        action: String(r.action),
        entityType: r.entity_type as AuditLogEntry['entityType'],
        summary: String(r.summary),
        space: r.space ? (r.space as LedgerSpace) : null,
        createdAt: String(r.created_at),
      }));

    res.json({ entries });
  });

  // ================= OCR RECEIPT & MBANK SCANNER =================
  app.post('/api/ocr/scan-receipt', requireAuth, async (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    if (user.role === 'viewer') {
      res.status(403).json({ error: 'Наблюдатель не может сканировать и добавлять чеки' });
      return;
    }

    const { imageBase64, mimeType, preferredSpace, autoSave, sourceChannel, forcedType, siteSyncStatus } =
      req.body ?? {};
    const allowedMimes = ['image/jpeg', 'image/png', 'image/webp'];
    if (typeof imageBase64 !== 'string' || imageBase64.length < 100) {
      res.status(400).json({ error: 'Передайте корректное изображение чека или квитанции' });
      return;
    }
    const cleanMime = typeof mimeType === 'string' && allowedMimes.includes(mimeType) ? mimeType : 'image/jpeg';
    const cleanBase64 = imageBase64.includes(',') ? imageBase64.split(',')[1] : imageBase64;
    const prefSpace: LedgerSpace | undefined =
      isValidSpace(preferredSpace) && canWriteSpace(user, preferredSpace)
        ? preferredSpace
        : user.allowedSpaces[0];

    try {
      const ocr = await recognizeReceiptImage(cleanBase64, cleanMime, prefSpace);
      if (forcedType === 'income' || forcedType === 'expense') {
        ocr.type = forcedType;
      }
      let savedTransaction: Transaction | null = null;
      const syncStatus: SiteSyncStatus =
        siteSyncStatus === 'pending' || siteSyncStatus === 'synced' ? siteSyncStatus : 'not_applicable';

      if (autoSave && ocr.amount > 0 && canWriteSpace(user, ocr.suggestedSpace)) {
        savedTransaction = insertTransactionRecord({
          space: ocr.suggestedSpace,
          type: ocr.type,
          paymentMethod: 'cashless',
          siteSyncStatus: syncStatus,
          amount: ocr.amount,
          currency: ocr.currency,
          category: ocr.suggestedCategory,
          projectId: null,
          merchant: ocr.merchant,
          description: ocr.rawTextSummary || (ocr.isMbankReceipt ? 'Квитанция MBank (авто-OCR)' : 'Чек (авто-OCR)'),
          paymentSource: ocr.paymentSource,
          date: ocr.date,
          receiptRef: ocr.receiptNumber || null,
          externalRef: null,
          sourceChannel: sourceChannel === 'ocr_camera' ? 'ocr_camera' : 'ocr_upload',
          userId: user.id,
          userName: user.name,
        });
        broadcastEvent({ type: 'transaction:created', transaction: savedTransaction }, savedTransaction.space);
        recordAudit(
          user.id,
          user.name,
          'ocr_autosave',
          'ocr',
          `Распознан и занесён ${ocr.isMbankReceipt ? 'чек MBank' : 'чек'}: ${ocr.merchant} (${ocr.amount} ${ocr.currency})`,
          savedTransaction.space
        );
      }

      res.json({ ocr, savedTransaction });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Не удалось распознать чек';
      res.status(502).json({ error: message });
    }
  });

  app.post('/api/ocr/parse-text', requireAuth, async (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    if (user.role === 'viewer') {
      res.status(403).json({ error: 'Недостаточно прав для импорта квитанций' });
      return;
    }

    const { text, preferredSpace, autoSave, forcedType, siteSyncStatus } = req.body ?? {};
    if (typeof text !== 'string' || text.trim().length < 5) {
      res.status(400).json({ error: 'Вставьте текст квитанции MBank или SMS-уведомления' });
      return;
    }
    const prefSpace: LedgerSpace | undefined =
      isValidSpace(preferredSpace) && canWriteSpace(user, preferredSpace)
        ? preferredSpace
        : user.allowedSpaces[0];

    try {
      const ocr = await recognizeReceiptText(text.trim(), prefSpace);
      if (forcedType === 'income' || forcedType === 'expense') {
        ocr.type = forcedType;
      }
      let savedTransaction: Transaction | null = null;
      const syncStatus: SiteSyncStatus =
        siteSyncStatus === 'pending' || siteSyncStatus === 'synced' ? siteSyncStatus : 'not_applicable';

      if (autoSave && ocr.amount > 0 && canWriteSpace(user, ocr.suggestedSpace)) {
        savedTransaction = insertTransactionRecord({
          space: ocr.suggestedSpace,
          type: ocr.type,
          paymentMethod: 'cashless',
          siteSyncStatus: syncStatus,
          amount: ocr.amount,
          currency: ocr.currency,
          category: ocr.suggestedCategory,
          projectId: null,
          merchant: ocr.merchant,
          description: ocr.rawTextSummary || 'Распознано из текста квитанции',
          paymentSource: ocr.paymentSource,
          date: ocr.date,
          receiptRef: ocr.receiptNumber || null,
          externalRef: null,
          sourceChannel: 'ocr_upload',
          userId: user.id,
          userName: user.name,
        });
        broadcastEvent({ type: 'transaction:created', transaction: savedTransaction }, savedTransaction.space);
      }
      res.json({ ocr, savedTransaction });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Ошибка распознавания текста';
      res.status(502).json({ error: message });
    }
  });

  // ================= STAGED PURCHASED GOODS (FOR WEBSITE UPLOAD) =================
  app.get('/api/goods', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    if (!canReadSpace(user, 'business')) {
      res.json({ goods: [] });
      return;
    }
    const rows = db
      .prepare(`SELECT * FROM staged_goods ORDER BY CASE WHEN site_status = 'pending' THEN 0 ELSE 1 END, created_at DESC LIMIT 500`)
      .all() as Record<string, unknown>[];
    res.json({ goods: rows.map(mapGoodRow) });
  });

  app.post('/api/goods', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    if (!canWriteSpace(user, 'business')) {
      res.status(403).json({ error: 'Нет прав для записи закупленных товаров в контур Бизнес' });
      return;
    }

    const {
      productName,
      category,
      sku,
      quantity,
      unit,
      unitCost,
      currency,
      sellingPrice,
      supplier,
      paymentMethod,
      receiptRef,
      notes,
      recordAsBusinessExpense,
    } = req.body ?? {};

    if (typeof productName !== 'string' || productName.trim().length < 2) {
      res.status(400).json({ error: 'Укажите название товара' });
      return;
    }
    const qty = Number(quantity);
    const cost = Number(unitCost);
    if (!Number.isFinite(qty) || qty <= 0 || qty > 1_000_000) {
      res.status(400).json({ error: 'Укажите корректное количество' });
      return;
    }
    if (!Number.isFinite(cost) || cost <= 0 || cost > 1_000_000_000) {
      res.status(400).json({ error: 'Укажите закупочную цену за единицу' });
      return;
    }
    const curr: CurrencyCode = isValidCurrency(currency) ? currency : 'KGS';
    const rate = getRateToKgsSync(curr);
    const totalNative = Math.round(qty * cost * 100) / 100;
    const totalKgs = Math.round(totalNative * rate * 100) / 100;
    const sellNum =
      sellingPrice !== undefined && sellingPrice !== null && sellingPrice !== '' && Number(sellingPrice) > 0
        ? Math.round(Number(sellingPrice) * 100) / 100
        : null;
    const method: PaymentMethod = paymentMethod === 'cash' ? 'cash' : 'cashless';
    const resolvedCategory =
      typeof category === 'string' && category.trim()
        ? category.trim().slice(0, 80)
        : 'Закупка товара и сырья';

    let linkedTx: Transaction | null = null;
    if (recordAsBusinessExpense !== false) {
      linkedTx = insertTransactionRecord({
        space: 'business',
        type: 'expense',
        paymentMethod: method,
        siteSyncStatus: 'not_applicable',
        amount: totalNative,
        currency: curr,
        category: resolvedCategory,
        projectId: null,
        merchant: typeof supplier === 'string' && supplier.trim() ? supplier.trim() : productName.trim(),
        description: `${productName.trim()} (${qty} ${typeof unit === 'string' && unit.trim() ? unit.trim() : 'шт'} × ${cost} ${curr})`,
        paymentSource: method === 'cash' ? 'Наличные' : 'MBank Бизнес',
        date: new Date().toISOString().slice(0, 10),
        receiptRef: typeof receiptRef === 'string' && receiptRef.trim() ? receiptRef.trim() : null,
        externalRef: null,
        sourceChannel: 'manual',
        userId: user.id,
        userName: user.name,
      });
      broadcastEvent({ type: 'transaction:created', transaction: linkedTx }, 'business');
    }

    const id = `gd_${crypto.randomBytes(6).toString('hex')}`;
    const nowIso = new Date().toISOString();

    db.prepare(
      `INSERT INTO staged_goods (
        id, product_name, sku, quantity, unit, unit_cost, currency, total_cost_kgs,
        selling_price, supplier, payment_method, receipt_ref, notes, site_status,
        linked_tx_id, created_by, created_by_name, created_at, uploaded_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, NULL)`
    ).run(
      id,
      productName.trim().slice(0, 140),
      typeof sku === 'string' ? sku.trim().slice(0, 60) : '',
      qty,
      typeof unit === 'string' && unit.trim() ? unit.trim().slice(0, 20) : 'шт',
      cost,
      curr,
      totalKgs,
      sellNum,
      typeof supplier === 'string' ? supplier.trim().slice(0, 120) : '',
      method,
      typeof receiptRef === 'string' && receiptRef.trim() ? receiptRef.trim().slice(0, 80) : null,
      typeof notes === 'string' ? notes.trim().slice(0, 300) : '',
      linkedTx?.id ?? null,
      user.id,
      user.name,
      nowIso
    );

    const row = db.prepare(`SELECT * FROM staged_goods WHERE id = ?`).get(id) as Record<string, unknown>;
    const good = mapGoodRow(row);
    broadcastEvent({ type: 'good:created', good }, 'business');
    recordAudit(
      user.id,
      user.name,
      'good_create',
      'goods',
      `Добавлен товар на сайт: ${good.productName} (${good.quantity} ${good.unit}, ${totalNative} ${good.currency})`,
      'business'
    );

    res.status(201).json({ good, linkedTransaction: linkedTx });
  });

  app.patch('/api/goods/:id', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    if (!canWriteSpace(user, 'business')) {
      res.status(403).json({ error: 'Недостаточно прав для обновления товаров' });
      return;
    }
    const existingRow = db.prepare(`SELECT * FROM staged_goods WHERE id = ?`).get(req.params.id) as
      | Record<string, unknown>
      | undefined;
    if (!existingRow) {
      res.status(404).json({ error: 'Товар не найден' });
      return;
    }

    const existing = mapGoodRow(existingRow);
    const body = req.body ?? {};
    const nextStatus =
      body.siteStatus === 'uploaded' || body.siteStatus === 'pending'
        ? body.siteStatus
        : existing.siteStatus;
    const uploadedAt =
      nextStatus === 'uploaded'
        ? existing.uploadedAt ?? new Date().toISOString()
        : null;
    const nextSell =
      body.sellingPrice !== undefined
        ? body.sellingPrice === null || body.sellingPrice === ''
          ? null
          : Number(body.sellingPrice)
        : existing.sellingPrice;
    const nextNotes = typeof body.notes === 'string' ? body.notes.trim().slice(0, 300) : existing.notes;
    const nextSku = typeof body.sku === 'string' ? body.sku.trim().slice(0, 60) : existing.sku;

    db.prepare(
      `UPDATE staged_goods SET site_status = ?, uploaded_at = ?, selling_price = ?, notes = ?, sku = ? WHERE id = ?`
    ).run(nextStatus, uploadedAt, nextSell, nextNotes, nextSku, existing.id);

    const updatedRow = db.prepare(`SELECT * FROM staged_goods WHERE id = ?`).get(existing.id) as Record<
      string,
      unknown
    >;
    const updated = mapGoodRow(updatedRow);
    broadcastEvent({ type: 'good:updated', good: updated }, 'business');
    recordAudit(
      user.id,
      user.name,
      'good_update',
      'goods',
      `${updated.siteStatus === 'uploaded' ? 'Товар внесён на сайт' : 'Возвращён в ожидание'}: ${updated.productName}`,
      'business'
    );

    res.json({ good: updated });
  });

  app.delete('/api/goods/:id', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    const existingRow = db.prepare(`SELECT * FROM staged_goods WHERE id = ?`).get(req.params.id) as
      | Record<string, unknown>
      | undefined;
    if (!existingRow) {
      res.status(404).json({ error: 'Товар не найден' });
      return;
    }
    const existing = mapGoodRow(existingRow);
    const canDelete =
      (user.role === 'owner' || user.role === 'admin') && canReadSpace(user, 'business')
        ? true
        : user.role === 'editor' && existing.createdBy === user.id;

    if (!canDelete) {
      res.status(403).json({ error: 'Нет прав на удаление этого товара' });
      return;
    }

    db.prepare(`DELETE FROM staged_goods WHERE id = ?`).run(existing.id);
    broadcastEvent({ type: 'good:deleted', id: existing.id }, 'business');
    recordAudit(user.id, user.name, 'good_delete', 'goods', `Удалён временный товар: ${existing.productName}`, 'business');
    res.json({ ok: true });
  });

  // ================= CASHBOX ACCOUNTS & RECONCILIATION =================
  app.get('/api/accounts', requireAuth, (_req, res) => {
    const rows = db
      .prepare(`SELECT * FROM cash_accounts ORDER BY CASE WHEN kind = 'cash' THEN 0 ELSE 1 END`)
      .all() as Record<string, unknown>[];
    res.json({ accounts: rows.map(mapAccountRow) });
  });

  app.patch('/api/accounts/:id', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    if (user.role === 'viewer') {
      res.status(403).json({ error: 'Недостаточно прав для изменения остатков кассы' });
      return;
    }
    const existingRow = db.prepare(`SELECT * FROM cash_accounts WHERE id = ?`).get(req.params.id) as
      | Record<string, unknown>
      | undefined;
    if (!existingRow) {
      res.status(404).json({ error: 'Счёт кассы не найден' });
      return;
    }
    const existing = mapAccountRow(existingRow);
    const body = req.body ?? {};
    const nextBalance =
      body.openingBalance !== undefined && Number.isFinite(Number(body.openingBalance))
        ? Math.round(Number(body.openingBalance) * 100) / 100
        : existing.openingBalance;
    const nextDate =
      typeof body.openingDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.openingDate)
        ? body.openingDate
        : existing.openingDate;
    const nextName =
      typeof body.name === 'string' && body.name.trim().length >= 2
        ? body.name.trim().slice(0, 80)
        : existing.name;
    const nowIso = new Date().toISOString();

    db.prepare(
      `UPDATE cash_accounts SET name = ?, opening_balance = ?, opening_date = ?, updated_at = ? WHERE id = ?`
    ).run(nextName, nextBalance, nextDate, nowIso, existing.id);

    const updatedRow = db.prepare(`SELECT * FROM cash_accounts WHERE id = ?`).get(existing.id) as Record<
      string,
      unknown
    >;
    const account = mapAccountRow(updatedRow);
    broadcastEvent({ type: 'account:updated', account });
    recordAudit(
      user.id,
      user.name,
      'cashbox_update',
      'cashbox',
      `Обновлён стартовый остаток «${account.name}»: ${account.openingBalance} ${account.currency} (с ${account.openingDate})`
    );
    res.json({ account });
  });

  app.post('/api/accounts/:id/reconcile', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    if (user.role === 'viewer') {
      res.status(403).json({ error: 'Недостаточно прав для сверки кассы' });
      return;
    }
    const existingRow = db.prepare(`SELECT * FROM cash_accounts WHERE id = ?`).get(req.params.id) as
      | Record<string, unknown>
      | undefined;
    if (!existingRow) {
      res.status(404).json({ error: 'Счёт не найден' });
      return;
    }
    const actual = Number(req.body?.actualBalance);
    if (!Number.isFinite(actual)) {
      res.status(400).json({ error: 'Укажите фактический остаток числом' });
      return;
    }
    const nowIso = new Date().toISOString();
    const rounded = Math.round(actual * 100) / 100;
    db.prepare(
      `UPDATE cash_accounts SET last_actual_balance = ?, last_reconciled_at = ?, updated_at = ? WHERE id = ?`
    ).run(rounded, nowIso, nowIso, req.params.id);

    const updatedRow = db.prepare(`SELECT * FROM cash_accounts WHERE id = ?`).get(req.params.id) as Record<
      string,
      unknown
    >;
    const account = mapAccountRow(updatedRow);
    broadcastEvent({ type: 'account:updated', account });
    recordAudit(
      user.id,
      user.name,
      'cashbox_reconcile',
      'cashbox',
      `Сверка «${account.name}»: фактический остаток ${rounded} ${account.currency}`
    );
    res.json({ account });
  });

  // ================= CATALOG AUTO-LISTS (30 Clients, 30 Business, 8 Family) =================
  const mapCatalogRow = (row: Record<string, unknown>): CatalogItem => ({
    id: String(row.id),
    kind: row.kind as CatalogKind,
    sortOrder: Number(row.sort_order ?? 0),
    name: String(row.name),
    phone: String(row.phone ?? ''),
  });

  app.get('/api/catalog', requireAuth, (_req, res) => {
    const rows = db
      .prepare(`SELECT * FROM catalog_items ORDER BY sort_order ASC, name ASC`)
      .all() as Record<string, unknown>[];
    const items = rows.map(mapCatalogRow);
    res.json({
      clients: items.filter((i) => i.kind === 'client'),
      businessExpenses: items.filter((i) => i.kind === 'business_expense'),
      familyExpenses: items.filter((i) => i.kind === 'family_expense'),
    });
  });

  app.post('/api/catalog', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    if (user.role === 'viewer') {
      res.status(403).json({ error: 'Недостаточно прав' });
      return;
    }
    const { kind, name, phone } = req.body ?? {};
    const validKinds: CatalogKind[] = ['client', 'business_expense', 'family_expense'];
    if (!validKinds.includes(kind)) {
      res.status(400).json({ error: 'Некорректный тип списка' });
      return;
    }
    if (typeof name !== 'string' || name.trim().length < 1) {
      res.status(400).json({ error: 'Укажите название' });
      return;
    }
    const maxRow = db
      .prepare(`SELECT COALESCE(MAX(sort_order), 0) as m FROM catalog_items WHERE kind = ?`)
      .get(kind) as { m: number };
    const id = `cat_${crypto.randomBytes(6).toString('hex')}`;
    const nowIso = new Date().toISOString();
    db.prepare(
      `INSERT INTO catalog_items (id, kind, sort_order, name, phone, created_at) VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      kind,
      maxRow.m + 1,
      name.trim().slice(0, 100),
      typeof phone === 'string' ? phone.trim().slice(0, 60) : '',
      nowIso
    );
    const row = db.prepare(`SELECT * FROM catalog_items WHERE id = ?`).get(id) as Record<
      string,
      unknown
    >;
    broadcastEvent({ type: 'catalog:changed' });
    res.status(201).json({ item: mapCatalogRow(row) });
  });

  app.put('/api/catalog/replace', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    if (user.role === 'viewer') {
      res.status(403).json({ error: 'Недостаточно прав' });
      return;
    }
    const { kind, items } = req.body ?? {};
    const validKinds: CatalogKind[] = ['client', 'business_expense', 'family_expense'];
    if (!validKinds.includes(kind)) {
      res.status(400).json({ error: 'Некорректный тип списка' });
      return;
    }
    if (!Array.isArray(items) || items.length === 0 || items.length > 100) {
      res.status(400).json({ error: 'Список должен содержать от 1 до 100 записей' });
      return;
    }

    const cleaned: { name: string; phone: string }[] = [];
    for (const entry of items) {
      const rawName = typeof entry?.name === 'string' ? entry.name.trim() : '';
      if (!rawName) continue;
      const rawPhone =
        kind === 'client' && typeof entry?.phone === 'string' ? entry.phone.trim().slice(0, 60) : '';
      cleaned.push({ name: rawName.slice(0, 100), phone: rawPhone });
    }

    if (cleaned.length === 0) {
      res.status(400).json({ error: 'Добавьте хотя бы одно название' });
      return;
    }

    const nowIso = new Date().toISOString();
    const deleteStmt = db.prepare(`DELETE FROM catalog_items WHERE kind = ?`);
    const insertStmt = db.prepare(
      `INSERT INTO catalog_items (id, kind, sort_order, name, phone, created_at) VALUES (?, ?, ?, ?, ?, ?)`
    );

    const replaceTx = db.transaction(() => {
      deleteStmt.run(kind);
      cleaned.forEach((item, idx) => {
        const id = `cat_${crypto.randomBytes(6).toString('hex')}`;
        insertStmt.run(id, kind, idx + 1, item.name, item.phone, nowIso);
      });
    });
    replaceTx();

    const rows = db
      .prepare(`SELECT * FROM catalog_items WHERE kind = ? ORDER BY sort_order ASC`)
      .all(kind) as Record<string, unknown>[];
    broadcastEvent({ type: 'catalog:changed' });
    res.json({ items: rows.map(mapCatalogRow) });
  });

  app.patch('/api/catalog/:id', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    if (user.role === 'viewer') {
      res.status(403).json({ error: 'Недостаточно прав' });
      return;
    }
    const existing = db.prepare(`SELECT * FROM catalog_items WHERE id = ?`).get(req.params.id) as
      | Record<string, unknown>
      | undefined;
    if (!existing) {
      res.status(404).json({ error: 'Запись не найдена' });
      return;
    }
    const nextName =
      typeof req.body?.name === 'string' && req.body.name.trim().length >= 1
        ? req.body.name.trim().slice(0, 100)
        : String(existing.name);
    const nextPhone =
      typeof req.body?.phone === 'string' ? req.body.phone.trim().slice(0, 60) : String(existing.phone ?? '');

    db.prepare(`UPDATE catalog_items SET name = ?, phone = ? WHERE id = ?`).run(
      nextName,
      nextPhone,
      req.params.id
    );
    const row = db.prepare(`SELECT * FROM catalog_items WHERE id = ?`).get(req.params.id) as Record<
      string,
      unknown
    >;
    broadcastEvent({ type: 'catalog:changed' });
    res.json({ item: mapCatalogRow(row) });
  });

  app.delete('/api/catalog/:id', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    if (user.role === 'viewer') {
      res.status(403).json({ error: 'Недостаточно прав' });
      return;
    }
    db.prepare(`DELETE FROM catalog_items WHERE id = ?`).run(req.params.id);
    broadcastEvent({ type: 'catalog:changed' });
    res.json({ ok: true });
  });

  // ================= DEBTS / CREDIT (КАРЫЗ / НАСИЯ) =================
  app.get('/api/debts', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    if (user.allowedSpaces.length === 0) {
      res.json({ debts: [] });
      return;
    }
    const placeholders = user.allowedSpaces.map(() => '?').join(', ');
    const rows = db
      .prepare(
        `SELECT * FROM debts WHERE space IN (${placeholders})
         ORDER BY CASE WHEN status = 'paid' THEN 1 ELSE 0 END, created_at DESC LIMIT 300`
      )
      .all(...user.allowedSpaces) as Record<string, unknown>[];
    res.json({ debts: rows.map(mapDebtRow) });
  });

  app.post('/api/debts', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    const { direction, space, counterparty, contact, totalAmount, paidAmount, currency, dueDate, notes } =
      req.body ?? {};
    const cleanSpace: LedgerSpace = isValidSpace(space) ? space : 'business';
    if (!canWriteSpace(user, cleanSpace)) {
      res.status(403).json({ error: 'Нет прав для добавления долга в этот контур' });
      return;
    }
    const cleanDir: DebtDirection = direction === 'we_owe' ? 'we_owe' : 'client_owes';
    if (typeof counterparty !== 'string' || counterparty.trim().length < 2) {
      res.status(400).json({ error: 'Укажите имя клиента или поставщика' });
      return;
    }
    const total = Number(totalAmount);
    const paid = paidAmount !== undefined && paidAmount !== '' ? Number(paidAmount) : 0;
    if (!Number.isFinite(total) || total <= 0 || total > 1_000_000_000) {
      res.status(400).json({ error: 'Укажите корректную общую сумму' });
      return;
    }
    if (!Number.isFinite(paid) || paid < 0 || paid > total) {
      res.status(400).json({ error: 'Оплаченная сумма должна быть от 0 до общей суммы' });
      return;
    }
    const curr: CurrencyCode = isValidCurrency(currency) ? currency : 'KGS';
    const rate = getRateToKgsSync(curr);
    const totalKgs = Math.round(total * rate * 100) / 100;
    const paidKgs = Math.round(paid * rate * 100) / 100;
    const status: DebtStatus = paid >= total ? 'paid' : paid > 0 ? 'partial' : 'open';
    const cleanDue = typeof dueDate === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dueDate) ? dueDate : null;

    const id = `dbt_${crypto.randomBytes(6).toString('hex')}`;
    const nowIso = new Date().toISOString();
    db.prepare(
      `INSERT INTO debts (
        id, direction, space, counterparty, contact, total_amount, paid_amount, currency,
        total_in_kgs, paid_in_kgs, due_date, notes, status, created_by, created_by_name, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      cleanDir,
      cleanSpace,
      counterparty.trim().slice(0, 120),
      typeof contact === 'string' ? contact.trim().slice(0, 120) : '',
      Math.round(total * 100) / 100,
      Math.round(paid * 100) / 100,
      curr,
      totalKgs,
      paidKgs,
      cleanDue,
      typeof notes === 'string' ? notes.trim().slice(0, 300) : '',
      status,
      user.id,
      user.name,
      nowIso,
      nowIso
    );

    const row = db.prepare(`SELECT * FROM debts WHERE id = ?`).get(id) as Record<string, unknown>;
    const debt = mapDebtRow(row);
    broadcastEvent({ type: 'debt:created', debt }, debt.space);
    recordAudit(
      user.id,
      user.name,
      'debt_create',
      'debt',
      `${debt.direction === 'client_owes' ? 'Долг клиента' : 'Наш долг'}: ${debt.counterparty} (${debt.totalAmount} ${debt.currency})`,
      debt.space
    );
    res.status(201).json({ debt });
  });

  app.post('/api/debts/:id/payment', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    const row = db.prepare(`SELECT * FROM debts WHERE id = ?`).get(req.params.id) as
      | Record<string, unknown>
      | undefined;
    if (!row) {
      res.status(404).json({ error: 'Запись о долге не найдена' });
      return;
    }
    const existing = mapDebtRow(row);
    if (!canWriteSpace(user, existing.space)) {
      res.status(403).json({ error: 'Нет прав для обновления этой записи' });
      return;
    }

    const payAmount = Number(req.body?.amount);
    const remaining = Math.max(0, Math.round((existing.totalAmount - existing.paidAmount) * 100) / 100);
    if (!Number.isFinite(payAmount) || payAmount <= 0 || payAmount > remaining + 0.01) {
      res.status(400).json({ error: `Сумма оплаты должна быть от 1 до ${remaining}` });
      return;
    }
    const method: PaymentMethod = req.body?.paymentMethod === 'cash' ? 'cash' : 'cashless';
    const recordTx = req.body?.recordTransaction !== false;

    const nextPaid = Math.min(existing.totalAmount, Math.round((existing.paidAmount + payAmount) * 100) / 100);
    const rate = getRateToKgsSync(existing.currency);
    const nextPaidKgs = Math.round(nextPaid * rate * 100) / 100;
    const nextStatus: DebtStatus = nextPaid >= existing.totalAmount - 0.01 ? 'paid' : 'partial';
    const nowIso = new Date().toISOString();

    db.prepare(
      `UPDATE debts SET paid_amount = ?, paid_in_kgs = ?, status = ?, updated_at = ? WHERE id = ?`
    ).run(nextPaid, nextPaidKgs, nextStatus, nowIso, existing.id);

    let linkedTx: Transaction | null = null;
    if (recordTx) {
      const isClient = existing.direction === 'client_owes';
      linkedTx = insertTransactionRecord({
        space: existing.space,
        type: isClient ? 'income' : 'expense',
        paymentMethod: method,
        siteSyncStatus: isClient && existing.space === 'business' ? 'pending' : 'not_applicable',
        clientContact: existing.contact || null,
        amount: Math.round(payAmount * 100) / 100,
        currency: existing.currency,
        category: isClient ? 'Оплата от клиентов (B2B)' : 'Закупка товара и сырья',
        projectId: null,
        merchant: existing.counterparty,
        description: isClient
          ? `Погашение долга клиента (${nextStatus === 'paid' ? 'закрыт полностью' : 'частично'})`
          : `Оплата долга поставщику (${nextStatus === 'paid' ? 'закрыт полностью' : 'частично'})`,
        paymentSource: method === 'cash' ? 'Наличные' : 'MBank',
        date: new Date().toISOString().slice(0, 10),
        receiptRef: null,
        externalRef: null,
        sourceChannel: 'manual',
        userId: user.id,
        userName: user.name,
      });
      broadcastEvent({ type: 'transaction:created', transaction: linkedTx }, linkedTx.space);
    }

    const updatedRow = db.prepare(`SELECT * FROM debts WHERE id = ?`).get(existing.id) as Record<
      string,
      unknown
    >;
    const updated = mapDebtRow(updatedRow);
    broadcastEvent({ type: 'debt:updated', debt: updated }, updated.space);
    recordAudit(
      user.id,
      user.name,
      'debt_payment',
      'debt',
      `Оплата по долгу «${updated.counterparty}»: ${payAmount} ${updated.currency}`,
      updated.space
    );
    res.json({ debt: updated, linkedTransaction: linkedTx });
  });

  app.delete('/api/debts/:id', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    const row = db.prepare(`SELECT * FROM debts WHERE id = ?`).get(req.params.id) as
      | Record<string, unknown>
      | undefined;
    if (!row) {
      res.status(404).json({ error: 'Запись не найдена' });
      return;
    }
    const existing = mapDebtRow(row);
    const canDel =
      (user.role === 'owner' || user.role === 'admin') && canReadSpace(user, existing.space)
        ? true
        : user.role === 'editor' && existing.createdBy === user.id;
    if (!canDel) {
      res.status(403).json({ error: 'Нет прав на удаление записи' });
      return;
    }
    db.prepare(`DELETE FROM debts WHERE id = ?`).run(existing.id);
    broadcastEvent({ type: 'debt:deleted', id: existing.id }, existing.space);
    res.json({ ok: true });
  });

  // ================= TELEGRAM BOT INTEGRATION =================
  app.get('/api/telegram/config', requireAuth, async (req, res) => {
    const settings = getTelegramSettingsRow();
    const botInfo = isTelegramTokenConfigured() ? await getTelegramBotInfo() : { username: null };
    const proto = req.headers['x-forwarded-proto'] === 'https' ? 'https' : req.protocol;
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '');
    const fallbackOrigin = host ? `${proto}://${host}` : '';
    const config: TelegramConfig = {
      botConfigured: isTelegramTokenConfigured(),
      webhookSecretConfigured: isTelegramSecretConfigured(),
      botUsername: botInfo.username,
      webhookUrl: getPublicWebhookUrl(fallbackOrigin),
      allowedChatIds: settings.allowedChatIds,
      defaultPhotoMode: settings.defaultPhotoMode,
      autoReply: settings.autoReply,
      dailySummaryChatId: settings.dailySummaryChatId,
      webhookRegisteredAt: settings.webhookRegisteredAt,
    };
    const inboxRows = db
      .prepare(`SELECT * FROM telegram_inbox ORDER BY created_at DESC LIMIT 40`)
      .all() as Record<string, unknown>[];
    res.json({ config, inbox: inboxRows.map(mapTelegramInboxRow) });
  });

  app.patch('/api/telegram/config', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    if (!canManageBanks(user)) {
      res.status(403).json({ error: 'Настраивать Telegram-бота могут только владелец и администратор' });
      return;
    }
    const current = getTelegramSettingsRow();
    const body = req.body ?? {};
    const nextAllowed = Array.isArray(body.allowedChatIds)
      ? body.allowedChatIds
          .map((x: unknown) => String(x).trim())
          .filter((x: string) => /^-?\d{4,20}$/.test(x))
          .slice(0, 20)
      : current.allowedChatIds;
    const validModes: TelegramDefaultMode[] = ['family_expense', 'client_income', 'business_expense'];
    const nextMode: TelegramDefaultMode = validModes.includes(body.defaultPhotoMode)
      ? body.defaultPhotoMode
      : current.defaultPhotoMode;
    const nextAutoReply = typeof body.autoReply === 'boolean' ? body.autoReply : current.autoReply;
    const nextDailyChat =
      typeof body.dailySummaryChatId === 'string' &&
      (body.dailySummaryChatId.trim() === '' || /^-?\d{4,20}$/.test(body.dailySummaryChatId.trim()))
        ? body.dailySummaryChatId.trim()
        : current.dailySummaryChatId;

    db.prepare(
      `UPDATE telegram_settings
       SET allowed_chat_ids = ?, default_photo_mode = ?, auto_reply = ?, daily_summary_chat_id = ?, updated_at = ?
       WHERE id = 'default'`
    ).run(
      JSON.stringify(nextAllowed),
      nextMode,
      nextAutoReply ? 1 : 0,
      nextDailyChat,
      new Date().toISOString()
    );

    recordAudit(
      user.id,
      user.name,
      'telegram_config',
      'telegram',
      `Обновлены настройки Telegram-бота (чатов: ${nextAllowed.length}, режим: ${nextMode})`
    );
    res.json({
      ok: true,
      allowedChatIds: nextAllowed,
      defaultPhotoMode: nextMode,
      autoReply: nextAutoReply,
      dailySummaryChatId: nextDailyChat,
    });
  });

  app.post('/api/telegram/register-webhook', requireAuth, async (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    if (!canManageBanks(user)) {
      res.status(403).json({ error: 'Подключать Webhook может только владелец или администратор' });
      return;
    }
    const webhookUrl = getPublicWebhookUrl();
    if (!webhookUrl) {
      res.status(400).json({ error: 'APP_URL не настроен на сервере' });
      return;
    }
    try {
      const result = await registerTelegramWebhook(webhookUrl);
      const nowIso = new Date().toISOString();
      db.prepare(`UPDATE telegram_settings SET webhook_registered_at = ?, updated_at = ? WHERE id = 'default'`).run(
        nowIso,
        nowIso
      );
      recordAudit(user.id, user.name, 'telegram_webhook', 'telegram', `Активирован Telegram Webhook`);
      res.json({ ok: true, description: result.description, webhookRegisteredAt: nowIso });
    } catch (err) {
      res.status(502).json({ error: err instanceof Error ? err.message : 'Ошибка подключения Webhook' });
    }
  });

  app.post('/api/telegram/send-daily-summary', requireAuth, async (req: AuthenticatedRequest, res) => {
    const summaryText = buildDailySummaryText();
    const settings = getTelegramSettingsRow();
    const targetChatId =
      settings.dailySummaryChatId || settings.allowedChatIds[0] || '';

    if (!isTelegramTokenConfigured() || !targetChatId) {
      res.json({
        sent: false,
        summaryText,
        reason: !isTelegramTokenConfigured()
          ? 'TELEGRAM_BOT_TOKEN серверде коюлган эмес — текст көчүрүүгө даяр'
          : 'Telegram Chat ID кошулган эмес',
      });
      return;
    }

    const ok = await sendTelegramMessage(targetChatId, summaryText);
    res.json({ sent: ok, summaryText });
  });

  // Real Telegram Bot API Webhook endpoint (verified via X-Telegram-Bot-Api-Secret-Token)
  app.post('/api/telegram/webhook', async (req, res) => {
    if (!isTelegramTokenConfigured() || !isTelegramSecretConfigured()) {
      res.status(503).json({ error: 'Telegram Bot is not configured on server' });
      return;
    }
    const secretHeader =
      typeof req.headers['x-telegram-bot-api-secret-token'] === 'string'
        ? req.headers['x-telegram-bot-api-secret-token']
        : undefined;
    if (!verifyTelegramSecretHeader(secretHeader)) {
      res.status(401).json({ error: 'Unauthorized webhook secret' });
      return;
    }

    const update = req.body as {
      message?: {
        chat?: { id?: number | string };
        from?: { first_name?: string; last_name?: string; username?: string };
        text?: string;
        caption?: string;
        photo?: { file_id: string; width: number; height: number }[];
      };
    };

    const msg = update?.message;
    if (!msg || !msg.chat?.id) {
      res.json({ ok: true });
      return;
    }

    const chatId = String(msg.chat.id);
    const senderName =
      [msg.from?.first_name, msg.from?.last_name].filter(Boolean).join(' ').trim() ||
      (msg.from?.username ? `@${msg.from.username}` : `Chat ${chatId}`);
    const text = (msg.text ?? '').trim();
    const caption = (msg.caption ?? '').trim();
    const settings = getTelegramSettingsRow();

    const saveInbox = (
      messageType: 'photo' | 'text',
      rawCaption: string,
      routedTo: string,
      status: 'saved' | 'ignored' | 'error',
      summary: string,
      linkedTxId: string | null = null
    ) => {
      const id = `tg_${crypto.randomBytes(6).toString('hex')}`;
      const nowIso = new Date().toISOString();
      db.prepare(
        `INSERT INTO telegram_inbox (id, chat_id, sender_name, message_type, caption, routed_to, status, summary, linked_tx_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        id,
        chatId,
        senderName.slice(0, 80),
        messageType,
        rawCaption.slice(0, 300),
        routedTo.slice(0, 80),
        status,
        summary.slice(0, 300),
        linkedTxId,
        nowIso
      );
      const row = db.prepare(`SELECT * FROM telegram_inbox WHERE id = ?`).get(id) as Record<
        string,
        unknown
      >;
      broadcastEvent({ type: 'telegram:received', item: mapTelegramInboxRow(row) });
    };

    // Allow /start and /help from any chat so the owner can learn their exact Chat ID
    if (/^\/(start|help)\b/i.test(text)) {
      await sendTelegramMessage(
        chatId,
        [
          `Саламатсызбы! КнигаСчёт ботуна кош келиңиз.`,
          `Сиздин Chat ID: ${chatId}`,
          ``,
          `Бул Chat IDни сайттагы «Telegram-бот» бөлүмүнө кошуп сактаңыз.`,
          `Андан кийин:`,
          `• MBank чек сүрөтүн переслать кылсаңыз → автоматтык жазылат`,
          `• Чекке #клиент деп жазсаңыз → «Клиенттен приход (Сайтка)» тизмесине түшөт`,
          `• Чекке #бизнес деп жазсаңыз → Бизнес чыгымга түшөт`,
          `• /нал 1500 Базар → Накталай үй-бүлө чыгымын жазат`,
          `• /клиент Айбек 12000 → Клиенттен приход жазат`,
          `• /итоги → Күндүн жыйынтыгын жөнөтөт`,
        ].join('\n')
      );
      res.json({ ok: true });
      return;
    }

    // Strict allowlist check for any financial data read/write
    if (!settings.allowedChatIds.includes(chatId)) {
      saveInbox('text', text || caption, 'Блокировано', 'ignored', `Неавторизованный Chat ID: ${chatId}`);
      await sendTelegramMessage(
        chatId,
        `Бул чат (${chatId}) уруксат тизмесинде жок. Сайттагы «Telegram-бот» бөлүмүнө Chat IDңизди кошуңуз.`
      );
      res.json({ ok: true });
      return;
    }

    // Daily summary command
    if (/^\/(today|итоги|отчет|жыйынтык)\b/i.test(text)) {
      await sendTelegramMessage(chatId, buildDailySummaryText());
      res.json({ ok: true });
      return;
    }

    // Fast cash expense command: /нал 1500 Базар or /cash 1500 Аптека
    const cashCmd = text.match(/^\/(нал|накталай|cash)\s+([\d.,]+)(?:\s+(.+))?$/i);
    if (cashCmd) {
      const amt = Number(cashCmd[2].replace(',', '.'));
      const note = (cashCmd[3] ?? 'Накталай чыгым').trim();
      if (Number.isFinite(amt) && amt > 0) {
        const tx = insertTransactionRecord({
          space: 'family',
          type: 'expense',
          paymentMethod: 'cash',
          siteSyncStatus: 'not_applicable',
          amount: Math.round(amt * 100) / 100,
          currency: 'KGS',
          category: 'Продукты и супермаркеты',
          projectId: null,
          merchant: note.slice(0, 80),
          description: `Telegram /нал (${senderName})`,
          paymentSource: 'Наличные',
          date: new Date().toISOString().slice(0, 10),
          receiptRef: null,
          externalRef: null,
          sourceChannel: 'telegram',
          userId: `tg_${chatId}`,
          userName: `Telegram: ${senderName}`,
        });
        broadcastEvent({ type: 'transaction:created', transaction: tx }, tx.space);
        saveInbox('text', text, 'Үй-бүлө (Нал)', 'saved', `${tx.merchant} · -${tx.amount} ${tx.currency}`, tx.id);
        if (settings.autoReply) {
          await sendTelegramMessage(
            chatId,
            `✓ Жазылды (Үй-бүлө · Накталай): ${tx.merchant} — ${tx.amount} ${tx.currency}`
          );
        }
      }
      res.json({ ok: true });
      return;
    }

    // Fast client income command: /клиент Айбек 15000 заказ 1050
    const clientCmd = text.match(/^\/(клиент|client)\s+(.+?)\s+([\d.,]+)(?:\s+(.+))?$/i);
    if (clientCmd) {
      const clientName = clientCmd[2].trim();
      const amt = Number(clientCmd[3].replace(',', '.'));
      const extraNote = (clientCmd[4] ?? '').trim();
      if (Number.isFinite(amt) && amt > 0 && clientName.length >= 2) {
        const tx = insertTransactionRecord({
          space: 'business',
          type: 'income',
          paymentMethod: 'cashless',
          siteSyncStatus: 'pending',
          clientContact: extraNote || null,
          amount: Math.round(amt * 100) / 100,
          currency: 'KGS',
          category: 'Оплата от клиентов (B2B)',
          projectId: null,
          merchant: clientName,
          description: extraNote || `Telegram /клиент (${senderName}) — сайтка түшүрүү керек`,
          paymentSource: 'MBank',
          date: new Date().toISOString().slice(0, 10),
          receiptRef: null,
          externalRef: null,
          sourceChannel: 'telegram',
          userId: `tg_${chatId}`,
          userName: `Telegram: ${senderName}`,
        });
        broadcastEvent({ type: 'transaction:created', transaction: tx }, tx.space);
        saveInbox(
          'text',
          text,
          'Клиенттен приход → Сайтка',
          'saved',
          `${tx.merchant} · +${tx.amount} ${tx.currency}`,
          tx.id
        );
        if (settings.autoReply) {
          await sendTelegramMessage(
            chatId,
            `✓ Клиенттен приход сакталды («Сайтка түшүрүү» тизмесине кошулду):\n${tx.merchant} — +${tx.amount} ${tx.currency}`
          );
        }
      }
      res.json({ ok: true });
      return;
    }

    // Photo receipt forwarding (MBank screenshot / receipt photo)
    if (Array.isArray(msg.photo) && msg.photo.length > 0) {
      const largest = msg.photo[msg.photo.length - 1];
      const routing = resolveTelegramRouting(caption, settings.defaultPhotoMode);
      try {
        const { base64, mimeType } = await downloadTelegramPhotoBase64(largest.file_id);
        const ocr = await recognizeReceiptImage(base64, mimeType, routing.space);
        if (ocr.amount > 0) {
          const tx = insertTransactionRecord({
            space: routing.space,
            type: routing.forcedType,
            paymentMethod: routing.paymentMethod,
            siteSyncStatus: routing.siteSyncStatus,
            amount: ocr.amount,
            currency: ocr.currency,
            category: ocr.suggestedCategory,
            projectId: null,
            merchant: ocr.merchant,
            description: caption || ocr.rawTextSummary || 'Telegram аркылуу переслать кылынган чек',
            paymentSource: ocr.paymentSource || 'MBank',
            date: ocr.date,
            receiptRef: ocr.receiptNumber || null,
            externalRef: null,
            sourceChannel: 'telegram',
            userId: `tg_${chatId}`,
            userName: `Telegram: ${senderName}`,
          });
          broadcastEvent({ type: 'transaction:created', transaction: tx }, tx.space);
          saveInbox(
            'photo',
            caption || 'Чек (сүрөт)',
            routing.routeLabel,
            'saved',
            `${tx.merchant} · ${tx.type === 'income' ? '+' : '-'}${tx.amount} ${tx.currency}`,
            tx.id
          );
          if (settings.autoReply) {
            await sendTelegramMessage(
              chatId,
              `✓ Чек таанылды жана жазылды!\nБөлүм: ${routing.routeLabel}\nКонтрагент: ${tx.merchant}\nСумма: ${tx.amount} ${tx.currency}\nДата: ${tx.date}`
            );
          }
        } else {
          saveInbox('photo', caption || 'Чек (сүрөт)', routing.routeLabel, 'error', 'Чектен сумма табылган жок');
          if (settings.autoReply) {
            await sendTelegramMessage(chatId, 'Сүрөттөн сумма табылган жок. Так сүрөт жөнөтүп көрүңүз.');
          }
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'OCR катасы';
        saveInbox('photo', caption || 'Чек (сүрөт)', routing.routeLabel, 'error', errMsg);
        if (settings.autoReply) {
          await sendTelegramMessage(chatId, `Чекти иштетүүдө ката кетти: ${errMsg}`);
        }
      }
      res.json({ ok: true });
      return;
    }

    // Forwarded text receipt / MBank SMS
    if (text.length >= 6) {
      const routing = resolveTelegramRouting(text, settings.defaultPhotoMode);
      try {
        const ocr = await recognizeReceiptText(text, routing.space);
        if (ocr.amount > 0) {
          const tx = insertTransactionRecord({
            space: routing.space,
            type: routing.forcedType,
            paymentMethod: routing.paymentMethod,
            siteSyncStatus: routing.siteSyncStatus,
            amount: ocr.amount,
            currency: ocr.currency,
            category: ocr.suggestedCategory,
            projectId: null,
            merchant: ocr.merchant,
            description: ocr.rawTextSummary || text.slice(0, 200),
            paymentSource: ocr.paymentSource || 'MBank',
            date: ocr.date,
            receiptRef: ocr.receiptNumber || null,
            externalRef: null,
            sourceChannel: 'telegram',
            userId: `tg_${chatId}`,
            userName: `Telegram: ${senderName}`,
          });
          broadcastEvent({ type: 'transaction:created', transaction: tx }, tx.space);
          saveInbox(
            'text',
            text,
            routing.routeLabel,
            'saved',
            `${tx.merchant} · ${tx.type === 'income' ? '+' : '-'}${tx.amount} ${tx.currency}`,
            tx.id
          );
          if (settings.autoReply) {
            await sendTelegramMessage(
              chatId,
              `✓ Жазылды (${routing.routeLabel}): ${tx.merchant} — ${tx.amount} ${tx.currency}`
            );
          }
        } else {
          saveInbox('text', text, routing.routeLabel, 'ignored', 'Сумма табылган жок');
        }
      } catch (err) {
        saveInbox('text', text, routing.routeLabel, 'error', err instanceof Error ? err.message : 'Ката');
      }
    }

    res.json({ ok: true });
  });

  // ================= BANK API INTEGRATIONS =================
  app.get('/api/bank/connections', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    if (user.allowedSpaces.length === 0) {
      res.json({ connections: [] });
      return;
    }
    const placeholders = user.allowedSpaces.map(() => '?').join(', ');
    const rows = db
      .prepare(`SELECT * FROM bank_connections WHERE default_space IN (${placeholders}) ORDER BY created_at DESC`)
      .all(...user.allowedSpaces) as Record<string, unknown>[];

    res.json({ connections: rows.map(mapBankRow) });
  });

  app.post('/api/bank/connections', requireAuth, async (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    if (!canManageBanks(user)) {
      res.status(403).json({ error: 'Подключать банковские API могут только владелец и администратор' });
      return;
    }

    const { provider, name, accountMask, defaultSpace, currency, apiEndpoint, apiToken } = req.body ?? {};
    const validProviders = ['mbank', 'demirbank', 'optima', 'kaspi', 'tbank', 'custom_api'];
    if (!validProviders.includes(provider)) {
      res.status(400).json({ error: 'Неподдерживаемый банковский провайдер' });
      return;
    }
    if (typeof name !== 'string' || name.trim().length < 2) {
      res.status(400).json({ error: 'Укажите название счёта или интеграции' });
      return;
    }
    if (!isValidSpace(defaultSpace) || !canWriteSpace(user, defaultSpace)) {
      res.status(403).json({ error: 'Нет доступа к указанному контуру' });
      return;
    }
    const curr: CurrencyCode = isValidCurrency(currency) ? currency : 'KGS';

    let cleanEndpoint: string | null = null;
    if (typeof apiEndpoint === 'string' && apiEndpoint.trim().length > 0) {
      try {
        const validated = await validateExternalBankUrl(apiEndpoint);
        cleanEndpoint = validated.toString();
      } catch (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Недопустимый URL API' });
        return;
      }
    }

    const id = `bank_${crypto.randomBytes(6).toString('hex')}`;
    const webhookSecret = `whsec_${crypto.randomBytes(18).toString('hex')}`;
    const nowIso = new Date().toISOString();

    db.prepare(
      `INSERT INTO bank_connections (
        id, provider, name, account_mask, default_space, currency,
        api_endpoint, api_token, webhook_secret, auto_import_enabled,
        status, last_sync_at, last_sync_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'active', NULL, 0, ?)`
    ).run(
      id,
      provider,
      name.trim().slice(0, 100),
      typeof accountMask === 'string' && accountMask.trim() ? accountMask.trim().slice(0, 40) : '•••• 0000',
      defaultSpace,
      curr,
      cleanEndpoint,
      typeof apiToken === 'string' && apiToken.trim() ? apiToken.trim() : null,
      webhookSecret,
      nowIso
    );

    const row = db.prepare(`SELECT * FROM bank_connections WHERE id = ?`).get(id) as Record<string, unknown>;
    broadcastEvent({ type: 'bank:changed' }, defaultSpace);
    recordAudit(
      user.id,
      user.name,
      'bank_connect',
      'bank',
      `Подключён банковский шлюз «${name.trim()}» (${provider.toUpperCase()})`,
      defaultSpace
    );

    res.status(201).json({
      connection: mapBankRow(row),
      webhookSecret, // returned once on creation so user can configure bank webhook
    });
  });

  app.delete('/api/bank/connections/:id', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    if (!canManageBanks(user)) {
      res.status(403).json({ error: 'Недостаточно прав' });
      return;
    }
    const row = db.prepare(`SELECT * FROM bank_connections WHERE id = ?`).get(req.params.id) as
      | Record<string, unknown>
      | undefined;
    if (!row) {
      res.status(404).json({ error: 'Подключение не найдено' });
      return;
    }
    db.prepare(`DELETE FROM bank_connections WHERE id = ?`).run(req.params.id);
    broadcastEvent({ type: 'bank:changed' });
    recordAudit(user.id, user.name, 'bank_delete', 'bank', `Отключён банк «${String(row.name)}»`);
    res.json({ ok: true });
  });

  app.post('/api/bank/import-statement', requireAuth, (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    const { connectionId, content, space } = req.body ?? {};
    if (typeof content !== 'string' || content.trim().length < 5) {
      res.status(400).json({ error: 'Загрузите файл выписки CSV или JSON' });
      return;
    }

    const conn = db
      .prepare(`SELECT * FROM bank_connections WHERE id = ?`)
      .get(connectionId) as Record<string, unknown> | undefined;

    const targetSpace: LedgerSpace = isValidSpace(space)
      ? space
      : conn && isValidSpace(conn.default_space)
        ? (conn.default_space as LedgerSpace)
        : user.allowedSpaces[0];

    if (!canWriteSpace(user, targetSpace)) {
      res.status(403).json({ error: 'Нет прав на импорт операций в этот контур' });
      return;
    }

    const defaultCurrency: CurrencyCode =
      conn && isValidCurrency(conn.currency) ? (conn.currency as CurrencyCode) : 'KGS';
    const paymentSource = conn ? String(conn.name).slice(0, 60) : 'Банковский API';

    let records;
    try {
      records = parseBankStatementContent(
        content,
        defaultCurrency,
        targetSpace,
        conn ? String(conn.id) : 'manual_csv'
      );
    } catch {
      res.status(400).json({ error: 'Не удалось разобрать формат выписки. Проверьте структуру CSV или JSON.' });
      return;
    }

    if (records.length === 0) {
      res.status(400).json({
        error: 'В файле не найдено валидных транзакций. Убедитесь, что есть колонки Дата и Сумма (или JSON-массив).',
      });
      return;
    }

    let imported = 0;
    let skipped = 0;
    const checkDup = db.prepare(`SELECT id FROM transactions WHERE external_ref = ?`);

    for (const rec of records) {
      const dup = checkDup.get(rec.externalRef);
      if (dup) {
        skipped++;
        continue;
      }
      insertTransactionRecord({
        space: targetSpace,
        type: rec.type,
        amount: rec.amount,
        currency: rec.currency,
        category: rec.category,
        projectId: null,
        merchant: rec.merchant,
        description: rec.description,
        paymentSource,
        date: rec.date,
        receiptRef: rec.receiptRef,
        externalRef: rec.externalRef,
        sourceChannel: 'bank_file',
        userId: user.id,
        userName: user.name,
      });
      imported++;
    }

    if (conn) {
      db.prepare(
        `UPDATE bank_connections SET last_sync_at = ?, last_sync_count = ? WHERE id = ?`
      ).run(new Date().toISOString(), imported, conn.id);
      broadcastEvent({ type: 'bank:changed' }, targetSpace);
    }

    if (imported > 0) {
      broadcastEvent({ type: 'transactions:imported', count: imported, space: targetSpace }, targetSpace);
      recordAudit(
        user.id,
        user.name,
        'bank_import',
        'bank',
        `Импортировано ${imported} транзакций из банковской выписки (${paymentSource}), пропущено дублей: ${skipped}`,
        targetSpace
      );
    }

    res.json({ imported, skipped, totalParsed: records.length });
  });

  app.post('/api/bank/sync/:id', requireAuth, async (req: AuthenticatedRequest, res) => {
    const user = req.user!;
    if (!canManageBanks(user)) {
      res.status(403).json({ error: 'Запускать синхронизацию API могут только владелец и администратор' });
      return;
    }
    const conn = db
      .prepare(`SELECT * FROM bank_connections WHERE id = ?`)
      .get(req.params.id) as Record<string, unknown> | undefined;

    if (!conn) {
      res.status(404).json({ error: 'Банковское подключение не найдено' });
      return;
    }
    const endpoint = conn.api_endpoint ? String(conn.api_endpoint) : '';
    if (!endpoint) {
      res.status(400).json({
        error:
          'Для этого счёта не задан внешний HTTPS URL API. Используйте импорт выписки CSV/JSON или настройте Webhook.',
      });
      return;
    }

    try {
      const safeUrl = await validateExternalBankUrl(endpoint);
      const headers: Record<string, string> = { Accept: 'application/json' };
      if (conn.api_token) {
        headers.Authorization = `Bearer ${String(conn.api_token)}`;
      }
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const response = await fetch(safeUrl.toString(), { headers, signal: controller.signal });
      clearTimeout(timeout);

      if (!response.ok) {
        res.status(502).json({ error: `Банковский API вернул статус ${response.status}` });
        return;
      }

      const rawText = await response.text();
      const targetSpace = conn.default_space as LedgerSpace;
      const defaultCurrency = conn.currency as CurrencyCode;
      const records = parseBankStatementContent(rawText, defaultCurrency, targetSpace, String(conn.id));

      let imported = 0;
      let skipped = 0;
      const checkDup = db.prepare(`SELECT id FROM transactions WHERE external_ref = ?`);
      for (const rec of records) {
        if (checkDup.get(rec.externalRef)) {
          skipped++;
          continue;
        }
        insertTransactionRecord({
          space: targetSpace,
          type: rec.type,
          amount: rec.amount,
          currency: rec.currency,
          category: rec.category,
          projectId: null,
          merchant: rec.merchant,
          description: rec.description,
          paymentSource: String(conn.name).slice(0, 60),
          date: rec.date,
          receiptRef: rec.receiptRef,
          externalRef: rec.externalRef,
          sourceChannel: 'bank_api',
          userId: user.id,
          userName: user.name,
        });
        imported++;
      }

      db.prepare(`UPDATE bank_connections SET last_sync_at = ?, last_sync_count = ?, status = 'active' WHERE id = ?`).run(
        new Date().toISOString(),
        imported,
        conn.id
      );

      broadcastEvent({ type: 'bank:changed' }, targetSpace);
      if (imported > 0) {
        broadcastEvent({ type: 'transactions:imported', count: imported, space: targetSpace }, targetSpace);
        recordAudit(
          user.id,
          user.name,
          'bank_api_sync',
          'bank',
          `API-синхронизация «${String(conn.name)}»: загружено ${imported} операций`,
          targetSpace
        );
      }

      res.json({ imported, skipped });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Ошибка подключения к банковскому API';
      res.status(502).json({ error: msg });
    }
  });

  // Incoming bank webhook endpoint (secured with X-Webhook-Secret)
  app.post('/api/bank/webhook/:id', (req, res) => {
    const conn = db
      .prepare(`SELECT * FROM bank_connections WHERE id = ?`)
      .get(req.params.id) as Record<string, unknown> | undefined;

    if (!conn || !conn.auto_import_enabled) {
      res.status(404).json({ error: 'Подключение не найдено или отключено' });
      return;
    }

    const provided = String(req.headers['x-webhook-secret'] ?? '');
    const expected = String(conn.webhook_secret ?? '');
    const bufA = Buffer.from(provided);
    const bufB = Buffer.from(expected);
    if (bufA.length !== bufB.length || !crypto.timingSafeEqual(bufA, bufB)) {
      res.status(401).json({ error: 'Недействительный секрет вебхука' });
      return;
    }

    const targetSpace = conn.default_space as LedgerSpace;
    const defaultCurrency = conn.currency as CurrencyCode;
    const bodyStr = JSON.stringify(Array.isArray(req.body) ? req.body : [req.body]);
    const records = parseBankStatementContent(bodyStr, defaultCurrency, targetSpace, String(conn.id));

    let imported = 0;
    const checkDup = db.prepare(`SELECT id FROM transactions WHERE external_ref = ?`);
    for (const rec of records) {
      if (checkDup.get(rec.externalRef)) continue;
      insertTransactionRecord({
        space: targetSpace,
        type: rec.type,
        amount: rec.amount,
        currency: rec.currency,
        category: rec.category,
        projectId: null,
        merchant: rec.merchant,
        description: rec.description,
        paymentSource: String(conn.name).slice(0, 60),
        date: rec.date,
        receiptRef: rec.receiptRef,
        externalRef: rec.externalRef,
        sourceChannel: 'webhook',
        userId: 'system_webhook',
        userName: `Webhook: ${String(conn.name)}`,
      });
      imported++;
    }

    db.prepare(`UPDATE bank_connections SET last_sync_at = ?, last_sync_count = ? WHERE id = ?`).run(
      new Date().toISOString(),
      imported,
      conn.id
    );
    if (imported > 0) {
      broadcastEvent({ type: 'transactions:imported', count: imported, space: targetSpace }, targetSpace);
      broadcastEvent({ type: 'bank:changed' }, targetSpace);
    }

    res.json({ ok: true, imported });
  });

  // ================= MONTHLY EXPENSE SOFT-ALERT LIMITS =================
  app.get('/api/limits', requireAuth, (_req, res) => {
    const row = db
      .prepare(`SELECT family_monthly_kgs, business_monthly_kgs, updated_at FROM expense_limits WHERE id = 'default'`)
      .get() as { family_monthly_kgs: number; business_monthly_kgs: number; updated_at: string } | undefined;

    const limits: MonthlyLimits = row
      ? {
          familyMonthlyKgs: Number(row.family_monthly_kgs) || 0,
          businessMonthlyKgs: Number(row.business_monthly_kgs) || 0,
          updatedAt: row.updated_at || null,
        }
      : { familyMonthlyKgs: 0, businessMonthlyKgs: 0, updatedAt: null };

    res.json({ limits });
  });

  app.put('/api/limits', requireAuth, (req: AuthenticatedRequest, res) => {
    const body = req.body as { familyMonthlyKgs?: unknown; businessMonthlyKgs?: unknown };
    const fam = Number(body.familyMonthlyKgs ?? 0);
    const biz = Number(body.businessMonthlyKgs ?? 0);

    if (!Number.isFinite(fam) || fam < 0 || !Number.isFinite(biz) || biz < 0) {
      res.status(400).json({ error: 'Лимит 0 же оң сан болушу керек' });
      return;
    }

    const familyMonthlyKgs = Math.round(fam * 100) / 100;
    const businessMonthlyKgs = Math.round(biz * 100) / 100;
    const updatedAt = new Date().toISOString();

    db.prepare(
      `INSERT INTO expense_limits (id, family_monthly_kgs, business_monthly_kgs, updated_at)
       VALUES ('default', ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         family_monthly_kgs = excluded.family_monthly_kgs,
         business_monthly_kgs = excluded.business_monthly_kgs,
         updated_at = excluded.updated_at`
    ).run(familyMonthlyKgs, businessMonthlyKgs, updatedAt);

    const limits: MonthlyLimits = { familyMonthlyKgs, businessMonthlyKgs, updatedAt };
    broadcastEvent({ type: 'limits:changed', limits });
    res.json({ limits });
  });

  // ================= STATIC / VITE FRONTEND =================
  const server = http.createServer(app);

  // Real-time WebSocket Server strictly on /ws (noServer avoids aborting other upgrade paths)
  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (pathname === '/ws') {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
      });
    }
  });

  wss.on('connection', (ws) => {
    let authedClient: AuthedSocket | null = null;

    const authTimeout = setTimeout(() => {
      if (!authedClient) {
        ws.close(4001, 'Auth timeout');
      }
    }, 10000);

    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(String(raw)) as { type?: string; token?: string };
        if (msg.type === 'auth' && typeof msg.token === 'string') {
          const authRes = authenticateToken(msg.token);
          if (!authRes) {
            ws.send(JSON.stringify({ type: 'auth:error', message: 'Invalid token' } satisfies RealtimeEvent));
            ws.close(4003, 'Unauthorized');
            return;
          }
          clearTimeout(authTimeout);
          authedClient = {
            ws,
            user: authRes.user,
            connectedAt: new Date().toISOString(),
          };
          activeSockets.add(authedClient);
          ws.send(JSON.stringify({ type: 'auth:ok', userId: authRes.user.id } satisfies RealtimeEvent));
          broadcastPresence();
        }
      } catch {
        // ignore malformed frames
      }
    });

    ws.on('close', () => {
      clearTimeout(authTimeout);
      if (authedClient) {
        activeSockets.delete(authedClient);
        broadcastPresence();
      }
    });
  });

  const isProd = process.env.NODE_ENV === 'production';
  const distDir = path.resolve(process.cwd(), 'dist');

  if (isProd && fs.existsSync(distDir)) {
    app.use(express.static(distDir));
    app.get('/{*splat}', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: {
          server,
          path: '/__vite_hmr',
        },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const PORT = Number(process.env.PORT) || 3000;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`KnigaSchet server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
