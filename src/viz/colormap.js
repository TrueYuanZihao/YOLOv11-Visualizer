/* 伪彩色映射表：把 0..1 的标量映射成 RGB */
const STOPS = {
  viridis: [[68,1,84],[72,40,120],[62,74,137],[49,104,142],[38,130,142],[31,158,137],[53,183,121],[109,205,89],[180,222,44],[253,231,37]],
  inferno: [[0,0,4],[22,11,57],[66,10,104],[106,23,110],[147,38,103],[188,55,84],[221,81,58],[243,120,25],[252,165,10],[246,215,70],[252,255,164]],
  turbo:   [[48,18,59],[70,107,227],[37,187,213],[31,231,141],[151,247,58],[253,196,45],[240,101,26],[200,34,5],[122,4,3]],
  ice:     [[3,6,20],[10,42,84],[16,100,146],[42,174,202],[152,232,240],[255,255,255]],
  gray:    [[4,5,9],[255,255,255]],
  coolwarm:[[40,60,150],[90,130,210],[170,200,240],[245,245,245],[245,190,150],[215,110,80],[160,30,40]],
};

export const COLORMAPS = Object.keys(STOPS);
export const COLORMAP_LABELS = {
  viridis: 'Viridis', inferno: 'Inferno', turbo: 'Turbo',
  ice: 'Ice', gray: '灰度', coolwarm: '冷暖（适合有正负的值）',
};

const cache = new Map();

export function lut(name) {
  if (cache.has(name)) return cache.get(name);
  const stops = STOPS[name] || STOPS.viridis;
  const out = new Uint8Array(256 * 3);
  for (let i = 0; i < 256; i++) {
    const t = (i / 255) * (stops.length - 1);
    const j = Math.min(stops.length - 2, Math.floor(t));
    const f = t - j;
    const a = stops[j], b = stops[j + 1];
    out[i*3] = a[0] + (b[0]-a[0]) * f;
    out[i*3+1] = a[1] + (b[1]-a[1]) * f;
    out[i*3+2] = a[2] + (b[2]-a[2]) * f;
  }
  cache.set(name, out);
  return out;
}

/** 把 0..1 的平面写进 RGBA 缓冲 */
export function colorizeInto(plane, table, gamma, rgba) {
  const n = plane.length;
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    let v = plane[i];
    if (gamma !== 1) v = Math.pow(v <= 0 ? 0 : v, gamma);
    let idx = (v <= 0 ? 0 : v >= 1 ? 255 : (v * 255) | 0) * 3;
    rgba[j] = table[idx]; rgba[j+1] = table[idx+1]; rgba[j+2] = table[idx+2]; rgba[j+3] = 255;
  }
}
