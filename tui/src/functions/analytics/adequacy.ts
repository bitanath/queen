//MARK: - Sample-adequacy diagnostics (plan §4.4). `factor-js` exposes no KMO/Bartlett, so both are implemented here on the 14×14 correlation matrix.

function correlationMatrix(matrix: number[][]): number[][] {
  const n = matrix.length;
  const p = matrix[0]?.length ?? 0;
  const means = new Array<number>(p).fill(0);
  const stds = new Array<number>(p).fill(1);
  for (let j = 0; j < p; j += 1) {
    let sum = 0;
    for (let i = 0; i < n; i += 1) sum += matrix[i]?.[j] ?? 0;
    means[j] = sum / n;
  }
  for (let j = 0; j < p; j += 1) {
    let sumSq = 0;
    for (let i = 0; i < n; i += 1) {
      const d = (matrix[i]?.[j] ?? 0) - (means[j] ?? 0);
      sumSq += d * d;
    }
    const sd = Math.sqrt(sumSq / n);
    stds[j] = sd > 0 ? sd : 1;
  }
  const r: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  for (let i = 0; i < p; i += 1) {
    for (let j = 0; j < p; j += 1) {
      let sum = 0;
      for (let row = 0; row < n; row += 1) {
        sum += ((matrix[row]?.[i] ?? 0) - (means[i] ?? 0)) / (stds[i] ?? 1) * (((matrix[row]?.[j] ?? 0) - (means[j] ?? 0)) / (stds[j] ?? 1));
      }
      r[i]![j] = sum / n;
    }
  }
  return r;
}

function inverse(m: number[][]): number[][] | null {
  const n = m.length;
  const a = m.map((row, i) => [...row, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(a[r]?.[col] ?? 0) > Math.abs(a[pivot]?.[col] ?? 0)) pivot = r;
    }
    if (Math.abs(a[pivot]?.[col] ?? 0) < 1e-12) return null;
    [a[col], a[pivot]] = [a[pivot]!, a[col]!];
    const div = a[col]![col]!;
    for (let j = 0; j < 2 * n; j += 1) a[col]![j] = (a[col]![j] ?? 0) / div;
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const factor = a[r]?.[col] ?? 0;
      if (factor === 0) continue;
      for (let j = 0; j < 2 * n; j += 1) a[r]![j] = (a[r]![j] ?? 0) - factor * (a[col]![j] ?? 0);
    }
  }
  return a.map((row) => row.slice(n));
}

function determinant(m: number[][]): number {
  const n = m.length;
  const a = m.map((row) => [...row]);
  let det = 1;
  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(a[r]?.[col] ?? 0) > Math.abs(a[pivot]?.[col] ?? 0)) pivot = r;
    }
    if (Math.abs(a[pivot]?.[col] ?? 0) < 1e-12) return 0;
    if (pivot !== col) {
      [a[col], a[pivot]] = [a[pivot]!, a[col]!];
      det = -det;
    }
    det *= a[col]![col]!;
    for (let r = col + 1; r < n; r += 1) {
      const factor = (a[r]?.[col] ?? 0) / (a[col]?.[col] ?? 1);
      for (let j = col; j < n; j += 1) a[r]![j] = (a[r]![j] ?? 0) - factor * (a[col]![j] ?? 0);
    }
  }
  return det;
}

export type Adequacy = {
  kmo: number;
  bartlett: { chi2: number; df: number; p: number };
};

export function adequacy(matrix: number[][]): Adequacy | null {
  const n = matrix.length;
  const p = matrix[0]?.length ?? 0;
  if (n < 3 || p < 2) return null;
  const r = correlationMatrix(matrix);
  const inv = inverse(r);
  const det = determinant(r);

  let sumR2 = 0;
  let sumA2 = 0;
  if (inv) {
    for (let i = 0; i < p; i += 1) {
      for (let j = 0; j < p; j += 1) {
        if (i === j) continue;
        sumR2 += (r[i]?.[j] ?? 0) ** 2;
        const aij = -(inv[i]?.[j] ?? 0) / Math.sqrt((inv[i]?.[i] ?? 1) * (inv[j]?.[j] ?? 1));
        sumA2 += aij ** 2;
      }
    }
  }
  const kmo = sumR2 + sumA2 > 0 ? sumR2 / (sumR2 + sumA2) : 0;

  const df = (p * (p - 1)) / 2;
  const chi2 = det > 0 ? -((n - 1) - (2 * p + 5) / 6) * Math.log(det) : 0;
  const p_value = chi2 > 0 ? gammq(df / 2, chi2 / 2) : 1;

  return { kmo, bartlett: { chi2, df, p: p_value } };
}

function lnGamma(x: number): number {
  const cof = [
    76.18009172947146, -86.50532032941677, 24.01409824083091,
    -1.231739572450155, 0.1208650973866179e-2, -0.5395239384953e-5,
  ];
  let y = x;
  let tmp = x + 5.5;
  tmp -= (x + 0.5) * Math.log(tmp);
  let ser = 1.000000000190015;
  for (const c of cof) {
    y += 1;
    ser += c / y;
  }
  return -tmp + Math.log((2.5066282746310005 * ser) / x);
}

function gser(a: number, x: number): number {
  const EPS = 1e-12;
  const ITMAX = 300;
  let ap = a;
  let sum = 1 / a;
  let del = sum;
  for (let n = 0; n < ITMAX; n += 1) {
    ap += 1;
    del *= x / ap;
    sum += del;
    if (Math.abs(del) < Math.abs(sum) * EPS) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - lnGamma(a));
}

function gcf(a: number, x: number): number {
  const EPS = 1e-12;
  const FPMIN = 1e-300;
  const ITMAX = 300;
  let b = x + 1 - a;
  let c = 1 / FPMIN;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i <= ITMAX; i += 1) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = b + an / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < EPS) break;
  }
  return Math.exp(-x + a * Math.log(x) - lnGamma(a)) * h;
}

function gammq(a: number, x: number): number {
  if (x <= 0) return 1;
  if (x < a + 1) return 1 - gser(a, x);
  return gcf(a, x);
}
