// YA! VOLVERÁS... · Aviso a los iPhone para que actualicen su tarjeta del Wallet (APNs con el certificado del pase).
// POST /functions/v1/apns  { cliente_id | negocio_id }  con cabecera x-sync-secret (lo llama la base de datos).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
async function rpc(fn: string, args: Record<string, unknown> = {}) {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${fn}`, { method: "POST", body: JSON.stringify(args), headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" } });
  if (!r.ok) throw new Error(`${fn}: ${r.status} ${await r.text()}`);
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
const HOST = "https://api.push.apple.com";

Deno.serve(async (req) => {
  try {
    const c = await rpc("wallet_config");
    if (req.method !== "POST" || req.headers.get("x-sync-secret") !== c.wallet_sync_secret) return new Response("", { status: 401 });
    if (!(c.wallet_apple_cert_pem && c.wallet_apple_key_pem && c.wallet_apple_pass_type_id)) return Response.json({ apple: false });
    const { cliente_id, negocio_id } = await req.json();
    const filas: { push: string; negocio_id: string }[] = await rpc("wallet_apple_tokens_negocio", { p_cliente_id: cliente_id ?? null, p_negocio_id: negocio_id ?? null });
    const out = { tokens: filas.length, ok: 0, bajas: 0, errores: [] as string[] };
    if (!filas.length) return Response.json(out);
    // Cada negocio puede tener su propio Pass Type ID (secretos «…__<id del negocio>»); si no, se usa el general.
    const appleDe = (id: string) => { const s = "__" + id;
      return c["wallet_apple_pass_type_id" + s] && c["wallet_apple_cert_pem" + s] && c["wallet_apple_key_pem" + s]
        ? { tipo: c["wallet_apple_pass_type_id" + s] as string, cert: c["wallet_apple_cert_pem" + s] as string, key: c["wallet_apple_key_pem" + s] as string }
        : { tipo: c.wallet_apple_pass_type_id as string, cert: c.wallet_apple_cert_pem as string, key: c.wallet_apple_key_pem as string }; };
    // fetch con certificado de cliente (HTTP/2), uno por Pass Type ID. Los dos pares de nombres cubren versiones nuevas y antiguas de Deno.
    // deno-lint-ignore no-explicit-any
    const clientes = new Map<string, any>();
    const clienteDe = (ap: { tipo: string; cert: string; key: string }) => {
      // deno-lint-ignore no-explicit-any
      if (!clientes.has(ap.tipo)) clientes.set(ap.tipo, (Deno as any).createHttpClient({ cert: ap.cert, key: ap.key, certChain: ap.cert, privateKey: ap.key, http2: true }));
      return clientes.get(ap.tipo);
    };
    const uno = async (f: { push: string; negocio_id: string }) => {
      const t = f.push, ap = appleDe(f.negocio_id);
      try {
        // deno-lint-ignore no-explicit-any
        const r = await fetch(`${HOST}/3/device/${t}`, { method: "POST", body: "{}", headers: { "apns-topic": ap.tipo, "content-type": "application/json" }, client: clienteDe(ap), signal: AbortSignal.timeout(8000) } as any);
        const cuerpo = await r.text();
        if (r.status === 200) out.ok++;
        else if (r.status === 410 || /BadDeviceToken|Unregistered/.test(cuerpo)) { out.bajas++; await rpc("wallet_apple_quitar_token", { p_push: t }); }
        else if (out.errores.length < 5) out.errores.push(`${r.status} ${cuerpo.slice(0, 120)}`);
      } catch (e) { if (out.errores.length < 5) out.errores.push(String(e).slice(0, 160)); }
    };
    for (let i = 0; i < filas.length; i += 20) await Promise.all(filas.slice(i, i + 20).map(uno));
    for (const k of clientes.values()) { try { k.close(); } catch { /* */ } }
    if (out.errores.length) console.error("apns errores:", JSON.stringify(out.errores));
    return Response.json(out);
  } catch (e) { console.error("apns error:", e); return Response.json({ error: String(e) }, { status: 500 }); }
});
