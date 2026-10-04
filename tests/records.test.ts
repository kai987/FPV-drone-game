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

test('each map stores its own record while valley keeps the existing key', () => {
  const wind = { strength: 'breeze' as const, direction: 315 };
  const valleyKey = bestTimeKey('freestyle', 'assisted', wind, 'valley');
  const factoryKey = bestTimeKey('freestyle', 'assisted', wind, 'factory');
  const harborKey = bestTimeKey('freestyle', 'assisted', wind, 'harbor');
  assert.equal(valleyKey, bestTimeKey('freestyle', 'assisted', wind));
  assert.equal(valleyKey, 'aeroflow:v3:best:freestyle:assisted:breeze:315');
  assert.equal(new Set([valleyKey, factoryKey, harborKey]).size, 3);
  const values: Record<string, string> = { [valleyKey]: '31', [factoryKey]: '57', [harborKey]: '64' };
  const storage = { getItem: (key: string) => values[key] ?? null };
  assert.equal(readBestTime(storage, 'freestyle', 'assisted', wind), 31);
  assert.equal(readBestTime(storage, 'freestyle', 'assisted', wind, 'factory'), 57);
  assert.equal(readBestTime(storage, 'freestyle', 'assisted', wind, 'harbor'), 64);
});

test('new maps never import valley or pre-wind records, including calm flights', () => {
  const wind = { strength: 'calm' as const, direction: 180 };
  const values: Record<string, string> = {
    'aeroflow:v1:best:sport': '20',
    'aeroflow:v2:best:freestyle:sport': '21',
    [bestTimeKey('freestyle', 'sport', wind)]: '22',
  };
  const requested: string[] = [];
  const storage = { getItem: (key: string) => { requested.push(key); return values[key] ?? null; } };
  for (const map of ['factory', 'harbor'] as const) {
    assert.equal(readBestTime(storage, 'freestyle', 'sport', wind, map), null);
    assert.equal(bestTimeKey('freestyle', 'sport', wind, map), bestTimeKey('freestyle', 'sport', { ...wind, direction: 0 }, map));
  }
  assert.equal(requested.length, 2);
  assert.ok(requested.every(key => key.startsWith('aeroflow:v4:best:')));
  assert.equal(readBestTime(storage, 'freestyle', 'sport', wind), 22);
});
