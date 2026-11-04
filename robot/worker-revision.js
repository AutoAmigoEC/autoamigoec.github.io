/*
 * AutoAmigo · Servidor de revisión del turno (Cloudflare Worker, gratis).
 *
 * La app del conductor envía aquí sus fotos al empezar el turno. Este servidor:
 *   1. Comprueba que quien envía es un conductor activo de AutoAmigo (con su sesión de Firebase).
 *   2. Le pregunta a Gemini (versión gratis) si tiene camisa, si tiene gorra y si el carro está limpio.
 *      La cara ya llega borrosa desde el teléfono: aquí nunca llega una cara reconocible.
 *   3. Decide:  claramente bien -> aprueba solo
 *               sin camisa o foto que no sirve -> bloquea y NO guarda la foto
 *               claramente mal (gorra, carro sucio) -> rechaza solo
 *               dudoso (camiseta, foto oscura, Gemini no respondió) -> pasa a la central
 *   4. Guarda el resultado en Firebase con una cuenta de servicio (el conductor no puede aprobarse solo).
 *
 * Claves que pegas TÚ en Cloudflare (Settings -> Variables and Secrets), nunca en el código:
 *   GEMINI_KEY      clave gratis de Google AI Studio
 *   FIREBASE_SA     el archivo JSON completo de la cuenta de servicio de Firebase
 * Variables normales (opcionales):
 *   GEMINI_MODEL    por defecto gemini-3.1-flash-lite
 */

const PROYECTO = 'autoamigo-be443';
const DB = 'https://autoamigo-be443-default-rtdb.firebaseio.com';
const MAX_INTENTOS_DIA = 15;          // para no gastar el límite gratis de Gemini
const MAX_FOTOS_POR_CLASE = 2000;     // fotos guardadas para entrenar el detector propio
const SEGURO = 0.8;                   // desde qué seguridad Gemini decide solo

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors() });
    try {
      const url = new URL(req.url);
      if (req.method !== 'POST') return json({ ok: true, servicio: 'AutoAmigo revisión de turno' });
      // Solicitud de conductor nuevo: no tiene cuenta todavía
      if (url.pathname.endsWith('/solicitud')) return json(await solicitud(req, await req.json(), env));
      const uid = await verificarConductor(req, env);
      const body = await req.json();
      if (url.pathname.endsWith('/perfil')) return json(await fotoPerfil(uid, body, env));
      if (url.pathname.endsWith('/documento')) return json(await documento(uid, body, env));
      if (url.pathname.endsWith('/identidad')) return json(await identidad(uid, body, env));
      if (url.pathname.endsWith('/turno')) return json(await turno(uid, body, env));
      return json({ ok: false, error: 'ruta' }, 404);
    } catch (e) {
      const m = String(e && e.message || e);
      return json({ ok: false, error: m }, m.startsWith('auth') ? 401 : 500);
    }
  }
};

// ---------------- Registro de identidad (una sola vez) ----------------
// La cédula y el selfie oficial los aprueba la central en el panel.
async function identidad(uid, b, env) {
  if (!esImagen(b.cedula) || !esImagen(b.selfie) || !Array.isArray(b.descriptor) || b.descriptor.length !== 128) throw new Error('datos');
  const actual = await db(env, 'GET', 'identidad/' + uid);
  if (actual && actual.estado === 'aprobada') return { ok: true, estado: 'aprobada' };
  const t = Date.now();
  await db(env, 'PATCH', '', {
    ['identidad/' + uid]: { estado: 'pendiente', descriptor: b.descriptor.map(n => Math.round(n * 1e5) / 1e5), t },
    // parecido: distancia entre la cara de la cédula y el selfie (menos de 0.5 = se parecen), lo mide el teléfono
    ['identidadFotos/' + uid]: { cedula: b.cedula, selfie: b.selfie, t, parecido: typeof b.parecido === 'number' ? b.parecido : null }
  });
  return { ok: true, estado: 'pendiente' };
}

// ---------------- Solicitud de conductor nuevo (sin cuenta) ----------------
// La central la aprueba en el panel (Solicitudes): ahí se crean el usuario y la clave.
const CAMPOS = ['nombre', 'cedula', 'cedulaVence', 'nacimiento', 'telefono', 'correo', 'sector', 'licenciaVence', 'placa', 'marca', 'color', 'anio', 'matriculaVence'];
const FOTOS_SOL = ['persona', 'cedula', 'licencia', 'matricula', 'carro'];
async function solicitud(req, b, env) {
  const d = b && b.datos, f = b && b.fotos;
  if (!d || !f) throw new Error('datos');
  for (const k of CAMPOS) if (typeof d[k] !== 'string' || !d[k].trim() || d[k].length > 120) throw new Error('falta ' + k);
  if (!/^\d{10}$/.test(d.cedula) || !/^09\d{8}$/.test(d.telefono) || !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(d.correo)) throw new Error('datos');
  for (const k of FOTOS_SOL) if (!esImagen(f[k])) throw new Error('foto ' + k);
  // Límite: 3 solicitudes por día desde la misma conexión y una pendiente por cédula
  const t = Date.now(), dia = diaEcuador(t);
  const ip = await huella(req.headers.get('cf-connecting-ip') || 'x');
  const cuenta = (await db(env, 'GET', 'solicitudesLimite/' + dia + '/' + ip)) || 0;
  if (cuenta >= 3) throw new Error('Ya se enviaron varias solicitudes hoy desde este teléfono. Intenta mañana.');
  const prev = await db(env, 'GET', 'solicitudesCedula/' + d.cedula);
  if (prev && prev.estado === 'pendiente') return { ok: true, estado: 'pendiente', repetida: true };
  const id = clave(t);
  const datos = {}; CAMPOS.forEach(k => { datos[k] = d[k].trim(); }); datos.placa = datos.placa.toUpperCase();
  const desc = {};
  ['persona', 'cedula', 'licencia'].forEach(k => { const v = b.desc && b.desc[k]; if (Array.isArray(v) && v.length === 128) desc[k] = v.map(n => Math.round(n * 1e5) / 1e5); });
  const par = {}; ['cedula', 'licencia'].forEach(k => { const v = b.parecido && b.parecido[k]; if (typeof v === 'number') par[k] = Math.round(v * 1000) / 1000; });
  const up = {};
  up['solicitudes/' + id] = { datos, t, estado: 'pendiente', parecido: par, desc };
  up['solicitudFotos/' + id] = Object.assign({ t }, ...FOTOS_SOL.map(k => ({ [k]: f[k] })));
  up['solicitudesLimite/' + dia + '/' + ip] = cuenta + 1;
  up['solicitudesCedula/' + d.cedula] = { estado: 'pendiente', id, t };
  await db(env, 'PATCH', '', up);
  return { ok: true, estado: 'pendiente' };
}

// ---------------- Foto de perfil ----------------
// El teléfono ya comparó la cara con la del registro y la cédula (cara.persona / cara.cedula).
async function fotoPerfil(uid, b, env) {
  if (!esImagen(b.foto)) throw new Error('datos');
  const t = Date.now();
  const cara = b.cara || {};
  let r;
  if (typeof cara.persona === 'number' && cara.persona > 0.55) r = { estado: 'rechazada', motivo: 'Tu cara no coincide con la de tu cédula y tu licencia. Toma la foto de frente, sin gafas ni gorra y con buena luz.' };
  else {
    let g = null;
    try { g = await revisarPerfil(b.foto, env); } catch (e) { g = null; }
    if (!g) r = { estado: 'revision', duda: 'La revisión automática no respondió.' };
    else if (g.persona_valida === false || g.contenido_inapropiado === true) r = { estado: 'rechazada', motivo: 'Esa foto no sirve. Toma una foto de frente de tu cara y tu camisa.', bloqueada: true };
    else {
      const c = g.confianza || {}, malos = [], dudas = [];
      if (g.fondo === 'colores' && (c.fondo || 0) >= SEGURO) malos.push('El fondo no es blanco ni gris claro.'); else if (g.fondo !== 'claro' || (c.fondo || 0) < SEGURO) dudas.push('No está claro si el fondo es claro.');
      if (g.prenda === 'camiseta' && (c.prenda || 0) >= 0.9) malos.push('Llevas camiseta, no camisa manga larga.');
      else if (g.prenda !== 'camisa' || (c.prenda || 0) < SEGURO) dudas.push('No está claro si es camisa.');
      if (g.manga === 'corta' && (c.manga || 0) >= SEGURO) malos.push('La camisa debe ser manga larga.'); else if (g.manga !== 'larga' || (c.manga || 0) < SEGURO) dudas.push('No se ve si es manga larga.');
      if (g.estampado === true && (c.estampado || 0) >= SEGURO) malos.push('Tu camisa tiene estampado, dibujos o letras.'); else if (g.estampado !== false || (c.estampado || 0) < SEGURO) dudas.push('No está claro si la camisa tiene estampado.');
      if (g.gorra_o_gafas === true && (c.gorra_o_gafas || 0) >= SEGURO) malos.push('Quítate la gorra o las gafas.');
      if (typeof cara.persona === 'number' && cara.persona > 0.45) dudas.push('La cara se parece, pero no del todo, a la del registro.');
      if (malos.length) r = { estado: 'rechazada', motivo: malos.join(' ') };
      else if (dudas.length) r = { estado: 'revision', duda: dudas.join(' ') };
      else r = { estado: 'aprobada' };
    }
  }
  const p = { estado: r.estado, t, motivo: r.motivo || null, duda: r.duda || null, por: r.estado === 'revision' ? null : 'ia' };
  if (!r.bloqueada) p.foto = b.foto;
  const up = { ['perfiles/' + uid]: p };
  if (r.estado === 'aprobada') up['conductores/' + uid + '/foto'] = b.foto;
  await db(env, 'PATCH', '', up);
  return { ok: true, estado: r.estado, motivo: r.motivo || null };
}
async function revisarPerfil(foto, env) {
  const prompt = 'Revisa la foto de perfil de un conductor de taxi. Requisitos: fondo blanco o gris claro (sin colores fuertes ni cosas detrás), ' +
    'camisa (con cuello y botones) de manga larga, de un solo color y sin estampado (sin dibujos, letras ni logos), de frente, sin gorra ni gafas. ' +
    'Si no es una persona o es inapropiada, persona_valida=false. Da tu seguridad de 0 a 1 en cada punto; si dudas, bájala.';
  return await gemini(env, prompt, [foto], {
    type: 'OBJECT',
    properties: {
      persona_valida: { type: 'BOOLEAN' }, contenido_inapropiado: { type: 'BOOLEAN' },
      fondo: { type: 'STRING', enum: ['claro', 'colores', 'no_se_ve'] },
      prenda: { type: 'STRING', enum: ['camisa', 'polo', 'camiseta', 'otra', 'no_se_ve'] },
      manga: { type: 'STRING', enum: ['larga', 'corta', 'no_se_ve'] },
      estampado: { type: 'BOOLEAN' }, gorra_o_gafas: { type: 'BOOLEAN' },
      confianza: { type: 'OBJECT', properties: { fondo: { type: 'NUMBER' }, prenda: { type: 'NUMBER' }, manga: { type: 'NUMBER' }, estampado: { type: 'NUMBER' }, gorra_o_gafas: { type: 'NUMBER' } }, required: ['fondo', 'prenda', 'manga', 'estampado', 'gorra_o_gafas'] }
    },
    required: ['persona_valida', 'contenido_inapropiado', 'fondo', 'prenda', 'manga', 'estampado', 'gorra_o_gafas', 'confianza']
  });
}

// ---------------- Documento renovado (lo aprueba la central) ----------------
async function documento(uid, b, env) {
  if (['cedula', 'licencia', 'matricula'].indexOf(b.doc) < 0 || !esImagen(b.foto) || !/^\d{4}-\d{2}-\d{2}$/.test(b.vence || '')) throw new Error('datos');
  if (b.vence <= diaEcuador(Date.now())) throw new Error('La nueva fecha de vencimiento debe ser futura.');
  await db(env, 'PATCH', '', { ['docsPendientes/' + uid + '/' + b.doc]: { foto: b.foto, vence: b.vence, t: Date.now() } });
  return { ok: true, estado: 'pendiente' };
}

// ---------------- Revisión diaria del turno ----------------
async function turno(uid, b, env) {
  if (!esImagen(b.pecho) || !Array.isArray(b.carro) || b.carro.length !== 3 || !b.carro.every(esImagen)) throw new Error('datos');
  const ident = await db(env, 'GET', 'identidad/' + uid);
  if (!ident || ident.estado !== 'aprobada') throw new Error('identidad');
  const t = Date.now(), dia = diaEcuador(t);
  const previo = (await db(env, 'GET', 'turnos/' + uid)) || {};
  if (previo.dia === dia && previo.estado === 'aprobado' && !(await db(env, 'GET', 'conductores/' + uid + '/verificarSiempre'))) return { ok: true, estado: 'aprobado' };
  const intentos = previo.dia === dia ? (previo.intentos || 0) + 1 : 1;
  const cond = (await db(env, 'GET', 'conductores/' + uid)) || {};
  const base = { dia, t, intentos, cara: typeof b.cara === 'number' ? Math.round(b.cara * 1000) / 1000 : null };

  let r;
  if (intentos > MAX_INTENTOS_DIA && !cond.verificarSiempre) r = { estado: 'revision', duda: 'Muchos intentos hoy: revísalo tú.' };
  else {
    let g = null;
    try { g = await preguntarGemini(b, env); } catch (e) { g = null; }
    r = decidir(g);
  }

  const up = {};
  if (r.estado === 'revision') {
    up['turnos/' + uid] = Object.assign(base, { estado: 'revision', duda: r.duda, por: null, motivo: null, bloqueada: null, rehacer: null });
    up['turnoFotos/' + uid] = { pecho: b.pecho, carro: b.carro, t, duda: r.duda, nombre: cond.nombre || '', unidad: cond.unidad || '' };
  } else {
    up['turnos/' + uid] = Object.assign(base, { estado: r.estado, por: 'ia', motivo: r.motivo || null, bloqueada: r.bloqueada || null, rehacer: r.rehacer || null, duda: null });
    up['turnoFotos/' + uid] = null;
    up['turnosHist/' + dia + '/' + clave(t)] = { uid, nombre: cond.nombre || '', unidad: cond.unidad || '', estado: r.estado, motivo: r.motivo || null, bloqueada: r.bloqueada || null, por: 'ia', t };
  }
  await db(env, 'PATCH', '', up);
  // Fotos aptas (nunca las bloqueadas) para enseñarle al detector propio
  if (!r.bloqueada && r.estado !== 'revision') await guardarEntrenamiento(env, b, r.clases || []).catch(() => {});
  return { ok: true, estado: r.estado, motivo: r.motivo || null, bloqueada: !!r.bloqueada, rehacer: r.rehacer || null };
}

// Reglas de decisión: solo decide sola cuando está segura; lo demás va a la central
function decidir(g) {
  if (!g) return { estado: 'revision', duda: 'La revisión automática no respondió.' };
  const c = g.confianza || {};
  if (g.persona_valida === false || g.contenido_inapropiado === true)
    return { estado: 'rechazado', bloqueada: true, motivo: 'Esa foto no sirve: no se ve tu camisa. Toma la foto de tu cara para abajo, con tu camisa puesta.', rehacer: ['pecho'] };
  if (g.sin_camisa === true && (c.prenda || 0) >= SEGURO)
    return { estado: 'rechazado', bloqueada: true, motivo: 'No tienes camisa. Ponte camisa y vuelve a tomar la foto.', rehacer: ['pecho'] };
  if (g.fotos_carro_validas === false)
    return { estado: 'rechazado', bloqueada: true, motivo: 'Las fotos del carro no sirven. Toma las 3 fotos del interior de tu carro.', rehacer: ['carro'] };
  const malos = [], rehacer = [], clases = [];
  if (g.gorra === 'si' && (c.gorra || 0) >= SEGURO) { malos.push('Estás con gorra. Quítatela y vuelve a tomar la foto de tu camisa.'); rehacer.push('pecho'); clases.push('gorra'); }
  if (g.carro === 'sucio' && (c.carro || 0) >= SEGURO) { malos.push('El carro no está limpio. Límpialo y vuelve a tomar las fotos del carro.'); rehacer.push('carro'); clases.push('carro_sucio'); }
  if (malos.length) return { estado: 'rechazado', motivo: malos.join(' '), rehacer, clases };
  const bien = g.prenda === 'camisa' && (c.prenda || 0) >= SEGURO && g.gorra === 'no' && (c.gorra || 0) >= SEGURO && g.carro === 'limpio' && (c.carro || 0) >= SEGURO;
  if (bien) return { estado: 'aprobado', clases: ['camisa', 'sin_gorra', 'carro_limpio'] };
  const dudas = [];
  if (g.prenda === 'camiseta') dudas.push('Parece camiseta, no camisa.');
  else if (g.prenda === 'polo') dudas.push('Parece camiseta tipo polo.');
  else if (g.prenda !== 'camisa' || (c.prenda || 0) < SEGURO) dudas.push('No se distingue bien la camisa.');
  if (g.gorra !== 'no' || (c.gorra || 0) < SEGURO) dudas.push('No está claro si tiene gorra.');
  if (g.carro !== 'limpio' || (c.carro || 0) < SEGURO) dudas.push('No está claro si el carro está limpio.');
  const extra = g.explicacion ? ' ' + String(g.explicacion).slice(0, 160) : '';
  return { estado: 'revision', duda: (dudas.join(' ') + extra).trim() };
}

async function preguntarGemini(b, env) {
  if (!env.GEMINI_KEY) throw new Error('sin clave');
  const modelo = env.GEMINI_MODEL || 'gemini-3.1-flash-lite';
  const prompt =
    'Eres el revisor de vestimenta de una empresa de taxis en Ecuador. Recibes 4 fotos.\n' +
    'Foto 1: el conductor de la cara para abajo (la cara está borrosa a propósito, no la analices). ' +
    'Debe llevar CAMISA (con cuello y botones, de manga corta o larga). Una camiseta (cuello redondo o en V, sin botones) NO es camisa. ' +
    'Una camiseta tipo polo (cuello con 2 o 3 botones) es "polo". No debe llevar gorra ni nada en la cabeza.\n' +
    'Fotos 2, 3 y 4: el interior del carro (asientos de adelante, de atrás y piso). Debe estar limpio y ordenado.\n' +
    'Si la foto 1 no muestra a una persona con ropa en el torso (por ejemplo una pierna, el piso, un objeto, una pantalla) o tiene contenido inapropiado, persona_valida=false.\n' +
    'Si las fotos 2 a 4 no son del interior de un carro, fotos_carro_validas=false.\n' +
    'Da tu seguridad de 0 a 1 en cada punto. Si dudas, baja la seguridad: es mejor que lo revise una persona.\n' +
    'explicacion: una frase corta en español, solo si hay alguna duda.';
  const partes = [{ text: prompt }].concat([b.pecho].concat(b.carro).map(img => ({ inline_data: { mime_type: 'image/jpeg', data: img.replace(/^data:image\/\w+;base64,/, '') } })));
  const esquema = {
    type: 'OBJECT',
    properties: {
      persona_valida: { type: 'BOOLEAN' }, contenido_inapropiado: { type: 'BOOLEAN' }, sin_camisa: { type: 'BOOLEAN' },
      prenda: { type: 'STRING', enum: ['camisa', 'polo', 'camiseta', 'otra', 'no_se_ve'] },
      gorra: { type: 'STRING', enum: ['si', 'no', 'no_se_ve'] },
      carro: { type: 'STRING', enum: ['limpio', 'sucio', 'no_se_ve'] },
      fotos_carro_validas: { type: 'BOOLEAN' },
      confianza: { type: 'OBJECT', properties: { prenda: { type: 'NUMBER' }, gorra: { type: 'NUMBER' }, carro: { type: 'NUMBER' } }, required: ['prenda', 'gorra', 'carro'] },
      explicacion: { type: 'STRING' }
    },
    required: ['persona_valida', 'contenido_inapropiado', 'sin_camisa', 'prenda', 'gorra', 'carro', 'fotos_carro_validas', 'confianza']
  };
  return await llamarGemini(env, modelo, partes, esquema);
}
async function gemini(env, prompt, imagenes, esquema) {
  if (!env.GEMINI_KEY) throw new Error('sin clave');
  const partes = [{ text: prompt }].concat(imagenes.map(img => ({ inline_data: { mime_type: 'image/jpeg', data: img.replace(/^data:image\/\w+;base64,/, '') } })));
  return await llamarGemini(env, env.GEMINI_MODEL || 'gemini-3.1-flash-lite', partes, esquema);
}
async function llamarGemini(env, modelo, partes, esquema) {
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + modelo + ':generateContent', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_KEY },
    body: JSON.stringify({ contents: [{ role: 'user', parts: partes }], generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: esquema } })
  });
  if (!r.ok) throw new Error('gemini ' + r.status);
  const j = await r.json();
  const txt = j && j.candidates && j.candidates[0] && j.candidates[0].content && j.candidates[0].content.parts && j.candidates[0].content.parts[0] && j.candidates[0].content.parts[0].text;
  // Si Google bloqueó la respuesta por contenido inapropiado, se trata como foto que no sirve
  if (!txt && j && j.promptFeedback && j.promptFeedback.blockReason) return { persona_valida: false, contenido_inapropiado: true };
  return JSON.parse(txt);
}

async function guardarEntrenamiento(env, b, clases) {
  if (!clases.length) return;
  const cont = (await db(env, 'GET', 'entrenarConteo')) || {};
  const up = {}, t = Date.now();
  clases.forEach(cl => {
    if ((cont[cl] || 0) >= MAX_FOTOS_POR_CLASE) return;
    const imgs = cl.startsWith('carro') ? b.carro : [b.pecho];
    imgs.forEach((img, i) => { up['entrenar/' + cl + '/' + clave(t) + i] = { img, t, por: 'ia' }; });
    up['entrenarConteo/' + cl] = (cont[cl] || 0) + imgs.length;
  });
  if (Object.keys(up).length) await db(env, 'PATCH', '', up);
}

// ---------------- Sesión del conductor (token de Firebase) ----------------
let llaves = null, llavesHasta = 0;
async function verificarConductor(req, env) {
  const h = req.headers.get('authorization') || '';
  const tok = h.startsWith('Bearer ') ? h.slice(7) : '';
  const p = tok.split('.');
  if (p.length !== 3) throw new Error('auth: sin sesión');
  const cab = JSON.parse(texto(b64url(p[0]))), dat = JSON.parse(texto(b64url(p[1])));
  const ahora = Math.floor(Date.now() / 1000);
  if (cab.alg !== 'RS256' || dat.aud !== PROYECTO || dat.iss !== 'https://securetoken.google.com/' + PROYECTO || !dat.sub || dat.exp < ahora || dat.iat > ahora + 300) throw new Error('auth: sesión inválida');
  if (!llaves || Date.now() > llavesHasta) {
    const r = await fetch('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com');
    llaves = (await r.json()).keys; llavesHasta = Date.now() + 3600e3;
  }
  const jwk = llaves.find(k => k.kid === cab.kid);
  if (!jwk) throw new Error('auth: llave');
  const k = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', k, b64url(p[2]), new TextEncoder().encode(p[0] + '.' + p[1]));
  if (!ok) throw new Error('auth: firma');
  const c = await db(env, 'GET', 'conductores/' + dat.sub);
  if (!c || c.activo !== true) throw new Error('auth: conductor no activo');
  return dat.sub;
}

// ---------------- Firebase con la cuenta de servicio ----------------
let acceso = null, accesoHasta = 0;
async function token(env) {
  if (acceso && Date.now() < accesoHasta) return acceso;
  const sa = JSON.parse(env.FIREBASE_SA);
  const ahora = Math.floor(Date.now() / 1000);
  const cab = b64urlTexto(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const dat = b64urlTexto(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email', aud: 'https://oauth2.googleapis.com/token', iat: ahora, exp: ahora + 3600 }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), ch => ch.charCodeAt(0));
  const k = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const firma = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', k, new TextEncoder().encode(cab + '.' + dat)));
  const jwt = cab + '.' + dat + '.' + b64urlBytes(firma);
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + jwt });
  const j = await r.json();
  if (!j.access_token) throw new Error('firebase: cuenta de servicio');
  acceso = j.access_token; accesoHasta = Date.now() + 50 * 60e3;
  return acceso;
}
async function db(env, metodo, ruta, cuerpo) {
  const r = await fetch(DB + '/' + ruta + '.json', {
    method: metodo,
    headers: { authorization: 'Bearer ' + await token(env), 'content-type': 'application/json' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo)
  });
  if (!r.ok) throw new Error('firebase ' + r.status);
  return r.json();
}

// ---------------- Utilidades ----------------
function diaEcuador(t) { return new Date(t - 5 * 3600e3).toISOString().slice(0, 10); }   // Ecuador: UTC-5 todo el año
async function huella(s) { const h = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('aa|' + s))); return b64urlBytes(h).slice(0, 16); }
function clave(t) { return t.toString(36) + Math.random().toString(36).slice(2, 7); }
function esImagen(s) { return typeof s === 'string' && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(s) && s.length < 600000; }
function b64url(s) { s = s.replace(/-/g, '+').replace(/_/g, '/'); while (s.length % 4) s += '='; return Uint8Array.from(atob(s), c => c.charCodeAt(0)); }
function texto(u8) { return new TextDecoder().decode(u8); }
function b64urlBytes(u8) { let s = ''; u8.forEach(c => { s += String.fromCharCode(c); }); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function b64urlTexto(s) { return b64urlBytes(new TextEncoder().encode(s)); }
function cors() { return { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'POST, GET, OPTIONS' }; }
function json(o, status) { return new Response(JSON.stringify(o), { status: status || 200, headers: Object.assign({ 'content-type': 'application/json' }, cors()) }); }

export { decidir, diaEcuador };   // para las pruebas
