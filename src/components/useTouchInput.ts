import { useSyncExternalStore } from 'react';

// A narrow desktop window is still mouse driven. Use the primary pointer so a
// touchscreen on a mouse-first hybrid does not cover the canvas with controls.
export const TOUCH_INPUT_MEDIA = '(pointer: coarse)';

type InputMediaQuery = Pick<MediaQueryList, 'matches' | 'addEventListener' | 'removeEventListener'>;

export function createTouchInputStore(matchMedia: (query: string) => InputMediaQuery) {
  let media: InputMediaQuery | undefined;
  const listeners = new Set<() => void>();
  const getMedia = () => media ??= matchMedia(TOUCH_INPUT_MEDIA);
  const notify = () => { for (const listener of listeners) listener(); };

  return {
    getSnapshot: () => getMedia().matches,
    subscribe(listener: () => void) {
      if (listeners.size === 0) getMedia().addEventListener('change', notify);
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) getMedia().removeEventListener('change', notify);
      };
    },
  };
}

const touchInput = createTouchInputStore(query => window.matchMedia(query));
const serverSnapshot = () => false;

export function useTouchInput() {
  return useSyncExternalStore(touchInput.subscribe, touchInput.getSnapshot, serverSnapshot);
}

// Do not filter on isPrimary: the second touch owns climb/yaw or gun aiming.
export function isTouchPointer(event: { pointerType: string }) {
  return event.pointerType === 'touch';
}
