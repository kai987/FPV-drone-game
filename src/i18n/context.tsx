import { createContext, useCallback, useContext, useLayoutEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { LANGUAGE_TAGS, LOCALE_STORAGE_KEY, readLocale } from './locale';
import type { Locale, MessageParams } from './locale';
import { translate } from './messages';

interface I18nContextValue {
  locale: Locale;
  languageTag: string;
  setLocale(locale: Locale): void;
  t(source: string, params?: MessageParams): string;
}
const I18nContext = createContext<I18nContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, updateLocale] = useState<Locale>(() => {
    try { return readLocale(window.localStorage); } catch { return 'zh'; }
  });
  const setLocale = useCallback((next: Locale) => {
    updateLocale(next);
    try { localStorage.setItem(LOCALE_STORAGE_KEY, next); } catch { /* Language switching also works without storage. */ }
  }, []);
  const t = useCallback((source: string, params?: MessageParams) => translate(locale, source, params), [locale]);
  const value = useMemo(() => ({ locale, languageTag: LANGUAGE_TAGS[locale], setLocale, t }), [locale, setLocale, t]);
  useLayoutEffect(() => {
    document.documentElement.lang = LANGUAGE_TAGS[locale];
    document.title = t('AEROFLOW — 第一视角无人机飞行场');
    document.querySelector('meta[name="description"]')?.setAttribute('content', t('AEROFLOW 第一视角无人机游戏。在松林山谷、工厂和海港中飞行、穿越检查点、体验风场与投弹挑战。'));
  }, [locale, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n requires LocaleProvider');
  return context;
}
