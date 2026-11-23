import React, { useState } from 'react';
import { BookOpen, Lock } from 'lucide-react';
import { api, setAuthToken } from '../api.ts';
import { PWAInstallButton } from './PWAInstallButton.tsx';
import type { AppLang, UserProfile } from '../types.ts';

interface AuthScreenProps {
  hasUsers: boolean;
  lang: AppLang;
  onChangeLang: (lang: AppLang) => void;
  onAuthenticated: (user: UserProfile, token: string) => void;
}

export function AuthScreen({ hasUsers, lang, onChangeLang, onAuthenticated }: AuthScreenProps) {
  const isKg = lang === 'kg';
  const [name, setName] = useState('Ээси');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [seedDemo, setSeedDemo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = hasUsers
        ? await api.login({ email, password })
        : await api.bootstrap({ name: name.trim() || 'Ээси', email, password, seedDemo });
      setAuthToken(res.token);
      onAuthenticated(res.user, res.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : isKg ? 'Кирүү катасы' : 'Ошибка входа');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen text-slate-100 flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-[410px] bg-[#0e131f]/95 border border-cyan-500/25 rounded-2xl shadow-[0_0_50px_rgba(34,211,238,0.1)] p-8">
        <div className="flex items-center justify-between mb-7">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-cyan-400 text-slate-950 flex items-center justify-center shadow-[0_0_18px_rgba(34,211,238,0.45)]">
              <BookOpen className="w-4 h-4 stroke-[2.2]" />
            </div>
            <span className="text-lg font-bold tracking-tight text-white">
              Книга<span className="text-cyan-300">Счёт</span>
            </span>
          </div>

          <div className="inline-flex p-0.5 bg-[#07090f] border border-slate-800 rounded-lg text-xs">
            <button
              type="button"
              onClick={() => onChangeLang('kg')}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                isKg ? 'bg-cyan-400/20 text-cyan-200 border border-cyan-400/30' : 'text-slate-400 hover:text-white'
              }`}
            >
              КГ
            </button>
            <button
              type="button"
              onClick={() => onChangeLang('ru')}
              className={`px-2.5 py-1 rounded-md font-medium transition-colors cursor-pointer ${
                !isKg ? 'bg-cyan-400/20 text-cyan-200 border border-cyan-400/30' : 'text-slate-400 hover:text-white'
              }`}
            >
              РУ
            </button>
          </div>
        </div>

        <h1 className="text-2xl font-bold text-white tracking-tight">
          {hasUsers
            ? isKg
              ? 'Блокнотко кирүү'
              : 'Вход в блокнот'
            : isKg
              ? 'Жеке блокнотту ачуу'
              : 'Создать личный блокнот'}
        </h1>
        <p className="mt-1.5 text-xs text-slate-400 leading-relaxed">
          {isKg
            ? 'Үй-бүлө жана бизнес чыгымдары, 30 клиент · 30 бизнес · 8 үй-бүлө базасы жана MBank чектер.'
            : 'Учёт семейных и бизнес-расходов, база клиентов и номенклатур, сканирование чеков MBank.'}
        </p>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          {!hasUsers && (
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5" htmlFor="auth-name">
                {isKg ? 'Атыңыз' : 'Ваше имя'}
              </label>
              <input
                id="auth-name"
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-3.5 py-2.5 text-sm bg-[#090d16] text-white border border-slate-700/90 rounded-xl focus:outline-none focus:border-cyan-400 transition-colors"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5" htmlFor="auth-email">
              Email
            </label>
            <input
              id="auth-email"
              type="email"
              required
              autoFocus
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@mail.com"
              className="w-full px-3.5 py-2.5 text-sm bg-[#090d16] text-white placeholder:text-slate-500 border border-slate-700/90 rounded-xl focus:outline-none focus:border-cyan-400 transition-colors"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1.5" htmlFor="auth-pass">
              {isKg ? 'Сыр сөз' : 'Пароль'}
            </label>
            <input
              id="auth-pass"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isKg ? 'Кеминде 6 символ' : 'Минимум 6 символов'}
              className="w-full px-3.5 py-2.5 text-sm bg-[#090d16] text-white placeholder:text-slate-500 border border-slate-700/90 rounded-xl focus:outline-none focus:border-cyan-400 transition-colors"
            />
          </div>

          {!hasUsers && (
            <label className="flex items-center gap-2.5 text-xs text-slate-300 cursor-pointer pt-0.5">
              <input
                type="checkbox"
                checked={seedDemo}
                onChange={(e) => setSeedDemo(e.target.checked)}
                className="w-4 h-4 rounded border-slate-600 bg-[#090d16] accent-cyan-400"
              />
              <span>
                {isKg ? 'Мисал жазууларды кошуу (көрүп чыгуу үчүн)' : 'Добавить примеры записей для теста'}
              </span>
            </label>
          )}

          {error && (
            <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-500/40 text-xs text-rose-200">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-2.5 px-4 rounded-xl bg-cyan-400 hover:bg-cyan-300 active:scale-[0.99] disabled:opacity-60 text-slate-950 text-sm font-bold shadow-[0_0_22px_rgba(34,211,238,0.38)] transition-all cursor-pointer"
          >
            <Lock className="w-3.5 h-3.5" />
            <span>
              {loading
                ? '...'
                : hasUsers
                  ? isKg
                    ? 'Кирүү'
                    : 'Войти'
                  : isKg
                    ? 'Баштоо'
                    : 'Начать'}
            </span>
          </button>
        </form>

        <div className="mt-5 pt-4 border-t border-slate-800 flex items-center justify-between gap-2">
          <span className="text-xs text-slate-400">
            {isKg ? 'Телефонго иконка катары:' : 'Как приложение на телефон:'}
          </span>
          <PWAInstallButton lang={lang} />
        </div>
      </div>
    </div>
  );
}
