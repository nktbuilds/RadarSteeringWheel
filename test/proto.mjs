import { buildSetupCommand, commands, classifyMessage } from '../source/js/protocol.js';
import { validateConfig, DEFAULTS } from '../source/js/config.js';

const setup = new TextDecoder().decode(buildSetupCommand(DEFAULTS));
console.log('setup cmd:', setup.slice(0, 120));
console.log('sysinfo  :', new TextDecoder().decode(commands.getSystemInfo()));
console.log('validate :', validateConfig(DEFAULTS));

const msg = classifyMessage({ result_info: [[{ tick: 1 }]], payload_size: 60 }, new Uint8Array(60));
const bad = classifyMessage({ status: 'error', message: 'boom' }, null);

const setupOk = setup.includes('"cmd":"setup"') && setup.includes('"start_point":100') && setup.includes('"num_points":40');
const ok =
  setupOk &&
  validateConfig(DEFAULTS).length === 0 &&
  msg.type === 'result' &&
  bad.type === 'error' &&
  bad.data === 'boom';
console.log('classify:', msg.type, bad.type, bad.data);
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
