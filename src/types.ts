export type LedgerSpace = 'business' | 'family' | 'personal';

export type TransactionType = 'income' | 'expense';

export type PaymentMethod = 'cash' | 'cashless';

export type SiteSyncStatus = 'not_applicable' | 'pending' | 'synced';

export type UserRole = 'owner' | 'admin' | 'editor' | 'viewer';

export type AppLang = 'kg' | 'ru';

export type CurrencyCode =
  | 'KGS'
  | 'USD'
  | 'EUR'
  | 'RUB'
  | 'KZT'
  | 'UZS'
  | 'TRY'
  | 'GBP'
  | 'AED'
  | 'CNY';

export interface UserProfile {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  allowedSpaces: LedgerSpace[];
  createdAt: string;
  lastActiveAt?: string;
}

export interface Transaction {
  id: string;
  space: LedgerSpace;
  type: TransactionType;
  paymentMethod: PaymentMethod;
  siteSyncStatus: SiteSyncStatus;
  clientContact: string | null;
  amount: number;
  currency: CurrencyCode;
  amountInKgs: number;
  exchangeRate: number;
  category: string;
  projectId: string | null;
  merchant: string;
  description: string;
  paymentSource: string;
  date: string; // YYYY-MM-DD
  receiptRef: string | null;
  externalRef: string | null;
  sourceChannel:
    | 'manual'
    | 'ocr_camera'
    | 'ocr_upload'
    | 'bank_api'
    | 'bank_file'
    | 'webhook'
    | 'telegram';
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

export interface StagedGood {
  id: string;
  productName: string;
  sku: string;
  quantity: number;
  unit: string;
  unitCost: number;
  currency: CurrencyCode;
  totalCostKgs: number;
  sellingPrice: number | null;
  supplier: string;
  paymentMethod: PaymentMethod;
  receiptRef: string | null;
  notes: string;
  siteStatus: 'pending' | 'uploaded';
  linkedTxId: string | null;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  uploadedAt: string | null;
}

export type CatalogKind = 'client' | 'business_expense' | 'family_expense';

export interface CatalogItem {
  id: string;
  kind: CatalogKind;
  sortOrder: number;
  name: string;
  phone: string;
}

export interface MonthlyLimits {
  familyMonthlyKgs: number;
  businessMonthlyKgs: number;
  updatedAt: string | null;
}

export interface CashAccount {
  id: string;
  name: string;
  kind: PaymentMethod;
  currency: CurrencyCode;
  openingBalance: number;
  openingDate: string;
  lastActualBalance: number | null;
  lastReconciledAt: string | null;
  updatedAt: string;
}

export type DebtDirection = 'client_owes' | 'we_owe';
export type DebtStatus = 'open' | 'partial' | 'paid';

export interface DebtRecord {
  id: string;
  direction: DebtDirection;
  space: LedgerSpace;
  counterparty: string;
  contact: string;
  totalAmount: number;
  paidAmount: number;
  currency: CurrencyCode;
  totalInKgs: number;
  paidInKgs: number;
  dueDate: string | null;
  notes: string;
  status: DebtStatus;
  createdBy: string;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

export type TelegramDefaultMode = 'family_expense' | 'client_income' | 'business_expense';

export interface TelegramConfig {
  botConfigured: boolean;
  webhookSecretConfigured: boolean;
  botUsername: string | null;
  webhookUrl: string;
  allowedChatIds: string[];
  defaultPhotoMode: TelegramDefaultMode;
  autoReply: boolean;
  dailySummaryChatId: string;
  webhookRegisteredAt: string | null;
}

export interface TelegramInboxItem {
  id: string;
  chatId: string;
  senderName: string;
  messageType: 'photo' | 'text';
  caption: string;
  routedTo: string;
  status: 'saved' | 'ignored' | 'error';
  summary: string;
  linkedTxId: string | null;
  createdAt: string;
}

export interface BudgetProject {
  id: string;
  name: string;
  kind: 'project' | 'category';
  space: LedgerSpace;
  category: string | null;
  limitAmount: number;
  currency: CurrencyCode;
  limitInKgs: number;
  period: 'monthly' | 'quarterly' | 'total';
  description: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface BankConnection {
  id: string;
  provider: 'mbank' | 'demirbank' | 'optima' | 'kaspi' | 'tbank' | 'custom_api';
  name: string;
  accountMask: string;
  defaultSpace: LedgerSpace;
  currency: CurrencyCode;
  apiEndpoint: string | null;
  hasApiToken: boolean;
  webhookSecretPrefix: string;
  autoImportEnabled: boolean;
  status: 'active' | 'paused' | 'error';
  lastSyncAt: string | null;
  lastSyncCount: number;
  createdAt: string;
}

export interface AuditLogEntry {
  id: string;
  userId: string;
  userName: string;
  action: string;
  entityType:
    | 'transaction'
    | 'budget'
    | 'member'
    | 'bank'
    | 'ocr'
    | 'goods'
    | 'debt'
    | 'cashbox'
    | 'telegram';
  summary: string;
  space: LedgerSpace | null;
  createdAt: string;
}

export interface OcrLineItem {
  name: string;
  quantity: number;
  price: number;
}

export interface OcrReceiptResult {
  isMbankReceipt: boolean;
  documentType: 'mbank_transfer' | 'mbank_payment' | 'store_receipt' | 'invoice' | 'other';
  type: TransactionType;
  merchant: string;
  amount: number;
  currency: CurrencyCode;
  date: string;
  suggestedSpace: LedgerSpace;
  suggestedCategory: string;
  paymentSource: string;
  receiptNumber: string;
  commission: number;
  lineItems: OcrLineItem[];
  rawTextSummary: string;
  confidenceNote: string;
  convertedAmountKgs: number;
  exchangeRateToKgs: number;
}

export interface PresenceUser {
  id: string;
  name: string;
  role: UserRole;
  connectedAt: string;
}

export type RealtimeEvent =
  | { type: 'auth:ok'; userId: string }
  | { type: 'auth:error'; message: string }
  | { type: 'presence:update'; users: PresenceUser[] }
  | { type: 'transaction:created'; transaction: Transaction }
  | { type: 'transaction:updated'; transaction: Transaction }
  | { type: 'transaction:deleted'; id: string; space: LedgerSpace }
  | { type: 'transactions:imported'; count: number; space?: LedgerSpace }
  | { type: 'good:created'; good: StagedGood }
  | { type: 'good:updated'; good: StagedGood }
  | { type: 'good:deleted'; id: string }
  | { type: 'account:updated'; account: CashAccount }
  | { type: 'debt:created'; debt: DebtRecord }
  | { type: 'debt:updated'; debt: DebtRecord }
  | { type: 'debt:deleted'; id: string }
  | { type: 'telegram:received'; item: TelegramInboxItem }
  | { type: 'catalog:changed' }
  | { type: 'limits:changed'; limits: MonthlyLimits }
  | { type: 'budget:created'; budget: BudgetProject }
  | { type: 'budget:updated'; budget: BudgetProject }
  | { type: 'budget:deleted'; id: string; space: LedgerSpace }
  | { type: 'member:changed' }
  | { type: 'bank:changed' }
  | { type: 'audit:created'; entry: AuditLogEntry };
