// Arma chacombo/index.html a partir de plantilla.html y de la carta de abajo.
// Uso:  node scripts/web-chacombo/armar.mjs
// Para cambiar un precio o un plato: editar aquí, correr el comando y publicar.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const aqui = dirname(fileURLToPath(import.meta.url));

/* ---------- Datos del negocio (confirmar con el local antes de lanzar) ---------- */
const WHATSAPP = '51934517954';            // número de la carta impresa
const MAPA = 'https://www.google.com/maps/search/?api=1&query=-11.9936041,-77.0156238';
const TARJETA = 'https://yavolveras.com/?n=el-chacombo';

/* ---------- Salsas (nivel de ají 0–4, como en la carta) ---------- */
const SALSAS = [
  ['BBQ', 0, 'Salsa casera dulce con un toque ahumado.'],
  ['Chimichurri', 0, 'Salsa aromática de perejil, ajo, aceite y un toque ácido.'],
  ['Maracuyá', 0, 'Mezcla dulce y ácida con un toque exótico.'],
  ['Crispy', 0, 'Crujiente y dorada, jugosa por dentro.'],
  ['Teriyaki', 0, 'Dulce y salado con jengibre, puro umami.'],
  ['Acevichada', 1, 'Fresca y cítrica con un toque picante.'],
  ['Chalaca', 2, 'Fresca, picante y cítrica con cebolla, ají, culantro y limón.'],
  ['Búfalo', 3, 'Dulce y picante, intensa y equilibrada.'],
  ['Diabla', 4, 'Intensa y picante, con tres tipos de ajíes.'],
];

/* ---------- Tamaños de alitas ---------- */
const TAMANOS = [
  [6, 18.5, 1, true],
  [8, 22.5, 2, true],
  [12, 33.5, 2, true],
  [16, 43, 3, false],
  [24, 58, 4, false],
];

/* ---------- Carta ----------
   item: [nombre, descripción, precio]  o  [nombre, descripción, [[variante, precio], …]]
   precio null = sin precio en la carta (se confirma por WhatsApp) */
const CARTA = [
  {
    id: 'con-todo', nav: 'Con todo', titulo: ['Alitas', 'con todo'], foto: ['chaufialitas', 900, 1200, 'Chaufa con alitas en salsa, papas y ensalada'],
    nota: 'Seis alitas con su compañía. Dinos tu salsa en la nota del pedido.',
    items: [
      ['Salchialitas', '6 alitas, salchicha ahumada, papas nativas y ensalada.', 24],
      ['Salchialitas a lo pobre', '6 alitas, hot dog ahumado, plátano, huevo y papas nativas.', 28],
      ['Chaufialitas', '6 alitas, porción de chaufa, papas nativas y ensalada.', 26],
    ],
  },
  {
    id: 'hamburguesas', nav: 'Hamburguesas', titulo: 'Hamburguesas', foto: ['hamburguesa', 900, 1200, 'Hamburguesa con plátano, chancho al cilindro, huevo y carne'],
    nota: 'Artesanales, armadas al momento y con sus papas.',
    items: [
      ['El Chacombo', 'Carne, huevo, chancho al cilindro, plátano, lechuga, tomate y papas nativas.', 24.5],
      ['La Parrillera', 'Carne molida, queso, chorizo parrillero, chimichurri, lechuga, tomate y papas nativas.', 20.5],
      ['La Cilindrona', 'Chancho al cilindro, tomate, lechuga y papas nativas.', 19],
      ['La Cubanita', 'Carne molida, plátano, huevo y papas nativas.', 18],
      ['Royal', 'Carne molida, huevo, jamón, queso, tomate, lechuga y papas.', 18],
      ['La Crispy', 'Pollo crispy, tomate, lechuga y papas nativas.', 16],
      ['La Chori', 'Chorizo en finas hierbas, tomate, lechuga y papas nativas.', 14.5],
      ['La Clásica', 'Carne molida, lechuga, tomate y papas nativas.', 14.5],
    ],
  },
  {
    id: 'broaster', nav: 'Broaster', titulo: 'Broaster', foto: ['broaster', 1000, 1000, 'Pollo broaster crocante con papas nativas'],
    nota: 'Crocante por fuera, jugoso por dentro. Con papas nativas y ensaladas.',
    items: [
      ['Mostrito', 'Pollo broaster, porción de chaufa, papas nativas y ensalada.', 20],
      ['Pecho', 'Con papas nativas y ensaladas.', 16.5],
      ['Entrepierna', 'Con papas nativas y ensaladas.', 16.5],
      ['Pierna', 'Con papas nativas y ensaladas.', 15],
      ['Ala', 'Con papas nativas y ensaladas.', 13.5],
    ],
  },
  {
    id: 'salchipapas', nav: 'Salchipapas', titulo: 'Salchipapas', foto: ['salchipapa', 1000, 1000, 'Salchipapa con huevo frito y tres cremas'],
    nota: 'Siete formas de pedirla, de la clásica a la brava.',
    items: [
      ['Salchibrava', 'Salchicha ahumada, chorizo en finas hierbas, trozos de chancho al cilindro y pechuga crispy.', 31.5],
      ['Chanchipapa', 'Salchicha ahumada, trozos de chancho al cilindro, papas y ensalada.', 23.5],
      ['Salchimix', 'Salchicha ahumada, chorizo en finas hierbas, plátano, huevo, papas y ensalada.', 21],
      ['Chicken Pop', 'Trozos de pollo crispy, salchicha ahumada, papas y ensalada.', 20],
      ['Salchipapa a lo pobre', 'Salchicha ahumada, plátano, huevo, papas y ensalada.', 18],
      ['Salchichori', 'Salchicha ahumada, chorizo en finas hierbas, papas y ensalada.', 17.5],
      ['Salchicha ahumada', 'Salchicha ahumada, papas nativas y ensalada.', 13.5],
    ],
  },
  {
    id: 'de-la-casa', nav: 'De la casa', titulo: 'De la casa', foto: ['pollo-saltado', 1000, 1000, 'Pollo saltado con arroz y papas'],
    nota: 'Saltados, chaufas y caldo de gallina: lo que recomienda la cocina.',
    items: [
      ['Lomo saltado', '', 25],
      ['Tallarines saltados de carne', '', 25],
      ['Chaufa al cilindro', '', 22],
      ['Pollo saltado', '', 20],
      ['Tallarines saltados de pollo', '', 20],
      ['Caldo de gallina acevichada', '', 20],
      ['Chaufa de pollo', '', 15],
      ['Caldo de gallina', '', 14],
    ],
  },
  {
    id: 'bebidas', nav: 'Bebidas', titulo: 'Bebidas', foto: ['jarra', 640, 1168, 'Jarra de bebida natural helada con una rodaja de limón'],
    nota: 'Fruta de verdad, bien heladas.',
    grupos: [
      ['Refrescantes', [
        ['Refrescante', 'Bebida con pulpa de fruta y ginger.', [['Mango', 11], ['Fresa', 11], ['Maracuyá', 11], ['Maracumango', 11]]],
      ]],
      ['Naturales', [
        ['Limonada', '', [['Vaso', 7], ['1 litro', 12]]],
        ['Limonada de fresa', '', [['Vaso', 9], ['1 litro', 15]]],
        ['Limonada de mango', '', [['Vaso', 9], ['1 litro', 15]]],
        ['Limonada de hierba luisa', '', [['Vaso', 9], ['1 litro', 15]]],
        ['Maracuyá', '', [['Vaso', 9], ['1 litro', 15]]],
      ]],
      ['Frappes', [
        ['Frappe', '', [['De fresa', 12], ['De Oreo', 12], ['Frapuccino', 12]]],
      ]],
      ['Gaseosas', [
        ['Gaseosa', 'El precio te lo confirmamos por WhatsApp.', [['Personal', null], ['1 litro', null], ['1 litro y medio', null]]],
      ]],
    ],
  },
  {
    id: 'cocteles', nav: 'Cocteles', titulo: 'Cocteles', foto: ['pisco', 150, 194, 'Copa de pisco sour'],
    nota: 'Con pisco y ron, a S/ 17 cada uno.',
    legal: 'Tomar bebidas alcohólicas en exceso es dañino. Prohibida la venta a menores de 18 años.',
    items: [
      ['Pisco sour', 'Pisco, jugo de limón y clara de huevo.', 17],
      ['Chilcano', 'Pisco, zumo de fruta, jarabe de goma y ginger ale.', [['Clásico', 17], ['Maracuyá', 17], ['Fresa', 17]]],
      ['Mojito', 'Ron, jugo de limón, azúcar blanca, hierba buena y agua con gas.', [['Clásico', 17], ['Maracuyá', 17], ['Fresa', 17]]],
    ],
  },
  {
    id: 'adicionales', nav: 'Adicionales', titulo: 'Adicionales',
    nota: 'Para completar tu plato.',
    items: [
      ['Papas nativas', '', 11],
      ['Hot dog', '', 5],
      ['Chorizo', '', 5],
      ['Plátano', '', 5],
      ['Huevo', '', 3],
    ],
  },
];

/* ---------- Armado ---------- */
const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const sol = p => (p == null ? 'Por confirmar' : 'S/ ' + Number(p).toFixed(2));
const slug = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const AJI = '<svg class="aji" viewBox="0 0 24 24" aria-hidden="true"><path d="M14.4 6.6c3.7.5 6.1 3.3 5.7 7-.5 4.6-5 8-11 8.4-2.3.2-4.6-.3-6.6-1.4 5.2-.4 8.2-3.4 8.8-7.6.4-2.8 1-4.9 3.1-6.4z"/><path d="M14.2 6.8c.2-1.9 1.2-3.2 2.9-4l1 1.7c-1.1.5-1.7 1.3-1.9 2.4z"/></svg>';

const titulo = t => [].concat(t).map(l => `<span class="ln"><span>${esc(l)}</span></span>`).join('');

function item(catId, [n, d, p], i) {
  const id = catId + '/' + slug(n);
  const vars = Array.isArray(p);
  const der = vars
    ? ''
    : `<div class="it-a"><span class="pr">${sol(p)}</span><button class="mas" type="button" data-add aria-label="Agregar ${esc(n)}">+</button></div>`;
  const vs = vars
    ? `<div class="vars">${p.map(([v, vp]) => `<button class="var" type="button" data-add data-v="${esc(v)}" data-p="${vp ?? ''}" aria-label="Agregar ${esc(n)} ${esc(v)}"><span>${esc(v)}</span><b>${vp == null ? '' : sol(vp)}</b><i>+</i></button>`).join('')}</div>`
    : '';
  return `<li class="it${vars ? ' it-v' : ''}" data-r style="--i:${i % 8}" data-id="${esc(id)}" data-n="${esc(n)}"${vars ? '' : ` data-p="${p ?? ''}"`}>
        <div class="it-t"><h4>${esc(n)}</h4>${d ? `<p>${esc(d)}</p>` : ''}</div>${der}${vs}
      </li>`;
}

function categoria(c, k) {
  const foto = c.foto
    ? `<div class="foto" data-foto><img src="img/${c.foto[0]}.webp" width="${c.foto[1]}" height="${c.foto[2]}" alt="${esc(c.foto[3])}" loading="lazy" decoding="async"></div>`
    : '';
  const lista = c.grupos
    ? c.grupos.map(([g, its]) => `<div class="grupo"><p class="sub" data-r>${esc(g)}</p><ul class="its">${its.map((it, i) => item(c.id, it, i)).join('\n')}</ul></div>`).join('\n')
    : `<ul class="its">${c.items.map((it, i) => item(c.id, it, i)).join('\n')}</ul>`;
  return `<section class="cat cat-${c.id}${k % 2 ? ' inv' : ''}${c.foto ? '' : ' sin-foto'}" id="${c.id}" aria-labelledby="t-${c.id}">
    <div class="cab">
      <h3 class="d" id="t-${c.id}" data-t>${titulo(c.titulo)}</h3>
      <p class="cab-n" data-r>${esc(c.nota)}</p>
      ${foto}
    </div>
    <div class="cuerpo">
      ${lista}
      ${c.legal ? `<p class="legal" data-r>${esc(c.legal)}</p>` : ''}
    </div>
  </section>`;
}

const salsas = SALSAS.map(([n, k, d], i) =>
  `<button class="salsa" type="button" role="checkbox" aria-checked="false" data-salsa="${esc(n)}" data-k="${k}" data-d="${esc(d)}" data-r style="--i:${i}"><span class="sa-n">${esc(n)}</span><span class="sa-k">${k ? AJI.repeat(k) + `<span class="vh">Picante ${k} de 4</span>` : 'Suave'}</span></button>`
).join('\n        ');

const tamanos = TAMANOS.map(([u, p, s, papas], i) =>
  `<button class="tam" type="button" role="radio" aria-checked="${i === 0}" data-u="${u}" data-p="${p}" data-s="${s}" data-papas="${papas ? 1 : 0}"><b class="d">${u}</b><span>${sol(p)}</span></button>`
).join('\n          ');

const cinta = (lista) => {
  const una = lista.map(t => `<span>${esc(t)}${AJI}</span>`).join('');
  return `<div class="tira" aria-hidden="true"><div>${una}</div><div>${una}</div><div>${una}</div></div>`;
};

const nav = [['alitas', 'Alitas'], ...CARTA.map(c => [c.id, c.nav])]
  .map(([id, t]) => `<a href="#${id}">${esc(t)}</a>`).join('');

let html = readFileSync(join(aqui, 'plantilla.html'), 'utf8');
const pon = (k, v) => {
  if (!html.includes(`<!--${k}-->`)) throw new Error('Falta el marcador ' + k);
  html = html.split(`<!--${k}-->`).join(v);
};
pon('SALSAS', salsas);
pon('TAMANOS', tamanos);
pon('CATS', nav);
pon('CARTA', CARTA.map(categoria).join('\n\n  '));
pon('CINTA1', cinta(SALSAS.map(s => s[0])));
pon('CINTA2', cinta(['Alitas', 'Broaster', 'Hamburguesas', 'Salchipapas', 'Saltados', 'Chaufas', 'Frappes']));
pon('AJI', AJI);
html = html.split('%WHATSAPP%').join(WHATSAPP).split('%MAPA%').join(MAPA).split('%TARJETA%').join(TARJETA);

const sale = join(aqui, '..', '..', 'chacombo', 'index.html');
writeFileSync(sale, html);
const n = CARTA.reduce((a, c) => a + (c.items ? c.items.length : c.grupos.reduce((b, g) => b + g[1].length, 0)), 0);
console.log(`chacombo/index.html listo: ${n} productos en ${CARTA.length} categorías, ${SALSAS.length} salsas, ${(html.length / 1024).toFixed(0)} KB`);
