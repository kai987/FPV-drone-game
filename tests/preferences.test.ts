import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultFlightPreferences, normalizeFlightPreferences, PREFERENCES_STORAGE_KEY, readFlightPreferences, saveFlightPreferences } from '../src/game/preferences.ts';

test('all user preferences round-trip while position, ammunition and run state are excluded', () => {
  const value = { ...defaultFlightPreferences(), mapId: 'mountains', droneId: 'guardian', mode: 'free', flightMode: 'sport',
    cameraMode: 'fpv', windSettings: { strength: 'strong', direction: 90 }, night: true, sound: true, qualityPreset: 'low',
    touch: { sensitivity: 1.65, accelerationMs: 750, invertVertical: true },
    position: { x: 10, y: 120, z: 300 }, ammo: 3, elapsed: 42, status: 'flying' } as const;
  const values = new Map<string, string>();
  assert.equal(saveFlightPreferences({ setItem: (key, text) => { values.set(key, text); } }, value), true);
  const restored = readFlightPreferences({ getItem: key => values.get(key) ?? null });
  const { position: _position, ammo: _ammo, elapsed: _elapsed, status: _status, ...expected } = value;
  assert.deepEqual(restored, expected);
  const stored = JSON.parse(values.get(PREFERENCES_STORAGE_KEY)!);
  for (const key of ['position', 'ammo', 'elapsed', 'status']) assert.equal(Object.hasOwn(stored, key), false);
});

test('missing, damaged and unknown preference schemas safely fall back', () => {
  for (const text of [null, '', '{invalid', 'null', '[]', '"settings"', '{"version":0}', '{"version":2}', '{"version":"1"}']) {
    assert.deepEqual(readFlightPreferences({ getItem: () => text }), defaultFlightPreferences());
  }
  assert.deepEqual(readFlightPreferences(), defaultFlightPreferences());
  assert.deepEqual(readFlightPreferences({ getItem: () => ' '.repeat(8_193) }), defaultFlightPreferences());
});

test('invalid individual choices fall back without losing valid choices from the same schema', () => {
  const value = normalizeFlightPreferences({ version: 1, mapId: 'removed-map', droneId: 'removed-drone', mode: 'arcade',
    flightMode: 'sport', cameraMode: 'orbit', windSettings: { strength: '__proto__', direction: -45 }, night: true,
    sound: 'true', qualityPreset: 'ultra', touch: { sensitivity: 10, accelerationMs: -20, invertVertical: 'yes' } });
  const defaults = defaultFlightPreferences();
  assert.equal(value.mapId, defaults.mapId); assert.equal(value.droneId, defaults.droneId);
  assert.equal(value.mode, defaults.mode); assert.equal(value.cameraMode, defaults.cameraMode);
  assert.equal(value.flightMode, 'sport'); assert.equal(value.night, true); assert.equal(value.sound, false);
  assert.equal(value.qualityPreset, 'auto');
  assert.deepEqual(value.windSettings, { strength: 'breeze', direction: 315 });
  assert.deepEqual(value.touch, { sensitivity: 2, accelerationMs: 500, invertVertical: false });
  assert.deepEqual(normalizeFlightPreferences({ version: 1, windSettings: { strength: 'calm', direction: Infinity },
    touch: { sensitivity: NaN, accelerationMs: Infinity } }).windSettings, { strength: 'calm', direction: defaults.windSettings.direction });
});

test('blocked reads, blocked writes and full storage do not prevent a usable default or current settings', () => {
  assert.deepEqual(readFlightPreferences({ getItem: () => { throw new Error('Storage disabled'); } }), defaultFlightPreferences());
  const current = defaultFlightPreferences(); current.mapId = 'harbor'; current.touch.sensitivity = 1.5;
  const before = structuredClone(current);
  assert.equal(saveFlightPreferences({ setItem: () => { throw new Error('Quota exceeded'); } }, current), false);
  assert.deepEqual(current, before, 'failed persistence must not mutate live settings');
});

test('a preference reset never clears personal bests or the independently saved language', () => {
  const values = new Map([['aeroflow-language', 'ja'], ['aeroflow:v5:best:valley:freestyle:assisted:calm', '33']]);
  saveFlightPreferences({ setItem: (key, text) => { values.set(key, text); } }, defaultFlightPreferences());
  assert.equal(values.get('aeroflow-language'), 'ja');
  assert.equal(values.get('aeroflow:v5:best:valley:freestyle:assisted:calm'), '33');
});

test('defaults and normalized nested settings are independent mutable copies', () => {
  const first = defaultFlightPreferences(); first.touch.sensitivity = 2; first.windSettings.direction = 0;
  assert.equal(defaultFlightPreferences().touch.sensitivity, 1);
  assert.equal(defaultFlightPreferences().windSettings.direction, 315);
  const source = { ...defaultFlightPreferences(), touch: { sensitivity: 1.5, accelerationMs: 1_000, invertVertical: true } };
  const normalized = normalizeFlightPreferences(source); normalized.touch.sensitivity = 0.5;
  assert.equal(source.touch.sensitivity, 1.5);
});
