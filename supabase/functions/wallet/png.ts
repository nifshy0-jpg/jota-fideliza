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

/** Franja de sellos: fondo del color de la tarjeta, premio escrito arriba, sellos ganados llenos y el último con un regalo. */
export function franjaSellos(sellos: number, meta: number, primario: string, acento: string, w: number, h: number, txt: TextoFranja = null): Uint8Array {
  const P = hexRGB(primario), A = hexRGB(acento, [249, 180, 15]);
  const L = new Lienzo(w, h, P);
  meta = Math.max(1, Math.min(20, meta));
  const k = Math.min(w / 375, h / 144), anchoPt = w / k;            // todo se mide en «puntos» de una franja de 375 × 144
  const filas = meta > 10 ? 2 : 1, porFila = Math.ceil(meta / filas);
  const margen = 19, hueco = 8;
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
  const d = Math.min(dMax, 50, (144 - 22 - altoCabecera - (filas - 1) * hueco) / filas), r = d / 2;
  const altoSellos = filas * d + (filas - 1) * hueco;
  let y = (144 - (altoCabecera + altoSellos)) / 2;
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
    if (i < sellos) { L.circulo(cx, cy, R, A); if (ultimo) L.regalo(cx, cy, R, P, A); else L.check(cx, cy, R, P); }
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

/** Logo de texto no se dibuja: si el negocio no tiene logo PNG, el pase usa logoText. */
export { Lienzo };
