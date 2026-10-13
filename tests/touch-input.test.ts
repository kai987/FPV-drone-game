import assert from 'node:assert/strict';
import test from 'node:test';
import { createTouchInputStore, isTouchPointer } from '../src/components/useTouchInput.ts';
import { TouchGestureController } from '../src/components/touch-gesture.ts';

class InputMediaQuery extends EventTarget {
  matches: boolean;
  subscriptions = 0;

  constructor(matches: boolean) {
    super();
    this.matches = matches;
  }

  override addEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
    super.addEventListener(type, listener);
    this.subscriptions++;
  }

  override removeEventListener(type: string, listener: EventListenerOrEventListenerObject | null) {
    super.removeEventListener(type, listener);
    this.subscriptions--;
  }

  change(matches: boolean) {
    this.matches = matches;
    this.dispatchEvent(new Event('change'));
  }
}

function environment(width: number, primary: 'fine' | 'coarse', anyCoarse = false) {
  const media = new InputMediaQuery(primary === 'coarse');
  const queries: string[] = [];
  const store = createTouchInputStore(query => {
    queries.push(query);
    // Model the old combined query as well as the independent capabilities.
    if (query === '(pointer: coarse)') return media;
    if (query === '(max-width: 980px), (pointer: coarse)') return new InputMediaQuery(width <= 980 || primary === 'coarse');
    if (query === '(any-pointer: coarse)') return new InputMediaQuery(anyCoarse);
    throw new Error(`Unexpected input-mode query: ${query}`);
  });
  return { store, media, queries };
}

test('desktop input stays desktop at small widths and on mouse-primary touchscreen hybrids', () => {
  for (const width of [390, 780, 980, 981, 1440]) {
    for (const hasTouchscreen of [false, true]) {
      const { store, queries } = environment(width, 'fine', hasTouchscreen);
      assert.equal(store.getSnapshot(), false, `mouse-primary input at width ${width}, touchscreen ${hasTouchscreen}`);
      assert.deepEqual(queries, ['(pointer: coarse)']);
    }
  }
});

test('touch-primary controls are available beyond mobile layout breakpoints', () => {
  for (const width of [390, 980, 1024, 1440]) {
    const { store } = environment(width, 'coarse', true);
    assert.equal(store.getSnapshot(), true, `touch-primary input at width ${width}`);
  }
});

test('flight and aiming share one capability listener and observe primary-pointer changes', () => {
  const { store, media } = environment(780, 'coarse', true);
  const flight: boolean[] = [];
  const aiming: boolean[] = [];
  const stopFlight = store.subscribe(() => flight.push(store.getSnapshot()));
  const stopAiming = store.subscribe(() => aiming.push(store.getSnapshot()));
  assert.equal(media.subscriptions, 1);

  media.change(false);
  media.change(true);
  assert.deepEqual(flight, [false, true]);
  assert.deepEqual(aiming, [false, true]);

  stopFlight();
  media.change(false);
  assert.equal(media.subscriptions, 1);
  assert.deepEqual(flight, [false, true]);
  assert.deepEqual(aiming, [false, true, false]);

  stopAiming();
  assert.equal(media.subscriptions, 0);
  media.change(true);
  assert.deepEqual(aiming, [false, true, false]);
  const stopRemounted = store.subscribe(() => flight.push(store.getSnapshot()));
  assert.equal(store.getSnapshot(), true, 'remount reads current capabilities after an unsubscribed change');
  assert.equal(media.subscriptions, 1);
  stopRemounted();
  assert.equal(media.subscriptions, 0);
});

test('mouse, pen and unspecified pointers never begin a touch hold', () => {
  const controller = new TouchGestureController();
  for (const pointerType of ['mouse', 'pen', '']) {
    const event = { pointerType, pointerId: 1, isPrimary: true };
    if (isTouchPointer(event)) controller.begin(event.pointerId, 100, 200, 0);
    assert.equal(controller.active, false, `${pointerType || 'unspecified'} pointer must leave flight idle`);
    assert.deepEqual(controller.sample(2000).axes, { forward: 0, strafe: 0, climb: 0, yaw: 0 });
  }
});

test('touch filtering preserves secondary fingers for independent flight roles and aiming', () => {
  const controller = new TouchGestureController();
  const fingers = [
    { pointerType: 'touch', pointerId: 4, isPrimary: true },
    { pointerType: 'touch', pointerId: 7, isPrimary: false },
  ];
  for (const finger of fingers) {
    assert.equal(isTouchPointer(finger), true);
    assert.equal(controller.begin(finger.pointerId, 100, 200, 0), true);
  }
  assert.deepEqual(controller.snapshot(0).fingers.map(finger => finger.role), ['flight', 'attitude']);
  assert.equal(isTouchPointer({ pointerType: 'touch', ...{ isPrimary: false } }), true,
    'aiming must also accept a non-primary touch while a flight finger is held');
});
