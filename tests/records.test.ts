import assert from 'node:assert/strict';
import test from 'node:test';
import { bestTimeKey, readBestTime } from '../src/game/records.ts';

test('revised city solids and alpine courses retain old records without comparing them to the new routes', () => {
  const wind = { strength: 'calm', direction: 0 } as const;
  for (const map of ['downtown', 'mountains'] as const) {
    const previousKey = `aeroflow:v5:best:${map}:freestyle:assisted:calm`;
    const values: Record<string, string> = { [previousKey]: '32' };
    const storage = { getItem: (key: string) => values[key] ?? null };
    assert.notEqual(bestTimeKey('freestyle', 'assisted', wind, map), previousKey);
    assert.equal(readBestTime(storage, 'freestyle', 'assisted', wind, map), null);
    values[bestTimeKey('freestyle', 'assisted', wind, map)] = '35';
    assert.equal(readBestTime(storage, 'freestyle', 'assisted', wind, map), 35);
    assert.equal(values[previousKey], '32', 'prior achievements are preserved in storage');
  }
});

test('broken alpine ridges preserve the previous terrain record without using it for the revised course', () => {
  const wind = { strength: 'breeze', direction: 315 } as const;
  const previousKey = 'aeroflow:v5:best:mountains:sharp-ridges-v2:freestyle:assisted:breeze:315';
  const values: Record<string, string> = { [previousKey]: '48' };
  const storage = { getItem: (key: string) => values[key] ?? null };
  assert.equal(readBestTime(storage, 'freestyle', 'assisted', wind, 'mountains'), null);
  values[bestTimeKey('freestyle', 'assisted', wind, 'mountains')] = '51';
  assert.equal(readBestTime(storage, 'freestyle', 'assisted', wind, 'mountains'), 51);
  assert.equal(values[previousKey], '48');
});

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

test('each map stores its own record under the dynamic-wind version', () => {
  const wind = { strength: 'breeze' as const, direction: 315 };
  const valleyKey = bestTimeKey('freestyle', 'assisted', wind, 'valley');
  const factoryKey = bestTimeKey('freestyle', 'assisted', wind, 'factory');
  const harborKey = bestTimeKey('freestyle', 'assisted', wind, 'harbor');
  assert.equal(valleyKey, bestTimeKey('freestyle', 'assisted', wind));
  assert.equal(valleyKey, 'aeroflow:v5:best:valley:freestyle:assisted:breeze:315');
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
    'aeroflow:v4:best:factory:freestyle:sport:calm': '19',
    'aeroflow:v4:best:harbor:freestyle:sport:calm': '18',
    [bestTimeKey('freestyle', 'sport', wind)]: '22',
  };
  const requested: string[] = [];
  const storage = { getItem: (key: string) => { requested.push(key); return values[key] ?? null; } };
  for (const map of ['factory', 'harbor'] as const) {
    assert.equal(readBestTime(storage, 'freestyle', 'sport', wind, map), null);
    assert.equal(bestTimeKey('freestyle', 'sport', wind, map), bestTimeKey('freestyle', 'sport', { ...wind, direction: 0 }, map));
  }
  assert.equal(requested.length, 2);
  assert.ok(requested.every(key => key.startsWith('aeroflow:v5:best:')));
  assert.equal(readBestTime(storage, 'freestyle', 'sport', wind), 22);
});

test('old fixed-direction wind records never become dynamic-wind records', () => {
  const wind = { strength: 'breeze' as const, direction: 315 };
  const values: Record<string, string> = {
    'aeroflow:v3:best:freestyle:assisted:breeze:315': '24',
    'aeroflow:v4:best:factory:freestyle:assisted:breeze:315': '25',
    'aeroflow:v4:best:harbor:freestyle:assisted:breeze:315': '26',
  };
  const requested: string[] = [];
  const storage = { getItem: (key: string) => { requested.push(key); return values[key] ?? null; } };
  for (const map of ['valley', 'factory', 'harbor'] as const) assert.equal(readBestTime(storage, 'freestyle', 'assisted', wind, map), null);
  assert.equal(requested.length, 3);
  assert.ok(requested.every(key => key.startsWith('aeroflow:v5:best:')));
  assert.equal(Object.keys(values).length, 3);
});

test('calm valley retains v3 compatibility and prefers a new-version record', () => {
  const wind = { strength: 'calm' as const, direction: 315 };
  const values: Record<string, string> = {
    'aeroflow:v3:best:racer:sport:calm': '29',
    'aeroflow:v2:best:racer:sport': '30',
  };
  const storage = { getItem: (key: string) => values[key] ?? null };
  assert.equal(readBestTime(storage, 'racer', 'sport', wind), 29);
  values[bestTimeKey('racer', 'sport', wind)] = '28';
  assert.equal(readBestTime(storage, 'racer', 'sport', wind), 28);
  assert.equal(readBestTime(storage, 'racer', 'sport', wind, 'factory'), null);
  assert.equal(values['aeroflow:v3:best:racer:sport:calm'], '29');
});
