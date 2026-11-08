// Dependency-free canvas charts.
//
// Two renderers are provided: a bar chart for amplitude-vs-distance and a
// line chart for time-series waveforms. Both are DPR-aware and responsive.

const COLORS = {
  grid: 'rgba(255, 255, 255, 0.08)',
  axis: 'rgba(255, 255, 255, 0.25)',
  text: 'rgba(230, 236, 245, 0.75)',
  bar: '#4f9cff',
  barPeak: '#ff6b6b',
  acquire: 'rgba(255, 196, 87, 0.9)',
  handMark: '#4fd1a5',
};

class CanvasChart {
  constructor(canvas, { padding = { top: 12, right: 12, bottom: 34, left: 38 } } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.padding = padding;
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this._ready = false;

    this._resizeObserver = new ResizeObserver(() => this._resize());
    this._resizeObserver.observe(canvas.parentElement || canvas);
    this._resize();
  }

  _resize() {
    const rect = (this.canvas.parentElement || this.canvas).getBoundingClientRect();
    const cssW = Math.max(1, Math.floor(rect.width));
    const cssH = Math.max(1, Math.floor(this.canvas.clientHeight || rect.height || 160));
    this.dpr = window.devicePixelRatio || 1;
    this.width = cssW;
    this.height = cssH;
    this.canvas.width = Math.floor(cssW * this.dpr);
    this.canvas.height = Math.floor(cssH * this.dpr);
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    if (this._ready) this.draw();
  }

  get plot() {
    const { top, right, bottom, left } = this.padding;
    return {
      x: left,
      y: top,
      w: Math.max(1, this.width - left - right),
      h: Math.max(1, this.height - top - bottom),
    };
  }

  clear() {
    this.ctx.clearRect(0, 0, this.width, this.height);
    const { x, y, w, h } = this.plot;
    this.ctx.fillStyle = 'rgba(255,255,255,0.02)';
    this.ctx.fillRect(x, y, w, h);
  }

  drawGrid(rows = 4) {
    const { ctx } = this;
    const { x, y, w, h } = this.plot;
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    for (let i = 0; i <= rows; i++) {
      const yy = y + (h * i) / rows;
      ctx.beginPath();
      ctx.moveTo(x, yy);
      ctx.lineTo(x + w, yy);
      ctx.stroke();
    }
    ctx.strokeStyle = COLORS.axis;
    ctx.strokeRect(x, y, w, h);
  }

  drawText(text, x, y, align = 'left') {
    const { ctx } = this;
    ctx.fillStyle = COLORS.text;
    ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x, y);
  }

  draw() {}
}

export class BarChart extends CanvasChart {
  constructor(canvas, opts = {}) {
    super(canvas, opts);
    this.values = [];
    this.meta = {};
    this._ready = true;
    this.draw();
  }

  setData(values, meta = {}) {
    this.values = values || [];
    this.meta = meta;
    this.draw();
  }

  draw() {
    this.clear();
    this.drawGrid(4);
    const { ctx } = this;
    const { x, y, w, h } = this.plot;
    const values = this.values || [];
    if (values.length === 0) {
      this.drawText('no data', x + w / 2, y + h / 2, 'center');
      return;
    }

    let max = 0;
    for (const v of values) if (v > max) max = v;
    if (max <= 0) max = 1;

    const n = values.length;
    const bw = w / n;
    let peak = 0;
    for (let i = 1; i < n; i++) if (values[i] > values[peak]) peak = i;

    const stepM = this.meta.stepMeters;
    const startM = this.meta.startMeters ?? 0;
    const tickBins = stepM ? this._tickBins(n) : [];

    if (stepM) {
      ctx.strokeStyle = COLORS.grid;
      ctx.lineWidth = 1;
      for (const i of tickBins) {
        const xx = x + (i + 0.5) * bw;
        ctx.beginPath();
        ctx.moveTo(xx, y);
        ctx.lineTo(xx, y + h);
        ctx.stroke();
      }
    }

    for (let i = 0; i < n; i++) {
      const bh = (values[i] / max) * (h - 4);
      ctx.fillStyle = i === peak ? COLORS.barPeak : COLORS.bar;
      ctx.fillRect(x + i * bw + 1, y + h - bh, Math.max(1, bw - 2), bh);
    }

    const toAmpY = (v) => y + h - (Math.min(v, max) / max) * (h - 4);
    const acquire = this.meta.threshold;
    if (acquire > 0) {
      ctx.save();
      ctx.strokeStyle = COLORS.acquire;
      ctx.setLineDash([6, 4]);
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x, toAmpY(acquire));
      ctx.lineTo(x + w, toAmpY(acquire));
      ctx.stroke();
      ctx.restore();
      this.drawText(`acquire ${acquire.toFixed(0)}`, x + 2, toAmpY(acquire) - 7, 'left');
    }

    const handBins = this.meta.handBins;
    if (Array.isArray(handBins)) {
      for (const b of handBins) {
        if (!Number.isInteger(b) || b < 0 || b >= n) continue;
        const xx = x + (b + 0.5) * bw;
        ctx.fillStyle = COLORS.handMark;
        ctx.beginPath();
        ctx.moveTo(xx, y + 1);
        ctx.lineTo(xx - 4, y + 8);
        ctx.lineTo(xx + 4, y + 8);
        ctx.closePath();
        ctx.fill();
      }
    }

    this.drawText(max.toFixed(0), x - 4, y + 6, 'right');
    this.drawText('0', x - 4, y + h, 'right');

    if (stepM) {
      for (const i of tickBins) {
        const xx = x + (i + 0.5) * bw;
        const cm = (startM + i * stepM) * 100;
        this.drawText(cm.toFixed(0), xx, y + h + 11, 'center');
      }
      this.drawText('distance (cm)', x + w / 2, y + h + 25, 'center');
      const peakCm = (startM + peak * stepM) * 100;
      this.drawText(`peak ${peakCm.toFixed(0)} cm`, x + w - 2, y + 6, 'right');
    }
  }

  _tickBins(n) {
    const count = Math.min(6, n);
    const bins = [];
    for (let t = 0; t < count; t++) {
      bins.push(count === 1 ? 0 : Math.round((t * (n - 1)) / (count - 1)));
    }
    return Array.from(new Set(bins));
  }
}

export class LineChart extends CanvasChart {
  constructor(canvas, { color = '#4f9cff', fill = null, opts = {} } = {}) {
    super(canvas, opts);
    this.color = color;
    this.fill = fill;
    this.values = [];
    this.meta = {};
    this._ready = true;
    this.draw();
  }

  setData(values, meta = {}) {
    this.values = values || [];
    this.meta = meta;
    this.draw();
  }

  draw() {
    this.clear();
    this.drawGrid(4);
    const { ctx } = this;
    const { x, y, w, h } = this.plot;
    const values = this.values || [];
    const meta = this.meta || {};
    if (values.length < 2) {
      this.drawText('collecting…', x + w / 2, y + h / 2, 'center');
      return;
    }

    let min = meta.yMin ?? Infinity;
    let max = meta.yMax ?? -Infinity;
    if (meta.yMin === undefined || meta.yMax === undefined) {
      min = Infinity;
      max = -Infinity;
      for (const v of values) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
      if (max - min < 1e-9) {
        max += 1;
        min -= 1;
      }
      const pad = (max - min) * 0.1;
      min -= pad;
      max += pad;
    }

    const toY = (v) => y + h - ((v - min) / (max - min)) * h;
    const toX = (i) => x + (i / (values.length - 1)) * w;

    ctx.beginPath();
    ctx.moveTo(toX(0), toY(values[0]));
    for (let i = 1; i < values.length; i++) ctx.lineTo(toX(i), toY(values[i]));
    ctx.strokeStyle = this.color;
    ctx.lineWidth = 1.6;
    ctx.stroke();

    if (this.fill) {
      ctx.lineTo(toX(values.length - 1), y + h);
      ctx.lineTo(toX(0), y + h);
      ctx.closePath();
      ctx.fillStyle = this.fill;
      ctx.fill();
    }

    this.drawText(max.toFixed(2), x - 4, y + 6, 'right');
    this.drawText(min.toFixed(2), x - 4, y + h, 'right');
  }
}
