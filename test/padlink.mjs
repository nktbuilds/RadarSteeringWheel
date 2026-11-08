// Exercises the virtual pad link's mapping, throttling and reconnect logic with
// a fake WebSocket, so no bridge and no Windows are needed.

const { PadLink, angleToStick } = await import('../source/js/padlink.js');

const results = [];
const check = (name, ok, detail = '') => results.push([name, ok, detail]);

check('centre maps to neutral', angleToStick(0) === 0);
check('full lock at max angle', Math.abs(angleToStick(90) - 1) < 1e-9);
check('clamped past max angle', Math.abs(angleToStick(400) - 1) < 1e-9);
check('keeps the sign', angleToStick(-90) < 0 && angleToStick(-90) > -1.0001);
check(
  'inside the deadzone is neutral',
  angleToStick(2, { maxAngleDeg: 90, deadzone: 0.06, curve: 1 }) === 0,
);
check(
  'grows monotonically',
  angleToStick(20) < angleToStick(60) && angleToStick(60) < angleToStick(85),
);
check(
  'expo keeps centre fine',
  angleToStick(30, { maxAngleDeg: 90, deadzone: 0, curve: 2 }) <
    angleToStick(30, { maxAngleDeg: 90, deadzone: 0, curve: 1 }),
);

class FakeSocket {
  static created = [];
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    FakeSocket.created.push(this);
  }
  send(text) {
    if (this.readyState !== 1) throw new Error('socket is not open');
    this.sent.push(JSON.parse(text));
  }
  close() {
    this.readyState = 3;
  }
  open() {
    this.readyState = 1;
    this.onopen?.({});
  }
  drop() {
    this.readyState = 3;
    this.onclose?.({});
  }
}

let clock = 0;
let timers = [];
const schedule = (fn, ms) => {
  const timer = { fn, ms, cancelled: false };
  timers.push(timer);
  return timer;
};
const cancel = (timer) => {
  if (timer) timer.cancelled = true;
};
const runTimers = () => {
  const due = timers;
  timers = [];
  for (const timer of due) if (!timer.cancelled) timer.fn();
};

FakeSocket.created = [];
const inert = new PadLink({ WebSocketImpl: FakeSocket, now: () => clock, schedule, cancel });
inert.send(45);
check('disabled opens no socket', FakeSocket.created.length === 0);
check('disabled stays off', inert.state === 'off');

FakeSocket.created = [];
const states = [];
const link = new PadLink({
  WebSocketImpl: FakeSocket,
  now: () => clock,
  schedule,
  cancel,
  onState: (state) => states.push(state.state),
});

link.enable('ws://127.0.0.1:8765');
check('enable opens one socket', FakeSocket.created.length === 1);
check('uses the given url', FakeSocket.created[0].url === 'ws://127.0.0.1:8765');
check('reports connecting', link.state === 'connecting');

link.send(45);
check('writes nothing before open', FakeSocket.created[0].sent.length === 0);

const socket = FakeSocket.created[0];
socket.open();
check('reports linked', link.state === 'linked');
check('flushes the pending value on open', socket.sent.length === 1);
check(
  'pending value is the mapped angle',
  Math.abs(socket.sent[0].x - Number(angleToStick(45).toFixed(3))) < 1e-9,
);

clock = 100;
link.send(60);
check('writes once the interval elapsed', socket.sent.length === 2);

clock = 105;
link.send(80);
check('suppresses a write inside the interval', socket.sent.length === 2);

clock = 130;
link.send(80);
check('writes after the interval', socket.sent.length === 3);

const steady = socket.sent.at(-1).x;
clock = 200;
link.send(80.0001, {});
check('suppresses a change under epsilon', socket.sent.length === 3 && steady === socket.sent.at(-1).x);

clock = 201;
link.send(80, { blanked: true });
check('blanked centres immediately', socket.sent.length === 4);
check('blanked value is zero', socket.sent.at(-1).x === 0);

clock = 300;
socket.drop();
check('reports retrying after close', link.state === 'retrying');
check('schedules the first retry', timers.length === 1 && timers[0].ms === 250);

runTimers();
check('retry opens a new socket', FakeSocket.created.length === 2);

FakeSocket.created[1].drop();
check('backoff doubles', timers.length === 1 && timers[0].ms === 500);

link.disable();
check('disable reports off', link.state === 'off' && link.enabled === false);
const before = FakeSocket.created.length;
runTimers();
check('disable cancels the retry', FakeSocket.created.length === before);

FakeSocket.created = [];
const fresh = new PadLink({ WebSocketImpl: FakeSocket, now: () => clock, schedule, cancel });
fresh.enable('ws://127.0.0.1:8765');
FakeSocket.created[0].open();
fresh.send(60);
const sentBefore = FakeSocket.created[0].sent.length;
fresh.enable('ws://127.0.0.1:9000');
check('url change reconnects', FakeSocket.created.length === 2);
check('old socket got a centre packet', FakeSocket.created[0].sent.at(-1).x === 0);
check('new socket targets the new url', FakeSocket.created[1].url === 'ws://127.0.0.1:9000');
check('no stray writes to the old socket', FakeSocket.created[0].sent.length === sentBefore + 1);
fresh.disable();

let ok = true;
for (const [name, passed, detail] of results) {
  if (!passed) ok = false;
  console.log(`${passed ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
}
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
