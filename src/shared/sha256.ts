// src/shared/sha256.ts — تفاعل SHA-256 خالص (بدون تبعيات) للوسائط كلها.
//
// الغرض: مطابقة خوارزمية التوقيع في الخادم (Supabase `extensions.digest(...,'sha256')`)
// داخل المحرك المحلي (engine.ts) حتى تكون اختبارات المحرك/RLS مرآةً صادقة لسلوك الإنتاج.
// لا تستخدم SHA-256 في أي حساب يُعتمد عليه كأمان من طرف العميل — السرّ (qr_seed) يبقى
// خادميًا فقط؛ هذه الدالة تُستخدم لمطابقة نفس الحساب الختمي في الاختبارات والعرض.
//
// ملاحظة: خرج hex دائمًا حروف صغيرة، مطابقًا لـ encode(digest(...,'sha256'),'hex') في Postgres.

const K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

/** ترميز UTF-8 يدوي (بدون TextEncoder لضمان العمل على Hermes/React-Native/Node). */
function utf8Encode(input: string): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < input.length; i++) {
    let code = input.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff && i + 1 < input.length) {
      const next = input.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        code = 0x10000 + ((code - 0xd800) << 10) + (next - 0xdc00);
        i++;
      }
    }
    if (code <= 0x7f) {
      out.push(code);
    } else if (code <= 0x7ff) {
      out.push(0xc0 | (code >> 6), 0x80 | (code & 0x3f));
    } else if (code <= 0xffff) {
      out.push(0xe0 | (code >> 12), 0x80 | ((code >> 6) & 0x3f), 0x80 | (code & 0x3f));
    } else {
      out.push(
        0xf0 | (code >> 18),
        0x80 | ((code >> 12) & 0x3f),
        0x80 | ((code >> 6) & 0x3f),
        0x80 | (code & 0x3f),
      );
    }
  }
  return new Uint8Array(out);
}

function toHex32(words: number[]): string {
  let out = '';
  for (let i = 0; i < words.length; i++) {
    out += (words[i] >>> 0).toString(16).padStart(8, '0');
  }
  return out;
}

/** SHA-256 → 64 حرف hex صغيرة (مماثل encode(digest(m,'sha256'),'hex') في PostgreSQL). */
export function sha256Hex(input: string): string {
  const bytes = utf8Encode(input);
  const len = bytes.length;
  const bitLen = len * 8;

  // التدرّج: رسالة + 0x80 + أصفار + الطول 64-بت (big-endian)
  const total = (((len + 8) >> 6) + 1) << 6;
  const padded = new Uint8Array(total);
  padded.set(bytes);
  padded[len] = 0x80;
  // 32-بت عالية ثم منخفضة من bitLen
  const hi = Math.floor(bitLen / 0x100000000);
  const lo = bitLen >>> 0;
  padded[total - 8] = (hi >>> 24) & 0xff;
  padded[total - 7] = (hi >>> 16) & 0xff;
  padded[total - 6] = (hi >>> 8) & 0xff;
  padded[total - 5] = hi & 0xff;
  padded[total - 4] = (lo >>> 24) & 0xff;
  padded[total - 3] = (lo >>> 16) & 0xff;
  padded[total - 2] = (lo >>> 8) & 0xff;
  padded[total - 1] = lo & 0xff;

  const w = new Array<number>(64);
  let h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a,
      h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  for (let offset = 0; offset < total; offset += 64) {
    for (let i = 0; i < 16; i++) {
      const j = offset + i * 4;
      w[i] = ((padded[j] << 24) | (padded[j + 1] << 16) | (padded[j + 2] << 8) | padded[j + 3]) >>> 0;
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;

    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + h) >>> 0;
  }

  return toHex32([h0, h1, h2, h3, h4, h5, h6, h7]);
}

/** أول 20 حرف hex من SHA-256 — مطابق لـ public._qr_signature في الخادم. */
export function qrSignature(seed: string, sessionId: string, slot: number | bigint): string {
  return sha256Hex(`${seed}:${sessionId}:${slot}`).slice(0, 20);
}

/** الكود الاحتياطي 6 أرقام — مطابق لـ public._backup_code في الخادم (البايتات 0..3 big-endian mod 1,000,000). */
export function backupCode(seed: string, sessionId: string): string {
  const hex = sha256Hex(`${seed}:backup:${sessionId}`);
  const b0 = parseInt(hex.slice(0, 2), 16);
  const b1 = parseInt(hex.slice(2, 4), 16);
  const b2 = parseInt(hex.slice(4, 6), 16);
  const b3 = parseInt(hex.slice(6, 8), 16);
  const num = ((b0 * 16777216 + b1 * 65536 + b2 * 256 + b3) >>> 0) % 1000000;
  return String(num).padStart(6, '0');
}
