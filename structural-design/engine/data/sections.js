/* engine/data/sections.js — steel section library (มอก. 1227 H/I/C, pipes, square/rect tubes).
 * Units: cm, cm2, cm4, cm3, cm6, kg/m.  verified:false on EVERY row: dimensions were entered from memory of the
 * JIS/มอก. catalogue; section properties are COMPUTED from the dimensions (fillets included for rolled shapes).
 * `source` per property: 'table' = value typed from the catalogue (only A and weight for H rows, used as a cross-check),
 * 'computed' = derived here.  Check against the manufacturer catalogue before real use.
 * Solver helpers (m units): SD.sections.rect(b,h), circle(D), toSolver(row).
 * Self-registers on globalThis.SD.sections; no load-time dependency on other engine files. */
(function (root) {
  'use strict';
  const SD = root.SD = root.SD || {};
  const PI = Math.PI;
  const KF = 1 - PI / 4;          // fillet area factor
  const KC = 0.2234;               // fillet centroid offset factor (x r)
  const KI = 0.00755;              // fillet own inertia factor (x r^4)
  const RHO = 0.00785;             // kg/cm3

  function finish(row, p) {
    row.A = p.A; row.Ix = p.Ix; row.Iy = p.Iy; row.Zx = p.Zx; row.Zy = p.Zy; row.J = p.J; row.Cw = p.Cw;
    row.Sx = p.Ix / p.cx; row.Sy = p.Iy / p.cy;
    row.rx = Math.sqrt(p.Ix / p.A); row.ry = Math.sqrt(p.Iy / p.A);
    if (row.AtTable && Math.abs(p.A / row.AtTable - 1) > 0.012) {   // typed table value disagrees with geometry: distrust both
      row.note = 'catalogue A disagrees with computed A by ' + ((p.A / row.AtTable - 1) * 100).toFixed(1) + '% - dimensions suspect, check catalogue';
      row.AtTable = 0; row.weightTable = 0;
    }
    row.weight = row.weightTable || p.A * 0.785;   // A cm2 * 0.785 = kg/m
    row.source = { A: row.AtTable ? 'table' : 'computed', weight: row.weightTable ? 'table' : 'computed',
      Ix: 'computed', Iy: 'computed', Sx: 'computed', Sy: 'computed', Zx: 'computed', Zy: 'computed',
      rx: 'computed', ry: 'computed', J: 'computed', Cw: 'computed' };
    row.AcomputedVsTable = row.AtTable ? p.A / row.AtTable - 1 : null;
    if (row.AtTable) row.A = row.AtTable;           // keep catalogue area where given; ratios unaffected (<1%)
    row.verified = false;
    delete row.AtTable; delete row.weightTable;
    return row;
  }

  // ---- doubly symmetric rolled I/H (with root fillets)
  function propsI(d, bf, tw, tf, r) {
    const af = KF * r * r, y = d / 2 - tf - KC * r, x = tw / 2 + KC * r, hw = d - 2 * tf;
    const A = 2 * bf * tf + hw * tw + 4 * af;
    const Ix = bf * d * d * d / 12 - (bf - tw) * hw * hw * hw / 12 + 4 * (af * y * y + KI * Math.pow(r, 4));
    const Iy = 2 * tf * bf * bf * bf / 12 + hw * tw * tw * tw / 12 + 4 * (af * x * x + KI * Math.pow(r, 4));
    const Zx = bf * tf * (d - tf) + tw * hw * hw / 4 + 4 * af * y;
    const Zy = tf * bf * bf / 2 + hw * tw * tw / 4 + 4 * af * x;
    const J = (2 * bf * Math.pow(tf, 3) + (d - tf) * Math.pow(tw, 3)) / 3;
    const ho = d - tf;
    return { A, Ix, Iy, Zx, Zy, J, Cw: Iy * ho * ho / 4, cx: d / 2, cy: bf / 2 };
  }

  // ---- channel (parallel flange approximation, fillets at inside corners)
  function propsC(d, bf, tw, tf, r) {
    const af = KF * r * r, bfl = bf - tw, hw = d - 2 * tf;
    const A = d * tw + 2 * bfl * tf + 2 * af;
    const xbar = (d * tw * tw / 2 + 2 * bfl * tf * (tw + bfl / 2) + 2 * af * (tw + KC * r)) / A;
    const y = d / 2 - tf - KC * r;
    const Ix = tw * d * d * d / 12 + 2 * (bfl * tf * tf * tf / 12 + bfl * tf * Math.pow((d - tf) / 2, 2)) + 2 * (af * y * y + KI * Math.pow(r, 4));
    const Iy = d * Math.pow(tw, 3) / 12 + d * tw * Math.pow(xbar - tw / 2, 2) +
      2 * (tf * Math.pow(bfl, 3) / 12 + bfl * tf * Math.pow(tw + bfl / 2 - xbar, 2)) +
      2 * (af * Math.pow(tw + KC * r - xbar, 2) + KI * Math.pow(r, 4));
    const Zx = tw * d * d / 4 + bfl * tf * (d - tf);
    let xp = tw + (A / 2 - d * tw) / (2 * tf);              // plastic NA (assumed in flanges)
    let Zy;
    if (xp >= tw && xp <= bf) Zy = d * tw * (xp - tw / 2) + tf * Math.pow(xp - tw, 2) + tf * Math.pow(bf - xp, 2);
    else { xp = A / 2 / d; Zy = d * (xp * xp + (tw - xp) * (tw - xp)) / 2 + 2 * bfl * tf * (tw + bfl / 2 - xp); }
    const J = ((d - tf) * Math.pow(tw, 3) + 2 * bf * Math.pow(tf, 3)) / 3;
    const b = bf - tw / 2, h = d - tf;
    const Cw = tf * b * b * b * h * h / 12 * (3 * b * tf + 2 * h * tw) / (6 * b * tf + h * tw);
    return { A, Ix, Iy, Zx, Zy, J, Cw, cx: d / 2, cy: Math.max(xbar, bf - xbar), xbar };
  }

  // ---- hollow rectangle with corner radii (outer ro, inner ri = ro - t)
  function propsBox(b, h, t, ro) {
    const ri = Math.max(ro - t, 0), bi = b - 2 * t, hi = h - 2 * t;
    const aco = KF * ro * ro, aci = KF * ri * ri;
    const yo = h / 2 - KC * ro, xo = b / 2 - KC * ro, yi = hi / 2 - KC * ri, xi = bi / 2 - KC * ri;
    const A = b * h - bi * hi - 4 * aco + 4 * aci;
    const Ix = (b * h * h * h - bi * hi * hi * hi) / 12 - 4 * (aco * yo * yo + KI * Math.pow(ro, 4)) + 4 * (aci * yi * yi + KI * Math.pow(ri, 4));
    const Iy = (h * b * b * b - hi * bi * bi * bi) / 12 - 4 * (aco * xo * xo + KI * Math.pow(ro, 4)) + 4 * (aci * xi * xi + KI * Math.pow(ri, 4));
    const Zx = (b * h * h - bi * hi * hi) / 4 - 4 * aco * yo + 4 * aci * yi;
    const Zy = (h * b * b - hi * bi * bi) / 4 - 4 * aco * xo + 4 * aci * xi;
    const p = 2 * (b - t) + 2 * (h - t), Ao = (b - t) * (h - t);
    const J = 4 * Ao * Ao * t / p + t * t * t * p / 3;
    return { A, Ix, Iy, Zx, Zy, J, Cw: 0, cx: h / 2, cy: b / 2 };
  }

  function propsPipe(D, t) {
    const di = D - 2 * t, A = PI / 4 * (D * D - di * di), I = PI / 64 * (Math.pow(D, 4) - Math.pow(di, 4));
    const Z = (Math.pow(D, 3) - Math.pow(di, 3)) / 6;
    return { A, Ix: I, Iy: I, Zx: Z, Zy: Z, J: 2 * I, Cw: 0, cx: D / 2, cy: D / 2 };
  }

  // ------------------------------------------------------------------ data
  // [d, bf, tw, tf, r, A_table, weight_table]
  const H = [
    [100, 100, 6, 8, 10, 21.90, 17.2], [125, 125, 6.5, 9, 10, 30.31, 23.8], [150, 150, 7, 10, 11, 40.14, 31.5],
    [175, 175, 7.5, 11, 12, 51.21, 40.2], [200, 200, 8, 12, 13, 63.53, 49.9], [250, 250, 9, 14, 16, 92.18, 72.4],
    [300, 300, 10, 15, 18, 119.8, 94.0], [350, 350, 12, 19, 20, 173.9, 137], [400, 400, 13, 21, 22, 218.7, 172],
    [100, 50, 5, 7, 8, 11.85, 9.30], [125, 60, 6, 8, 9, 16.84, 13.2], [150, 75, 5, 7, 8, 17.85, 14.0],
    [175, 90, 5, 8, 9, 23.04, 18.1], [198, 99, 4.5, 7, 11, 23.18, 18.2], [200, 100, 5.5, 8, 11, 27.16, 21.3],
    [248, 124, 5, 8, 12, 32.68, 25.7], [250, 125, 6, 9, 12, 37.66, 29.6], [298, 149, 5.5, 8, 13, 40.80, 32.0],
    [300, 150, 6.5, 9, 13, 46.78, 36.7], [346, 174, 6, 9, 14, 52.68, 41.4], [350, 175, 7, 11, 14, 63.14, 49.6],
    [396, 199, 7, 11, 16, 72.16, 56.6], [400, 200, 8, 13, 16, 84.12, 66.0], [446, 199, 8, 12, 18, 84.30, 66.2],
    [450, 200, 9, 14, 18, 95.43, 74.9], [496, 199, 9, 14, 20, 99.29, 77.9], [500, 200, 10, 16, 20, 114.2, 89.6],
    [596, 199, 10, 15, 22, 120.5, 94.6], [600, 200, 11, 17, 22, 134.4, 106],
    [194, 150, 6, 9, 13, 39.01, 30.6], [244, 175, 7, 11, 16, 56.24, 44.1], [294, 200, 8, 12, 18, 73.03, 57.3],
    [340, 250, 9, 14, 20, 101.5, 79.7], [390, 300, 10, 16, 22, 136.0, 107], [440, 300, 11, 18, 24, 157.4, 124],
    [488, 300, 11, 18, 26, 159.2, 125], [588, 300, 12, 20, 28, 187.2, 147]
  ];
  // I-beams (JIS tapered flange approximated by parallel flange of mean thickness): [d, bf, tw, tf, r]
  const I = [[150, 75, 5.5, 9.5, 9], [200, 100, 7, 10, 10], [250, 125, 7.5, 12.5, 12], [300, 150, 8, 13, 12],
    [350, 150, 9, 15, 13], [400, 150, 10, 18, 17], [450, 175, 11, 20, 19]];
  // channels: [d, bf, tw, tf, r]
  const C = [[75, 40, 5, 7, 8], [100, 50, 5, 7.5, 8], [125, 65, 6, 8, 8], [150, 75, 6.5, 10, 10], [180, 75, 7, 10.5, 11],
    [200, 80, 7.5, 11, 12], [250, 90, 9, 13, 14], [300, 90, 9, 13, 14]];
  // pipes [OD mm, t mm]
  const P = [[60.5, 2.3], [60.5, 3.2], [76.3, 2.8], [76.3, 3.2], [89.1, 3.2], [89.1, 4.0], [101.6, 3.2], [101.6, 4.0],
    [114.3, 3.2], [114.3, 4.5], [139.8, 4.5], [165.2, 4.5], [165.2, 6.0], [216.3, 6.0], [267.4, 6.0], [318.5, 6.0], [355.6, 6.0]];
  // square / rectangular tubes [depth mm, width mm, t mm]
  const T = [[50, 50, 2.3], [60, 60, 2.3], [75, 75, 3.2], [100, 100, 3.2], [100, 100, 4.5], [125, 125, 4.5], [150, 150, 4.5],
    [150, 150, 6], [175, 175, 6], [200, 200, 6], [200, 200, 8], [250, 250, 9], [100, 50, 3.2], [150, 100, 4.5], [200, 100, 4.5],
    [200, 100, 6], [250, 150, 6], [300, 200, 8]];

  const rows = [];
  const fmt = (x) => String(+x.toFixed(2));
  H.forEach((v) => {
    const p = propsI(v[0] / 10, v[1] / 10, v[2] / 10, v[3] / 10, v[4] / 10);
    rows.push(finish({ name: 'H' + [v[0], v[1], v[2], v[3]].join('x'), type: 'H', std: 'มอก. 1227',
      d: v[0] / 10, bf: v[1] / 10, tw: v[2] / 10, tf: v[3] / 10, r: v[4] / 10, hw: (v[0] - 2 * v[3] - 2 * v[4]) / 10,
      AtTable: v[5], weightTable: v[6] }, p));
  });
  I.forEach((v) => {
    const p = propsI(v[0] / 10, v[1] / 10, v[2] / 10, v[3] / 10, v[4] / 10);
    rows.push(finish({ name: 'I' + [v[0], v[1], v[2], v[3]].join('x'), type: 'I', std: 'มอก. 1227',
      note: 'tapered flange approximated as parallel flange of mean thickness',
      d: v[0] / 10, bf: v[1] / 10, tw: v[2] / 10, tf: v[3] / 10, r: v[4] / 10, hw: (v[0] - 2 * v[3] - 2 * v[4]) / 10 }, p));
  });
  C.forEach((v) => {
    const p = propsC(v[0] / 10, v[1] / 10, v[2] / 10, v[3] / 10, v[4] / 10);
    rows.push(finish({ name: 'C' + [v[0], v[1], v[2], v[3]].join('x'), type: 'C', std: 'มอก. 1227',
      d: v[0] / 10, bf: v[1] / 10, tw: v[2] / 10, tf: v[3] / 10, r: v[4] / 10, hw: (v[0] - 2 * v[3] - 2 * v[4]) / 10,
      xbar: p.xbar }, p));
  });
  P.forEach((v) => {
    const p = propsPipe(v[0] / 10, v[1] / 10);
    rows.push(finish({ name: 'PIPE' + fmt(v[0]) + 'x' + fmt(v[1]), type: 'PIPE', std: 'มอก. 276',
      D: v[0] / 10, t: v[1] / 10, d: v[0] / 10, bf: v[0] / 10, tw: v[1] / 10, tf: v[1] / 10, r: 0 }, p));
  });
  T.forEach((v) => {
    // names are depth x width x t (RHS200x100x4.5: depth 200 along y, width 100)
    const dep = v[0] / 10, wid = v[1] / 10, t = v[2] / 10;
    const p = propsBox(wid, dep, t, 1.5 * t);
    rows.push(finish({ name: (v[0] === v[1] ? 'SHS' : 'RHS') + v[0] + 'x' + v[1] + 'x' + fmt(v[2]),
      type: v[0] === v[1] ? 'SHS' : 'RHS', std: 'มอก. 107/แบบ STKR', d: dep, bf: wid, tw: t, tf: t, t, r: 1.5 * t,
      hw: dep - 3 * t, bflat: wid - 3 * t }, p));
  });

  const byName = {};
  rows.forEach((r) => { byName[norm(r.name)] = r; });
  function norm(s) { return String(s).toUpperCase().replace(/\s+/g, '').replace(/[×X*]/g, 'x').replace(/^(H|I|C|PIPE|SHS|RHS)-/, '$1'); }

  const sections = {
    verified: false,
    rows,
    /** find('H200x200x8x12') (case/space/× tolerant) -> row | null */
    find(name) {
      if (name && typeof name === 'object') return name;
      return byName[norm(name)] || null;
    },
    list(type) { return type ? rows.filter((r) => r.type === type) : rows.slice(); },
    /** Rectangular RC/timber member, m units. Depth h along local z (strong axis My uses Iy = b h^3/12). */
    rect(b, h) {
      const a = Math.max(b, h), s = Math.min(b, h);
      const J = a * Math.pow(s, 3) * (1 / 3 - 0.21 * (s / a) * (1 - Math.pow(s, 4) / (12 * Math.pow(a, 4))));
      return { A: b * h, Iy: b * h * h * h / 12, Iz: h * b * b * b / 12, J, shape: 'rect', b, h, Asy: 5 / 6 * b * h, Asz: 5 / 6 * b * h };
    },
    circle(D) {
      return { A: PI * D * D / 4, Iy: PI * Math.pow(D, 4) / 64, Iz: PI * Math.pow(D, 4) / 64, J: PI * Math.pow(D, 4) / 32, shape: 'circle', D };
    },
    /** Steel row (cm units) -> solver section (m units); web along local z so Iy = Ix (strong). */
    toSolver(row) {
      const r = typeof row === 'string' ? sections.find(row) : row;
      if (!r) return null;
      return { A: r.A * 1e-4, Iy: r.Ix * 1e-8, Iz: r.Iy * 1e-8, J: r.J * 1e-8, shape: 'steel', name: r.name, type: r.type, d: r.d / 100, b: r.bf / 100 };
    }
  };
  SD.sections = sections;
  if (typeof module !== 'undefined' && module.exports) module.exports = sections;
})(typeof globalThis !== 'undefined' ? globalThis : this);
