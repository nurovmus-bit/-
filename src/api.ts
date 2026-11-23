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
  LedgerSpace,
  MonthlyLimits,
  OcrReceiptResult,
  PaymentMethod,
  SiteSyncStatus,
  StagedGood,
  TelegramConfig,
  TelegramDefaultMode,
  TelegramInboxItem,
  Transaction,
  TransactionType,
  UserProfile,
  UserRole,
} from './types.ts';

let authToken: string | null = null;

export function setAuthToken(token: string | null): void {
  authToken = token;
}

export function getAuthToken(): string | null {
  return authToken;
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers);
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (authToken) {
    headers.set('Authorization', `Bearer ${authToken}`);
  }

  const res = await fetch(url, { ...options, headers });
  const text = await res.text();
  let data: unknown = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = { error: text };
    }
  }

  if (!res.ok) {
    const errObj = data as { error?: string };
    throw new Error(errObj.error || `Ошибка сервера (${res.status})`);
  }
  return data as T;
}

export const api = {
  authStatus: () => request<{ hasUsers: boolean }>('/api/auth/status'),
  bootstrap: (payload: { name: string; email: string; password: string; seedDemo: boolean }) =>
    request<{ token: string; user: UserProfile }>('/api/auth/bootstrap', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  login: (payload: { email: string; password: string }) =>
    request<{ token: string; user: UserProfile }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  logout: () => request<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }),
  me: () => request<{ user: UserProfile }>('/api/auth/me'),

  getRates: () =>
    request<{ rates: Record<CurrencyCode, number>; updatedAt: string; source: 'live' | 'fallback' }>(
      '/api/rates'
    ),

  getTransactions: () => request<{ transactions: Transaction[] }>('/api/transactions'),
  createTransaction: (payload: {
    space: LedgerSpace;
    type: TransactionType;
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
    sourceChannel?: Transaction['sourceChannel'];
  }) =>
    request<{ transaction: Transaction }>('/api/transactions', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateTransaction: (
    id: string,
    payload: Partial<{
      space: LedgerSpace;
      type: TransactionType;
      paymentMethod: PaymentMethod;
      siteSyncStatus: SiteSyncStatus;
      clientContact: string | null;
      amount: number;
      currency: CurrencyCode;
      category: string;
      projectId: string | null;
      merchant: string;
      description: string;
      paymentSource: string;
      date: string;
      receiptRef: string | null;
    }>
  ) =>
    request<{ transaction: Transaction }>(`/api/transactions/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteTransaction: (id: string) =>
    request<{ ok: boolean }>(`/api/transactions/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // Staged purchased goods for website upload
  getGoods: () => request<{ goods: StagedGood[] }>('/api/goods'),
  createGood: (payload: {
    productName: string;
    category?: string;
    sku: string;
    quantity: number;
    unit: string;
    unitCost: number;
    currency: CurrencyCode;
    sellingPrice: number | null;
    supplier: string;
    paymentMethod: PaymentMethod;
    receiptRef: string | null;
    notes: string;
    recordAsBusinessExpense: boolean;
  }) =>
    request<{ good: StagedGood; linkedTransaction: Transaction | null }>('/api/goods', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateGood: (
    id: string,
    payload: Partial<{
      siteStatus: 'pending' | 'uploaded';
      sellingPrice: number | null;
      notes: string;
      sku: string;
    }>
  ) =>
    request<{ good: StagedGood }>(`/api/goods/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteGood: (id: string) =>
    request<{ ok: boolean }>(`/api/goods/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  getBudgets: () => request<{ budgets: BudgetProject[] }>('/api/budgets'),
  createBudget: (payload: {
    name: string;
    kind: 'project' | 'category';
    space: LedgerSpace;
    category: string | null;
    limitAmount: number;
    currency: CurrencyCode;
    period: 'monthly' | 'quarterly' | 'total';
    description: string;
  }) =>
    request<{ budget: BudgetProject }>('/api/budgets', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  deleteBudget: (id: string) =>
    request<{ ok: boolean }>(`/api/budgets/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  getMembers: () => request<{ members: UserProfile[] }>('/api/members'),
  createMember: (payload: {
    name: string;
    email: string;
    password: string;
    role: UserRole;
    allowedSpaces: LedgerSpace[];
  }) =>
    request<{ member: UserProfile }>('/api/members', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateMember: (id: string, payload: { role: UserRole; allowedSpaces: LedgerSpace[] }) =>
    request<{ member: UserProfile }>(`/api/members/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  deleteMember: (id: string) =>
    request<{ ok: boolean }>(`/api/members/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  getAudit: () => request<{ entries: AuditLogEntry[] }>('/api/audit'),

  scanReceiptImage: (payload: {
    imageBase64: string;
    mimeType: string;
    preferredSpace?: LedgerSpace;
    autoSave?: boolean;
    sourceChannel?: 'ocr_camera' | 'ocr_upload';
    forcedType?: TransactionType;
    siteSyncStatus?: SiteSyncStatus;
  }) =>
    request<{ ocr: OcrReceiptResult; savedTransaction: Transaction | null }>('/api/ocr/scan-receipt', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  parseReceiptText: (payload: {
    text: string;
    preferredSpace?: LedgerSpace;
    autoSave?: boolean;
    forcedType?: TransactionType;
    siteSyncStatus?: SiteSyncStatus;
  }) =>
    request<{ ocr: OcrReceiptResult; savedTransaction: Transaction | null }>('/api/ocr/parse-text', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  getBankConnections: () => request<{ connections: BankConnection[] }>('/api/bank/connections'),
  createBankConnection: (payload: {
    provider: BankConnection['provider'];
    name: string;
    accountMask: string;
    defaultSpace: LedgerSpace;
    currency: CurrencyCode;
    apiEndpoint?: string;
    apiToken?: string;
  }) =>
    request<{ connection: BankConnection; webhookSecret: string }>('/api/bank/connections', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  deleteBankConnection: (id: string) =>
    request<{ ok: boolean }>(`/api/bank/connections/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  importBankStatement: (payload: {
    connectionId?: string;
    content: string;
    space?: LedgerSpace;
  }) =>
    request<{ imported: number; skipped: number; totalParsed: number }>('/api/bank/import-statement', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  syncBankApi: (id: string) =>
    request<{ imported: number; skipped: number }>(`/api/bank/sync/${encodeURIComponent(id)}`, {
      method: 'POST',
    }),

  // Cashbox accounts & reconciliation
  getAccounts: () => request<{ accounts: CashAccount[] }>('/api/accounts'),
  updateAccount: (
    id: string,
    payload: Partial<{ name: string; openingBalance: number; openingDate: string }>
  ) =>
    request<{ account: CashAccount }>(`/api/accounts/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  reconcileAccount: (id: string, actualBalance: number) =>
    request<{ account: CashAccount }>(`/api/accounts/${encodeURIComponent(id)}/reconcile`, {
      method: 'POST',
      body: JSON.stringify({ actualBalance }),
    }),

  // Debts & credit (Карыз / Насия)
  getDebts: () => request<{ debts: DebtRecord[] }>('/api/debts'),
  createDebt: (payload: {
    direction: DebtDirection;
    space: LedgerSpace;
    counterparty: string;
    contact: string;
    totalAmount: number;
    paidAmount: number;
    currency: CurrencyCode;
    dueDate: string | null;
    notes: string;
  }) =>
    request<{ debt: DebtRecord }>('/api/debts', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  addDebtPayment: (
    id: string,
    payload: { amount: number; paymentMethod: PaymentMethod; recordTransaction: boolean }
  ) =>
    request<{ debt: DebtRecord; linkedTransaction: Transaction | null }>(
      `/api/debts/${encodeURIComponent(id)}/payment`,
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    ),
  deleteDebt: (id: string) =>
    request<{ ok: boolean }>(`/api/debts/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // Telegram Bot integration
  getTelegramConfig: () =>
    request<{ config: TelegramConfig; inbox: TelegramInboxItem[] }>('/api/telegram/config'),
  updateTelegramConfig: (payload: {
    allowedChatIds?: string[];
    defaultPhotoMode?: TelegramDefaultMode;
    autoReply?: boolean;
    dailySummaryChatId?: string;
  }) =>
    request<{
      ok: boolean;
      allowedChatIds: string[];
      defaultPhotoMode: TelegramDefaultMode;
      autoReply: boolean;
      dailySummaryChatId: string;
    }>('/api/telegram/config', {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  registerTelegramWebhook: () =>
    request<{ ok: boolean; description: string; webhookRegisteredAt: string }>(
      '/api/telegram/register-webhook',
      { method: 'POST' }
    ),
  sendTelegramDailySummary: () =>
    request<{ sent: boolean; summaryText: string; reason?: string }>(
      '/api/telegram/send-daily-summary',
      { method: 'POST' }
    ),

  // Editable auto-lists (30 clients, 30 business nomenclatures, 8 family nomenclatures)
  getCatalog: () =>
    request<{
      clients: CatalogItem[];
      businessExpenses: CatalogItem[];
      familyExpenses: CatalogItem[];
    }>('/api/catalog'),
  createCatalogItem: (payload: { kind: CatalogKind; name: string; phone?: string }) =>
    request<{ item: CatalogItem }>('/api/catalog', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),
  updateCatalogItem: (id: string, payload: { name: string; phone?: string }) =>
    request<{ item: CatalogItem }>(`/api/catalog/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),
  replaceCatalogList: (kind: CatalogKind, items: { name: string; phone?: string }[]) =>
    request<{ items: CatalogItem[] }>('/api/catalog/replace', {
      method: 'PUT',
      body: JSON.stringify({ kind, items }),
    }),
  deleteCatalogItem: (id: string) =>
    request<{ ok: boolean }>(`/api/catalog/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  // Monthly expense soft-alert limits (KGS)
  getLimits: () => request<{ limits: MonthlyLimits }>('/api/limits'),
  updateLimits: (payload: { familyMonthlyKgs: number; businessMonthlyKgs: number }) =>
    request<{ limits: MonthlyLimits }>('/api/limits', {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),
};
