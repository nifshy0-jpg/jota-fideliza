// Texto para las imágenes del Wallet: lee la fuente de la marca (Baloo 2) y convierte letras en contornos.
import opentype from "npm:opentype.js@1.3.4";

// deno-lint-ignore no-explicit-any
type Fuente = any;
const URL_FUENTE = "https://yavolveras.com/fuentes/baloo2-700.woff";
let _fuente: Fuente | null = null, _intento = 0;

export async function cargarFuente(bytes?: ArrayBuffer): Promise<Fuente | null> {
  if (bytes) { _fuente = opentype.parse(bytes); return _fuente; }
  if (_fuente) return _fuente;
  if (Date.now() - _intento < 60_000) return null; // si falló, no reintenta en cada pedido
  _intento = Date.now();
  try {
    const r = await fetch(URL_FUENTE);
    if (!r.ok) throw new Error("fuente " + r.status);
    _fuente = opentype.parse(await r.arrayBuffer());
  } catch (e) { console.error("No se pudo cargar la fuente:", e); _fuente = null; }
  return _fuente;
}

/** Quita lo que la fuente no puede dibujar (emojis, símbolos raros). */
export function limpiar(f: Fuente, t: string) {
  return [...(t || "")].filter((c) => c === " " || f.charToGlyphIndex(c) > 0).join("").replace(/\s+/g, " ").trim();
}
export function ancho(f: Fuente, t: string, tam: number, espaciado = 0) {
  return f.getAdvanceWidth(t, tam) + espaciado * tam * Math.max(0, [...t].length - 1);
}

/** Contornos (polígonos) de un texto, con la línea base en (x, y). */
export function contornos(f: Fuente, t: string, x: number, y: number, tam: number, espaciado = 0): number[][][] {
  const out: number[][][] = [];
  const agrega = (txt: string, px: number) => {
    let act: number[][] = [], cx = 0, cy = 0;
    const curva = (p: (s: number) => [number, number]) => { for (let i = 1; i <= 8; i++) act.push(p(i / 8)); };
    for (const c of f.getPath(txt, px, y, tam).commands) {
      if (c.type === "M") { if (act.length > 2) out.push(act); act = [[c.x, c.y]]; }
      else if (c.type === "L") act.push([c.x, c.y]);
      else if (c.type === "Q") { const x0 = cx, y0 = cy; curva((s) => [(1 - s) * (1 - s) * x0 + 2 * (1 - s) * s * c.x1 + s * s * c.x, (1 - s) * (1 - s) * y0 + 2 * (1 - s) * s * c.y1 + s * s * c.y]); }
      else if (c.type === "C") { const x0 = cx, y0 = cy; curva((s) => { const a = (1 - s) ** 3, b = 3 * (1 - s) ** 2 * s, d = 3 * (1 - s) * s * s, e = s ** 3; return [a * x0 + b * c.x1 + d * c.x2 + e * c.x, a * y0 + b * c.y1 + d * c.y2 + e * c.y]; }); }
      else if (c.type === "Z") { if (act.length > 2) out.push(act); act = []; }
      if (c.type !== "Z") { cx = c.x; cy = c.y; }
    }
    if (act.length > 2) out.push(act);
  };
  if (!espaciado) agrega(t, x);
  else { let px = x; for (const ch of [...t]) { agrega(ch, px); px += f.getAdvanceWidth(ch, tam) + espaciado * tam; } }
  return out;
}

/** Parte un texto en hasta `maxLineas` líneas que quepan en `anchoMax`; si no cabe, corta con «…». */
export function partir(f: Fuente, t: string, tam: number, anchoMax: number, maxLineas: number): string[] {
  const palabras = t.split(" "), lineas: string[] = [];
  let act = "";
  for (const p of palabras) {
    const prueba = act ? act + " " + p : p;
    if (ancho(f, prueba, tam) <= anchoMax || !act) act = prueba;
    else { lineas.push(act); act = p; }
  }
  if (act) lineas.push(act);
  if (lineas.length > maxLineas) {
    let ult = lineas.slice(maxLineas - 1).join(" ");
    while (ult.length > 1 && ancho(f, ult + "…", tam) > anchoMax) ult = ult.slice(0, -1).trimEnd();
    lineas.length = maxLineas - 1; lineas.push(ult + "…");
  }
  return lineas;
}
