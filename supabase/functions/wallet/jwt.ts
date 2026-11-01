// Firma JWT RS256 (Google Wallet)
export const b64url = (b: Uint8Array | string) => {
  const s = typeof b === "string" ? btoa(unescape(encodeURIComponent(b))) : btoa(String.fromCharCode(...b));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export async function firmarRS256(pem: string, encabezado: object, cuerpo: object) {
  const der = Uint8Array.from(atob(pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "")), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const datosFirma = `${b64url(JSON.stringify(encabezado))}.${b64url(JSON.stringify(cuerpo))}`;
  const firma = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(datosFirma)));
  return `${datosFirma}.${b64url(firma)}`;
}
