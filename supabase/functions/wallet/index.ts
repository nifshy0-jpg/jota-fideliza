// YA! VOLVERÁS... · Tarjeta de sellos en Apple Wallet y Google Wallet
// Rutas (prefijo /functions/v1/wallet):
//   GET  /estado                 → { apple, google } según las credenciales cargadas
//   GET  /google?t=TOKEN         → redirige a "Guardar en Google Wallet"
//   GET  /apple?t=TOKEN          → descarga el .pkpass
//   GET  /img/sellos?s=&m=&p=&a=&w=&h=   → PNG de la franja de sellos
//   GET  /img/icono?p=&a=&l=     → PNG del ícono
//   GET  /img/logo/:negocioId    → logo del negocio
//   POST /sync                   → (desde la base) actualiza tarjetas guardadas
//   /apple-ws/v1/...             → servicio web de Apple Wallet (registro y actualización)
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import forge from "npm:node-forge@1.3.1";
import { zipSync, strToU8 } from "npm:fflate@0.8.2";
import { franjaSellos, icono, hexRGB } from "./png.ts";
import { firmarRS256 } from "./jwt.ts";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const BASE_WEB = "https://yavolveras.com/";
const FN_URL = `${SB_URL}/functions/v1/wallet`;
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type, apikey, x-client-info" };

// ---------- utilidades ----------
async function rpc(fn: string, args: Record<string, unknown> = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, {
    method: "POST", body: JSON.stringify(args),
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
  });
  if (!r.ok) throw new Error(`${fn}: ${r.status} ${await r.text()}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
let _cfg: { v: Record<string, string>; t: number } | null = null;
async function cfg(): Promise<Record<string, string>> {
  if (_cfg && Date.now() - _cfg.t < 60_000) return _cfg.v;
  _cfg = { v: (await rpc("wallet_config")) || {}, t: Date.now() };
  return _cfg.v;
}
const appleListo = (c: Record<string, string>) => !!(c.wallet_apple_pass_type_id && c.wallet_apple_team_id && c.wallet_apple_cert_pem && c.wallet_apple_key_pem);
const googleListo = (c: Record<string, string>) => !!(c.wallet_google_issuer_id && c.wallet_google_sa);

const json = (o: unknown, status = 200, h: Record<string, string> = {}) =>
  new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json", ...h } });
const txt = (t: string, status: number) => new Response([101, 204, 205, 304].includes(status) || !t ? null : t, { status, headers: CORS });
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
async function sha1(b: Uint8Array) { return hex(await crypto.subtle.digest("SHA-1", b)); }
async function hmac(secreto: string, msg: string) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg))).slice(0, 40);
}
const ddmm = (d: string) => new Date(d).toLocaleDateString("es-PE", { day: "2-digit", month: "2-digit", timeZone: "America/Lima" });
const soles = (n: number) => "S/ " + Number(n || 0).toFixed(2);
const rgb = (h: string) => { const [r, g, b] = hexRGB(h); return `rgb(${r}, ${g}, ${b})`; };
const sinHash = (h: string) => (h || "").replace("#", "");
const linkWeb = (tok: string) => `${BASE_WEB}?t=${tok}`;

type Estado = {
  cliente: { id: string; nombre: string; token: string };
  negocio: { id: string; nombre: string; logo_url: string | null; color_primario: string; color_acento: string; monto_minimo: number; meta_sellos: number; premio: string; premio_vigencia_dias: number; direccion: string | null };
  sellos: number; meta: number; premio_disponible: { id: string; descripcion: string; vence_en: string } | null;
  mod: string; activo: boolean; whatsapp: string | null;
  ubicacion?: { lat: number; lng: number } | null; aviso?: { texto: string; en: string } | null;
};
// Texto que el iPhone muestra en la pantalla bloqueada cuando el cliente pasa cerca del local
function textoCercania(e: Estado) {
  const n = e.negocio.nombre, p = e.premio_disponible, faltan = e.meta - e.sellos;
  if (p) return `Tu premio te espera en ${n}: ${p.descripcion} 🎁`;
  if (e.sellos > 0 && faltan > 0) return `¡Te faltan ${faltan} sello${faltan === 1 ? "" : "s"} para tu premio! Pasa por ${n}`;
  return `Estás cerca de ${n} 🍗 Suma tu sello de hoy`;
}
const ubicaciones = (e: Estado) => e.ubicacion ? [{ latitude: e.ubicacion.lat, longitude: e.ubicacion.lng }] : undefined;
const datos = (args: { p_token?: string; p_cliente_id?: string }) => rpc("wallet_datos", args) as Promise<Estado | null>;

function imgSellosURL(e: Estado, w: number, h: number) {
  const n = e.negocio;
  return `${FN_URL}/img/sellos?s=${e.sellos}&m=${e.meta}&p=${sinHash(n.color_primario)}&a=${sinHash(n.color_acento)}&w=${w}&h=${h}`;
}
function logoInfo(dataUrl: string | null): { mime: string; bytes: Uint8Array } | null {
  const m = /^data:(image\/[a-z+.-]+);base64,(.+)$/i.exec(dataUrl || "");
  if (!m) return null;
  const bin = atob(m[2]); const u = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
  return { mime: m[1].toLowerCase(), bytes: u };
}
async function huellaLogo(n: Estado["negocio"]) { return n.logo_url ? (await sha1(new TextEncoder().encode(n.logo_url))).slice(0, 10) : "0"; }

// ================= GOOGLE WALLET =================
let _gtoken: { v: string; t: number } | null = null;
async function googleToken(sa: { client_email: string; private_key: string }) {
  if (_gtoken && Date.now() - _gtoken.t < 50 * 60_000) return _gtoken.v;
  const ahora = Math.floor(Date.now() / 1000);
  const jwt = await firmarRS256(sa.private_key, { alg: "RS256", typ: "JWT" }, {
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/wallet_object.issuer",
    aud: "https://oauth2.googleapis.com/token", iat: ahora, exp: ahora + 3600,
  });
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const j = await r.json();
  if (!j.access_token) throw new Error("Google OAuth: " + JSON.stringify(j));
  _gtoken = { v: j.access_token, t: Date.now() };
  return j.access_token as string;
}
const G_API = "https://walletobjects.googleapis.com/walletobjects/v1";
async function gApi(c: Record<string, string>, metodo: string, ruta: string, cuerpo?: unknown) {
  const sa = JSON.parse(c.wallet_google_sa);
  return fetch(`${G_API}${ruta}`, {
    method: metodo, body: cuerpo ? JSON.stringify(cuerpo) : undefined,
    headers: { Authorization: `Bearer ${await googleToken(sa)}`, "Content-Type": "application/json" },
  });
}
const gClaseId = (c: Record<string, string>, negocioId: string) => `${c.wallet_google_issuer_id}.yv_${negocioId.replace(/-/g, "")}`;
const gObjetoId = (c: Record<string, string>, clienteId: string) => `${c.wallet_google_issuer_id}.c_${clienteId.replace(/-/g, "")}`;
const es = (v: string) => ({ defaultValue: { language: "es-PE", value: v } });

async function gClase(c: Record<string, string>, e: Estado) {
  const n = e.negocio;
  const logo = n.logo_url ? `${FN_URL}/img/logo/${n.id}?v=${await huellaLogo(n)}` : `${FN_URL}/img/icono?p=${sinHash(n.color_primario)}&a=${sinHash(n.color_acento)}&l=660&r=1`;
  return {
    id: gClaseId(c, n.id),
    issuerName: n.nombre.slice(0, 20),
    localizedIssuerName: es(n.nombre.slice(0, 20)),
    programName: "Tarjeta de sellos",
    localizedProgramName: es("Tarjeta de sellos"),
    programLogo: { sourceUri: { uri: logo }, contentDescription: es(n.nombre) },
    hexBackgroundColor: n.color_primario,
    countryCode: "PE",
    reviewStatus: "UNDER_REVIEW",
    multipleDevicesAndHoldersAllowedStatus: "ONE_USER_ALL_DEVICES",
    ...(ubicaciones(e) ? { merchantLocations: ubicaciones(e) } : {}),
  };
}
function gObjeto(c: Record<string, string>, e: Estado) {
  const n = e.negocio, p = e.premio_disponible, link = linkWeb(e.cliente.token);
  const o: Record<string, unknown> = {
    id: gObjetoId(c, e.cliente.id), classId: gClaseId(c, n.id), state: "ACTIVE",
    accountName: e.cliente.nombre, accountId: e.cliente.token.slice(0, 8).toUpperCase(),
    loyaltyPoints: { label: "Sellos", balance: { string: `${e.sellos} de ${e.meta}` } },
    barcode: { type: "QR_CODE", value: link, alternateText: e.cliente.token.slice(0, 8).toUpperCase() },
    heroImage: { sourceUri: { uri: imgSellosURL(e, 1032, 336) }, contentDescription: es(`${e.sellos} de ${e.meta} sellos`) },
    textModulesData: [
      p ? { id: "premio", header: "¡Tu premio está listo!", body: `${p.descripcion} · vence el ${ddmm(p.vence_en)}. Muéstralo en caja.` }
        : { id: "premio", header: `Tu premio al completar ${e.meta} sellos`, body: n.premio },
      { id: "reglas", header: "Cómo funciona", body: `1 sello al día con compra desde ${soles(n.monto_minimo)}. El premio vence a los ${n.premio_vigencia_dias} días.` },
    ],
    linksModuleData: { uris: [{ id: "web", uri: link, description: "Ver mi tarjeta" }] },
  };
  if (p) o.secondaryLoyaltyPoints = { label: "Premio", balance: { string: "¡Listo!" } };
  if (ubicaciones(e)) o.merchantLocations = ubicaciones(e);
  if (!e.activo) o.state = "INACTIVE";
  return o;
}
async function gGuardar(c: Record<string, string>, clase: Record<string, unknown>, ruta: "loyaltyClass" | "loyaltyObject") {
  const id = encodeURIComponent(String(clase.id));
  let r = await gApi(c, "PUT", `/${ruta}/${id}`, clase);
  if (r.status === 404) r = await gApi(c, "POST", `/${ruta}`, clase);
  if (!r.ok) throw new Error(`Google ${ruta} ${r.status}: ${await r.text()}`);
}
async function googleGuardarURL(c: Record<string, string>, e: Estado) {
  await gGuardar(c, await gClase(c, e), "loyaltyClass");
  const obj = gObjeto(c, e);
  await gGuardar(c, obj, "loyaltyObject");
  await rpc("wallet_marcar_google", { p_cliente_id: e.cliente.id });
  const sa = JSON.parse(c.wallet_google_sa);
  const jwt = await firmarRS256(sa.private_key, { alg: "RS256", typ: "JWT" }, {
    iss: sa.client_email, aud: "google", typ: "savetowallet", origins: ["https://yavolveras.com"],
    payload: { loyaltyObjects: [{ id: obj.id, classId: obj.classId }] },
  });
  return `https://pay.google.com/gp/v/save/${jwt}`;
}

// ================= APPLE WALLET =================
let _wwdr: string | null = null;
async function wwdrPem(c: Record<string, string>) {
  if (c.wallet_apple_wwdr_pem) return c.wallet_apple_wwdr_pem;
  if (_wwdr) return _wwdr;
  const r = await fetch("https://www.apple.com/certificateauthority/AppleWWDRCAG4.cer");
  const der = new Uint8Array(await r.arrayBuffer());
  const cert = forge.pki.certificateFromAsn1(forge.asn1.fromDer(forge.util.binary.raw.encode(der)));
  _wwdr = forge.pki.certificateToPem(cert);
  return _wwdr!;
}
async function authToken(c: Record<string, string>, clienteId: string) { return await hmac(c.wallet_auth_secret, "apple:" + clienteId); }

export async function armarPkpass(c: Record<string, string>, e: Estado, wwdr: string): Promise<Uint8Array> {
  const n = e.negocio, p = e.premio_disponible, link = linkWeb(e.cliente.token);
  const logo = logoInfo(n.logo_url);
  const logoPng = logo && logo.mime === "image/png" ? logo.bytes : null;
  const pass: Record<string, unknown> = {
    formatVersion: 1,
    passTypeIdentifier: c.wallet_apple_pass_type_id,
    teamIdentifier: c.wallet_apple_team_id,
    serialNumber: e.cliente.id,
    authenticationToken: await authToken(c, e.cliente.id),
    webServiceURL: `${FN_URL}/apple-ws`,
    organizationName: n.nombre,
    description: `Tarjeta de sellos de ${n.nombre}`,
    backgroundColor: rgb(n.color_primario),
    foregroundColor: "rgb(255, 255, 255)",
    labelColor: rgb(n.color_acento),
    sharingProhibited: true,
    barcodes: [{ format: "PKBarcodeFormatQR", message: link, messageEncoding: "iso-8859-1", altText: e.cliente.token.slice(0, 8).toUpperCase() }],
    storeCard: {
      headerFields: [{ key: "sellos", label: "SELLOS", value: `${e.sellos}/${e.meta}`, changeMessage: "Llevas %@ sellos" }],
      secondaryFields: [
        { key: "cliente", label: "CLIENTE", value: e.cliente.nombre },
        p ? { key: "premio", label: "PREMIO", value: "¡Listo para canjear!", changeMessage: "Tu premio está %@" }
          : { key: "premio", label: "PREMIO", value: `Al completar ${e.meta}`, changeMessage: "Tu premio está %@" },
      ],
      auxiliaryFields: p ? [{ key: "vence", label: "VENCE", value: ddmm(p.vence_en) }] : [],
      backFields: [
        ...(e.aviso ? [{ key: "aviso", label: "Novedades", value: e.aviso.texto, changeMessage: "%@" }] : []),
        { key: "premio_d", label: p ? "Tu premio" : `Tu premio al completar ${e.meta} sellos`, value: p ? `${p.descripcion}\nVence el ${ddmm(p.vence_en)}. Muéstralo en caja.` : n.premio },
        { key: "reglas", label: "Cómo funciona", value: `1 sello al día con compra desde ${soles(n.monto_minimo)}. El premio vence a los ${n.premio_vigencia_dias} días.` },
        { key: "web", label: "Tu tarjeta en la web", value: link, attributedValue: `<a href='${link}'>Abrir mi tarjeta</a>` },
        ...(n.direccion ? [{ key: "dir", label: "Dirección", value: n.direccion }] : []),
        ...(e.whatsapp ? [{ key: "wa", label: "WhatsApp", value: e.whatsapp }] : []),
        { key: "by", label: "Sistema de fidelización", value: "YA! VOLVERÁS..." },
      ],
    },
  };
  if (!logoPng) pass.logoText = n.nombre;
  if (e.ubicacion) pass.locations = [{ latitude: e.ubicacion.lat, longitude: e.ubicacion.lng, relevantText: textoCercania(e) }];
  if (!e.activo) pass.voided = true;

  const archivos: Record<string, Uint8Array> = {
    "pass.json": strToU8(JSON.stringify(pass)),
    "icon.png": icono(n.color_primario, n.color_acento, 29),
    "icon@2x.png": icono(n.color_primario, n.color_acento, 58),
    "icon@3x.png": icono(n.color_primario, n.color_acento, 87),
    "strip.png": franjaSellos(e.sellos, e.meta, n.color_primario, n.color_acento, 375, 123),
    "strip@2x.png": franjaSellos(e.sellos, e.meta, n.color_primario, n.color_acento, 750, 246),
    "strip@3x.png": franjaSellos(e.sellos, e.meta, n.color_primario, n.color_acento, 1125, 369),
  };
  if (logoPng) { archivos["logo.png"] = logoPng; archivos["logo@2x.png"] = logoPng; }
  const manifest: Record<string, string> = {};
  for (const [k, v] of Object.entries(archivos)) manifest[k] = await sha1(v);
  const manifestStr = JSON.stringify(manifest);
  archivos["manifest.json"] = strToU8(manifestStr);

  // firma PKCS#7 separada con el certificado del Pass Type ID + intermedio WWDR
  const cert = forge.pki.certificateFromPem(c.wallet_apple_cert_pem);
  const key = forge.pki.privateKeyFromPem(c.wallet_apple_key_pem);
  const p7 = forge.pkcs7.createSignedData();
  p7.content = forge.util.createBuffer(manifestStr, "utf8");
  p7.addCertificate(cert);
  p7.addCertificate(forge.pki.certificateFromPem(wwdr));
  p7.addSigner({
    key, certificate: cert, digestAlgorithm: forge.pki.oids.sha256,
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
      { type: forge.pki.oids.signingTime, value: new Date() },
    ],
  });
  p7.sign({ detached: true });
  archivos["signature"] = forge.util.binary.raw.decode(forge.asn1.toDer(p7.toAsn1()).getBytes());
  return zipSync(archivos, { level: 6 });
}
async function respuestaPkpass(c: Record<string, string>, e: Estado) {
  const bytes = await armarPkpass(c, e, await wwdrPem(c));
  return new Response(bytes, {
    headers: {
      ...CORS, "Content-Type": "application/vnd.apple.pkpass",
      "Content-Disposition": `attachment; filename="tarjeta-${e.negocio.nombre.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.pkpass"`,
      "Last-Modified": new Date(e.mod).toUTCString(), "Cache-Control": "no-store",
    },
  });
}

// Avisos push a los iPhone (HTTP/2 con el certificado del pase)
async function applePush(c: Record<string, string>, tokens: string[]) {
  if (!tokens.length) return { enviados: 0 };
  const http2 = await import("node:http2");
  const cliente = http2.connect(Deno.env.get("APNS_HOST") || "https://api.push.apple.com", { cert: c.wallet_apple_cert_pem, key: c.wallet_apple_key_pem });
  const res: string[] = [];
  await Promise.all(tokens.map((t) => new Promise<void>((ok) => {
    const req = cliente.request({ ":method": "POST", ":path": `/3/device/${t}`, "apns-topic": c.wallet_apple_pass_type_id, "content-type": "application/json" });
    req.on("response", (h: Record<string, unknown>) => { res.push(String(h[":status"])); });
    req.on("error", (er: Error) => { res.push("error " + er.message); ok(); });
    req.on("end", () => ok());
    req.on("data", () => {});
    req.end("{}");
  })));
  cliente.close();
  return { enviados: tokens.length, estados: res };
}

async function appleWS(req: Request, partes: string[], c: Record<string, string>) {
  // partes: ["v1", ...]
  const [, tipo, a, , b, d] = partes;
  if (tipo === "log") { try { console.log("Apple Wallet log:", JSON.stringify(await req.json())); } catch { /* */ } return txt("", 200); }
  if (tipo === "devices" && partes[3] === "registrations") {
    const device = a, serial = d;
    if (serial) {
      const auth = (req.headers.get("Authorization") || "").replace(/^ApplePass\s+/i, "");
      if (auth !== await authToken(c, serial)) return txt("", 401);
      if (req.method === "POST") {
        const { pushToken } = await req.json();
        const nuevo = await rpc("wallet_apple_registrar", { p_device: device, p_push: pushToken, p_cliente_id: serial });
        return txt("", nuevo ? 201 : 200);
      }
      if (req.method === "DELETE") { await rpc("wallet_apple_baja", { p_device: device, p_cliente_id: serial }); return txt("", 200); }
    } else if (req.method === "GET" && b) {
      const desde = new URL(req.url).searchParams.get("passesUpdatedSince");
      const r = await rpc("wallet_apple_series", { p_device: device, p_desde: desde ? new Date(Number(desde)).toISOString() : null });
      if (!r.series.length) return txt("", 204);
      return json({ serialNumbers: r.series, lastUpdated: String(new Date(r.ultimo).getTime()) });
    }
  }
  if (tipo === "passes" && req.method === "GET") {
    const serial = b ?? partes[3];
    const auth = (req.headers.get("Authorization") || "").replace(/^ApplePass\s+/i, "");
    if (auth !== await authToken(c, serial)) return txt("", 401);
    const e = await datos({ p_cliente_id: serial });
    if (!e) return txt("", 404);
    const ims = req.headers.get("If-Modified-Since");
    if (ims && Math.floor(new Date(e.mod).getTime() / 1000) <= Math.floor(new Date(ims).getTime() / 1000)) return txt("", 304);
    return respuestaPkpass(c, e);
  }
  return txt("", 404);
}

// ---------- página para cuando algo falla al abrir desde el celular ----------
function paginaError(msg: string, tok = "") {
  // Supabase muestra el HTML de las funciones como texto: mejor volver a la tarjeta web con un aviso.
  return Response.redirect(`${BASE_WEB}?${tok ? `t=${encodeURIComponent(tok)}&` : ""}aviso=${encodeURIComponent(msg)}`, 302);
}

// ================= SERVIDOR =================
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: { ...CORS, "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS" } });
  const url = new URL(req.url);
  const partes = url.pathname.replace(/^.*?\/wallet\/?/, "").split("/").filter(Boolean);
  try {
    const c = await cfg();
    switch (partes[0]) {
      case "estado":
        return json({ apple: appleListo(c), google: googleListo(c) }, 200, { "Cache-Control": "public, max-age=300" });

      case "img": {
        const q = url.searchParams, num = (k: string, d: number, max: number) => Math.max(1, Math.min(max, parseInt(q.get(k) || "") || d));
        let png: Uint8Array;
        if (partes[1] === "sellos") png = franjaSellos(Math.max(0, Math.min(20, parseInt(q.get("s") || "0") || 0)), num("m", 6, 20),"#" + (q.get("p") || "460E0D"), "#" + (q.get("a") || "F9B40F"), num("w", 1032, 1200), num("h", 336, 600));
        else if (partes[1] === "icono") png = icono("#" + (q.get("p") || "460E0D"), "#" + (q.get("a") || "F9B40F"), num("l", 660, 800), q.get("r") === "1");
        else if (partes[1] === "logo" && partes[2]) {
          const l = logoInfo(await rpc("wallet_logo", { p_negocio_id: partes[2] }));
          if (!l) return txt("", 404);
          return new Response(l.bytes, { headers: { ...CORS, "Content-Type": l.mime, "Cache-Control": "public, max-age=31536000, immutable" } });
        } else return txt("", 404);
        return new Response(png, { headers: { ...CORS, "Content-Type": "image/png", "Cache-Control": "public, max-age=31536000, immutable" } });
      }

      case "google": {
        const tok = url.searchParams.get("t") || "";
        if (!googleListo(c)) return paginaError("Google Wallet todavía no está activado.", tok);
        const e = await datos({ p_token: tok });
        if (!e) return paginaError("Tarjeta no encontrada.");
        return Response.redirect(await googleGuardarURL(c, e), 302);
      }

      case "apple": {
        const tok = url.searchParams.get("t") || "";
        if (!appleListo(c)) return paginaError("Apple Wallet todavía no está activado.", tok);
        const e = await datos({ p_token: tok });
        if (!e) return paginaError("Tarjeta no encontrada.");
        return respuestaPkpass(c, e);
      }

      case "apple-ws":
        if (!appleListo(c)) return txt("", 503);
        return appleWS(req, partes.slice(1), c);

      case "sync": {
        if (req.method !== "POST" || req.headers.get("x-sync-secret") !== c.wallet_sync_secret) return txt("", 401);
        const { cliente_id, negocio_id, mensaje } = await req.json();
        const out: Record<string, unknown> = {};
        // Google: actualizar objeto(s) guardado(s)
        if (googleListo(c)) {
          const ids: string[] = cliente_id ? [cliente_id] : await rpc("wallet_google_clientes", { p_negocio_id: negocio_id });
          let ok = 0, primera = true;
          for (const id of ids) {
            const e = await datos({ p_cliente_id: id });
            if (!e) continue;
            if (negocio_id && primera) { await gGuardar(c, await gClase(c, e), "loyaltyClass"); primera = false; }
            const r = await gApi(c, "PATCH", `/loyaltyObject/${encodeURIComponent(gObjetoId(c, id))}`, gObjeto(c, e));
            if (r.ok) ok++;
            // Aviso con notificación (Google permite 3 por tarjeta al día; si se pasa, queda como mensaje sin notificar)
            if (r.ok && mensaje && cliente_id) {
              const msj = (tipo: string) => ({ message: { id: `${mensaje.id}_${Date.now()}`, header: mensaje.header, body: mensaje.body, messageType: tipo } });
              const ruta = `/loyaltyObject/${encodeURIComponent(gObjetoId(c, id))}/addMessage`;
              let m = await gApi(c, "POST", ruta, msj("TEXT_AND_NOTIFY"));
              if (!m.ok) m = await gApi(c, "POST", ruta, msj("TEXT"));
              out.mensaje = m.ok;
            }
          }
          out.google = ok;
        }
        // Apple: aviso push a los iPhone registrados
        if (appleListo(c)) {
          const tokens: string[] = await rpc("wallet_apple_tokens", { p_cliente_id: cliente_id ?? null, p_negocio_id: negocio_id ?? null });
          out.apple = await applePush(c, tokens);
        }
        return json(out);
      }
    }
    return txt("", 404);
  } catch (err) {
    console.error("wallet error:", err);
    if (partes[0] === "google" || partes[0] === "apple") return paginaError("No se pudo preparar tu tarjeta para el Wallet. Intenta de nuevo en un momento.", url.searchParams.get("t") || "");
    return json({ error: String((err as Error).message || err) }, 500);
  }
});
