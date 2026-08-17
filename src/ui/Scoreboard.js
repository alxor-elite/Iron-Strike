/**
 * Scoreboard (hold TAB): team scores, the player's line, and the AI roster with
 * live status. Rebuilt at 4 Hz while visible only.
 */

import { TEAM_NAMES } from '../game/MatchManager.js';

export class Scoreboard {
  constructor(game, element) {
    this.game = game;
    this.el = element;
    this.visible = false;
    this._timer = 0;
  }

  setVisible(v) {
    if (v === this.visible) return;
    this.visible = v;
    this.el.classList.toggle('hidden', !v);
    if (v) {
      this._timer = 0;
      this.render();
    }
  }

  hide() { this.setVisible(false); }

  update(dt) {
    if (!this.visible) return;
    this._timer -= dt;
    if (this._timer <= 0) {
      this._timer = 0.25;
      this.render();
    }
  }

  render() {
    const game = this.game;
    const match = game.match;
    const p = game.player;
    const stats = p.stats;
    const accuracy = stats.shotsFired > 0 ? (stats.hits / stats.shotsFired) * 100 : 0;
    const roster = game.enemyManager.getRoster();

    const rows = roster.map((r) => `
      <tr class="${r.alive ? '' : 'dead'}">
        <td>${r.name}</td>
        <td>${r.alive ? r.health : '—'}</td>
        <td>${r.alive ? r.state : 'DOWN'}</td>
      </tr>`).join('');

    this.el.innerHTML = `
      <div class="sb-head">
        <h3>TEAM DEATHMATCH</h3>
        <div>
          <span class="kf-a">${TEAM_NAMES.A} ${match.scores.A}</span>
          &nbsp;·&nbsp;
          <span class="kf-b">${TEAM_NAMES.B} ${match.scores.B}</span>
          &nbsp;/&nbsp;${match.scoreLimit}
        </div>
      </div>
      <table class="sb-table">
        <thead>
          <tr><th>OPERATOR</th><th>KILLS</th><th>DEATHS</th><th>HS</th><th>ACC</th><th>DMG</th></tr>
        </thead>
        <tbody>
          <tr class="you">
            <td>${p.name} (${TEAM_NAMES.A})</td>
            <td>${stats.kills}</td>
            <td>${stats.deaths}</td>
            <td>${stats.headshots}</td>
            <td>${accuracy.toFixed(0)}%</td>
            <td>${Math.round(stats.damageDealt)}</td>
          </tr>
        </tbody>
      </table>
      <table class="sb-table">
        <thead>
          <tr class="sb-teamrow"><td colspan="3">${TEAM_NAMES.B} SQUAD</td></tr>
          <tr><th>UNIT</th><th>HP</th><th>STATUS</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;
  }
}
