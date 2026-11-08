// Virtual gamepad link.
//
// The page cannot create a gamepad, and the game only sees pads the OS knows
// about, so the wheel angle is shipped over a local WebSocket to a small
// Windows bridge that drives a ViGEmBus virtual Xbox pad. This module is
// transport only: it owns the socket, the send throttling and the reconnect,
// and never touches the DOM, so tests can drive it with a fake socket.

import { PAD } from './config.js';

const DEFAULTS = {
  url: PAD.url,
  maxAngleDeg: PAD.maxAngleDeg,
  deadzone: PAD.deadzone,
  curve: PAD.curve,
  epsilon: PAD.epsilon,
  intervalMs: PAD.intervalMs,
  minRetryMs: PAD.minRetryMs,
  maxRetryMs: PAD.maxRetryMs,
};

const STATES = {
  off: { label: 'off', kind: 'idle' },
  connecting: { label: 'connecting…', kind: 'busy' },
  linked: { label: 'linked', kind: 'ok' },
  retrying: { label: 'retrying…', kind: 'error' },
  error: { label: 'error', kind: 'error' },
};

// Wheel angle (deg) -> left stick X (-1..1), with a centre deadzone and an expo
// curve so small corrections stay small.
export function angleToStick(angleDeg, options = {}) {
  const { maxAngleDeg, deadzone, curve } = { ...DEFAULTS, ...options };
  const angle = Number.isFinite(angleDeg) ? angleDeg : 0;
  const limit = maxAngleDeg > 0 ? maxAngleDeg : 1;
  const dz = Math.min(0.9, Math.max(0, deadzone));
  let mag = Math.min(1, Math.abs(angle) / limit);
  if (mag <= dz) return 0;
  mag = (mag - dz) / (1 - dz);
  if (curve > 0 && curve !== 1) mag = Math.pow(mag, curve);
  return Math.sign(angle) * Math.min(1, mag);
}

export class PadLink {
  constructor(options = {}) {
    const opts = { ...DEFAULTS, ...options };
    this.url = opts.url;
    this.mapping = {
      maxAngleDeg: opts.maxAngleDeg,
      deadzone: opts.deadzone,
      curve: opts.curve,
    };
    this.epsilon = opts.epsilon;
    this.intervalMs = opts.intervalMs;
    this.minRetryMs = opts.minRetryMs;
    this.maxRetryMs = opts.maxRetryMs;

    this.WebSocketImpl =
      options.WebSocketImpl || (typeof WebSocket !== 'undefined' ? WebSocket : null);
    this.now =
      options.now || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
    this.schedule = options.schedule || ((fn, ms) => setTimeout(fn, ms));
    this.cancel = options.cancel || ((timer) => clearTimeout(timer));
    this.onState = options.onState || (() => {});
    this.onLog = options.onLog || (() => {});

    this.enabled = false;
    this.socket = null;
    this.target = 0;
    this._sentValue = 0;
    this._lastSentAt = -Infinity;
    this._retryTimer = null;
    this._retryMs = this.minRetryMs;
    this._state = 'off';
  }

  get state() {
    return this._state;
  }

  enable(url = this.url) {
    const next = url || DEFAULTS.url;
    if (this.enabled && this.socket && next === this.url) return;
    if (next !== this.url) this._dropSocket();
    this._clearRetry();
    this.url = next;
    this.enabled = true;
    this._retryMs = this.minRetryMs;
    this._connect();
  }

  disable() {
    this.enabled = false;
    this._clearRetry();
    this._dropSocket();
    this.target = 0;
    this._sentValue = 0;
    this._setState('off');
  }

  center() {
    if (!this.enabled) return;
    this.send(0, { blanked: true });
  }

  send(angleDeg, { blanked = false } = {}) {
    if (!this.enabled) return;
    this.target = blanked ? 0 : angleToStick(angleDeg, this.mapping);
    const force = this.target === 0 && this.target !== this._sentValue;
    this._flush(force);
  }

  _flush(force) {
    const now = this.now();
    if (!force) {
      if (now - this._lastSentAt < this.intervalMs) return;
      if (Math.abs(this.target - this._sentValue) < this.epsilon) return;
    }
    this._lastSentAt = now;
    this._sentValue = this.target;
    this._write(this.target);
  }

  _write(value) {
    if (!this.socket || this.socket.readyState !== 1) return;
    try {
      this.socket.send(JSON.stringify({ x: Number(value.toFixed(3)) }));
    } catch (err) {
      this.onLog('warn', `Pad link write failed: ${err.message}`);
    }
  }

  _connect() {
    if (!this.enabled) return;
    if (!this.WebSocketImpl) {
      this.onLog('error', 'This browser cannot open a WebSocket, so the pad link is unavailable.');
      this._setState('error');
      this.disable();
      return;
    }

    this._setState('connecting');
    let socket;
    try {
      socket = new this.WebSocketImpl(this.url);
    } catch (err) {
      this.onLog('warn', `Pad link: ${err.message}`);
      this._setState('retrying');
      this._scheduleRetry();
      return;
    }
    this.socket = socket;

    socket.onopen = () => {
      if (this.socket !== socket) return;
      this._retryMs = this.minRetryMs;
      this._setState('linked');
      this.onLog('info', `Pad link connected to ${this.url}`);
      this._sentValue = Number.NaN;
      this._flush(true);
    };

    socket.onclose = () => {
      if (this.socket !== socket) return;
      this.socket = null;
      if (!this.enabled) return;
      this._setState('retrying');
      this._scheduleRetry();
    };

    socket.onerror = () => {
      // A close always follows an error; the close handler owns the retry.
    };
  }

  _dropSocket() {
    const socket = this.socket;
    this.socket = null;
    if (!socket) return;
    if (socket.readyState === 1) {
      try {
        socket.send(JSON.stringify({ x: 0 }));
      } catch {
        /* socket already gone */
      }
    }
    try {
      socket.close();
    } catch {
      /* already closed */
    }
  }

  _clearRetry() {
    if (this._retryTimer != null) {
      this.cancel(this._retryTimer);
      this._retryTimer = null;
    }
  }

  _scheduleRetry() {
    if (!this.enabled || this._retryTimer != null) return;
    const delay = this._retryMs;
    this._retryMs = Math.min(this.maxRetryMs, this._retryMs * 2);
    this._retryTimer = this.schedule(() => {
      this._retryTimer = null;
      if (this.enabled) this._connect();
    }, delay);
  }

  _setState(state) {
    if (this._state === state) return;
    this._state = state;
    const { label, kind } = STATES[state] || { label: state, kind: 'idle' };
    this.onState({ state, label, kind });
  }
}
