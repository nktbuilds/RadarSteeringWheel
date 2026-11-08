// Dependency-free canvas driving game, top view.
//
// The car holds station near the bottom of the view and the world scrolls down
// past it, which reads as forward motion. The steering wheel angle sets the car's
// heading, and the heading carries the car sideways, so turning the wheel walks
// the car across the road.
//
// The physics lives in step() and is kept free of canvas work so it can be
// driven deterministically from tests.

import { GAME } from './config.js';

const COLORS = {
  grass: '#101a14',
  grassStripe: 'rgba(255, 255, 255, 0.022)',
  road: '#22282f',
  roadEdge: 'rgba(230, 236, 245, 0.55)',
  lane: 'rgba(240, 198, 116, 0.85)',
  post: 'rgba(230, 236, 245, 0.30)',
  body: '#4f9cff',
  bodyOff: '#8b97a8',
  glass: '#0d1117',
  light: '#f0c674',
};

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function roundRectPath(ctx, x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

export class DriveGame {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.width = 0;
    this.height = 0;
    this.dpr = 1;

    this.speed = opts.speed ?? GAME.speed;
    this.headingScale = opts.headingScale ?? GAME.headingScale;
    this.maxHeadingDeg = opts.maxHeadingDeg ?? GAME.maxHeadingDeg;
    this.headingTau = opts.headingTau ?? GAME.headingTau;
    this.roadFraction = opts.roadFraction ?? GAME.roadFraction;

    this.angleDeg = 0;
    this.blanked = true;
    this.headingDeg = 0;
    this.carX = 0.5;
    this.scroll = 0;
    this.offRoad = false;
    this._last = 0;
    this._raf = 0;

    this._resizeObserver = new ResizeObserver(() => this._resize());
    this._resizeObserver.observe(canvas.parentElement || canvas);
    this._resize();

    if (typeof requestAnimationFrame === 'function') {
      this._loop = this._loop.bind(this);
      this._raf = requestAnimationFrame(this._loop);
    }
  }

  stop() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = 0;
  }

  _resize() {
    const parent = this.canvas.parentElement || this.canvas;
    const rect = parent.getBoundingClientRect();
    const cssW = Math.max(1, Math.floor(parent.clientWidth || rect.width));
    const cssH = Math.max(1, Math.floor(parent.clientHeight || rect.height));
    const dpr = window.devicePixelRatio || 1;
    const backingW = Math.floor(cssW * dpr);
    const backingH = Math.floor(cssH * dpr);
    // Nothing changed: return without touching the canvas, so a resize callback
    // can never drive another one.
    if (
      this.width === cssW &&
      this.height === cssH &&
      this.canvas.width === backingW &&
      this.canvas.height === backingH
    ) {
      return;
    }
    this.dpr = dpr;
    this.width = cssW;
    this.height = cssH;
    this.canvas.width = backingW;
    this.canvas.height = backingH;
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  setInput(angleDeg, { blanked = false } = {}) {
    this.angleDeg = Number.isFinite(angleDeg) ? angleDeg : 0;
    this.blanked = blanked;
  }

  setOptions(opts = {}) {
    for (const key of ['speed', 'headingScale', 'maxHeadingDeg', 'headingTau', 'roadFraction']) {
      if (Number.isFinite(opts[key])) this[key] = opts[key];
    }
  }

  step(dt) {
    const target = this.blanked ? 0 : clamp(this.angleDeg, -180, 180) * this.headingScale;
    const a = this.headingTau > 0 ? 1 - Math.exp(-dt / this.headingTau) : 1;
    this.headingDeg = clamp(
      this.headingDeg + (target - this.headingDeg) * a,
      -this.maxHeadingDeg,
      this.maxHeadingDeg,
    );

    const rad = (this.headingDeg * Math.PI) / 180;
    this.scroll += this.speed * dt;
    this.carX = clamp(
      this.carX + (Math.sin(rad) * this.speed * dt) / Math.max(1, this.width),
      0.04,
      0.96,
    );

    const roadW = Math.min(this.width * this.roadFraction, 460);
    const roadX = (this.width - roadW) / 2;
    const carPx = this.carX * this.width;
    this.offRoad = carPx < roadX + 6 || carPx > roadX + roadW - 6;
  }

  _loop(ts) {
    this._raf = requestAnimationFrame(this._loop);
    const dt = this._last ? Math.min(0.05, (ts - this._last) / 1000) : 0;
    this._last = ts;
    if (dt > 0) this.step(dt);
    this.draw();
  }

  draw() {
    const { ctx, width: W, height: H } = this;
    if (W < 2 || H < 2) return;
    ctx.clearRect(0, 0, W, H);

    const roadW = Math.min(W * this.roadFraction, 460);
    const roadX = (W - roadW) / 2;

    ctx.fillStyle = COLORS.grass;
    ctx.fillRect(0, 0, W, H);

    // Grass banding: a second, slower motion cue outside the road.
    const band = 90;
    ctx.fillStyle = COLORS.grassStripe;
    for (let y = -band + (this.scroll % band); y < H + band; y += band) {
      ctx.fillRect(0, y, W, band / 2);
    }

    ctx.fillStyle = COLORS.road;
    ctx.fillRect(roadX, 0, roadW, H);
    ctx.fillStyle = COLORS.roadEdge;
    ctx.fillRect(roadX - 3, 0, 3, H);
    ctx.fillRect(roadX + roadW, 0, 3, H);

    // Lane dashes and roadside posts scroll down: y grows with distance covered.
    const dash = 44;
    const gap = 36;
    const period = dash + gap;
    const offset = this.scroll % period;
    ctx.fillStyle = COLORS.lane;
    for (let y = -period + offset; y < H + period; y += period) {
      ctx.fillRect(W / 2 - 3, y, 6, dash);
    }
    ctx.fillStyle = COLORS.post;
    for (let y = -period * 2 + (this.scroll % (period * 2)); y < H + period * 2; y += period * 2) {
      ctx.fillRect(roadX - 16, y, 7, 26);
      ctx.fillRect(roadX + roadW + 9, y, 7, 26);
    }

    this._drawCar(W, H);
  }

  _drawCar(W, H) {
    const { ctx } = this;
    const w = clamp(W * 0.075, 24, 46);
    const h = w * 1.85;
    const x = this.carX * W;
    const y = H * 0.78;

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((this.headingDeg * Math.PI) / 180);

    ctx.fillStyle = this.blanked || this.offRoad ? COLORS.bodyOff : COLORS.body;
    roundRectPath(ctx, -w / 2, -h / 2, w, h, w * 0.26);
    ctx.fill();

    ctx.fillStyle = COLORS.glass;
    roundRectPath(ctx, -w * 0.33, -h * 0.31, w * 0.66, h * 0.2, w * 0.12);
    ctx.fill();
    roundRectPath(ctx, -w * 0.31, h * 0.13, w * 0.62, h * 0.17, w * 0.12);
    ctx.fill();

    ctx.fillStyle = COLORS.light;
    ctx.fillRect(-w * 0.36, -h / 2, w * 0.22, 4);
    ctx.fillRect(w * 0.14, -h / 2, w * 0.22, 4);

    ctx.restore();
  }
}
