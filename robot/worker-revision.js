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
const MAX_LECTURAS_DIA = 8;           // lecturas de documentos por día desde la misma conexión

export default {
  async fetch(req, env) {
    if (req.method === 'OPTIONS') return new Response(null, { headers: cors() });
    try {
      const url = new URL(req.url);
      if (req.method !== 'POST') return json({ ok: true, servicio: 'AutoAmigo revisión de turno' });
      // Solicitud de conductor nuevo: no tiene cuenta todavía
      if (url.pathname.endsWith('/solicitud')) return json(await solicitud(req, await req.json(), env));
      // App del cliente (todavía sin cuenta de Firebase): se identifica con su id + clave secreta que le dio el servidor
      if (url.pathname.endsWith('/cliente/registro')) return json(await clienteRegistro(req, await req.json(), env));
      if (url.pathname.endsWith('/cliente/estado')) return json(await clienteEstado(await req.json(), env));
      if (url.pathname.endsWith('/cliente/intento')) return json(await clienteIntento(await req.json(), env));
      // Panel (solo administradores): restringir personas y ver la lista
      if (url.pathname.endsWith('/restringir')) return json(await restringir(await verificarAdmin(req, env), await req.json(), env));
      if (url.pathname.endsWith('/restringidos')) { await verificarAdmin(req, env); return json(await listaRestringidos(env)); }
      if (url.pathname.endsWith('/clave')) { await verificarAdmin(req, env); return json(await claveConductor(await req.json(), env)); }
      const uid = await verificarConductor(req, env);
      const body = await req.json();
      if (url.pathname.endsWith('/perfil')) return json(await fotoPerfil(uid, body, env));
      if (url.pathname.endsWith('/documento')) return json(await documento(uid, body, env));
      if (url.pathname.endsWith('/identidad')) return json(await identidad(uid, body, env));
      if (url.pathname.endsWith('/turno')) return json(await turno(uid, body, env));
      if (url.pathname.endsWith('/equipo')) return json(await equipoConductor(req, uid, body, env));
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
  const sol = { datos, t, estado: 'pendiente', parecido: par, desc };
  // Versión nueva del registro (v: 2): se leen los documentos en silencio y se comparan
  if (b.v === 2) {
    if (b.prueba === true) sol.prueba = true;
    sol.equipo = limpiarEquipo(b.equipo); sol.ip = ip;
    const restr = await buscarRestringidos(env, { cedulas: [datos.cedula], telefono: datos.telefono, correo: datos.correo, placas: [placaNorm(datos.placa)], cara: desc.persona, equipo: sol.equipo, ip });
    const nl = (await db(env, 'GET', 'solicitudesLimite/' + dia + '/' + ip + '_l')) || 0;
    let lec = null;
    if (nl < MAX_LECTURAS_DIA) { try { lec = await leerDocumentos(f, env); } catch (e) { lec = null; } }
    await db(env, 'PUT', 'solicitudesLimite/' + dia + '/' + ip + '_l', nl + 1);
    const rev = compararDocumentos(datos, lec, par);
    // Solo un error de dedo con las fotos correctas se le avisa a la persona (no se guarda nada todavía)
    if (rev.corregir.length && !(restr && restr.nivel === 'fuerte')) return { ok: false, corregir: rev.corregir, error: rev.corregir.map(c => MENSAJE_CORREGIR[c]).join(' ') };
    sol.lectura = lec ? limpiarLectura(lec) : null;
    sol.revision = { estado: rev.estado, motivos: rev.motivos, notas: rev.notas };
    if (lec) {   // también con lo leído en las fotos (otra cédula escrita, misma persona)
      const L2 = limpiarLectura(lec), r2 = await buscarRestringidos(env, { cedulas: [L2.cedula.numero, L2.licencia.numero], placas: [L2.matricula.placa, L2.carro.placa] });
      if (r2 && (!restr || (r2.nivel === 'fuerte' && restr.nivel !== 'fuerte'))) sol.restringido = r2; else if (restr) sol.restringido = restr;
    } else if (restr) sol.restringido = restr;
    const previas = await buscarPrevias(env, datos, lec, desc, ip);
    if (previas.length) sol.previas = previas;
    if (rev.estado === 'sospechosa') up['sospechosas/' + id] = { t, nombre: datos.nombre, cedula: datos.cedula, cedulaLeida: sol.lectura && sol.lectura.cedula.numero || null, telefono: datos.telefono, correo: datos.correo.toLowerCase(), ip, cara: desc.persona || null };
  }
  up['solicitudes/' + id] = sol;
  up['solicitudFotos/' + id] = Object.assign({ t }, ...FOTOS_SOL.map(k => ({ [k]: f[k] })));
  up['solicitudesLimite/' + dia + '/' + ip] = cuenta + 1;
  up['solicitudesCedula/' + d.cedula] = { estado: 'pendiente', id, t };
  await db(env, 'PATCH', '', up);
  return { ok: true, estado: 'pendiente' };
}

// ---------------- Lectura silenciosa de los documentos del registro ----------------
// La persona NUNCA sabe qué se revisó. Solo se le avisa un error de dedo en lo que escribió
// (cédula o placa) cuando las fotos están bien y cuadran entre sí. Todo lo demás llega al panel como "Sospechosa".
const MENSAJE_CORREGIR = {
  cedula: 'El número de cédula que escribiste no coincide con tu cédula y tu licencia. Revísalo.',
  placa: 'La placa que escribiste no coincide con la matrícula. Revísala.',
  cedulaVence: 'La fecha de vencimiento de la cédula que escribiste no coincide con tu cédula. Revísala.',
  licenciaVence: 'La fecha de vencimiento de la licencia que escribiste no coincide con tu licencia. Revísala.',
  matriculaVence: 'La fecha de vencimiento de la matrícula que escribiste no coincide con tu matrícula. Revísala.'
};
async function leerDocumentos(f, env) {
  const prompt = 'Lee 4 fotos de documentos de un conductor de taxi en Ecuador. Copia los datos EXACTAMENTE como están impresos; no inventes ni corrijas nada.\n' +
    'Foto 1: cédula de identidad ecuatoriana (frente). numero = el número de cédula (10 dígitos, a veces con guion antes del último). nombre = apellidos y nombres.\n' +
    'Foto 2: licencia de conducir ecuatoriana. numero = el número de la licencia (en Ecuador es el número de cédula). nombre = apellidos y nombres.\n' +
    'Foto 3: matrícula del vehículo. placa = la placa. propietario = el nombre del propietario.\n' +
    'Foto 4: el carro por fuera. placa = la placa que se ve en el carro.\n' +
    'vence (fotos 1, 2 y 3) = la fecha de vencimiento, caducidad o expiración impresa en ese documento, en formato AAAA-MM-DD. Si no aparece o no se lee, déjalo vacío (no la inventes; no uses la fecha de expedición ni la de nacimiento).\n' +
    'es_documento: true solo si la foto es de verdad ese documento (o un carro en la foto 4). legible: true si se lee bien. Si un dato no se lee, déjalo vacío.';
  const doc = (campos) => ({ type: 'OBJECT', properties: Object.assign({ es_documento: { type: 'BOOLEAN' }, legible: { type: 'BOOLEAN' } }, campos), required: ['es_documento', 'legible'].concat(Object.keys(campos)) });
  const S = { type: 'STRING' };
  return await gemini(env, prompt, [f.cedula, f.licencia, f.matricula, f.carro], {
    type: 'OBJECT',
    properties: { cedula: doc({ numero: S, nombre: S, vence: S }), licencia: doc({ numero: S, nombre: S, vence: S }), matricula: doc({ placa: S, propietario: S, vence: S }), carro: doc({ placa: S }) },
    required: ['cedula', 'licencia', 'matricula', 'carro']
  });
}
function limpiarLectura(l) {
  const s = (v) => String(v || '').trim().slice(0, 80);
  const o = (x) => x || {};
  return {
    cedula: { numero: soloDigitos(o(l.cedula).numero), nombre: s(o(l.cedula).nombre), vence: fechaNorm(o(l.cedula).vence), valido: o(l.cedula).es_documento !== false, legible: o(l.cedula).legible !== false },
    licencia: { numero: soloDigitos(o(l.licencia).numero), nombre: s(o(l.licencia).nombre), vence: fechaNorm(o(l.licencia).vence), valido: o(l.licencia).es_documento !== false, legible: o(l.licencia).legible !== false },
    matricula: { placa: placaNorm(o(l.matricula).placa), propietario: s(o(l.matricula).propietario), vence: fechaNorm(o(l.matricula).vence), valido: o(l.matricula).es_documento !== false, legible: o(l.matricula).legible !== false },
    carro: { placa: placaNorm(o(l.carro).placa), valido: o(l.carro).es_documento !== false }
  };
}
// Fecha leída a AAAA-MM-DD (acepta también DD/MM/AAAA y DD-MM-AAAA); '' si no es una fecha válida
function fechaNorm(v) {
  const s = String(v || '').trim();
  let m = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})$/), y, mo, d;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{4})$/))) { d = +m[1]; mo = +m[2]; y = +m[3]; }
  else return '';
  if (y < 1990 || y > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return '';
  return y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}
function fechaTexto(iso) { const p = String(iso || '').split('-'); return p.length === 3 ? p[2] + '/' + p[1] + '/' + p[0] : iso; }
function soloDigitos(v) { return String(v || '').replace(/\D/g, ''); }
function placaNorm(v) { return String(v || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
// Distancia de edición con intercambio de dos vecinos (0912 -> 0921 cuenta como 1)
function distEdicion(a, b) {
  const m = a.length, n = b.length, d = [];
  for (let i = 0; i <= m; i++) { d[i] = [i]; for (let j = 1; j <= n; j++) d[i][j] = i ? 0 : j; }
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    const c = a[i - 1] === b[j - 1] ? 0 : 1;
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + c);
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
  }
  return d[m][n];
}
function palabras(nombre) {
  return String(nombre || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-ZÑ ]/g, ' ').split(/\s+/)
    .filter(w => w.length > 1 && ['DE', 'DEL', 'LA', 'LAS', 'LOS', 'Y'].indexOf(w) < 0);
}
// Mismo nombre aunque esté en otro orden o con una letra mal leída
function mismoNombre(a, b) {
  const x = palabras(a), y = palabras(b);
  if (!x.length || !y.length) return null;
  const [chica, grande] = x.length <= y.length ? [x, y] : [y, x];
  const comunes = chica.filter(w => grande.some(g => g === w || (w.length >= 5 && distEdicion(w, g) <= 1))).length;
  return comunes >= Math.min(2, chica.length) && comunes / chica.length >= 0.6;
}
function compararDocumentos(datos, lec, par) {
  const motivos = [], notas = [], errDedo = [];
  const sosp = (m) => motivos.push(m);
  // La cara (la compara el teléfono)
  ['cedula', 'licencia'].forEach(k => { if (typeof par[k] === 'number' && par[k] > 0.62) sosp('La cara de la persona no coincide con la de la ' + (k === 'cedula' ? 'cédula' : 'licencia') + '.'); });
  if (typeof par.cedula !== 'number' || typeof par.licencia !== 'number') notas.push('El teléfono no encontró la cara en la cédula o la licencia: compáralas tú.');
  if (!lec) {
    notas.push('No se pudieron leer los documentos automáticamente: revisa tú el número, el nombre y la placa.');
    return { estado: motivos.length ? 'sospechosa' : 'revisar', motivos, notas, corregir: [] };
  }
  const L = limpiarLectura(lec);
  if (!L.cedula.valido) sosp('La foto de la cédula no parece una cédula.');
  if (!L.licencia.valido) sosp('La foto de la licencia no parece una licencia de conducir.');
  if (!L.matricula.valido) sosp('La foto de la matrícula no parece una matrícula.');
  if (!L.carro.valido) sosp('La foto del carro no muestra un carro.');
  const cedOk = L.cedula.numero.length === 10, licOk = L.licencia.numero.length === 10;
  if (!cedOk) notas.push('No se pudo leer el número de la cédula en la foto.');
  if (!licOk) notas.push('No se pudo leer el número de la licencia en la foto.');
  // Las fotos entre sí
  if (cedOk && licOk && L.cedula.numero !== L.licencia.numero) sosp('La cédula (' + L.cedula.numero + ') y la licencia (' + L.licencia.numero + ') tienen números distintos.');
  const nomDocs = mismoNombre(L.cedula.nombre, L.licencia.nombre);
  if (nomDocs === false) sosp('El nombre de la licencia (' + L.licencia.nombre + ') no es el de la cédula (' + L.cedula.nombre + ').');
  if (L.matricula.placa && L.carro.placa && distEdicion(L.matricula.placa, L.carro.placa) > 1) sosp('La placa del carro (' + L.carro.placa + ') no es la de la matrícula (' + L.matricula.placa + ').');
  if (L.matricula.propietario && L.cedula.nombre && mismoNombre(L.matricula.propietario, L.cedula.nombre) === false) notas.push('El carro está a nombre de: ' + L.matricula.propietario + '.');
  // Lo que escribió contra lo que dicen las fotos
  const docNum = cedOk ? L.cedula.numero : (licOk ? L.licencia.numero : '');
  if (docNum && datos.cedula !== docNum) {
    if (distEdicion(datos.cedula, docNum) <= 2) errDedo.push('cedula');
    else sosp('Escribió la cédula ' + datos.cedula + ' pero la cédula de la foto dice ' + docNum + '.');
  }
  const placaDoc = L.matricula.placa || L.carro.placa, placaEsc = placaNorm(datos.placa);
  if (placaDoc && placaEsc !== placaDoc) {
    if (distEdicion(placaEsc, placaDoc) <= 2) errDedo.push('placa');
    else sosp('Escribió la placa ' + datos.placa + ' pero la matrícula dice ' + placaDoc + '.');
  }
  // Fechas de vencimiento: escrita contra la impresa en la foto
  const hoy = diaEcuador(Date.now());
  [['cedula', 'cédula'], ['licencia', 'licencia'], ['matricula', 'matrícula']].forEach(([k, nom]) => {
    const leida = L[k].vence, escrita = datos[k + 'Vence'];
    if (!leida) { if (k !== 'cedula') notas.push('No se pudo leer la fecha de vencimiento de la ' + nom + ' en la foto: revísala tú.'); return; }
    if (leida === escrita) return;
    if (leida < hoy) sosp('La ' + nom + ' de la foto venció el ' + fechaTexto(leida) + ', pero escribió que vence el ' + fechaTexto(escrita) + '.');
    else errDedo.push(k + 'Vence');
  });
  if (L.cedula.nombre && mismoNombre(datos.nombre, L.cedula.nombre) === false) sosp('Escribió el nombre ' + datos.nombre + ' pero la cédula dice ' + L.cedula.nombre + '.');
  // Si algo de las fotos no cuadra, NO se le avisa nada (ni siquiera el error de dedo)
  if (motivos.length) {
    errDedo.forEach(c => notas.push(c === 'cedula' ? 'El número de cédula escrito (' + datos.cedula + ') no es igual al de la foto (' + docNum + ').'
      : c === 'placa' ? 'La placa escrita (' + datos.placa + ') no es igual a la de la matrícula (' + placaDoc + ').'
      : 'La fecha de vencimiento escrita (' + fechaTexto(datos[c]) + ') no es igual a la de la foto (' + fechaTexto(L[c.replace('Vence', '')].vence) + ').'));
    return { estado: 'sospechosa', motivos, notas, corregir: [] };
  }
  if (errDedo.length) return { estado: 'ok', motivos, notas, corregir: errDedo };
  return { estado: notas.some(n => /^No se pudo|compáralas/.test(n)) ? 'revisar' : 'ok', motivos, notas, corregir: [] };
}
// ¿Ya envió antes una solicitud sospechosa? (por cédula, celular, correo, conexión o cara)
async function buscarPrevias(env, datos, lec, desc, ip) {
  const todas = (await db(env, 'GET', 'sospechosas')) || {};
  const ced = lec ? soloDigitos(lec.cedula && lec.cedula.numero) : '';
  const out = [];
  Object.keys(todas).forEach(k => {
    const s = todas[k] || {}, por = [];
    if (s.cedula === datos.cedula || (s.cedulaLeida && (s.cedulaLeida === datos.cedula || s.cedulaLeida === ced)) || (ced && s.cedula === ced)) por.push('cédula');
    if (s.telefono === datos.telefono) por.push('celular');
    if (s.correo && s.correo === datos.correo.toLowerCase()) por.push('correo');
    if (s.ip === ip) por.push('mismo teléfono o internet');
    if (Array.isArray(s.cara) && Array.isArray(desc.persona)) { let q = 0; for (let i = 0; i < 128; i++) q += (s.cara[i] - desc.persona[i]) ** 2; if (Math.sqrt(q) < 0.5) por.push('cara'); }
    if (por.length) out.push({ id: k, t: s.t || 0, nombre: s.nombre || '', por });
  });
  return out.sort((a, b) => b.t - a.t).slice(0, 5);
}

// ---------------- Restringir (lista negra silenciosa) ----------------
// Lo que la persona ve nunca cambia: "Solicitud enviada". Solo el panel sabe que es alguien restringido.
// Fuerte (⛔ Restringido): misma cara, mismo teléfono, misma cédula, mismo celular o correo.
// Relacionado (⚠): misma red de internet o el mismo carro.
function limpiarEquipo(e) {
  const o = {}; e = e || {};
  ['a', 'w', 'l', 'f'].forEach(k => { if (typeof e[k] === 'string' && /^[0-9a-z]{8,64}$/i.test(e[k])) o[k] = e[k]; });
  return Object.keys(o).length ? o : null;
}
async function buscarRestringidos(env, q) {
  const todos = (await db(env, 'GET', 'restringidos')) || {};
  let mejor = null;
  Object.keys(todos).forEach(k => {
    const r = todos[k] || {}, fuerte = [], rel = [];
    const ced = (q.cedulas || []).filter(c => c && c.length === 10);
    if (ced.some(c => (r.cedulas || []).indexOf(c) >= 0)) fuerte.push('cédula');
    if (q.telefono && (r.telefonos || []).indexOf(q.telefono) >= 0) fuerte.push('celular');
    if (q.correo && (r.correos || []).indexOf(String(q.correo).toLowerCase()) >= 0) fuerte.push('correo');
    if (Array.isArray(q.cara) && Array.isArray(r.cara)) { let s = 0; for (let i = 0; i < 128; i++) s += (q.cara[i] - r.cara[i]) ** 2; if (Math.sqrt(s) < 0.5) fuerte.push('cara'); }
    const eq = q.equipo || {}, re = r.equipos || [];
    if (['a', 'w', 'l'].some(x => eq[x] && re.some(e => e[x] === eq[x]))) fuerte.push('teléfono');
    else if (eq.f && re.some(e => e.f === eq.f)) rel.push('mismo modelo de teléfono y configuración');
    if (q.ip && (r.ips || []).indexOf(q.ip) >= 0) rel.push('misma red de internet');
    const pl = (q.placas || []).filter(Boolean);
    if (pl.some(p => (r.placas || []).indexOf(p) >= 0)) rel.push('mismo carro');
    if (!fuerte.length && !rel.length) return;
    const nivel = fuerte.length ? 'fuerte' : 'relacionado';
    const cand = { id: k, nombre: r.nombre || '', t: r.t || 0, nivel, por: fuerte.concat(rel) };
    if (!mejor || (nivel === 'fuerte' && mejor.nivel !== 'fuerte') || (nivel === mejor.nivel && cand.por.length > mejor.por.length)) mejor = cand;
  });
  return mejor;
}
function juntar(a, b) { const o = (a || []).slice(); (b || []).forEach(x => { if (x && o.indexOf(x) < 0) o.push(x); }); return o; }
function juntarEquipos(a, b) { const o = (a || []).slice(); (b || []).forEach(e => { if (e && !o.some(x => JSON.stringify(x) === JSON.stringify(e))) o.push(e); }); return o.slice(-10); }
async function restringir(admin, b, env) {
  const t = Date.now();
  if (b.quitar) { await db(env, 'PATCH', '', { ['restringidos/' + String(b.quitar).replace(/[.#$\[\]\/]/g, '')]: null }); return { ok: true }; }
  let r = null;
  if (b.solicitud) {
    const id = String(b.solicitud).replace(/[.#$\[\]\/]/g, '');
    const s = await db(env, 'GET', 'solicitudes/' + id);
    if (!s || !s.datos) throw new Error('datos');
    const d = s.datos, L = s.lectura || {};
    r = { nombre: d.nombre, t, por: admin, origen: 'solicitud', ref: id,
      cedulas: juntar([d.cedula], [L.cedula && L.cedula.numero, L.licencia && L.licencia.numero].filter(x => x && x.length === 10)),
      telefonos: [d.telefono], correos: [String(d.correo || '').toLowerCase()],
      placas: juntar([placaNorm(d.placa)], [L.matricula && L.matricula.placa, L.carro && L.carro.placa]),
      cara: (s.desc && s.desc.persona) || null, equipos: s.equipo ? [s.equipo] : [], ips: s.ip ? [s.ip] : [] };
  } else if (b.cliente) {
    const cid = idLimpio(b.cliente), c = await db(env, 'GET', CLI + '/' + cid);
    if (!c) throw new Error('datos');
    r = { nombre: c.nombre || '', t, por: admin, origen: 'cliente', ref: cid,
      cedulas: juntar([c.cedula], [c.lectura && c.lectura.numero].filter(x => x && x.length === 10)), telefonos: [c.tel].filter(Boolean), correos: [],
      placas: [], cara: (c.desc && c.desc.cara) || null, equipos: c.equipo ? [c.equipo] : [], ips: c.ip ? [c.ip] : [] };
    // En silencio: no puede pedir viajes y solo ve "Estamos revisando tu cuenta"
    await db(env, 'PATCH', '', { [CLI + '/' + cid + '/estado']: 'revision', [CLI + '/' + cid + '/restringidoT']: t });
  } else if (b.uid) {
    const uid = String(b.uid).replace(/[.#$\[\]\/]/g, '');
    const [c, f, ide, eq] = await Promise.all([db(env, 'GET', 'conductores/' + uid), db(env, 'GET', 'fichas/' + uid), db(env, 'GET', 'identidad/' + uid + '/descriptor'), db(env, 'GET', 'dispositivos/' + uid)]);
    if (!c) throw new Error('datos');
    const fi = f || {};
    let sol = null; if (fi.solicitud) sol = await db(env, 'GET', 'solicitudes/' + fi.solicitud);
    r = { nombre: c.nombre || fi.nombre || '', t, por: admin, origen: 'conductor', ref: uid,
      cedulas: [fi.cedula].filter(Boolean), telefonos: [c.telefono || fi.telefono].filter(Boolean), correos: [String(fi.correo || '').toLowerCase()].filter(Boolean),
      placas: [placaNorm(c.placa || fi.placa)].filter(Boolean), cara: ide || (sol && sol.desc && sol.desc.persona) || null,
      equipos: juntarEquipos(eq && eq.equipos, sol && sol.equipo ? [sol.equipo] : []), ips: juntar(eq && eq.ips, sol && sol.ip ? [sol.ip] : []) };
  } else throw new Error('datos');
  const id = (b.solicitud ? 's_' : b.cliente ? 'cl_' : 'c_') + r.ref;
  const prev = (await db(env, 'GET', 'restringidos/' + id)) || {};
  r.equipos = juntarEquipos(prev.equipos, r.equipos); r.ips = juntar(prev.ips, r.ips);
  await db(env, 'PUT', 'restringidos/' + id, r);
  return { ok: true, id };
}
async function listaRestringidos(env) {
  const [todos, alertas] = await Promise.all([db(env, 'GET', 'restringidos'), db(env, 'GET', 'restringidosAlertas')]);
  const lista = Object.keys(todos || {}).map(k => { const r = todos[k]; return { id: k, nombre: r.nombre, t: r.t, origen: r.origen, cedula: (r.cedulas || [])[0] || '' }; }).sort((a, b) => b.t - a.t);
  return { ok: true, lista, alertas: alertas || {} };
}
// La app del conductor avisa desde qué teléfono entró (una vez por sesión)
async function equipoConductor(req, uid, b, env) {
  const e = limpiarEquipo(b.equipo), ip = await huella(req.headers.get('cf-connecting-ip') || 'x'), t = Date.now();
  const prev = (await db(env, 'GET', 'dispositivos/' + uid)) || {};
  const up = { ['dispositivos/' + uid]: { equipos: juntarEquipos(prev.equipos, e ? [e] : []), ips: juntar(prev.ips, [ip]).slice(-20), t } };
  const r = await buscarRestringidos(env, { equipo: e });
  if (r && r.id !== 'c_' + uid) up['restringidosAlertas/' + uid] = { id: r.id, nombre: r.nombre, por: r.por, t };
  await db(env, 'PATCH', '', up);
  return { ok: true };
}

// ---------------- Clave de los conductores (solo el dueño, desde el panel) ----------------
// Firebase nunca guarda la clave real (solo una huella). Por eso, cuando el dueño crea o cambia una clave,
// se guarda una copia en `clavesConductores/` (solo la cuenta de servicio la lee; el panel la pide aquí).
async function claveConductor(b, env) {
  const uid = String(b && b.uid || '').replace(/[.#$\[\]\/]/g, '');
  if (!uid) throw new Error('datos');
  if (b.accion === 'ver') { const c = await db(env, 'GET', 'clavesConductores/' + uid); return { ok: true, clave: c && c.clave || null, t: c && c.t || null }; }
  const clave = String(b.clave || '');
  if (clave.length < 6 || clave.length > 40) throw new Error('La clave debe tener al menos 6 caracteres.');
  if (b.accion === 'cambiar') {
    const c = await db(env, 'GET', 'conductores/' + uid);
    if (!c) throw new Error('datos');
    const r = await fetch('https://identitytoolkit.googleapis.com/v1/projects/' + PROYECTO + '/accounts:update', {
      method: 'POST', headers: { authorization: 'Bearer ' + await token(env, true), 'content-type': 'application/json' },
      body: JSON.stringify({ localId: uid, password: clave })
    });
    if (!r.ok) throw new Error('No se pudo cambiar la clave (' + r.status + ').');
  } else if (b.accion !== 'guardar') throw new Error('datos');
  await db(env, 'PUT', 'clavesConductores/' + uid, { clave, t: Date.now() });
  return { ok: true };
}

// ---------------- Clientes de la app ----------------
// Entra al instante si todo coincide. Si la cédula o la cara no cuadran, o es alguien restringido: NO puede pedir viajes
// ("Estamos revisando tu cuenta") y le llega a la central. Se guarda en recargas/ (solo administradores).
const CLI = 'recargas/clientesApp', CLI_FOTOS = 'recargas/clientesAppFotos';
function idLimpio(v) { return String(v || '').replace(/[^0-9a-z]/gi, '').slice(0, 40); }
async function leerCedulaCliente(foto, env) {
  const prompt = 'La foto debería ser el frente de una cédula de identidad de Ecuador. Copia EXACTAMENTE lo impreso, sin inventar.\n' +
    'numero = el número de cédula (10 dígitos). nombre = apellidos y nombres. es_documento = true solo si de verdad es una cédula. legible = true si se lee bien.';
  const S = { type: 'STRING' };
  return await gemini(env, prompt, [foto], { type: 'OBJECT', properties: { es_documento: { type: 'BOOLEAN' }, legible: { type: 'BOOLEAN' }, numero: S, nombre: S }, required: ['es_documento', 'legible', 'numero', 'nombre'] });
}
async function clienteRegistro(req, b, env) {
  const d = b && b.datos || {}, f = b && b.fotos || {};
  const nombre = String(d.nombre || '').trim().replace(/\s+/g, ' ').slice(0, 80), cedula = soloDigitos(d.cedula), tel = soloDigitos(d.tel);
  if (nombre.split(' ').length < 2 || cedula.length !== 10 || !/^09\d{8}$/.test(tel) || !esImagen(f.cedula) || !esImagen(f.cara)) throw new Error('datos');
  const t = Date.now(), dia = diaEcuador(t), ip = await huella(req.headers.get('cf-connecting-ip') || 'x');
  const cuenta = (await db(env, 'GET', 'solicitudesLimite/' + dia + '/c_' + ip)) || 0;
  if (cuenta >= 3) throw new Error('Ya se crearon varias cuentas hoy desde esta conexión. Intenta mañana.');
  if (b.prueba !== true) {   // una sola cuenta por cédula
    const ya = await db(env, 'GET', CLI + 'Cedula/' + cedula);
    if (ya) throw new Error('Ya existe una cuenta con esta cédula. Entra con "Ya tengo cuenta".');
  }
  const desc = {}; ['cara', 'cedula'].forEach(k => { const v = b.desc && b.desc[k]; if (Array.isArray(v) && v.length === 128) desc[k] = v.map(n => Math.round(n * 1e5) / 1e5); });
  const parecido = typeof b.parecido === 'number' ? Math.round(b.parecido * 1000) / 1000 : null;
  const equipo = limpiarEquipo(b.equipo);
  // Lectura silenciosa de la cédula (sin revisar la fecha: al cliente no le importa si está caducada)
  let lec = null; try { lec = await leerCedulaCliente(f.cedula, env); } catch (e) { lec = null; }
  const motivos = [], notas = [];
  let num = '', nomLeido = '';
  if (lec) {
    num = soloDigitos(lec.numero); nomLeido = String(lec.nombre || '').trim().slice(0, 80);
    if (lec.es_documento === false) motivos.push('La foto de la cédula no parece una cédula.');
    if (num.length === 10 && num !== cedula) {
      if (distEdicion(cedula, num) <= 2 && !motivos.length && !(parecido != null && parecido > 0.62)) return { ok: false, corregir: 'cedula', error: 'El número de cédula que escribiste no coincide con tu cédula. Revísalo.' };
      motivos.push('Escribió la cédula ' + cedula + ' pero la cédula de la foto dice ' + num + '.');
    }
    if (nomLeido && mismoNombre(nombre, nomLeido) === false) motivos.push('Escribió el nombre ' + nombre + ' pero la cédula dice ' + nomLeido + '.');
    if (num.length !== 10) notas.push('No se pudo leer el número de la cédula en la foto.');
  } else notas.push('No se pudo leer la cédula automáticamente.');
  if (parecido != null && parecido > 0.62) motivos.push('Su cara no coincide con la de la cédula.');
  const restr = await buscarRestringidos(env, { cedulas: [cedula, num], telefono: tel, cara: desc.cara, equipo, ip });
  const previas = await buscarPrevias(env, { cedula, telefono: tel, correo: '' }, lec ? { cedula: { numero: num } } : null, { persona: desc.cara }, ip);
  const restringido = restr && restr.nivel === 'fuerte' ? restr : null;
  const estado = motivos.length || restringido ? 'revision' : 'aprobado';
  const id = clave(t), token = clave(t) + clave(t + 1), tokenH = await huella('tok|' + token);
  const up = {};
  up[CLI + '/' + id] = { nombre, cedula, tel, t, estado, prueba: b.prueba === true || null, parecido, desc, equipo, ip,
    lectura: lec ? { numero: num, nombre: nomLeido } : null, revision: { motivos, notas }, restringido: restr || null, previas: previas.length ? previas : null,
    antecedentes: 'pendiente', tokenH };
  up[CLI_FOTOS + '/' + id] = { cedula: f.cedula, cara: f.cara, t };
  up['solicitudesLimite/' + dia + '/c_' + ip] = cuenta + 1;
  if (b.prueba !== true) up[CLI + 'Cedula/' + cedula] = id;
  if (motivos.length) up['sospechosas/cl_' + id] = { t, nombre, cedula, cedulaLeida: num || null, telefono: tel, correo: '', ip, cara: desc.cara || null };
  await db(env, 'PATCH', '', up);
  return { ok: true, estado, id, token };
}
async function clienteVerificado(b, env) {
  const id = idLimpio(b && b.id); if (!id || !b.token) throw new Error('datos');
  const c = await db(env, 'GET', CLI + '/' + id);
  if (!c || c.tokenH !== await huella('tok|' + String(b.token))) throw new Error('auth: cliente');
  return [id, c];
}
async function clienteEstado(b, env) {
  const [, c] = await clienteVerificado(b, env);
  return { ok: true, estado: c.suspendido ? 'suspendido' : c.estado };
}
// Selfie antes de pedir que NO es la cara del dueño: a la 3ª vez le llega a la central (con las fotos)
async function clienteIntento(b, env) {
  const [id, c] = await clienteVerificado(b, env);
  if (!esImagen(b.foto)) throw new Error('datos');
  const t = Date.now(), n = (c.intentosAjenos || 0) + 1, up = {};
  up[CLI + '/' + id + '/intentosAjenos'] = n;
  up[CLI_FOTOS + '/' + id + '/ajenas/' + clave(t)] = b.foto;
  if (n >= 3) up[CLI + '/' + id + '/alertaAjena'] = { n, t };
  await db(env, 'PATCH', '', up);
  return { ok: true };
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

// ---------------- Documento renovado ----------------
// v:2 → se revisa solo: si todo coincide se aprueba sin la central. Errores del conductor (foto mala, fecha mal escrita,
// documento viejo) se le piden corregir a él. A la central SOLO llega si parece de otra persona u otro carro, y en ese
// caso el conductor queda SUSPENDIDO hasta que la central lo revise (cambiar de carro = usuario nuevo, nunca desde la app).
const NOMBRE_DOC = { cedula: 'cédula', licencia: 'licencia', matricula: 'matrícula' };
async function documento(uid, b, env) {
  if (['cedula', 'licencia', 'matricula'].indexOf(b.doc) < 0 || !esImagen(b.foto) || !/^\d{4}-\d{2}-\d{2}$/.test(b.vence || '')) throw new Error('datos');
  const hoy = diaEcuador(Date.now()), t = Date.now(), nom = NOMBRE_DOC[b.doc];
  if (b.vence <= hoy) throw new Error('La nueva fecha de caducidad debe ser futura.');
  if (b.v !== 2) {   // app vieja: como antes, lo revisa la central
    await db(env, 'PATCH', '', { ['docsPendientes/' + uid + '/' + b.doc]: { foto: b.foto, vence: b.vence, t } });
    return { ok: true, estado: 'pendiente' };
  }
  const [ficha, cond] = await Promise.all([db(env, 'GET', 'fichas/' + uid), db(env, 'GET', 'conductores/' + uid)]);
  const fi = ficha || {}, co = cond || {}, antes = ((fi.docs || {})[b.doc] || {}).vence || '';
  const ki = 'docsIntentos/' + uid + '/' + b.doc + '/' + hoy, intentos = ((await db(env, 'GET', ki)) || 0) + 1;
  await db(env, 'PUT', ki, intentos);
  let l;
  try { l = await leerDocRenovado(b.doc, b.foto, env); } catch (e) { return { ok: false, error: 'No pudimos revisar tu ' + nom + ' en este momento. Intenta otra vez en unos minutos.' }; }
  if (l.es_documento === false) return { ok: false, repetir: true, error: 'Esa foto no parece tu ' + nom + '. Tómale una foto al frente del documento.' };
  const leida = fechaNorm(l.vence);
  const sinLeer = !leida && (b.doc === 'cedula' || intentos >= 3);   // la cédula a veces no trae la fecha al frente; y nunca se queda trabado
  if (!leida && !sinLeer) return { ok: false, repetir: true, error: 'No se lee bien la fecha de caducidad de tu ' + nom + '. Tómale la foto otra vez, completa, con buena luz y sin reflejos.' };
  if (leida) {
    if (leida < hoy) return { ok: false, repetir: true, error: 'La ' + nom + ' de la foto ya está caducada (' + fechaTexto(leida) + '). Tómale la foto a tu ' + nom + ' nueva.' };
    if (antes && leida <= antes) return { ok: false, repetir: true, error: 'Esa es la misma ' + nom + ' de antes (caduca el ' + fechaTexto(leida) + '). Tómale la foto a la nueva.' };
    if (leida !== b.vence) return { ok: false, corregir: 'vence', error: 'La fecha que escribiste no coincide con la de tu ' + nom + '. Revísala.' };
  }
  // ¿Es de la misma persona / el mismo carro? (solo esto llega a la central)
  const motivos = [];
  if (b.doc !== 'matricula') {
    const num = soloDigitos(l.numero);
    if (num.length === 10 && fi.cedula && num !== String(fi.cedula)) motivos.push('El número del documento (' + num + ') no es su cédula (' + fi.cedula + ').');
    if (l.nombre && (fi.nombre || co.nombre) && mismoNombre(l.nombre, fi.nombre || co.nombre) === false) motivos.push('El nombre del documento (' + l.nombre + ') no es el suyo (' + (fi.nombre || co.nombre) + ').');
    if (typeof b.cara === 'number' && b.cara > 0.62) motivos.push('La cara del documento no se parece a la del conductor.');
  } else {
    const pl = placaNorm(l.placa), suya = placaNorm(fi.placa || co.placa);
    if (pl && suya && distEdicion(pl, suya) > 1) motivos.push('La placa de la matrícula (' + pl + ') no es la de su carro (' + suya + ').');
  }
  const vence = leida || b.vence;
  if (motivos.length) {
    // Parece de otra persona u otro carro: se suspende al conductor (él solo ve "AutoAmigo está revisando tus documentos")
    await db(env, 'PATCH', '', {
      ['docsPendientes/' + uid + '/' + b.doc]: { foto: b.foto, vence, t, revisar: motivos },
      ['conductores/' + uid + '/activo']: false,
      ['conductores/' + uid + '/suspension']: 'documentos',
      ['estado/' + uid + '/online']: false
    });
    return { ok: true, estado: 'pendiente' };
  }
  await db(env, 'PATCH', '', {
    ['fichas/' + uid + '/docs/' + b.doc]: { vence, t, auto: true, sinLeer: sinLeer || null },
    ['fichaFotos/' + uid + '/' + b.doc]: b.foto,
    ['docsPendientes/' + uid + '/' + b.doc]: null
  });
  return { ok: true, estado: 'aprobado', vence };
}
async function leerDocRenovado(doc, foto, env) {
  const que = doc === 'matricula' ? 'la matrícula de un vehículo de Ecuador. placa = la placa. propietario = el nombre del propietario.'
    : doc === 'licencia' ? 'una licencia de conducir de Ecuador. numero = el número de la licencia (es el número de cédula). nombre = apellidos y nombres.'
    : 'una cédula de identidad de Ecuador. numero = el número de cédula (10 dígitos). nombre = apellidos y nombres.';
  const prompt = 'La foto debería ser ' + que + ' Copia los datos EXACTAMENTE como están impresos; no inventes nada.\n' +
    'vence = la fecha de vencimiento, caducidad o expiración impresa, en formato AAAA-MM-DD; si no aparece o no se lee, déjala vacía (no uses la de expedición ni la de nacimiento).\n' +
    'es_documento = true solo si la foto es de verdad ese documento. legible = true si se lee bien.';
  const S = { type: 'STRING' };
  return await gemini(env, prompt, [foto], { type: 'OBJECT', properties: { es_documento: { type: 'BOOLEAN' }, legible: { type: 'BOOLEAN' }, numero: S, nombre: S, placa: S, propietario: S, vence: S }, required: ['es_documento', 'legible', 'vence'] });
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
  const uid = await verificarSesion(req);
  const c = await db(env, 'GET', 'conductores/' + uid);
  if (!c || c.activo !== true) throw new Error('auth: conductor no activo');
  return uid;
}
async function verificarAdmin(req, env) {
  const uid = await verificarSesion(req);
  if ((await db(env, 'GET', 'admins/' + uid)) !== true) throw new Error('auth: no es administrador');
  return uid;
}
async function verificarSesion(req) {
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
  return dat.sub;
}

// ---------------- Firebase con la cuenta de servicio ----------------
let acceso = null, accesoHasta = 0, accesoAuth = null, accesoAuthHasta = 0;
async function token(env, cuentas) {
  if (!cuentas && acceso && Date.now() < accesoHasta) return acceso;
  if (cuentas && accesoAuth && Date.now() < accesoAuthHasta) return accesoAuth;
  const sa = JSON.parse(env.FIREBASE_SA);
  const ahora = Math.floor(Date.now() / 1000);
  const cab = b64urlTexto(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const dat = b64urlTexto(JSON.stringify({ iss: sa.client_email, scope: cuentas ? 'https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/cloud-platform' : 'https://www.googleapis.com/auth/firebase.database https://www.googleapis.com/auth/userinfo.email', aud: 'https://oauth2.googleapis.com/token', iat: ahora, exp: ahora + 3600 }));
  const pem = sa.private_key.replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), ch => ch.charCodeAt(0));
  const k = await crypto.subtle.importKey('pkcs8', der, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']);
  const firma = new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', k, new TextEncoder().encode(cab + '.' + dat)));
  const jwt = cab + '.' + dat + '.' + b64urlBytes(firma);
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=' + jwt });
  const j = await r.json();
  if (!j.access_token) throw new Error('firebase: cuenta de servicio');
  if (cuentas) { accesoAuth = j.access_token; accesoAuthHasta = Date.now() + 50 * 60e3; return accesoAuth; }
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
