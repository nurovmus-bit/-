import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  CheckCircle2,
  FileText,
  RefreshCw,
  ScanLine,
  Upload,
  VideoOff,
} from 'lucide-react';
import { api } from '../api.ts';
import { CURRENCIES, formatMoney } from '../constants.ts';
import type {
  AppLang,
  CatalogItem,
  CurrencyCode,
  OcrReceiptResult,
  Transaction,
} from '../types.ts';

interface ReceiptScannerViewProps {
  lang: AppLang;
  familyNomenclature: CatalogItem[];
  businessNomenclature: CatalogItem[];
  clients: CatalogItem[];
  onTransactionSaved: (tx: Transaction) => void;
}

type ScanTarget = 'family_expense' | 'business_expense' | 'client_site';

const SAMPLE_MBANK_RECEIPT = `MBANK — Квитанция об оплате
ОАО «Коммерческий банк КЫРГЫЗСТАН»
Статус: Успешно исполнено
Дата и время: ${new Date().toISOString().slice(0, 10)} 14:28:11
Номер квитанции: MB-90481277
Получатель: Глобус Супермаркет (QR-оплата)
Счёт списания: 4169 •••• 8421 (MBank)
Сумма: 3 450,00 KGS
Комиссия: 0,00 KGS`;

export function ReceiptScannerView({
  lang,
  familyNomenclature,
  businessNomenclature,
  clients,
  onTransactionSaved,
}: ReceiptScannerViewProps) {
  const isKg = lang === 'kg';
  const [mode, setMode] = useState<'camera' | 'upload' | 'text'>('camera');
  const [scanTarget, setScanTarget] = useState<ScanTarget>('family_expense');
  const [autoSave, setAutoSave] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const [facingMode, setFacingMode] = useState<'environment' | 'user'>('environment');
  const [cameraError, setCameraError] = useState<string | null>(null);

  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [receiptText, setReceiptText] = useState('');
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ocrResult, setOcrResult] = useState<OcrReceiptResult | null>(null);
  const [autoSavedTx, setAutoSavedTx] = useState<Transaction | null>(null);

  const [formTarget, setFormTarget] = useState<ScanTarget>('family_expense');
  const [formAmount, setFormAmount] = useState('');
  const [formCurrency, setFormCurrency] = useState<CurrencyCode>('KGS');
  const [formMerchant, setFormMerchant] = useState('');
  const [formCategory, setFormCategory] = useState('');
  const [formDate, setFormDate] = useState(new Date().toISOString().slice(0, 10));
  const [formReceiptRef, setFormReceiptRef] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [savingForm, setSavingForm] = useState(false);
  const [savedNotice, setSavedNotice] = useState<string | null>(null);

  const liveCategories = useMemo(() => {
    if (formTarget === 'family_expense') return familyNomenclature.map((i) => i.name);
    if (formTarget === 'business_expense') return businessNomenclature.map((i) => i.name);
    return ['Клиенттен төлөм'];
  }, [formTarget, familyNomenclature, businessNomenclature]);

  function stopCamera() {
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) {
        track.stop();
      }
      streamRef.current = null;
    }
    setCameraActive(false);
  }

  async function startCamera(nextFacing: 'environment' | 'user' = facingMode) {
    setCameraError(null);
    stopCamera();
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError(
        isKg
          ? 'Бул браузерде камера иштебейт. «Фото / Скриншот» бөлүмүн колдонуңуз.'
          : 'Камера недоступна в текущем браузере. Используйте вкладку «Фото или скриншот».'
      );
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: nextFacing, width: { ideal: 1280 }, height: { ideal: 960 } },
        audio: false,
      });
      streamRef.current = stream;
      setCameraActive(true);
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          void videoRef.current.play();
        }
      });
    } catch {
      setCameraError(
        isKg
          ? 'Камерага уруксат берилген жок. Браузерден уруксат бериңиз же сүрөт жүктөңүз.'
          : 'Нет доступа к камере. Разрешите доступ в браузере или загрузите фото.'
      );
    }
  }

  useEffect(() => {
    return () => stopCamera();
  }, []);

  useEffect(() => {
    if (mode !== 'camera') stopCamera();
  }, [mode]);

  function populateFormFromOcr(ocr: OcrReceiptResult, target: ScanTarget) {
    setFormTarget(target);
    setFormAmount(ocr.amount > 0 ? String(ocr.amount) : '');
    setFormCurrency(ocr.currency);
    setFormMerchant(ocr.merchant);
    const defaultCat =
      target === 'family_expense'
        ? familyNomenclature[0]?.name || ocr.suggestedCategory
        : target === 'business_expense'
          ? businessNomenclature[0]?.name || ocr.suggestedCategory
          : 'Клиенттен төлөм';
    setFormCategory(defaultCat);
    setFormDate(ocr.date);
    setFormReceiptRef(ocr.receiptNumber || '');
    setFormDescription(ocr.rawTextSummary || '');
  }

  async function runImageOcr(
    dataUrl: string,
    mimeType: string,
    channel: 'ocr_camera' | 'ocr_upload'
  ) {
    setScanning(true);
    setError(null);
    setSavedNotice(null);
    setAutoSavedTx(null);
    try {
      const res = await api.scanReceiptImage({
        imageBase64: dataUrl,
        mimeType,
        preferredSpace: scanTarget === 'family_expense' ? 'family' : 'business',
        autoSave,
        sourceChannel: channel,
        forcedType: scanTarget === 'client_site' ? 'income' : 'expense',
        siteSyncStatus: scanTarget === 'client_site' ? 'pending' : 'not_applicable',
      });
      setOcrResult(res.ocr);
      populateFormFromOcr(res.ocr, scanTarget);
      if (res.savedTransaction) {
        setAutoSavedTx(res.savedTransaction);
        onTransactionSaved(res.savedTransaction);
        setSavedNotice(
          isKg
            ? `Чек автоматтык жазылды: ${res.savedTransaction.merchant} (${formatMoney(res.savedTransaction.amount, res.savedTransaction.currency)})`
            : `Чек автоматически записан: ${res.savedTransaction.merchant} (${formatMoney(res.savedTransaction.amount, res.savedTransaction.currency)})`
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка распознавания чека');
    } finally {
      setScanning(false);
    }
  }

  function handleCaptureFrame() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.videoWidth === 0) return;

    const maxW = 1400;
    const scale = Math.min(1, maxW / video.videoWidth);
    canvas.width = Math.round(video.videoWidth * scale);
    canvas.height = Math.round(video.videoHeight * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.88);
    setPreviewDataUrl(dataUrl);
    stopCamera();
    void runImageOcr(dataUrl, 'image/jpeg', 'ocr_camera');
  }

  function handleFileSelected(file: File | null) {
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError(isKg ? 'JPG, PNG же WebP сүрөт тандаңыз' : 'Поддерживаются JPG, PNG и WebP');
      return;
    }
    if (file.size > 9 * 1024 * 1024) {
      setError(isKg ? 'Файл 9 МБдан ашпашы керек' : 'Размер файла не должен превышать 9 МБ');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? '');
      setPreviewDataUrl(result);
      void runImageOcr(result, file.type, 'ocr_upload');
    };
    reader.readAsDataURL(file);
  }

  async function handleTextOcr(e: React.FormEvent) {
    e.preventDefault();
    if (receiptText.trim().length < 5) {
      setError(isKg ? 'MBank чектин текстин чаптаңыз' : 'Вставьте текст квитанции MBank');
      return;
    }
    setScanning(true);
    setError(null);
    setSavedNotice(null);
    setAutoSavedTx(null);
    try {
      const res = await api.parseReceiptText({
        text: receiptText.trim(),
        preferredSpace: scanTarget === 'family_expense' ? 'family' : 'business',
        autoSave,
        forcedType: scanTarget === 'client_site' ? 'income' : 'expense',
        siteSyncStatus: scanTarget === 'client_site' ? 'pending' : 'not_applicable',
      });
      setOcrResult(res.ocr);
      populateFormFromOcr(res.ocr, scanTarget);
      if (res.savedTransaction) {
        setAutoSavedTx(res.savedTransaction);
        onTransactionSaved(res.savedTransaction);
        setSavedNotice(
          isKg
            ? `Чек автоматтык жазылды: ${formatMoney(res.savedTransaction.amount, res.savedTransaction.currency)}`
            : `Квитанция автоматически записана: ${formatMoney(res.savedTransaction.amount, res.savedTransaction.currency)}`
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка разбора');
    } finally {
      setScanning(false);
    }
  }

  async function handleSaveRecognized(e: React.FormEvent) {
    e.preventDefault();
    const num = Number(formAmount.replace(',', '.'));
    if (!Number.isFinite(num) || num <= 0) {
      setError(isKg ? 'Сумманы туура жазыңыз' : 'Укажите корректную сумму');
      return;
    }
    setSavingForm(true);
    setError(null);
    try {
      const isClient = formTarget === 'client_site';
      const res = await api.createTransaction({
        space: formTarget === 'family_expense' ? 'family' : 'business',
        type: isClient ? 'income' : 'expense',
        paymentMethod: 'cashless',
        siteSyncStatus: isClient ? 'pending' : 'not_applicable',
        amount: Math.round(num * 100) / 100,
        currency: formCurrency,
        category: isClient ? 'Клиенттен төлөм' : formCategory || liveCategories[0] || 'Чыгым',
        projectId: null,
        merchant: formMerchant.trim() || formCategory || 'MBank чек',
        description: formDescription.trim(),
        paymentSource: 'MBank',
        date: formDate,
        receiptRef: formReceiptRef.trim() || null,
        sourceChannel: mode === 'camera' ? 'ocr_camera' : 'ocr_upload',
      });
      setAutoSavedTx(res.transaction);
      onTransactionSaved(res.transaction);
      setSavedNotice(
        isKg
          ? `Сакталды: ${res.transaction.merchant} (${formatMoney(res.transaction.amount, res.transaction.currency)})`
          : `Сохранено: ${res.transaction.merchant} (${formatMoney(res.transaction.amount, res.transaction.currency)})`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения');
    } finally {
      setSavingForm(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 pb-4 border-b border-slate-800">
        <div>
          <h2 className="text-xl font-bold text-white">
            {isKg ? 'Чек жана MBank квитанция сканери' : 'Сканер чеков и квитанций MBank'}
          </h2>
          <p className="mt-1 text-sm text-slate-400">
            {isKg
              ? 'Камера, скриншот же текст аркылуу чекти таанып, 10 валютада автоматтык эсепке алат.'
              : 'Распознавание чеков MBank и бумажных чеков с поддержкой 10 валют.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <select
            value={scanTarget}
            onChange={(e) => setScanTarget(e.target.value as ScanTarget)}
            className="px-3 py-1.5 text-xs font-medium bg-[#0e131f] text-slate-100 border border-slate-700 rounded-xl"
          >
            <option value="family_expense">{isKg ? 'Үй-бүлө чыгымы (8)' : 'Семейный расход (8)'}</option>
            <option value="business_expense">{isKg ? 'Бизнес · Товар чыгымы (30)' : 'Бизнес-расход (30)'}</option>
            <option value="client_site">{isKg ? 'Клиенттен төлөм → Сайтка' : 'Оплата клиента → На сайт'}</option>
          </select>

          <label className="flex items-center gap-2 text-xs font-medium text-slate-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={autoSave}
              onChange={(e) => setAutoSave(e.target.checked)}
              className="w-4 h-4 rounded border-slate-600 bg-[#090d16] accent-cyan-400"
            />
            <span>{isKg ? 'Дароо авто-сактоо' : 'Автосохранение'}</span>
          </label>
        </div>
      </div>

      {/* Mode Switcher */}
      <div className="inline-flex p-1 bg-[#0e131f] border border-slate-800 rounded-xl">
        <button
          type="button"
          onClick={() => setMode('camera')}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg cursor-pointer transition-colors ${
            mode === 'camera'
              ? 'bg-cyan-400 text-slate-950 shadow-[0_0_14px_rgba(34,211,238,0.35)]'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Camera className="w-4 h-4" />
          <span>Камера</span>
        </button>
        <button
          type="button"
          onClick={() => setMode('upload')}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg cursor-pointer transition-colors ${
            mode === 'upload'
              ? 'bg-cyan-400 text-slate-950 shadow-[0_0_14px_rgba(34,211,238,0.35)]'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <Upload className="w-4 h-4" />
          <span>Фото / Скриншот</span>
        </button>
        <button
          type="button"
          onClick={() => setMode('text')}
          className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg cursor-pointer transition-colors ${
            mode === 'text'
              ? 'bg-cyan-400 text-slate-950 shadow-[0_0_14px_rgba(34,211,238,0.35)]'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          <FileText className="w-4 h-4" />
          <span>{isKg ? 'Чек тексти / SMS' : 'Текст чека / SMS'}</span>
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        <div className="lg:col-span-6 bg-[#0e131f]/95 border border-slate-800/90 rounded-2xl p-6 space-y-4">
          {mode === 'camera' && (
            <div className="space-y-4">
              <div className="relative aspect-[4/3] bg-[#07090f] border border-slate-800 rounded-xl overflow-hidden flex items-center justify-center">
                {cameraActive ? (
                  <>
                    <video ref={videoRef} playsInline muted className="w-full h-full object-cover" />
                    <div className="pointer-events-none absolute inset-6 border border-cyan-400/60 rounded-xl shadow-[0_0_20px_rgba(34,211,238,0.2)]" />
                  </>
                ) : previewDataUrl ? (
                  <img src={previewDataUrl} alt="Чек" className="w-full h-full object-contain bg-[#07090f]" />
                ) : (
                  <div className="text-center px-6">
                    <Camera className="w-10 h-10 text-cyan-400/70 mx-auto" />
                    <p className="mt-3 text-sm font-medium text-slate-200">
                      {isKg ? 'Камераны чекке же MBank квитанциясына багыттаңыз' : 'Наведите камеру на чек или MBank'}
                    </p>
                  </div>
                )}
              </div>
              <canvas ref={canvasRef} className="hidden" />

              {cameraError && (
                <div className="p-3 rounded-xl bg-amber-500/15 border border-amber-400/40 text-xs text-amber-200">
                  {cameraError}
                </div>
              )}

              <div className="flex flex-wrap items-center gap-3">
                {!cameraActive ? (
                  <button
                    type="button"
                    onClick={() => void startCamera(facingMode)}
                    className="flex items-center gap-2 px-4 py-2.5 text-sm font-bold bg-cyan-400 hover:bg-cyan-300 text-slate-950 rounded-xl shadow-[0_0_18px_rgba(34,211,238,0.35)] cursor-pointer"
                  >
                    <Camera className="w-4 h-4" />
                    <span>{isKg ? 'Камераны күйгүзүү' : 'Включить камеру'}</span>
                  </button>
                ) : (
                  <>
                    <button
                      type="button"
                      onClick={handleCaptureFrame}
                      disabled={scanning}
                      className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold bg-cyan-400 hover:bg-cyan-300 text-slate-950 rounded-xl shadow-[0_0_18px_rgba(34,211,238,0.35)] cursor-pointer"
                    >
                      <ScanLine className="w-4 h-4" />
                      <span>{isKg ? 'Тартуу жана таануу' : 'Снять и распознать'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const next = facingMode === 'environment' ? 'user' : 'environment';
                        setFacingMode(next);
                        void startCamera(next);
                      }}
                      className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-200 border border-slate-700 rounded-xl cursor-pointer"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      <span>{isKg ? 'Алмаштыруу' : 'Камера'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={stopCamera}
                      className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 rounded-xl cursor-pointer"
                    >
                      <VideoOff className="w-3.5 h-3.5" />
                      <span>Стоп</span>
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {mode === 'upload' && (
            <div className="space-y-4">
              <label className="block border-2 border-dashed border-cyan-500/40 hover:border-cyan-400 bg-cyan-400/5 rounded-2xl p-8 text-center cursor-pointer transition-colors">
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={(e) => handleFileSelected(e.target.files?.[0] ?? null)}
                />
                <Upload className="w-8 h-8 text-cyan-300 mx-auto" />
                <p className="mt-3 text-sm font-medium text-white">
                  {isKg ? 'MBank скриншотун же чек сүрөтүн тандаңыз' : 'Выберите скриншот MBank или фото чека'}
                </p>
              </label>
              {previewDataUrl && (
                <div className="border border-slate-800 rounded-xl overflow-hidden bg-[#07090f] p-2">
                  <img src={previewDataUrl} alt="Чек" className="max-h-72 mx-auto object-contain rounded" />
                </div>
              )}
            </div>
          )}

          {mode === 'text' && (
            <form onSubmit={handleTextOcr} className="space-y-4">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-slate-200">
                  {isKg ? 'MBank чек тексти же SMS' : 'Текст квитанции MBank'}
                </label>
                <button
                  type="button"
                  onClick={() => setReceiptText(SAMPLE_MBANK_RECEIPT)}
                  className="text-xs font-medium text-cyan-300 hover:underline cursor-pointer"
                >
                  {isKg ? 'Мисал коюу' : 'Вставить пример'}
                </button>
              </div>
              <textarea
                rows={8}
                value={receiptText}
                onChange={(e) => setReceiptText(e.target.value)}
                placeholder={isKg ? 'MBank чектин текстин чаптаңыз...' : 'Вставьте текст чека MBank...'}
                className="w-full p-3 text-xs font-mono bg-[#090d16] text-slate-100 placeholder:text-slate-500 border border-slate-700 rounded-xl focus:outline-none focus:border-cyan-400"
              />
              <button
                type="submit"
                disabled={scanning}
                className="flex items-center gap-2 px-5 py-2.5 text-sm font-bold bg-cyan-400 hover:bg-cyan-300 text-slate-950 rounded-xl shadow-[0_0_18px_rgba(34,211,238,0.32)] cursor-pointer"
              >
                <ScanLine className="w-4 h-4" />
                <span>{scanning ? '...' : isKg ? 'Чекти таануу' : 'Распознать'}</span>
              </button>
            </form>
          )}

          {scanning && (
            <div className="p-3.5 rounded-xl bg-cyan-400/10 border border-cyan-400/35 text-xs text-cyan-200">
              {isKg ? 'Чек таанылууда...' : 'Распознавание чека...'}
            </div>
          )}
          {error && (
            <div className="p-3.5 rounded-xl bg-rose-500/15 border border-rose-500/45 text-xs text-rose-200">
              {error}
            </div>
          )}
          {savedNotice && (
            <div className="flex items-center gap-2 p-3.5 rounded-xl bg-emerald-500/15 border border-emerald-400/40 text-xs text-emerald-200">
              <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-400" />
              <span>{savedNotice}</span>
            </div>
          )}
        </div>

        {/* Right: Confirmation Form */}
        <div className="lg:col-span-6 bg-[#0e131f]/95 border border-slate-800/90 rounded-2xl p-6">
          <div className="pb-4 border-b border-slate-800 flex items-center justify-between">
            <h3 className="text-base font-semibold text-white">
              {isKg ? 'Таанылган маалымат' : 'Распознанные данные'}
            </h3>
            {ocrResult && ocrResult.currency !== 'KGS' && (
              <span className="text-xs font-mono font-semibold text-cyan-300">
                ≈ {formatMoney(ocrResult.convertedAmountKgs, 'KGS')}
              </span>
            )}
          </div>

          {!ocrResult ? (
            <div className="py-12 text-center text-xs text-slate-400 space-y-2">
              <p>{isKg ? 'Чекти тартканда талаалар автоматтык толот.' : 'Отсканируйте чек — поля заполнятся сами.'}</p>
              <p className="font-mono text-cyan-300/80">
                KGS · USD · EUR · RUB · KZT · UZS · TRY · GBP · AED · CNY
              </p>
            </div>
          ) : (
            <form onSubmit={handleSaveRecognized} className="mt-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  {isKg ? 'Кайда жазылсын' : 'Куда записать'}
                </label>
                <select
                  value={formTarget}
                  onChange={(e) => {
                    const next = e.target.value as ScanTarget;
                    setFormTarget(next);
                    if (next === 'family_expense' && familyNomenclature[0]) {
                      setFormCategory(familyNomenclature[0].name);
                    } else if (next === 'business_expense' && businessNomenclature[0]) {
                      setFormCategory(businessNomenclature[0].name);
                    } else if (next === 'client_site') {
                      setFormCategory('Клиенттен төлөм');
                    }
                  }}
                  className="w-full px-3 py-2 text-sm bg-[#090d16] text-slate-100 border border-slate-700 rounded-xl"
                >
                  <option value="family_expense">{isKg ? 'Үй-бүлө чыгымы (8)' : 'Семейный расход (8)'}</option>
                  <option value="business_expense">{isKg ? 'Бизнес · Товар чыгымы (30)' : 'Бизнес-расход (30)'}</option>
                  <option value="client_site">{isKg ? 'Клиенттен төлөм → Сайтка' : 'Оплата клиента → На сайт'}</option>
                </select>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Сумма</label>
                  <input
                    type="number"
                    step="0.01"
                    required
                    value={formAmount}
                    onChange={(e) => setFormAmount(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono bg-[#090d16] text-cyan-200 border border-slate-700 rounded-xl"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Валюта</label>
                  <select
                    value={formCurrency}
                    onChange={(e) => setFormCurrency(e.target.value as CurrencyCode)}
                    className="w-full px-2.5 py-2 text-sm bg-[#090d16] text-slate-100 border border-slate-700 rounded-xl"
                  >
                    {CURRENCIES.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.code}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">Дата</label>
                  <input
                    type="date"
                    required
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                    className="w-full px-2.5 py-2 text-xs font-mono bg-[#090d16] text-slate-100 border border-slate-700 rounded-xl"
                  />
                </div>
              </div>

              {formTarget !== 'client_site' ? (
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    {isKg ? 'Номенклатура (Базадан)' : 'Номенклатура (из Базы)'}
                  </label>
                  <select
                    value={liveCategories.includes(formCategory) ? formCategory : liveCategories[0] || ''}
                    onChange={(e) => setFormCategory(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-[#090d16] text-slate-100 border border-slate-700 rounded-xl"
                  >
                    {liveCategories.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1">
                    {isKg ? 'Клиент (30 клиент базасынан)' : 'Клиент (из базы 30)'}
                  </label>
                  <input
                    type="text"
                    required
                    list="scanner-clients-list"
                    value={formMerchant}
                    onChange={(e) => setFormMerchant(e.target.value)}
                    className="w-full px-3 py-2 text-sm bg-[#090d16] text-white border border-slate-700 rounded-xl"
                  />
                  <datalist id="scanner-clients-list">
                    {clients.map((c) => (
                      <option key={c.id} value={c.name} />
                    ))}
                  </datalist>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-slate-300 mb-1">
                  {isKg ? 'Чектеги дүкөн / эскертүү' : 'Магазин / комментарий'}
                </label>
                <input
                  type="text"
                  value={formDescription || formMerchant}
                  onChange={(e) => setFormDescription(e.target.value)}
                  className="w-full px-3 py-2 text-sm bg-[#090d16] text-white border border-slate-700 rounded-xl"
                />
              </div>

              <div className="flex justify-end pt-2 border-t border-slate-800">
                <button
                  type="submit"
                  disabled={savingForm || Boolean(autoSavedTx)}
                  className="px-5 py-2 text-sm font-bold bg-cyan-400 hover:bg-cyan-300 disabled:opacity-50 text-slate-950 rounded-xl shadow-[0_0_16px_rgba(34,211,238,0.3)] cursor-pointer"
                >
                  {savingForm
                    ? '...'
                    : autoSavedTx
                      ? isKg
                        ? 'Сакталды ✓'
                        : 'Сохранено ✓'
                      : isKg
                        ? 'Сактоо'
                        : 'Сохранить'}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
