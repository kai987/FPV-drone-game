import assert from 'node:assert/strict';
import test from 'node:test';
import { bestTimeKey, readBestTime } from '../src/game/records.ts';

test('wind records separate direction and strength while calm ignores direction', () => {
  const key = (strength: 'calm' | 'breeze' | 'strong', direction: number) => bestTimeKey('freestyle', 'sport', { strength, direction });
  assert.notEqual(key('breeze', 0), key('breeze', 180));
  assert.notEqual(key('breeze', 90), key('strong', 90));
  assert.equal(key('calm', 0), key('calm', 180));
  assert.equal(key('breeze', 0), key('breeze', 360));
});

test('legacy times remain available only for matching calm aircraft and flight mode', () => {
  const values: Record<string, string> = { 'aeroflow:v1:best:sport': '45', 'aeroflow:v2:best:racer:assisted': '32' };
  const storage = { getItem: (key: string) => values[key] ?? null };
  assert.equal(readBestTime(storage, 'freestyle', 'sport', { strength: 'calm', direction: 0 }), 45);
  assert.equal(readBestTime(storage, 'racer', 'assisted', { strength: 'calm', direction: 0 }), 32);
  assert.equal(readBestTime(storage, 'racer', 'sport', { strength: 'calm', direction: 0 }), null);
  assert.equal(readBestTime(storage, 'freestyle', 'sport', { strength: 'breeze', direction: 315 }), null);
  assert.equal(readBestTime({ getItem() { throw new Error('blocked'); } }, 'freestyle', 'sport', { strength: 'calm', direction: 0 }), null);
});
