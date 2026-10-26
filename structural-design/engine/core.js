/* engine/core.js — SD namespace, errors, small vector/matrix helpers, unit helpers.
 * Plain JS, no dependencies, no DOM. Works in browser (classic script) and Node (require). */
(function (root) {
  const SD = root.SD = root.SD || {};

  /** Readable engineering error. `code` is machine-readable, `details` optional context. */
  class SolverError extends Error {
    constructor(message, code, details) {
      super(message);
      this.name = 'SolverError';
      this.code = code || 'SOLVER_ERROR';
      this.details = details || null;
    }
  }
  SD.SolverError = SolverError;

  SD.G = 9.81; // m/s2 (kgf <-> N)

  /** Round to d decimals (default 3). Non-finite numbers are returned unchanged. */
  SD.round = function (x, d) {
    if (typeof x !== 'number' || !isFinite(x)) return x;
    const f = Math.pow(10, d === undefined ? 3 : d);
    return Math.round((x + (x >= 0 ? 1 : -1) * Number.EPSILON * Math.abs(x)) * f) / f;
  };

  // ---------------------------------------------------------------- units
  // Analysis units: kgf, m.  Design units: kg, cm, ksc.
  SD.units = {
    kscToKgM2: (ksc) => ksc * 1e4,          // 1 ksc = 1 kg/cm2 = 10000 kg/m2
    kgM2ToKsc: (kgm2) => kgm2 / 1e4,
    kgmToKgcm: (kgm) => kgm * 100,
    kgcmToKgm: (kgcm) => kgcm / 100,
    mToCm: (m) => m * 100,
    cmToM: (cm) => cm / 100,
    mToMm: (m) => m * 1000,
    cubeToCylinder: (fcCube) => 0.80 * fcCube,   // fc'(cyl) = 0.80 x cube  [VERIFY]
    cylinderToCube: (fcCyl) => fcCyl / 0.80,
    kgToKN: (kg) => kg * 9.81 / 1000,
    kNToKg: (kN) => kN * 1000 / 9.81
  };

  // ---------------------------------------------------------------- vectors (3-arrays)
  SD.vec = {
    add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
    sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
    scale: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
    dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
    cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
    norm: (a) => Math.hypot(a[0], a[1], a[2]),
    normalize: function (a) {
      const n = Math.hypot(a[0], a[1], a[2]);
      if (n === 0) throw new SolverError('Zero-length vector', 'ZERO_VECTOR');
      return [a[0] / n, a[1] / n, a[2] / n];
    }
  };

  // ---------------------------------------------------------------- dense matrices (arrays of arrays)
  SD.mat = {
    zeros: function (n, m) {
      const A = new Array(n);
      for (let i = 0; i < n; i++) A[i] = new Array(m === undefined ? n : m).fill(0);
      return A;
    },
    identity: function (n) { const A = SD.mat.zeros(n, n); for (let i = 0; i < n; i++) A[i][i] = 1; return A; },
    transpose: function (A) {
      const n = A.length, m = A[0].length, T = SD.mat.zeros(m, n);
      for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) T[j][i] = A[i][j];
      return T;
    },
    mul: function (A, B) {
      const n = A.length, k = B.length, m = B[0].length, C = SD.mat.zeros(n, m);
      for (let i = 0; i < n; i++) for (let l = 0; l < k; l++) {
        const a = A[i][l]; if (a === 0) continue;
        for (let j = 0; j < m; j++) C[i][j] += a * B[l][j];
      }
      return C;
    },
    mulVec: function (A, x) {
      const y = new Array(A.length).fill(0);
      for (let i = 0; i < A.length; i++) { let s = 0; for (let j = 0; j < x.length; j++) s += A[i][j] * x[j]; y[i] = s; }
      return y;
    },
    /** Gauss elimination with partial pivoting. B is an array of rows (matrix RHS) -> returns A^-1 B. Throws on singular. */
    solve: function (A, B) {
      const n = A.length, m = B[0].length;
      const M = A.map((r, i) => r.concat(B[i]));
      for (let c = 0; c < n; c++) {
        let p = c, mx = Math.abs(M[c][c]);
        for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > mx) { mx = Math.abs(M[r][c]); p = r; }
        if (mx < 1e-300) throw new SolverError('Singular matrix', 'SINGULAR_DENSE');
        if (p !== c) { const t = M[p]; M[p] = M[c]; M[c] = t; }
        for (let r = c + 1; r < n; r++) {
          const f = M[r][c] / M[c][c]; if (f === 0) continue;
          for (let j = c; j < n + m; j++) M[r][j] -= f * M[c][j];
        }
      }
      const X = SD.mat.zeros(n, m);
      for (let j = 0; j < m; j++) for (let i = n - 1; i >= 0; i--) {
        let s = M[i][n + j];
        for (let k = i + 1; k < n; k++) s -= M[i][k] * X[k][j];
        X[i][j] = s / M[i][i];
      }
      return X;
    },
    inverse: function (A) { return SD.mat.solve(A, SD.mat.identity(A.length)); }
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = SD;
})(typeof globalThis !== 'undefined' ? globalThis : this);
