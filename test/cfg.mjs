import { describePortInfo } from '../source/js/config.js';

const ch340 = describePortInfo({ usbVendorId: 0x1a86, usbProductId: 0x7523 });
const cp210x = describePortInfo({ usbVendorId: 0x10c4, usbProductId: 0xea60 });
const unknown = describePortInfo({});

console.log('ch340  :', ch340);
console.log('cp210x :', cp210x);
console.log('unknown:', unknown);

const ok = ch340.includes('CH340') && cp210x.includes('CP210x') && unknown === 'unknown device';
console.log(ok ? 'PASS' : 'FAIL');
process.exit(ok ? 0 : 1);
