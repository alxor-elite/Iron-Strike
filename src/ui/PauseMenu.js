/**
 * PauseMenu — opened by ESC (pointer lock release) during a match.
 */

import { wireButtons } from './MainMenu.js';

export class PauseMenu {
  constructor(game) {
    this.game = game;
    this.el = document.getElementById('pause-menu');
    wireButtons(this.el, (action) => this._onAction(action), game.audio);
  }

  _onAction(action) {
    const game = this.game;
    switch (action) {
      case 'resume':
        this.hide();
        game.resume();
        break;
      case 'settings':
        this.hide(true);
        game.ui.settings.show(() => this.show());
        break;
      case 'controls':
        this.hide(true);
        game.ui.controls.show(() => this.show());
        break;
      case 'restart':
        this.hide(true);
        game.restartMatch();
        break;
      case 'menu':
        this.hide(true);
        game.returnToMenu();
        break;
      default: break;
    }
  }

  show() {
    this.el.classList.remove('hidden');
  }

  hide() {
    this.el.classList.add('hidden');
  }

  get isOpen() { return !this.el.classList.contains('hidden'); }
}
