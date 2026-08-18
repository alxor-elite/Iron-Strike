/**
 * IRON STRIKE — entry point.
 *
 * An original single-player, browser-native FPS: Team Deathmatch against an AI
 * squad on FOUNDRY-7. Everything (map, weapon, characters, audio, UI) is
 * generated at runtime from Three.js primitives and the Web Audio API.
 */

import './styles/main.css';
import { Game, GameState } from './game/Game.js';
import { FatalScreen } from './ui/Screens.js';

const canvas = document.getElementById('game-canvas');

function fail(err, context) {
  const message = err && err.stack ? err.stack : String(err);
  console.error(`[iron-strike] ${context}`, err);
  FatalScreen.show(`${context}\n\n${message}`);
}

// WebGL capability check up front so the failure mode is a message, not a
// black screen.
function hasWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch {
    return false;
  }
}

if (!hasWebGL()) {
  FatalScreen.show('This game needs WebGL, which your browser or GPU driver is not providing.\n\nTry a recent Chrome, Edge or Firefox with hardware acceleration enabled.');
} else {
  try {
    const game = new Game(canvas);
    window.__ironStrike = game; // handy for debugging in the console

    // Once the game is up, a stray error must not end the session: hand it to
    // the game's error sink, which logs it, tells the player it recovered and
    // only escalates to the fatal screen if the failure keeps repeating.
    // (Before that point there is nothing to recover into, so it is fatal.)
    const handle = (err, context) => {
      if (game.state.current !== GameState.BOOT) game.reportError(err, context);
      else fail(err, context);
    };

    window.addEventListener('error', (e) => {
      // resource load failures (img/audio/script) also land here and carry an
      // element as the target — they are not game errors
      if (e.target && e.target !== window) return;
      handle(e.error || e.message, 'Runtime error');
    });
    window.addEventListener('unhandledrejection', (e) => handle(e.reason, 'Unhandled promise rejection'));

    // Keep the page from scrolling / context-menuing during play.
    window.addEventListener('keydown', (e) => {
      if (['Space', 'Tab', 'F1', 'F3'].includes(e.code) && game.controller.locked) e.preventDefault();
    }, { passive: false });

    console.info(
      '%cIRON STRIKE%c ready — click PLAY to deploy.',
      'color:#ffb340;font-weight:bold', 'color:#9fb0bd'
    );
  } catch (err) {
    fail(err, 'Failed to start the game');
  }
}
