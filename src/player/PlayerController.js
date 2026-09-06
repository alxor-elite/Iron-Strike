/**
 * Input layer: keyboard, mouse buttons and Pointer Lock.
 *
 * Produces a small immutable-ish `state` object that the Player and Weapon
 * read each frame. Nothing here touches the world directly.
 */

/**
 * Keys we let the browser keep while the pointer is locked. Everything else is
 * cancelled: crouch is Ctrl, so ordinary play (Ctrl+S walking backwards while
 * crouched, Ctrl+D strafing, Ctrl+A, Ctrl+F…) otherwise fires browser
 * shortcuts — "save page as", bookmark, find — right in the middle of a match.
 */
const PASSTHROUGH_KEYS = new Set(['Escape', 'F5', 'F11', 'F12']);

/**
 * Codes handed to the Keyboard Lock API. A handful of shortcuts (Ctrl+W,
 * Ctrl+T, Ctrl+N) are reserved by the browser and cannot be cancelled from a
 * key handler at all — Ctrl+W closing the tab mid-match is exactly the crouch +
 * forward combination. Keyboard lock is the only way to receive them, and it
 * only works while the document is fullscreen.
 */
const CAPTURE_CODES = [
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE', 'KeyR', 'KeyF', 'KeyC',
  'KeyT', 'KeyN', 'KeyP', 'Tab', 'Space',
  'Digit1', 'Digit2', 'Digit3', 'Digit4'
];

export class PlayerController {
  constructor(domElement, playerCamera, settings) {
    this.dom = domElement;
    this.cam = playerCamera;
    this.settings = settings;

    this.enabled = false;
    this.locked = false;

    this.state = {
      forward: 0,      // -1 .. 1
      strafe: 0,       // -1 .. 1
      sprint: false,
      crouch: false,
      jumpQueued: false,
      jumpHeld: false,
      firing: false,
      firePressed: false,
      ads: false,
      reloadQueued: false,
      scoreboard: false,
      slotQueued: -1,      // 0-based weapon slot requested this frame, -1 = none
      slotCycle: 0         // +1 / -1 from the scroll wheel
    };

    this._keys = new Set();
    this._adsToggleState = false;
    this._keyboardLocked = false;

    this.onPause = null;         // ESC while locked
    this.onLockChange = null;    // (locked:boolean)
    this.onFlashlight = null;

    this._bind();
  }

  _bind() {
    this._onKeyDown = (e) => {
      if (e.code === 'Escape') return; // handled by the browser + lock change
      if (!this.enabled) return;
      this._swallow(e);
      if (e.repeat) return;
      this._syncModifiers(e);
      this._keys.add(e.code);
      switch (e.code) {
        case 'Space':
          this.state.jumpQueued = true;
          this.state.jumpHeld = true;
          break;
        case 'KeyR':
          this.state.reloadQueued = true;
          break;
        case 'Tab':
          this.state.scoreboard = true;
          break;
        case 'KeyF':
          if (this.onFlashlight) this.onFlashlight();
          break;
        case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4':
          this.state.slotQueued = Number(e.code.slice(5)) - 1;
          break;
        case 'KeyQ':
          this.state.slotCycle = 1;   // quick-swap reads as one step forward
          break;
        default:
          break;
      }
      this._recompute();
    };

    this._onKeyUp = (e) => {
      if (this.enabled) this._swallow(e);
      this._syncModifiers(e);
      this._keys.delete(e.code);
      if (e.code === 'Space') this.state.jumpHeld = false;
      if (e.code === 'Tab') this.state.scoreboard = false;
      this._recompute();
    };

    this._onMouseDown = (e) => {
      if (!this.enabled || !this.locked) return;
      if (e.button === 0) {
        this.state.firing = true;
        this.state.firePressed = true;
      } else if (e.button === 2) {
        if (this.settings.get('adsToggle')) {
          this._adsToggleState = !this._adsToggleState;
          this.state.ads = this._adsToggleState;
        } else {
          this.state.ads = true;
        }
      }
    };

    this._onMouseUp = (e) => {
      if (e.button === 0) this.state.firing = false;
      else if (e.button === 2 && !this.settings.get('adsToggle')) this.state.ads = false;
    };

    this._onMouseMove = (e) => {
      if (!this.enabled || !this.locked) return;
      this.cam.addMouse(e.movementX || 0, e.movementY || 0);
    };

    this._onContext = (e) => e.preventDefault();

    this._onWheel = (e) => {
      if (!this.enabled || !this.locked) return;
      this.state.slotCycle += e.deltaY > 0 ? 1 : -1;
      e.preventDefault();
    };

    this._onLockChange = () => {
      const wasLocked = this.locked;
      this.locked = document.pointerLockElement === this.dom;
      if (!this.locked) {
        // release everything so the player doesn't keep sprinting while paused
        this._keys.clear();
        this.state.firing = false;
        this.state.ads = false;
        this._adsToggleState = false;
        this._recompute();
        if (wasLocked && this.enabled && this.onPause) this.onPause();
      }
      if (this.onLockChange) this.onLockChange(this.locked);
    };

    this._onLockError = () => {
      console.warn('[input] pointer lock request failed');
      this.locked = false;
      if (this.onLockChange) this.onLockChange(false);
    };

    this._onBlur = () => {
      this._keys.clear();
      this.state.firing = false;
      this._recompute();
    };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    this.dom.addEventListener('mousedown', this._onMouseDown);
    window.addEventListener('mouseup', this._onMouseUp);
    this.dom.addEventListener('contextmenu', this._onContext);
    this.dom.addEventListener('wheel', this._onWheel, { passive: false });
    document.addEventListener('mousemove', this._onMouseMove);
    document.addEventListener('pointerlockchange', this._onLockChange);
    document.addEventListener('pointerlockerror', this._onLockError);
  }

  /** Keep a browser shortcut from firing on a key the match is using. */
  _swallow(e) {
    if (!this.locked || !e.cancelable) return;
    if (PASSTHROUGH_KEYS.has(e.code)) return;
    e.preventDefault();
  }

  /**
   * If a shortcut we could not cancel stole focus, the matching keyup never
   * arrives and the modifier stays "held" — the player comes back permanently
   * crouched. Every key event carries the true modifier state, so reconcile.
   */
  _syncModifiers(e) {
    if (!e.ctrlKey) {
      this._keys.delete('ControlLeft');
      this._keys.delete('ControlRight');
    }
    if (!e.shiftKey) {
      this._keys.delete('ShiftLeft');
      this._keys.delete('ShiftRight');
    }
  }

  /**
   * Ask for the browser-reserved combinations (Ctrl+W and friends). Only
   * granted while the document is fullscreen; a refusal is not an error, it
   * just leaves us with the cancel-everything-else path above.
   */
  lockKeyboard() {
    const kb = navigator.keyboard;
    if (!kb || !kb.lock || this._keyboardLocked) return;
    try {
      Promise.resolve(kb.lock(CAPTURE_CODES))
        .then(() => { this._keyboardLocked = true; })
        .catch(() => { /* not fullscreen, or the user said no */ });
    } catch {
      /* unsupported */
    }
  }

  unlockKeyboard() {
    if (!this._keyboardLocked) return;
    this._keyboardLocked = false;
    try {
      navigator.keyboard?.unlock?.();
    } catch {
      /* unsupported */
    }
  }

  _recompute() {
    const k = this._keys;
    const s = this.state;
    s.forward = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
    s.strafe = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
    s.sprint = k.has('ShiftLeft') || k.has('ShiftRight');
    s.crouch = k.has('ControlLeft') || k.has('ControlRight') || k.has('KeyC');
  }

  requestLock() {
    if (this.locked) return;
    const p = this.dom.requestPointerLock?.({ unadjustedMovement: false });
    if (p && typeof p.catch === 'function') p.catch(() => { /* fall back silently */ });
  }

  releaseLock() {
    if (document.pointerLockElement === this.dom) document.exitPointerLock();
  }

  setEnabled(on) {
    this.enabled = on;
    if (!on) {
      this._keys.clear();
      this.state.firing = false;
      this.state.ads = false;
      this._recompute();
    }
  }

  /** Called once per frame after systems have consumed the edge-triggered bits. */
  endFrame() {
    this.state.jumpQueued = false;
    this.state.firePressed = false;
    this.state.reloadQueued = false;
    this.state.slotQueued = -1;
    this.state.slotCycle = 0;
  }

  dispose() {
    this.unlockKeyboard();
    window.removeEventListener('keydown', this._onKeyDown);
    window.removeEventListener('keyup', this._onKeyUp);
    window.removeEventListener('blur', this._onBlur);
    this.dom.removeEventListener('mousedown', this._onMouseDown);
    window.removeEventListener('mouseup', this._onMouseUp);
    this.dom.removeEventListener('contextmenu', this._onContext);
    this.dom.removeEventListener('wheel', this._onWheel);
    document.removeEventListener('mousemove', this._onMouseMove);
    document.removeEventListener('pointerlockchange', this._onLockChange);
    document.removeEventListener('pointerlockerror', this._onLockError);
  }
}
