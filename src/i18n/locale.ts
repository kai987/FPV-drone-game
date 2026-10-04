export type Locale = 'zh' | 'ja' | 'en';
export type MessageCatalog = Record<string, readonly [japanese: string, english: string]>;
export type MessageParams = Readonly<Record<string, string | number>>;
export interface LocalizedMessage { key: string; params?: MessageParams }
export type NoticeMessage = string | LocalizedMessage;

export const LOCALE_STORAGE_KEY = 'aeroflow-language';
export const LANGUAGE_TAGS: Record<Locale, string> = { zh: 'zh-CN', ja: 'ja', en: 'en' };

export function isLocale(value: unknown): value is Locale {
  return value === 'zh' || value === 'ja' || value === 'en';
}

export function readLocale(storage?: Pick<Storage, 'getItem'>): Locale {
  try {
    const value = storage?.getItem(LOCALE_STORAGE_KEY);
    return isLocale(value) ? value : 'zh';
  } catch { return 'zh'; }
}

export function interpolate(message: string, params: MessageParams = {}): string {
  return message.replace(/\{(\w+)\}/g, (placeholder, name: string) =>
    Object.hasOwn(params, name) ? String(params[name]) : placeholder);
}
