import { APP_MESSAGES } from './app-messages.ts';
import { CATALOG_MESSAGES } from './catalog-messages.ts';
import { GUIDE_MESSAGES } from './guide-messages.ts';
import { HANGAR_MESSAGES } from './hangar-messages.ts';
import { MINIMAP_MESSAGES } from './minimap-messages.ts';
import { PANEL_MESSAGES } from './panel-messages.ts';
import { interpolate } from './locale.ts';
import type { Locale, LocalizedMessage, MessageCatalog, MessageParams, NoticeMessage } from './locale.ts';

export const MESSAGE_GROUPS = [APP_MESSAGES, CATALOG_MESSAGES, GUIDE_MESSAGES, HANGAR_MESSAGES, MINIMAP_MESSAGES, PANEL_MESSAGES];
export const MESSAGES: MessageCatalog = Object.assign({}, ...MESSAGE_GROUPS);

export function translate(locale: Locale, source: string, params?: MessageParams): string {
  const translation = locale === 'zh' ? source : MESSAGES[source]?.[locale === 'ja' ? 0 : 1] ?? source;
  return interpolate(translation, params);
}

/** Keep engine events untranslated until rendering, including an already visible toast. */
export function translateNotice(locale: Locale, notice: NoticeMessage): string {
  if (typeof notice === 'string') return translate(locale, notice);
  const params: LocalizedMessage['params'] = notice.params && Object.fromEntries(
    Object.entries(notice.params).map(([key, value]) => [key, typeof value === 'string' ? translate(locale, value) : value]),
  );
  return translate(locale, notice.key, params);
}
