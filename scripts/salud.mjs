// Chequeo de salud diario de YA! VOLVERÁS...
const SITE = 'https://yavolveras.com/';
const SB = 'https://ildmschqezgtkoeokcja.supabase.co';
const KEY = 'sb_publishable_OX_eva6RkRAN0uqUfuZLOg_bnn8wT_k';
const fallos = [];
try {
  const r = await fetch(SITE, { redirect: 'follow' });
  const html = await r.text();
  if (r.status !== 200) fallos.push(`Sitio respondió ${r.status}`);
  if (!html.includes('VOLVERÁS')) fallos.push('El sitio no muestra la app');
} catch (e) { fallos.push('Sitio no responde: ' + e.message); }
try {
  const r = await fetch(`${SB}/rest/v1/rpc/tarjeta_por_token`, { method: 'POST', headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ p_token: 'chequeo-salud' }) });
  const txt = await r.text();
  if (!txt.includes('Tarjeta no encontrada')) fallos.push(`Base de datos respondió distinto (${r.status}): ${txt.slice(0, 120)}`);
} catch (e) { fallos.push('Base de datos no responde: ' + e.message); }
if (fallos.length) { console.error('FALLAS:\n- ' + fallos.join('\n- ')); process.exit(1); }
console.log('OK · sitio y base de datos responden · ' + new Date().toISOString());
