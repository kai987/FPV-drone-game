import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { LOCALE_STORAGE_KEY, interpolate, isLocale, readLocale } from '../src/i18n/locale.ts';
import { MESSAGE_GROUPS, MESSAGES, translate, translateNotice } from '../src/i18n/messages.ts';
import { DRONES, DRONE_CATALOG_NOTE } from '../src/game/drone-catalog.ts';
import { MAPS } from '../src/game/map-catalog.ts';
import { WIND_PRESETS, describeWind, sampleWind } from '../src/game/wind.ts';

const placeholders = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
const hasHan = (value: string) => /[\u4e00-\u9fff]/.test(value);

test('locale preference handles all three languages, invalid data and disabled storage', () => {
  for (const locale of ['zh', 'ja', 'en']) {
    assert.ok(isLocale(locale));
    assert.equal(readLocale({ getItem: key => { assert.equal(key, LOCALE_STORAGE_KEY); return locale; } }), locale);
  }
  for (const value of [null, '', 'fr', 'JA', 'undefined']) assert.equal(readLocale({ getItem: () => value }), 'zh');
  assert.equal(readLocale({ getItem: () => { throw new Error('Storage disabled'); } }), 'zh');
  assert.equal(readLocale(), 'zh');
  assert.equal(interpolate('{name} {score} {other}', { name: '$& {count}', score: 0 }), '$& {count} 0 {other}');
});

test('every translation preserves placeholders and duplicate messages agree', () => {
  const seen = new Map<string, readonly string[]>();
  for (const group of MESSAGE_GROUPS) for (const [source, translations] of Object.entries(group)) {
    assert.equal(translations.length, 2, source);
    if (seen.has(source)) assert.deepEqual(translations, seen.get(source), `Conflicting translations: ${source}`);
    seen.set(source, translations);
    for (const translated of translations) {
      assert.ok(translated.trim(), `Empty translation: ${source}`);
      assert.deepEqual(placeholders(translated), placeholders(source), `Placeholder mismatch: ${source}`);
    }
    assert.ok(!hasHan(translations[1]), `Chinese leaked into English: ${source}`);
  }
});

test('all literal UI messages and accessibility text have Japanese and English translations', () => {
  const files = ['src/App.tsx', ...readdirSync('src/components').filter(file => file.endsWith('.tsx')).map(file => `src/components/${file}`)];
  for (const file of files) {
    const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === 't') {
        const key = node.arguments[0];
        if (key && ts.isStringLiteral(key) && hasHan(key.text)) assert.ok(Object.hasOwn(MESSAGES, key.text), `${file}: missing ${key.text}`);
      }
      if (ts.isJsxText(node)) {
        const isLanguageOption = ts.isJsxElement(node.parent) && node.parent.openingElement.tagName.getText(source) === 'option';
        if (!isLanguageOption) assert.ok(!hasHan(node.text), `${file}: untranslated JSX text ${node.text.trim()}`);
      }
      if (file.startsWith('src/components/') && ts.isStringLiteral(node) && hasHan(node.text) && !ts.isBinaryExpression(node.parent)) {
        assert.ok(Object.hasOwn(MESSAGES, node.text), `${file}: missing indirect/conditional message ${node.text}`);
      }
      if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)) {
        assert.ok(!hasHan(node.initializer.text), `${file}: untranslated attribute ${node.initializer.text}`);
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
});

test('catalog descriptions, hardware references, maps and every wind sector are translated', () => {
  const checkStrings = (value: unknown) => {
    if (typeof value === 'string' && hasHan(value)) assert.ok(Object.hasOwn(MESSAGES, value), `Missing catalog translation: ${value}`);
    else if (Array.isArray(value)) value.forEach(checkStrings);
    else if (value && typeof value === 'object') Object.values(value).forEach(checkStrings);
  };
  checkStrings(DRONES); checkStrings(DRONE_CATALOG_NOTE); checkStrings(MAPS); checkStrings(WIND_PRESETS);
  for (let direction = 0; direction < 360; direction += 45) {
    const wind = describeWind(sampleWind({ strength: 'windy', direction }, 0, { x: 0, y: 0, z: 0 }), 0);
    checkStrings(wind.directionLabel); checkStrings(wind.relativeLabel);
  }
});

test('live notices translate nested names and preserve scores without mutating their payloads', () => {
  const notice = { key: '已选用 {name} · 准备起飞', params: { name: DRONES[1].name } };
  const original = structuredClone(notice);
  for (const locale of ['zh', 'ja', 'en'] as const) {
    const text = translateNotice(locale, notice);
    assert.ok(text.includes(translate(locale, DRONES[1].name)));
    assert.ok(!text.includes('{name}'));
    assert.equal(translateNotice(locale, { key: '命中靶标 +{points} · {hits} / {total}', params: { points: 100, hits: 1, total: 5 } }).includes('+100'), true);
  }
  assert.deepEqual(notice, original);
  assert.equal(translateNotice('en', ''), '');
});
