// Dibujo y codificación PNG sin dependencias nativas (sirve en Deno y Node).
import { zlibSync } from "npm:fflate@0.8.2";
import { ancho, contornos, limpiar, partir } from "./texto.ts";

type RGB = [number, number, number];

export function hexRGB(hex: string, fallback: RGB = [70, 14, 13]): RGB {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || "");
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export function mix(a: RGB, b: RGB, t: number): RGB {
  return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as RGB;
}

class Lienzo {
  px: Uint8Array; w: number; h: number;
  constructor(w: number, h: number, fondo: RGB | null) {
    this.w = w; this.h = h;
    this.px = new Uint8Array(w * h * 4);
    if (fondo) for (let i = 0; i < w * h; i++) this.px.set([fondo[0], fondo[1], fondo[2], 255], i * 4);
  }
  // mezcla un color con cobertura 0..1 (antialias)
  pon(x: number, y: number, c: RGB, a: number) {
    if (a <= 0 || x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4, A = this.px[i + 3] / 255, na = a + A * (1 - a);
    for (let k = 0; k < 3; k++) this.px[i + k] = Math.round((c[k] * a + this.px[i + k] * A * (1 - a)) / (na || 1));
    this.px[i + 3] = Math.round(na * 255);
  }
  // rellena según una función de distancia con signo (negativa = adentro)
  forma(x0: number, y0: number, x1: number, y1: number, c: RGB, sdf: (x: number, y: number) => number, alpha = 1) {
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(this.h, Math.ceil(y1)); y++)
      for (let x = Math.max(0, Math.floor(x0)); x < Math.min(this.w, Math.ceil(x1)); x++) {
        const d = sdf(x + 0.5, y + 0.5);
        this.pon(x, y, c, Math.max(0, Math.min(1, 0.5 - d)) * alpha);
      }
  }
  circulo(cx: number, cy: number, r: number, c: RGB, alpha = 1) {
    this.forma(cx - r - 1, cy - r - 1, cx + r + 1, cy + r + 1, c, (x, y) => Math.hypot(x - cx, y - cy) - r, alpha);
  }
  aro(cx: number, cy: number, r: number, grosor: number, c: RGB, alpha = 1) {
    this.forma(cx - r - 1, cy - r - 1, cx + r + 1, cy + r + 1, c, (x, y) => Math.abs(Math.hypot(x - cx, y - cy) - (r - grosor / 2)) - grosor / 2, alpha);
  }
  linea(ax: number, ay: number, bx: number, by: number, g: number, c: RGB) {
    const seg = (x: number, y: number) => {
      const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)));
      return Math.hypot(x - (ax + t * dx), y - (ay + t * dy)) - g / 2;
    };
    this.forma(Math.min(ax, bx) - g, Math.min(ay, by) - g, Math.max(ax, bx) + g, Math.max(ay, by) + g, c, seg);
  }
  cuadroRedondo(x: number, y: number, w: number, h: number, r: number, c: RGB) {
    this.forma(x - 1, y - 1, x + w + 1, y + h + 1, c, (px, py) => {
      const qx = Math.abs(px - (x + w / 2)) - (w / 2 - r), qy = Math.abs(py - (y + h / 2)) - (h / 2 - r);
      return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
    });
  }
  check(cx: number, cy: number, r: number, c: RGB) {
    const g = Math.max(2, r * 0.26);
    this.linea(cx - r * 0.45, cy + r * 0.02, cx - r * 0.12, cy + r * 0.36, g, c);
    this.linea(cx - r * 0.12, cy + r * 0.36, cx + r * 0.5, cy - r * 0.32, g, c);
  }
  // rellena polígonos (letras) con antialias: 5 sub-líneas por píxel y cobertura horizontal exacta
  poligonos(cs: number[][][], c: RGB) {
    if (!cs.length) return;
    let y0 = Infinity, y1 = -Infinity;
    for (const k of cs) for (const p of k) { if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
    const SS = 5, fila = new Float32Array(this.w);
    for (let y = Math.max(0, Math.floor(y0)); y < Math.min(this.h, Math.ceil(y1)); y++) {
      fila.fill(0);
      for (let s = 0; s < SS; s++) {
        const sy = y + (s + 0.5) / SS, xs: [number, number][] = [];
        for (const k of cs) for (let i = 0; i < k.length; i++) {
          const a = k[i], b = k[(i + 1) % k.length];
          if ((a[1] <= sy && b[1] > sy) || (b[1] <= sy && a[1] > sy)) xs.push([a[0] + (sy - a[1]) * (b[0] - a[0]) / (b[1] - a[1]), b[1] > a[1] ? 1 : -1]);
        }
        xs.sort((p, q) => p[0] - q[0]);
        let giro = 0, ini = 0;
        for (const [x, d] of xs) {
          if (giro === 0) ini = x;
          giro += d;
          if (giro === 0) {
            const xa = Math.max(0, ini), xb = Math.min(this.w, x);
            for (let px = Math.floor(xa); px < xb; px++) fila[px] += (Math.min(xb, px + 1) - Math.max(xa, px)) / SS;
          }
        }
      }
      for (let x = 0; x < this.w; x++) if (fila[x] > 0) this.pon(x, y, c, Math.min(1, fila[x]));
    }
  }
  // sello metálico: cara con degradado diagonal, borde biselado y, si es el más reciente, banda de luz
  selloMetal(cx: number, cy: number, R: number, A: RGB, reciente = false) {
    const B: RGB = [255, 255, 255], N: RGB = [0, 0, 0];
    const claro = mix(A, B, 0.55), luz = mix(A, B, reciente ? 0.9 : 0.5), oscuro = mix(A, N, 0.4), surco = mix(A, N, 0.55);
    const cara: [number, RGB][] = [[0, claro], [0.3, A], [0.47, luz], [0.6, A], [1, oscuro]];
    const rampa = (t: number): RGB => {
      for (let i = 1; i < cara.length; i++) if (t <= cara[i][0]) return mix(cara[i - 1][1], cara[i][1], (t - cara[i - 1][0]) / (cara[i][0] - cara[i - 1][0]));
      return oscuro;
    };
    const rc = R * 0.86, gs = Math.max(1, R * 0.035);
    for (let y = Math.max(0, Math.floor(cy - R - 1)); y < Math.min(this.h, Math.ceil(cy + R + 1)); y++)
      for (let x = Math.max(0, Math.floor(cx - R - 1)); x < Math.min(this.w, Math.ceil(cx + R + 1)); x++) {
        const dx = x + 0.5 - cx, dy = y + 0.5 - cy, d = Math.hypot(dx, dy), cob = Math.max(0, Math.min(1, R - d + 0.5));
        if (cob <= 0) continue;
        const t = Math.max(0, Math.min(1, ((dx + dy) / (R * Math.SQRT2) + 1) / 2));
        // borde: luz arriba-izquierda, sombra abajo-derecha (relieve); cara: degradado con banda clara
        let c = d > rc ? mix(mix(A, B, 0.78), oscuro, t) : rampa(t);
        const s = Math.max(0, 1 - Math.abs(d - rc) / gs);
        if (s > 0) c = mix(c, surco, s * 0.55);
        this.pon(x, y, c, cob);
      }
  }
  // resplandor suave alrededor del sello más reciente
  halo(cx: number, cy: number, R: number, c: RGB, alcance = 0.3, fuerza = 0.5) {
    const Rm = R * (1 + alcance);
    for (let y = Math.max(0, Math.floor(cy - Rm)); y < Math.min(this.h, Math.ceil(cy + Rm)); y++)
      for (let x = Math.max(0, Math.floor(cx - Rm)); x < Math.min(this.w, Math.ceil(cx + Rm)); x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d < R - 1 || d > Rm) continue;
        const f = 1 - Math.max(0, d - R) / (Rm - R);
        this.pon(x, y, c, f * f * fuerza);
      }
  }
  // destello de 4 puntas
  destello(cx: number, cy: number, r: number, c: RGB) {
    const pts: number[][] = [];
    for (let i = 0; i < 8; i++) { const a = (i * Math.PI) / 4, q = i % 2 ? r * 0.2 : r; pts.push([cx + Math.sin(a) * q, cy - Math.cos(a) * q]); }
    this.poligonos([pts], c);
  }
  // pega una imagen RGBA escalada (bilineal al agrandar, promedio por área al reducir) respetando su transparencia
  imagen(src: Uint8Array, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number) {
    const fx = sw / dw, fy = sh / dh, X = Math.round(dx), Y = Math.round(dy);
    const px = (x: number, y: number) => (Math.max(0, Math.min(sh - 1, y)) * sw + Math.max(0, Math.min(sw - 1, x))) * 4;
    for (let y = 0; y < dh; y++) for (let x = 0; x < dw; x++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      if (fx <= 1 && fy <= 1) {
        const ux = (x + 0.5) * fx - 0.5, uy = (y + 0.5) * fy - 0.5, x0 = Math.floor(ux), y0 = Math.floor(uy), tx = ux - x0, ty = uy - y0;
        for (const [xx, yy, w] of [[x0, y0, (1 - tx) * (1 - ty)], [x0 + 1, y0, tx * (1 - ty)], [x0, y0 + 1, (1 - tx) * ty], [x0 + 1, y0 + 1, tx * ty]]) {
          const i = px(xx, yy), al = src[i + 3] * w; r += src[i] * al; g += src[i + 1] * al; b += src[i + 2] * al; a += al;
        }
        n = 1;
      } else {
        const x0 = Math.floor(x * fx), x1 = Math.max(x0 + 1, Math.floor((x + 1) * fx)), y0 = Math.floor(y * fy), y1 = Math.max(y0 + 1, Math.floor((y + 1) * fy));
        for (let yy = y0; yy < y1 && yy < sh; yy++) for (let xx = x0; xx < x1 && xx < sw; xx++) { const i = (yy * sw + xx) * 4, al = src[i + 3]; r += src[i] * al; g += src[i + 1] * al; b += src[i + 2] * al; a += al; n++; }
      }
      if (a > 0 && n > 0) this.pon(X + x, Y + y, [Math.round(r / a), Math.round(g / a), Math.round(b / a)], a / n / 255);
    }
  }
  // regalo (premio): caja, tapa, cinta y lazo
  regalo(cx: number, cy0: number, r: number, c: RGB, fondo: RGB) {
    const u = r, cy = cy0 + 0.05 * u;
    this.cuadroRedondo(cx - 0.40 * u, cy - 0.05 * u, 0.80 * u, 0.50 * u, 0.07 * u, c);
    this.cuadroRedondo(cx - 0.48 * u, cy - 0.27 * u, 0.96 * u, 0.24 * u, 0.07 * u, c);
    this.linea(cx, cy - 0.27 * u, cx, cy + 0.45 * u, 0.13 * u, fondo);
    this.aro(cx - 0.17 * u, cy - 0.40 * u, 0.15 * u, 0.07 * u, c);
    this.aro(cx + 0.17 * u, cy - 0.40 * u, 0.15 * u, 0.07 * u, c);
  }
  png(): Uint8Array {
    const raw = new Uint8Array((this.w * 4 + 1) * this.h);
    for (let y = 0; y < this.h; y++) {
      raw[y * (this.w * 4 + 1)] = 0;
      raw.set(this.px.subarray(y * this.w * 4, (y + 1) * this.w * 4), y * (this.w * 4 + 1) + 1);
    }
    const ihdr = new Uint8Array(13), dv = new DataView(ihdr.buffer);
    dv.setUint32(0, this.w); dv.setUint32(4, this.h); ihdr.set([8, 6, 0, 0, 0], 8);
    const partes = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlibSync(raw, { level: 9 })), chunk("IEND", new Uint8Array(0))];
    const out = new Uint8Array(partes.reduce((s, p) => s + p.length, 0));
    let o = 0; for (const p of partes) { out.set(p, o); o += p.length; }
    return out;
  }
}

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(b: Uint8Array) { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(tipo: string, data: Uint8Array) {
  const out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = tipo.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Texto opcional de la franja: título pequeño + premio (hasta 2 líneas), dibujados con la fuente de la marca. */
// deno-lint-ignore no-explicit-any
export type TextoFranja = { fuente: any; titulo: string; premio: string } | null;

/** Franja de sellos: fondo del color de la tarjeta, premio escrito arriba, sellos ganados con acabado metálico (el más reciente brilla) y el último con un regalo. */
/** `base` es el tamaño «en puntos» sobre el que se compone (iPhone: 375 × 144; Google usa uno más chico para que todo salga más grande). */
export type OpFranja = { base?: [number, number]; margen?: number };
export function franjaSellos(sellos: number, meta: number, primario: string, acento: string, w: number, h: number, txt: TextoFranja = null, op: OpFranja = {}): Uint8Array {
  const [BW, BH] = op.base ?? [375, 144];
  const P = hexRGB(primario), A = hexRGB(acento, [249, 180, 15]);
  const L = new Lienzo(w, h, P);
  meta = Math.max(1, Math.min(20, meta));
  const k = Math.min(w / BW, h / BH), anchoPt = w / k;              // todo se mide en «puntos» de una franja de BW × BH
  const filas = meta > 10 ? 2 : 1, porFila = Math.ceil(meta / filas);
  const margen = op.margen ?? 19, hueco = 8;
  // texto
  let titulo = "", lineas: string[] = [], tam = 17;
  if (txt?.fuente) {
    titulo = limpiar(txt.fuente, txt.titulo.toUpperCase());
    const premio = limpiar(txt.fuente, txt.premio);
    if (premio) {
      const max = Math.min(anchoPt - 2 * margen, 420);
      // 1 línea si cabe (18 → 15 pt); si no, 2 líneas a 15 pt; si aún no cabe, 2 líneas a 13 pt con «…»
      tam = 18; while (tam > 15 && ancho(txt.fuente, premio, tam) > max) tam--;
      if (ancho(txt.fuente, premio, tam) <= max) lineas = [premio];
      else { tam = 15; lineas = partir(txt.fuente, premio, tam, max, 3); if (lineas.length > 2) { tam = 13; lineas = partir(txt.fuente, premio, tam, max, 2); } }
    }
  }
  const altoTitulo = titulo ? 9 : 0, interlinea = tam * 1.12, altoTexto = lineas.length ? lineas.length * interlinea : 0;
  const altoCabecera = (titulo ? altoTitulo + 8 : 0) + (lineas.length ? altoTexto + 6 : 0);
  const dMax = (anchoPt - 2 * margen - hueco * (porFila - 1)) / porFila;
  const d = Math.min(dMax, 50, (BH - 22 - altoCabecera - (filas - 1) * hueco) / filas), r = d / 2;
  const altoSellos = filas * d + (filas - 1) * hueco;
  let y = (BH - (altoCabecera + altoSellos)) / 2;
  const tenue = mix(P, A, 0.62), relleno = mix(P, [255, 255, 255], 0.07);
  if (titulo) {
    const t = 10, esp = 0.09, an = ancho(txt!.fuente, titulo, t, esp);
    L.poligonos(contornos(txt!.fuente, titulo, ((anchoPt - an) / 2) * k, (y + altoTitulo) * k, t * k, esp), A);
    y += altoTitulo + 8;
  }
  for (const [i, ln] of lineas.entries()) {
    const an = ancho(txt!.fuente, ln, tam);
    L.poligonos(contornos(txt!.fuente, ln, ((anchoPt - an) / 2) * k, (y + i * interlinea + tam * 0.80) * k, tam * k), [255, 255, 255]);
  }
  if (lineas.length) y += altoTexto + 6;
  for (let i = 0; i < meta; i++) {
    const fila = Math.floor(i / porFila), col = i % porFila, enFila = Math.min(porFila, meta - fila * porFila);
    const anchoFila = enFila * d + (enFila - 1) * hueco;
    const cx = ((anchoPt - anchoFila) / 2 + col * (d + hueco) + r) * k, cy = (y + fila * (d + hueco) + r) * k, R = r * k;
    const ultimo = i === meta - 1;
    if (i < sellos) {
      const reciente = i === sellos - 1, relieve = mix(A, [255, 255, 255], 0.6), dz = Math.max(1, R * 0.05);
      if (reciente) L.halo(cx, cy, R, mix(A, [255, 255, 255], 0.35));
      L.selloMetal(cx, cy, R, A, reciente);
      // marca con relieve: primero su reflejo claro, corrido un poco hacia abajo, y encima la marca oscura
      if (ultimo) L.regalo(cx, cy + dz, R * 0.86, relieve, relieve); else L.check(cx, cy + dz, R * 0.86, relieve);
      if (ultimo) L.regalo(cx, cy, R * 0.86, P, mix(A, [255, 255, 255], 0.2)); else L.check(cx, cy, R * 0.86, P);
      if (reciente) { L.destello(cx + R * 0.68, cy - R * 0.7, R * 0.4, [255, 255, 255]); L.destello(cx - R * 0.78, cy + R * 0.6, R * 0.22, [255, 255, 255]); }
    }
    else { L.circulo(cx, cy, R, relleno); L.aro(cx, cy, R, Math.max(2, R * 0.09), tenue); if (ultimo) L.regalo(cx, cy, R, tenue, relleno); }
  }
  return L.png();
}

/** Ícono cuadrado: fondo del negocio con un sello. */
export function icono(primario: string, acento: string, lado: number, redondo = false): Uint8Array {
  const P = hexRGB(primario), A = hexRGB(acento, [249, 180, 15]);
  const L = new Lienzo(lado, lado, redondo ? null : P);
  if (redondo) L.circulo(lado / 2, lado / 2, lado / 2, P);
  const r = lado * 0.3;
  L.circulo(lado / 2, lado / 2, r, A);
  L.check(lado / 2, lado / 2, r, P);
  return L.png();
}

/** Logo del negocio sobre el color de su tarjeta (Google Wallet recorta el logo en círculo y pone fondo blanco a lo transparente). */
export function marcaSobreFondo(rgba: Uint8Array, lw: number, lh: number, primario: string, ancho: boolean): Uint8Array {
  const P = hexRGB(primario), W = ancho ? 960 : 660, H = ancho ? 300 : 660;
  const L = new Lienzo(W, H, P);
  const esc = ancho ? Math.min((H - 40) / lh, (W - 20) / lw) : Math.min((W * 0.74) / lw, (H * 0.74) / lh);
  const dw = Math.round(lw * esc), dh = Math.round(lh * esc);
  L.imagen(rgba, lw, lh, ancho ? 10 : (W - dw) / 2, (H - dh) / 2, dw, dh);
  return L.png();
}

/** Logo de texto no se dibuja: si el negocio no tiene logo PNG, el pase usa logoText. */
export { Lienzo };
