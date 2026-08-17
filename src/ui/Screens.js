/**
 * Transient full-screen overlays: loading, "click to engage", death and the
 * end-of-match results screen.
 */

import { TIPS, wireButtons } from './MainMenu.js';
import { TEAM_NAMES } from '../game/MatchManager.js';

export class LoadingScreen {
  constructor() {
    this.el = document.getElementById('loading');
    this.fill = document.getElementById('loading-fill');
    this.status = document.getElementById('loading-status');
    this.tip = document.getElementById('loading-tip');
  }

  show() {
    this.el.classList.remove('hidden');
    this.fill.style.width = '0%';
    this.tip.textContent = TIPS[(Math.random() * TIPS.length) | 0];
  }

  setProgress(fraction, label) {
    this.fill.style.width = `${Math.round(Math.max(0, Math.min(1, fraction)) * 100)}%`;
    if (label) this.status.textContent = label;
  }

  hide() {
    this.el.classList.add('hidden');
  }
}

export class ResumePrompt {
  constructor(game) {
    this.game = game;
    this.el = document.getElementById('resume-prompt');
    this.el.addEventListener('click', () => {
      this.hide();
      game.requestLock();
    });
  }

  show() { this.el.classList.remove('hidden'); }
  hide() { this.el.classList.add('hidden'); }
  get isOpen() { return !this.el.classList.contains('hidden'); }
}

export class DeathScreen {
  constructor() {
    this.el = document.getElementById('death-screen');
    this.by = document.getElementById('death-by');
    this.count = document.getElementById('respawn-count');
  }

  show(killerName) {
    this.by.textContent = killerName ? `Eliminated by ${killerName}` : 'Eliminated';
    this.el.classList.remove('hidden');
  }

  setCountdown(seconds) {
    this.count.textContent = String(Math.max(0, Math.ceil(seconds)));
  }

  hide() { this.el.classList.add('hidden'); }
}

export class ResultsScreen {
  constructor(game) {
    this.game = game;
    this.el = document.getElementById('results-screen');
    this.title = document.getElementById('results-title');
    this.sub = document.getElementById('results-sub');
    this.a = document.getElementById('result-a');
    this.b = document.getElementById('result-b');
    this.stats = document.getElementById('result-stats');
    wireButtons(this.el, (action) => {
      if (action === 'again') {
        this.hide();
        game.restartMatch();
      } else if (action === 'menu') {
        this.hide();
        game.returnToMenu();
      }
    }, game.audio);
  }

  show(summary) {
    const titles = { victory: 'VICTORY', defeat: 'DEFEAT', draw: 'DRAW' };
    this.title.textContent = titles[summary.result] || 'MATCH OVER';
    this.title.className = summary.result === 'victory' ? 'win'
      : summary.result === 'defeat' ? 'lose' : 'draw';
    this.sub.textContent = summary.reason === 'score'
      ? `Score limit reached · ${TEAM_NAMES.A} ${summary.scoreA} — ${TEAM_NAMES.B} ${summary.scoreB}`
      : 'Time expired';
    this.a.textContent = String(summary.scoreA);
    this.b.textContent = String(summary.scoreB);

    document.querySelector('.rteam.ra').classList.toggle('win', summary.result === 'victory');
    document.querySelector('.rteam.rb').classList.toggle('win', summary.result === 'defeat');

    const cells = [
      ['KILLS', summary.kills],
      ['DEATHS', summary.deaths],
      ['K/D', summary.kd.toFixed(2)],
      ['HEADSHOTS', summary.headshots],
      ['ACCURACY', `${summary.accuracy.toFixed(0)}%`],
      ['DAMAGE', summary.damage]
    ];
    this.stats.innerHTML = cells.map(([k, v]) => `
      <div class="stat"><span class="stat-k">${k}</span><span class="stat-v">${v}</span></div>
    `).join('');

    this.el.classList.remove('hidden');
  }

  hide() { this.el.classList.add('hidden'); }
  get isOpen() { return !this.el.classList.contains('hidden'); }
}

export class FatalScreen {
  static show(message) {
    const el = document.getElementById('fatal');
    document.getElementById('fatal-msg').textContent = message;
    el.classList.remove('hidden');
  }
}
