/**
 * Top-level screen/flow states and a tiny observable state holder.
 *
 * MENU → LOADING → PLAYING ⇄ PAUSED
 *                     ↓
 *                  RESULTS → MENU / PLAYING
 */

export const GameState = {
  BOOT: 'BOOT',
  MENU: 'MENU',
  LOADING: 'LOADING',
  PLAYING: 'PLAYING',
  PAUSED: 'PAUSED',
  DEAD: 'DEAD',       // player awaiting respawn (world keeps running)
  RESULTS: 'RESULTS'
};

export class StateMachine {
  constructor(initial = GameState.BOOT) {
    this.current = initial;
    this.previous = null;
    this._listeners = new Set();
  }

  is(...states) {
    return states.includes(this.current);
  }

  set(next) {
    if (this.current === next) return;
    this.previous = this.current;
    this.current = next;
    this._listeners.forEach((fn) => fn(next, this.previous));
  }

  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }
}
