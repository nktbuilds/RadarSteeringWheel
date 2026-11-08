// Drives the game's steering physics with a stubbed canvas, so the car's
// response to the wheel can be checked without a browser.

globalThis.ResizeObserver = class {
  constructor() {}
  observe() {}
};
globalThis.window = { devicePixelRatio: 1 };

const noop = () => {};
const ctx = {
  clearRect: noop,
  setTransform: noop,
  save: noop,
  restore: noop,
  translate: noop,
  rotate: noop,
  beginPath: noop,
  moveTo: noop,
  arcTo: noop,
  closePath: noop,
  fill: noop,
  fillRect: noop,
};
const canvas = {
  getContext: () => ctx,
  parentElement: null,
  style: {},
  width: 0,
  height: 0,
  getBoundingClientRect: () => ({ width: 600, height: 600 }),
};

const { DriveGame } = await import('../source/js/game.js');

const DT = 1 / 60;
const results = [];
const check = (name, ok, detail = '') => results.push([name, ok, detail]);

const drive = (game, seconds) => {
  for (let i = 0; i < Math.round(seconds / DT); i++) game.step(DT);
};

// 1. Centred wheel: drives straight, stays on the road.
{
  const g = new DriveGame(canvas);
  g.setInput(0, { blanked: false });
  drive(g, 1);
  check(
    'centred wheel drives straight and on-road',
    Math.abs(g.carX - 0.5) < 1e-9 && Math.abs(g.headingDeg) < 1e-9 && !g.offRoad,
    `carX=${g.carX} heading=${g.headingDeg} offRoad=${g.offRoad}`,
  );
}

// 2. Positive wheel steers right.
{
  const g = new DriveGame(canvas);
  g.setInput(90, { blanked: false });
  drive(g, 2);
  check('positive angle steers right', g.headingDeg > 1 && g.carX > 0.5, `carX=${g.carX.toFixed(3)} heading=${g.headingDeg.toFixed(2)}`);
}

// 3. Negative wheel steers left.
{
  const g = new DriveGame(canvas);
  g.setInput(-90, { blanked: false });
  drive(g, 2);
  check('negative angle steers left', g.headingDeg < -1 && g.carX < 0.5, `carX=${g.carX.toFixed(3)} heading=${g.headingDeg.toFixed(2)}`);
}

// 4. Heading is clamped, so a full-lock wheel cannot spin the car.
{
  const g = new DriveGame(canvas, { headingScale: 5, maxHeadingDeg: 30 });
  g.setInput(180, { blanked: false });
  drive(g, 5);
  check('heading is clamped', Math.abs(g.headingDeg - 30) < 0.05, `heading=${g.headingDeg.toFixed(3)}`);
}

// 5. The world scrolls forward while driving.
{
  const g = new DriveGame(canvas);
  g.setInput(0, { blanked: false });
  drive(g, 1);
  check('world scrolls forward', g.scroll > 250 && g.scroll < 350, `scroll=${g.scroll.toFixed(0)}`);
}

// 6. Holding a turn eventually takes the car off the road.
{
  const g = new DriveGame(canvas);
  g.setInput(180, { blanked: false });
  drive(g, 10);
  check('leaving the road is detected', g.offRoad === true && g.carX > 0.9, `carX=${g.carX.toFixed(3)} offRoad=${g.offRoad}`);
}

// 7. The car cannot be steered out of the view.
{
  const g = new DriveGame(canvas);
  g.setInput(-180, { blanked: false });
  drive(g, 20);
  check('car stays inside the view', g.carX >= 0.04 - 1e-9 && g.carX <= 0.96 + 1e-9, `carX=${g.carX.toFixed(3)}`);
}

// 8. Losing the hand straightens the car up.
{
  const g = new DriveGame(canvas);
  g.setInput(120, { blanked: false });
  drive(g, 1);
  const turned = g.headingDeg;
  g.setInput(120, { blanked: true });
  drive(g, 3);
  check('blanked input straightens the car', turned > 1 && Math.abs(g.headingDeg) < 0.5, `turned=${turned.toFixed(2)} settled=${g.headingDeg.toFixed(3)}`);
}

// 9. Resizing is a fixed point. If a resize callback ever changed the box, the
//    observer and the canvas would grow each other on every frame and push the
//    whole page down.
{
  const parentH = 600;
  const box = {
    get clientWidth() {
      return 600;
    },
    get clientHeight() {
      return parentH;
    },
    getBoundingClientRect: () => ({ width: 600, height: parentH }),
  };
  const c = { ...canvas, parentElement: box, style: {} };
  const g = new DriveGame(c);
  const w0 = c.width;
  const h0 = c.height;
  for (let i = 0; i < 50; i++) g._resize();
  check(
    'resize is a fixed point',
    c.width === w0 && c.height === h0 && c.style.height === `${parentH}px` && g.height === parentH,
    `canvas=${c.width}x${c.height} style=${c.style.height} box=${g.height}`,
  );
}

let ok = true;
for (const [name, passed, detail] of results) {
  if (!passed) ok = false;
  console.log(`${passed ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
