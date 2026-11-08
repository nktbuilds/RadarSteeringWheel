// Dependency-free canvas steering-wheel renderer.
//
// Draws a wheel rotated by the current angle. DPR-aware and responsive, using
// the same resize pattern as the chart renderers.

const COLORS = {
  rim: '#4f9cff',
  rimDim: 'rgba(79, 156, 255, 0.25)',
  spoke: 'rgba(230, 236, 245, 0.55)',
  hub: '#1c2230',
  hubEdge: 'rgba(230, 236, 245, 0.35)',
  marker: '#4fd1a5',
  markerDim: 'rgba(139, 151, 168, 0.6)',
  tick: 'rgba(255, 255, 255, 0.10)',
};

export class SteeringWheel {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.angleDeg = 0;
    this.blanked = true;
    this.mode = 'none';
    this.width = 0;
    this.height = 0;
    this.dpr = 1;

    this._resizeObserver = new ResizeObserver(() => this._resize());
    this._resizeObserver.observe(canvas.parentElement || canvas);
    this._resize();
  }

  _resize() {
    const rect = (this.canvas.parentElement || this.canvas).getBoundingClientRect();
    const cssW = Math.max(1, Math.floor(rect.width));
    const cssH = Math.max(1, Math.floor(this.canvas.clientHeight || rect.height || 240));
    this.dpr = window.devicePixelRatio || 1;
    this.width = cssW;
    this.height = cssH;
    this.canvas.width = Math.floor(cssW * this.dpr);
    this.canvas.height = Math.floor(cssH * this.dpr);
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.draw();
  }

  setAngle(angleDeg, { blanked = false, mode = 'none' } = {}) {
    this.angleDeg = angleDeg;
    this.blanked = blanked;
    this.mode = mode;
    this.draw();
  }

  draw() {
    const { ctx, width, height } = this;
    ctx.clearRect(0, 0, width, height);

    const cx = width / 2;
    const cy = height / 2;
    const radius = Math.max(20, Math.min(width, height) / 2 - 16);

    // Fixed reference ticks so the rotation is readable.
    ctx.strokeStyle = COLORS.tick;
    ctx.lineWidth = 1;
    for (let deg = 0; deg < 360; deg += 30) {
      const a = (deg - 90) * (Math.PI / 180);
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (radius + 6), cy + Math.sin(a) * (radius + 6));
      ctx.lineTo(cx + Math.cos(a) * (radius + 12), cy + Math.sin(a) * (radius + 12));
      ctx.stroke();
    }

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate((this.angleDeg * Math.PI) / 180);

    const rimColor = this.blanked ? COLORS.rimDim : COLORS.rim;

    // Rim.
    ctx.strokeStyle = rimColor;
    ctx.lineWidth = Math.max(6, radius * 0.09);
    ctx.beginPath();
    ctx.arc(0, 0, radius, 0, Math.PI * 2);
    ctx.stroke();

    // Spokes: left, right, bottom (angles measured clockwise from top).
    ctx.strokeStyle = this.blanked ? COLORS.rimDim : COLORS.spoke;
    ctx.lineWidth = Math.max(4, radius * 0.06);
    for (const deg of [270, 90, 180]) {
      const a = (deg - 90) * (Math.PI / 180);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(a) * radius * 0.92, Math.sin(a) * radius * 0.92);
      ctx.stroke();
    }

    // Hub.
    ctx.fillStyle = COLORS.hub;
    ctx.strokeStyle = COLORS.hubEdge;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, 0, radius * 0.22, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    // Top marker: makes the rotation direction obvious.
    ctx.fillStyle = this.blanked ? COLORS.markerDim : COLORS.marker;
    ctx.beginPath();
    ctx.arc(0, -radius, Math.max(4, radius * 0.06), 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }
}
