/* AutoAmigo · App del conductor en el navegador (iPhone y cualquier teléfono sin la app de Android).
 *
 * Hace lo mismo que la parte nativa de la app de Android (MainActivity, Repo, ServicioConductor, Taximetro,
 * Recorrido) pero en JavaScript: inicio de sesión, datos en vivo de Firebase, conectarse, GPS, ofertas en
 * cascada con sonido, aceptar, taxímetro, cobro, recargas y calificación. La pantalla (conductor.js) es la misma.
 *
 * Límite del iPhone: la página tiene que estar ABIERTA y con la pantalla encendida. Si se bloquea el teléfono o
 * se cambia de app, el iPhone deja de mandar el GPS y no suena la oferta. Por eso se pide mantener la pantalla
 * encendida (Wake Lock) y se avisa al conductor.
 */
(function () {
  if (window.AndroidAA) return;   // dentro de la app de Android no se usa
  var AJ = window.AUTOAMIGO || {}, D_ = window.Despacho;
  var DOMINIO = AJ.dominioUsuarios || 'conductores.autoamigo.app';
  var GPS_INTERVALO = 10000, OFERTA_SEG = 20, ALARMA_MAX = 45000, DIAS_HISTORIAL = 62;
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } }
  function q(s) { return document.querySelector(s); }
  function js(f) { try { f(); } catch (e) { if (window.console) console.warn('[AA web]', e); } }
  function aviso(t) { js(function () { if (window.AA && W.paginaLista) AA.aviso(t); else alert(t); }); }
  function dineroC(c) { return '$' + ((c || 0) / 100).toFixed(2); }
  function hora(t) { var d = new Date(t); return d.getHours() + ':' + String(d.getMinutes()).padStart(2, '0'); }
  function inicioHoy() { var d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }
  function diaHoy() { return new Date(ahora() - 5 * 3600e3).toISOString().slice(0, 10); }
  function metrosEntre(a, b) { var r = D_.distanciaKm(a.lat, a.lng, b.lat, b.lng); return isFinite(r) ? r * 1000 : 0; }
  function mono() { return (window.performance && performance.now) ? performance.now() : Date.now(); }

  firebase.initializeApp(window.FIREBASE_CONFIG);
  var auth = firebase.auth(), db = firebase.database(), SV = firebase.database.ServerValue;

  var W = {
    uid: null, perfil: null, perfilCargado: false, cfgRaw: {}, cfg: D_.cfgCompleta({}), estados: {}, saldos: {}, pend: {}, mis: {},
    cargado: false, misCargadas: false, enLinea: true, offset: 0, porSubir: 0, ultimoError: null,
    activo: false, modoOcupado: ls('aa_ocupado') === '1', ocupado: false, paginaLista: false,
    oferta: null, ofertaVistaDesde: 0, ofertaSonando: null, avisadas: {}, primera: true, ultimaReparacion: 0,
    ident: {}, turno: {}, ficha: null, perfilFoto: {}, docsP: {},
    gps: { id: null, ultima: null, ultimoEnvio: 0, rapido: false, denegado: false, ultimoFix: 0, vel: 0 },
    registros: []
  };
  function ahora() { return Date.now() + W.offset; }
  function cfg() { return W.cfg; }

  // ---------------- Datos en vivo ----------------
  function escuchar(ruta, f, suave) {
    var ref = typeof ruta === 'string' ? db.ref(ruta) : ruta;
    var cb = function (s) { f(s); programar(); };
    ref.on('value', cb, function (e) { if (!suave) { W.ultimoError = e && e.message; programar(); } });
    W.registros.push([ref, cb]);
  }
  function iniciarDatos(u) {
    detenerDatos();
    W.uid = u.uid;
    escuchar('.info/connected', function (s) { W.enLinea = s.val() === true; if (W.enLinea && W.activo) presencia(); });
    escuchar('.info/serverTimeOffset', function (s) { W.offset = Number(s.val()) || 0; });
    escuchar('conductores/' + u.uid, function (s) { W.perfilCargado = true; W.perfil = s.val(); });
    escuchar('config', function (s) { W.cfgRaw = s.val() || {}; W.cfg = D_.cfgCompleta(W.cfgRaw); });
    escuchar('estado', function (s) { W.estados = s.val() || {}; W.cargado = true; });
    escuchar('saldos', function (s) { W.saldos = s.val() || {}; });
    escuchar(db.ref('carreras').orderByChild('estado').equalTo('pendiente'), function (s) { W.pend = s.val() || {}; });
    escuchar(db.ref('carreras').orderByChild('conductor').equalTo(u.uid).limitToLast(500), function (s) { W.mis = s.val() || {}; W.misCargadas = true; });
    escuchar('identidad/' + u.uid, function (s) { W.ident = s.val() || {}; }, true);
    escuchar('turnos/' + u.uid, function (s) { W.turno = s.val() || {}; if (!W.turnoBase) { W.turnoUsadoT = W.turno.t || 0; W.turnoBase = true; } }, true);
    escuchar('fichas/' + u.uid, function (s) { W.ficha = s.val(); }, true);
    escuchar('perfiles/' + u.uid, function (s) { var v = s.val() || {}; W.perfilFoto = { estado: v.estado || null, motivo: v.motivo || '' }; }, true);
    escuchar('docsPendientes/' + u.uid, function (s) { var v = s.val() || {}, o = {}; Object.keys(v).forEach(function (k) { o[k] = { vence: v[k].vence || '' }; }); W.docsP = o; }, true);
  }
  function detenerDatos() {
    W.registros.forEach(function (r) { r[0].off('value', r[1]); }); W.registros = [];
    W.uid = null; W.perfil = null; W.perfilCargado = false; W.estados = {}; W.saldos = {}; W.pend = {}; W.mis = {};
    W.cargado = W.misCargadas = false; W.ident = {}; W.turno = {}; W.turnoUsadoT = 0; W.turnoBase = false; W.ficha = null; W.oferta = null;
  }

  // ---------------- Carreras (mismos campos que la app de Android) ----------------
  function carrera(id, v) {
    v = v || {}; var tx = v.taximetro || {}, o = v.origen || null;
    return { id: id, numero: v.numero || 0, cliente: v.cliente || '', telefono: v.telefono || '', origen: o, destino: v.destino || null,
      tarifa: Number(v.tarifa) || 0, notas: v.notas || '', exacta: v.exacta || '', estado: v.estado || '', creada: v.creada || 0,
      ofertaDesde: v.ofertaDesde, conductor: v.conductor || null, manual: !!v.manual, rechazos: v.rechazos || {}, aceptada: v.aceptada,
      iniciada: v.iniciada, finalizada: v.finalizada, precioFijo: !!v.precioFijo, comisionMinC: v.comisionMinC || 0, solicitudes: v.solicitudes || {},
      taxMetros: Number(tx.metros) || 0, taxEsperaSeg: Number(tx.esperaSeg) || 0, taxInicio: tx.inicio, comisionCobradaC: v.comisionCobradaC || 0,
      tarifaEstimadaC: v.tarifaEstimadaC || 0, recogerEn: v.recogerEn, activarEn: v.activarEn, cancelaciones: v.cancelaciones || {},
      equipaje: !!v.equipaje, clienteCalif: v.clienteCalif, clienteViajes: v.clienteViajes, origenRef: (o && o.ref) || '',
      metrosRecogida: Number(v.metrosRecogida) || 0, metrosTotal: v.metrosTotal, raw: v };
  }
  function misCarreras() { return Object.keys(W.mis).map(function (k) { return carrera(k, W.mis[k]); }); }
  function activa() {
    var l = misCarreras().filter(function (c) { return c.estado === 'aceptada' || c.estado === 'ejecucion'; });
    l.sort(function (a, b) { return (a.aceptada || a.creada) - (b.aceptada || b.creada); });
    return l[0] || null;
  }
  function pendiente(id) { return W.pend[id] ? carrera(id, W.pend[id]) : null; }
  function miSaldoC() { return Math.max(0, Number(W.saldos[W.uid] && W.saldos[W.uid].saldoC) || 0); }
  function miEstado() { return W.estados[W.uid] || null; }
  function estadoLibre() { return W.modoOcupado ? 'ocupado' : 'libre'; }
  function bloqueado() { return W.perfilCargado && (!W.perfil || W.perfil.activo === false); }

  // Verificación del turno
  function requiereTurno() { return W.cfgRaw.verificarTurno === true && /^https:\/\//.test(W.cfgRaw.turnoUrl || ''); }
  function turnoDeHoy() {
    if (W.turno.dia !== diaHoy()) return null;
    // Usuario de prueba (verificarSiempre): cada aprobación sirve para una sola conexión
    if (W.turno.estado === 'aprobado' && W.perfil && W.perfil.verificarSiempre === true && (W.turno.t || 0) <= (W.turnoUsadoT || 0)) return null;
    return W.turno.estado || null;
  }
  function turnoOk() { return !requiereTurno() || turnoDeHoy() === 'aprobado'; }

  // ---------------- Escrituras ----------------
  function actualizar(m) { return db.ref().update(m); }
  // Sin internet: no se queda esperando; Firebase lo envía al volver la señal (mientras la página siga abierta)
  function actualizarSinEsperar(m, listo) {
    var avisado = false; W.porSubir++;
    actualizar(m).then(function () { W.porSubir = Math.max(0, W.porSubir - 1); if (!avisado) { avisado = true; listo(true, false); } programar(); },
      function () { W.porSubir = Math.max(0, W.porSubir - 1); if (!avisado) { avisado = true; listo(false, false); } programar(); });
    setTimeout(function () { if (!avisado) { avisado = true; listo(true, true); } }, W.enLinea ? 4000 : 300);
  }
  function ponerMiEstado(e, c) { if (W.uid) db.ref('estado/' + W.uid).update({ estado: e, carrera: c || null }); }
  function enviarUbicacion(lat, lng) { if (W.uid) db.ref('estado/' + W.uid).update({ lat: lat, lng: lng, t: SV.TIMESTAMP, online: true }); }
  function presencia() { if (!W.uid) return; var r = db.ref('estado/' + W.uid + '/online'); r.onDisconnect().set(false); r.set(true); }
  function desconectarPresencia() { if (!W.uid) return; var r = db.ref('estado/' + W.uid + '/online'); r.onDisconnect().cancel(); r.set(false); }

  function aceptarCarrera(c, listo) {
    var u = W.uid, p = W.perfil || {};
    db.ref('carreras/' + c.id).transaction(function (d) {
      if (d === null) return d;
      if (d.estado !== 'pendiente') return;   // abortar
      d.estado = 'aceptada'; d.conductor = u; d.conductorNombre = p.nombre || ''; d.unidad = p.unidad || ''; d.aceptada = SV.TIMESTAMP;
      return d;
    }).then(function (r) {
      var v = r.snapshot && r.snapshot.val(), mia = !!(r.committed && v && v.conductor === u);
      if (mia) ponerMiEstado('aceptada', c.id);
      listo(mia);
    }, function () { listo(false); });
  }

  // ---------------- Taxímetro (igual que Taximetro.kt) ----------------
  var TX = { id: null, inicio: 0, metros: 0, esperaSeg: 0, mostradoC: 0, ultimaPos: null, vel: 0, ultimoFix: 0, ultimoSeg: -1, ultimoGuardado: 0, ultimaPantalla: -100 };
  var VEL_MOV = 1.1, PREC_MAX = 35, SIN_GPS_MS = 8000, SEG_EN_CERO = 3;
  function txRetomar(c) {
    if (TX.id === c.id) return;
    TX.id = c.id; TX.inicio = c.taxInicio || c.iniciada || ahora(); TX.metros = c.taxMetros; TX.esperaSeg = c.taxEsperaSeg;
    TX.ultimaPos = null; TX.vel = 0; TX.ultimoFix = 0;
    TX.ultimoSeg = Math.floor((ahora() - TX.inicio) / 1000); TX.ultimaPantalla = TX.ultimoSeg;
    TX.mostradoC = TX.ultimoSeg < SEG_EN_CERO ? 0 : D_.taximetroC(TX.metros, TX.esperaSeg, cfg());
  }
  function txApagar() { TX.id = null; TX.ultimaPos = null; TX.metros = 0; TX.esperaSeg = 0; TX.mostradoC = 0; }
  function txSeg() { return Math.max(0, Math.floor((ahora() - TX.inicio) / 1000)); }
  function txPos(p) {
    if (!TX.id || (p.acc && p.acc > PREC_MAX)) return;
    var t = mono();
    if (TX.ultimaPos) {
      var d = metrosEntre(TX.ultimaPos, p), dt = (t - TX.ultimoFix) / 1000;
      var vel = typeof p.vel === 'number' && p.vel >= 0 ? p.vel : (dt > 0 ? d / dt : 0);
      TX.vel = vel;
      if (vel >= VEL_MOV && txSeg() > cfg().gratisSeg) TX.metros += d;
    } else TX.vel = typeof p.vel === 'number' && p.vel >= 0 ? p.vel : 0;
    TX.ultimaPos = p; TX.ultimoFix = t;
  }
  function txTic() {
    if (!TX.id) return false;
    var seg = txSeg();
    if (seg === TX.ultimoSeg) return false;
    var pasaron = TX.ultimoSeg < 0 ? 1 : Math.min(5, Math.max(0, seg - TX.ultimoSeg));
    TX.ultimoSeg = seg;
    var sinGps = !TX.ultimoFix || mono() - TX.ultimoFix > SIN_GPS_MS;
    if ((sinGps || TX.vel < VEL_MOV) && seg > cfg().gratisSeg) TX.esperaSeg += pasaron;
    if (seg - TX.ultimaPantalla >= 10 || (TX.mostradoC === 0 && seg >= SEG_EN_CERO)) { TX.ultimaPantalla = seg - (seg % 10); TX.mostradoC = D_.taximetroC(TX.metros, TX.esperaSeg, cfg()); }
    if (mono() - TX.ultimoGuardado >= 10000) { TX.ultimoGuardado = mono(); return true; }
    return false;
  }
  function txTotalC() { return D_.taximetroC(TX.metros, TX.esperaSeg, cfg()); }

  // Km de la carrera desde que se acepta (para "Recorridos")
  var REC = { id: null, metros: 0, ultima: null, guardado: -1 };
  function recSeguir(c) {
    if (!c) { if (REC.id) { REC.id = null; REC.metros = 0; REC.ultima = null; recGuardar(); } return; }
    if (c.id !== REC.id) { REC.id = c.id; REC.ultima = null; REC.metros = ls('aa_rec_id') === c.id ? Number(ls('aa_rec_m')) || 0 : 0; }
    if (Math.abs(REC.metros - REC.guardado) >= 50) recGuardar();
  }
  function recPos(p) {
    if (!REC.id || (p.acc && p.acc > PREC_MAX)) return;
    var a = REC.ultima; REC.ultima = p; if (!a) return;
    var d = metrosEntre(a, p), mov = typeof p.vel !== 'number' || p.vel < 0 || p.vel >= VEL_MOV;
    if (mov && d >= 3 && d < 600) REC.metros += d;
  }
  function recDe(id) { return id === REC.id ? REC.metros : 0; }
  function recGuardar() { REC.guardado = REC.metros; ls('aa_rec_id', REC.id || ''); ls('aa_rec_m', String(REC.metros)); }

  // ---------------- GPS ----------------
  function gpsIniciar() {
    if (W.gps.id != null || !navigator.geolocation) { if (!navigator.geolocation) W.gps.denegado = true; return; }
    W.gps.id = navigator.geolocation.watchPosition(function (pos) {
      var c = pos.coords, p = { lat: c.latitude, lng: c.longitude, acc: c.accuracy, vel: c.speed };
      W.gps.denegado = false; W.gps.ultima = p;
      txPos(p); recPos(p);
      if (window.AA && AA.gps) AA.gps(p.lat, p.lng);   // la navegación usa el GPS del teléfono en tiempo real
      var t = mono();
      if (t - W.gps.ultimoEnvio < (W.gps.rapido ? 5000 : GPS_INTERVALO) && W.gps.ultimoEnvio) return;
      W.gps.ultimoEnvio = t; enviarUbicacion(p.lat, p.lng);
    }, function (e) {
      if (e && e.code === 1) { W.gps.denegado = true; aviso('Permite la ubicación de esta página para recibir carreras (Ajustes → Safari → Ubicación).'); }
    }, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
  }
  function gpsDetener() { if (W.gps.id != null) navigator.geolocation.clearWatch(W.gps.id); W.gps.id = null; W.gps.ultima = null; W.gps.ultimoEnvio = 0; }
  function latido() { var p = W.gps.ultima; if (p && mono() - W.gps.ultimoEnvio > 25000) { W.gps.ultimoEnvio = mono(); enviarUbicacion(p.lat, p.lng); } }

  // ---------------- Sonido de la oferta y pantalla encendida ----------------
  var audio = null, alarma = null, wake = null;
  function desbloquearAudio() {
    try { if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === 'suspended') audio.resume(); } catch (e) { }
  }
  document.addEventListener('pointerdown', desbloquearAudio, true);
  function pitido() {
    if (!audio) return;
    [0, 0.25, 0.5].forEach(function (t) {
      var o = audio.createOscillator(), g = audio.createGain(); o.frequency.value = 880; o.connect(g); g.connect(audio.destination);
      g.gain.setValueAtTime(0.25, audio.currentTime + t); g.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + t + 0.2);
      o.start(audio.currentTime + t); o.stop(audio.currentTime + t + 0.22);
    });
    try { if (navigator.vibrate) navigator.vibrate([300, 150, 300]); } catch (e) { }
  }
  function alarmaIniciar(ms) { alarmaDetener(); var fin = Date.now() + (ms || ALARMA_MAX); pitido(); alarma = setInterval(function () { if (Date.now() > fin) alarmaDetener(); else pitido(); }, 1300); }
  function alarmaDetener() { if (alarma) clearInterval(alarma); alarma = null; }
  function pantallaEncendida(si) {
    if (!('wakeLock' in navigator)) return;
    if (si && !wake) navigator.wakeLock.request('screen').then(function (w) { wake = w; w.addEventListener('release', function () { wake = null; }); }, function () { });
    if (!si && wake) { wake.release(); wake = null; }
  }
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && W.activo) { pantallaEncendida(true); gpsIniciar(); } });

  // ---------------- Conexión (equivale al servicio de Android) ----------------
  var tic = null;
  function conectar() {
    if (W.activo) return;
    W.activo = true; W.primera = true; W.avisadas = {}; ls('aa_conectado', '1');
    desbloquearAudio(); presencia(); gpsIniciar(); pantallaEncendida(true);
    tic = setInterval(function () { latido(); ticTaximetro(); evaluar(); }, 1000);
    if (!ls('aa_aviso_iphone')) { ls('aa_aviso_iphone', '1'); setTimeout(function () { aviso('Mantén AutoAmigo abierto y la pantalla encendida mientras trabajas: si bloqueas el teléfono no te llegan carreras.'); }, 600); }
    programar();
  }
  function desconectar() {
    W.activo = false; ls('aa_conectado', null);
    clearInterval(tic); tic = null; txApagar(); gpsDetener(); alarmaDetener(); pantallaEncendida(false);
    W.oferta = null; W.ofertaSonando = null; desconectarPresencia(); programar();
  }
  function ticTaximetro() {
    if (!W.misCargadas) return;
    var c = activa();
    recSeguir(c);
    W.gps.rapido = !!c;
    if (c && c.estado === 'ejecucion' && !c.precioFijo) {
      if (TX.id !== c.id) txRetomar(c);
      if (txTic()) db.ref('carreras/' + c.id + '/taximetro').update({ metros: Math.round(TX.metros), esperaSeg: TX.esperaSeg, totalC: txTotalC(), act: SV.TIMESTAMP });
    } else if (TX.id) txApagar();
  }
  function evaluar() {
    if (!W.activo || !W.uid) return;
    if (bloqueado()) { desconectar(); salir('Tu usuario fue bloqueado por la central.'); return; }
    if (!W.cargado || !W.misCargadas) return;
    var t = ahora(), c = activa(), mi = miEstado();
    // 1) Estado coherente con mis carreras
    if (mono() - W.ultimaReparacion > 5000) {
      if (!c && mi && mi.estado !== estadoLibre()) { W.ultimaReparacion = mono(); ponerMiEstado(estadoLibre(), null); }
      else if (c && (!mi || mi.estado !== c.estado || mi.carrera !== c.id)) { W.ultimaReparacion = mono(); ponerMiEstado(c.estado, c.id); }
    }
    // 2) Aviso cuando la central asigna una carrera
    if (W.primera) { W.primera = false; if (c) W.avisadas[c.id] = 1; }
    else if (c && !W.avisadas[c.id]) { W.avisadas[c.id] = 1; if (c.manual) alarmaIniciar(8000); }
    // 3) Oferta en cascada
    var of = (!c && !W.modoOcupado && turnoOk()) ? D_.ofertaPara(W.uid, W.pend, W.estados, t, W.cfgRaw, W.saldos) : null;
    if (of && of.id === W.ofertaSonando && W.ofertaVistaDesde && mono() - W.ofertaVistaDesde > OFERTA_SEG * 1000) {
      var pc = W.pend[of.id];
      if (pc && !(pc.solicitudes && pc.solicitudes[W.uid])) { db.ref('carreras/' + of.id + '/rechazos/' + W.uid).set(SV.TIMESTAMP); of = null; }
    }
    W.oferta = of;
    var id = of ? of.id : null;
    if (id !== W.ofertaSonando) { W.ofertaSonando = id; W.ofertaVistaDesde = id ? mono() : 0; if (of) alarmaIniciar(); else alarmaDetener(); }
  }

  // ---------------- Lo que pide la pantalla ----------------
  function ponerOcupado(v) { W.modoOcupado = v; ls('aa_ocupado', v ? '1' : null); }
  function accionAceptar(c, deBandeja) {
    if (W.ocupado) return;
    if (!c) { aviso('Esa carrera ya no está disponible.'); return; }
    if (activa()) { aviso('Ya tienes una carrera en curso.'); return; }
    if (!W.activo) { aviso('Primero conéctate: desliza "Conectarme".'); return; }
    if (deBandeja && D_.esProgramada(c, ahora())) { aviso('Esa carrera es programada; se puede aceptar 20 minutos antes de la hora.'); return; }
    if (c.cancelaciones[W.uid]) { aviso('Ya cancelaste esta carrera antes.'); return; }
    var minimo = c.comisionMinC > 0 ? c.comisionMinC : cfg().comisionMinC;
    if (miSaldoC() < minimo) { aviso('Tu saldo no alcanza para esta carrera. Recarga en Mi billetera.'); return; }
    W.ocupado = true; programar(); alarmaDetener();
    if (D_.requiereAprobacion(c.raw, miSaldoC(), cfg())) {
      db.ref('carreras/' + c.id + '/solicitudes/' + W.uid).set({ saldoC: miSaldoC(), t: SV.TIMESTAMP }).then(function () { W.ocupado = false; aviso('Tu saldo es bajo: le pedimos a la central que apruebe esta carrera.'); programar(); },
        function () { W.ocupado = false; aviso('No se pudo enviar. Revisa tu internet.'); programar(); });
    } else aceptarCarrera(c, function (ok) { W.ocupado = false; if (!ok) aviso('Otro conductor ya tomó esta carrera.'); programar(); });
  }
  function cobroActual(c) {
    if (c.precioFijo) return { tarifaC: Math.round(c.tarifa * 100), metros: 0, esperaSeg: 0 };
    if (TX.id === c.id) return { tarifaC: D_.aCobrarC(txTotalC(), cfg()), metros: TX.metros, esperaSeg: TX.esperaSeg };
    return { tarifaC: D_.aCobrarC(D_.taximetroC(c.taxMetros, c.taxEsperaSeg, cfg()), cfg()), metros: c.taxMetros, esperaSeg: c.taxEsperaSeg };
  }
  function accionFinalizar() {
    var c = activa(); if (!c || c.estado !== 'ejecucion' || W.ocupado) return;
    var k = cfg(), cobro = cobroActual(c), inicio = c.taxInicio || c.iniciada || ahora(), seg = Math.max(0, Math.floor((ahora() - inicio) / 1000));
    var metros = cobro.metros;
    if (metros <= 0 && c.precioFijo) { var km = D_.distanciaKm(c.origen && c.origen.lat, c.origen && c.origen.lng, c.destino && c.destino.lat, c.destino && c.destino.lng); if (isFinite(km)) metros = km * 1300; }
    var porCien = Math.round(k.kmC / 10), recorrido = Math.floor(cobro.metros / 100) * porCien, espera = Math.floor(cobro.esperaSeg / k.esperaCadaSeg) * k.esperaC;
    var fin = { id: c.id, totalC: cobro.tarifaC, fijo: c.precioFijo, o: (c.origen && c.origen.dir) || '', d: (c.destino && c.destino.dir) || '', metros: Math.round(metros), seg: seg,
      arranqueC: k.arranqueC, recorridoC: recorrido, esperaC: espera, esperaSeg: cobro.esperaSeg, marcadoC: k.arranqueC + recorrido + espera, minimaC: k.minimaC };
    // Comisión y saldo (igual que Repo.finalizar)
    var u = W.uid, comision = D_.comisionC(cobro.tarifaC, k), saldo = miSaldoC(), cobrado = Math.min(saldo, comision), perdida = comision - cobrado, b = 'carreras/' + c.id + '/', m = {};
    m[b + 'estado'] = 'finalizada'; m[b + 'finalizada'] = SV.TIMESTAMP; m[b + 'tarifa'] = c.precioFijo ? c.tarifa : cobro.tarifaC / 100; m[b + 'tarifaC'] = cobro.tarifaC;
    m[b + 'comisionC'] = comision; m[b + 'comisionCobradaC'] = cobrado; m[b + 'perdidaC'] = perdida;
    m[b + 'metrosTotal'] = Math.round(Math.max(recDe(c.id), c.metrosRecogida + cobro.metros));
    if (!c.precioFijo) { m[b + 'taximetro/metros'] = Math.round(cobro.metros); m[b + 'taximetro/esperaSeg'] = cobro.esperaSeg; m[b + 'taximetro/totalC'] = cobro.tarifaC; }
    if (cobrado > 0) m['saldos/' + u + '/saldoC'] = SV.increment(-cobrado);
    if (perdida > 0) { var pk = db.ref('perdidas').push().key; m['perdidas/' + pk] = { conductor: u, carrera: c.id, numero: c.numero, tarifaC: cobro.tarifaC, comisionC: comision, cobradoC: cobrado, perdidaC: perdida, fecha: SV.TIMESTAMP }; }
    m['estado/' + u + '/estado'] = estadoLibre(); m['estado/' + u + '/carrera'] = null;
    W.ocupado = true; programar();
    actualizarSinEsperar(m, function (ok, pend) {
      W.ocupado = false;
      if (ok) { fin.sinInternet = pend; js(function () { AA.fin(JSON.stringify(fin)); }); if (pend) aviso('Sin internet: la carrera quedó guardada y se enviará al volver la señal. No cierres la página.'); }
      else aviso('No se pudo finalizar. Revisa tu internet.');
      programar();
    });
  }
  function enviarServidor(ruta, datos, listo) {
    var base = String(W.cfgRaw.turnoUrl || '').replace(/\/+$/, ''), u = auth.currentUser;
    if (!/^https:\/\//.test(base) || !u) { listo(JSON.stringify({ ok: false, error: 'No se pudo enviar. Intenta otra vez.' })); return; }
    u.getIdToken(false).then(function (tok) {
      return fetch(base + '/' + ruta, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + tok }, body: JSON.stringify(datos) })
        .then(function (r) { return r.text().then(function (t) { return r.ok ? t : JSON.stringify({ ok: false, error: r.status === 401 ? 'Tu sesión no es válida. Cierra sesión y vuelve a entrar.' : 'No se pudo revisar. Intenta otra vez.' }); }); });
    }).then(listo, function () { listo(JSON.stringify({ ok: false, error: 'No se pudo enviar. Revisa tu internet.' })); });
  }
  function manejar(n, d) {
    var c, u = W.uid;
    switch (n) {
      case 'lista': W.paginaLista = true; claveHist = ''; enviarEstado(); break;
      case 'conectar':
        if (!turnoOk() && !activa()) { js(function () { AA.abrirTurno && AA.abrirTurno(); }); return; }
        ponerOcupado(false);
        if (W.activo) { if (!activa()) ponerMiEstado('libre', null); } else conectar();
        break;
      case 'ocupado':
        if (!turnoOk() && !W.activo) { js(function () { AA.abrirTurno && AA.abrirTurno(); }); return; }
        ponerOcupado(true);
        if (W.activo) { if (!activa()) ponerMiEstado('ocupado', null); } else conectar();
        aviso('Estás ocupado: no te llegarán carreras hasta que te pongas en Conectado.');
        break;
      case 'desconectar':
        if (activa()) { aviso('Termina tu carrera antes de desconectarte.'); return; }
        if (W.perfil && W.perfil.verificarSiempre === true) W.turnoUsadoT = W.turno.t || 0;
        ponerOcupado(false); desconectar(); break;
      case 'aceptar': accionAceptar(pendiente(d.id), false); break;
      case 'tomar': accionAceptar(pendiente(d.id), true); break;
      case 'rechazar': c = pendiente(d.id); if (!c) return; alarmaDetener(); db.ref('carreras/' + c.id + '/rechazos/' + u).set(SV.TIMESTAMP).catch(function () { aviso('No se pudo rechazar. Revisa tu internet.'); }); break;
      case 'iniciar':
        c = activa(); if (!c || c.estado !== 'aceptada' || W.ocupado) return;
        W.ocupado = true; programar();
        var m = {}; m['carreras/' + c.id + '/estado'] = 'ejecucion'; m['carreras/' + c.id + '/iniciada'] = SV.TIMESTAMP; m['carreras/' + c.id + '/metrosRecogida'] = Math.round(recDe(c.id));
        if (!c.precioFijo) m['carreras/' + c.id + '/taximetro'] = { inicio: SV.TIMESTAMP, metros: 0, esperaSeg: 0, totalC: cfg().arranqueC };
        m['estado/' + u + '/estado'] = 'ejecucion'; m['estado/' + u + '/carrera'] = c.id;
        actualizarSinEsperar(m, function (ok, pend) { W.ocupado = false; if (!ok) aviso('No se pudo iniciar. Revisa tu internet.'); else if (pend) aviso('Sin internet: el taxímetro igual cuenta. Se enviará al volver la señal.'); programar(); });
        break;
      case 'finalizar': accionFinalizar(); break;
      case 'cancelar':
        c = activa(); if (!c || c.estado !== 'aceptada' || W.ocupado) return;
        if (!W.enLinea) { aviso('Sin internet no se puede cancelar la carrera. Llama a la central.'); return; }
        W.ocupado = true; programar();
        var p = W.perfil || {}, mc = {}, b = 'carreras/' + c.id + '/';
        mc[b + 'estado'] = 'pendiente'; mc[b + 'conductor'] = null; mc[b + 'conductorNombre'] = null; mc[b + 'unidad'] = null; mc[b + 'manual'] = null; mc[b + 'aceptada'] = null;
        mc[b + 'ofertaDesde'] = SV.TIMESTAMP; mc[b + 'rechazos/' + u] = SV.TIMESTAMP; mc[b + 'cancelaciones/' + u] = { nombre: p.nombre || '', unidad: p.unidad || '', en: SV.TIMESTAMP };
        mc['estado/' + u + '/estado'] = estadoLibre(); mc['estado/' + u + '/carrera'] = null;
        actualizarSinEsperar(mc, function (ok, pend) { W.ocupado = false; aviso(!ok ? 'No se pudo cancelar. Revisa tu internet.' : pend ? 'Cancelaste la carrera. Se avisará a la central al volver la señal.' : 'Cancelaste la carrera. Se le ofrecerá a otro conductor.'); programar(); });
        break;
      case 'whatsapp':
        c = activa(); if (!c) return;
        var num = String(c.telefono || '').replace(/\D/g, ''); if (num[0] === '0') num = '593' + num.slice(1);
        if (!num) { aviso('La carrera no tiene teléfono.'); return; }
        window.open('https://wa.me/' + num, '_blank'); break;
      case 'llamar': c = activa(); if (!c || !c.telefono) { aviso('La carrera no tiene teléfono.'); return; } location.href = 'tel:' + encodeURIComponent(c.telefono); break;
      case 'recargar': recargar(String(d.codigo || '')); break;
      case 'calificar':
        if (!d.id || !(d.estrellas >= 1 && d.estrellas <= 5)) return;
        db.ref('estado/' + u + '/calif/' + d.id).set({ estrellas: d.estrellas, razon: String(d.razon || '').slice(0, 300), en: SV.TIMESTAMP }).catch(function () { aviso('No se pudo guardar la calificación.'); });
        break;
      case 'abrirUbicacion': aviso('Activa la ubicación: Ajustes → Privacidad → Localización → Safari → "Al usar la app".'); break;
      case 'salir': if (W.activo && activa()) { aviso('Termina tu carrera antes de cerrar sesión.'); return; } salir(null); break;
      case 'reintentar': location.reload(); break;
      case 'fichaFotos': db.ref('fichaFotos/' + u).once('value').then(function (s) { js(function () { AA.fichaFotos(JSON.stringify(s.val() || {})); }); }, function () { js(function () { AA.fichaFotos('{}'); }); }); break;
      case 'fotoPerfil': db.ref('perfiles/' + u + '/foto').once('value').then(function (s) { js(function () { AA.fotoPerfil(s.val() || ''); }); }); break;
      case 'guardarContacto':
        var mm = {};
        if (/^09\d{8}$/.test(d.telefono || '')) mm.telefono = d.telefono;
        if (/^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$/.test(d.correo || '')) mm.correo = d.correo;
        if (!Object.keys(mm).length) return;
        db.ref('fichas/' + u).update(mm).then(function () { aviso(mm.telefono ? 'Teléfono actualizado.' : 'Correo actualizado.'); }, function () { aviso('No se pudo guardar. Revisa tu internet.'); });
        break;
      case 'perfilEnviar': case 'documentoEnviar':
        var tipo = n === 'perfilEnviar' ? 'perfil' : 'documento';
        enviarServidor(tipo, d, function (r) { js(function () { AA.perfilRespuesta(tipo, r); }); }); break;
      case 'turnoEnviar': case 'identidadEnviar':
        enviarServidor(n === 'turnoEnviar' ? 'turno' : 'identidad', d, function (r) { js(function () { AA.turnoRespuesta(r); }); }); break;
    }
  }
  function recargar(texto) {
    var u = W.uid, k = texto.toUpperCase().replace(/[^A-Z0-9]/g, '');
    var listo = function (ok, msg) { js(function () { AA.recarga(ok, msg); }); programar(); };
    if (k.length < 6) return listo(false, 'Escribe los 10 números completos.');
    db.ref('recargas/codigos/' + k).once('value').then(function (s) {
      if (!s.exists()) return listo(false, 'Número de recarga no válido. Revísalo e intenta otra vez.');
      var v = s.val(); if (v.usado) return listo(false, 'Esta recarga ya fue usada.');
      var monto = Number(v.montoC) || 0, actual = Number(W.saldos[u] && W.saldos[u].saldoC) || 0, m = {};
      m['recargas/codigos/' + k + '/usado'] = true; m['recargas/codigos/' + k + '/usadoPor'] = u; m['recargas/codigos/' + k + '/usadoEn'] = SV.TIMESTAMP;
      m['saldos/' + u + '/saldoC'] = actual + monto; m['saldos/' + u + '/ultimoCodigo'] = k;
      return actualizar(m).then(function () {
        var lista = []; try { lista = JSON.parse(ls('aa_recargas') || '[]'); } catch (e) { }
        var desde = inicioHoy() - DIAS_HISTORIAL * 86400000; lista = lista.filter(function (r) { return r.t >= desde; });
        lista.push({ montoC: monto, codigo: k, t: Date.now() }); ls('aa_recargas', JSON.stringify(lista));
        listo(true, '¡Recarga exitosa! Se sumaron ' + dineroC(monto) + ' a tu saldo.');
      }, function () { listo(false, 'No se pudo recargar. Revisa tu internet e intenta de nuevo.'); });
    }, function () { listo(false, 'No se pudo verificar el código. Revisa tu internet.'); });
  }

  // ---------------- Estado para la pantalla (igual que enviarEstado de Android) ----------------
  var pendienteEnvio = null;
  function programar() { if (pendienteEnvio) return; pendienteEnvio = setTimeout(function () { pendienteEnvio = null; enviarEstado(); }, 120); }
  function punto(p, ref) { if (!p) return null; var o = { dir: p.dir || '' }; if (typeof p.lat === 'number' && typeof p.lng === 'number') { o.lat = p.lat; o.lng = p.lng; } if (ref) o.ref = ref; return o; }
  function kmCalle(km) { return isFinite(km) ? km * 1.3 : null; }
  function datosCarrera(o, c) {
    o.id = c.id; o.numero = c.numero; o.estado = c.estado; o.cliente = c.cliente; o.tel = c.telefono; o.o = punto(c.origen, c.origenRef); o.d = punto(c.destino);
    o.exacta = c.exacta; o.notas = c.notas; o.fijoC = c.precioFijo ? Math.round(c.tarifa * 100) : 0; o.estC = c.tarifaEstimadaC;
    o.calif = c.clienteCalif == null ? null : c.clienteCalif; o.viajes = c.clienteViajes == null ? null : c.clienteViajes; o.equipaje = c.equipaje; o.manual = c.manual; o.ocupado = W.ocupado;
  }
  function enviarEstado() {
    if (!W.paginaLista || !W.uid || !window.AA) return;
    if (bloqueado()) { salir('Tu usuario fue bloqueado por la central.'); return; }
    var t = ahora(), k = cfg(), p = W.perfil || {}, mi = miEstado(), c = activa(), u = W.uid, o = {};
    o.version = 'web';
    o.perfil = { nombre: p.nombre || '', unidad: p.unidad || '', placa: p.placa || '', colorCarro: p.colorCarro || '' };
    o.estado = !W.activo ? 'desconectado' : (W.modoOcupado && !c ? 'ocupado' : 'conectado');
    var ap = W.ident.estado === 'aprobada';
    o.turno = { requerido: requiereTurno(), camara: true, aprobadoHoy: turnoDeHoy() === 'aprobado', estado: turnoDeHoy(), motivo: W.turno.motivo || '', duda: W.turno.duda || '', por: W.turno.por || '',
      bloqueada: !!W.turno.bloqueada, rehacer: W.turno.rehacer || [], identidad: W.ident.estado || null, identidadMotivo: W.ident.motivo || '',
      descriptor: ap && W.ident.descriptor ? W.ident.descriptor : [], descCedula: ap && W.ident.descCedula ? W.ident.descCedula : [], descLicencia: ap && W.ident.descLicencia ? W.ident.descLicencia : [] };
    o.ficha = W.ficha || null; o.fotoPerfil = W.perfilFoto; o.docsPendientes = W.docsP;
    var todas = misCarreras();
    o.carrerasTotal = todas.filter(function (x) { return x.estado === 'finalizada'; }).length; o.calif = null;
    o.ubicacionApagada = W.gps.denegado; o.sinInternet = !W.enLinea; o.porSubir = W.porSubir; o.error = W.ultimoError || null;
    o.saldoC = miSaldoC(); o.minimoC = k.comisionMinC; o.cfg = { minimaC: k.minimaC };
    o.yo = mi && typeof mi.lat === 'number' ? { lat: mi.lat, lng: mi.lng } : (W.gps.ultima ? { lat: W.gps.ultima.lat, lng: W.gps.ultima.lng } : null);
    var desde = inicioHoy();
    var hoy = todas.filter(function (x) { return x.estado === 'finalizada' && (x.finalizada || 0) >= desde; }).sort(function (a, b) { return (b.finalizada || 0) - (a.finalizada || 0); });
    o.carrerasHoy = hoy.length; o.consumidoHoyC = hoy.reduce(function (s, x) { return s + x.comisionCobradaC; }, 0);
    o.hechas = hoy.map(function (x) { return { t: x.finalizada || 0, metros: Math.round(x.metrosTotal || (x.metrosRecogida + x.taxMetros)), numero: x.numero, cliente: x.cliente, o: (x.origen && x.origen.dir) || '', d: (x.destino && x.destino.dir) || '', cobradoC: Math.round(x.tarifa * 100), comC: x.comisionCobradaC, hora: hora(x.finalizada || 0) }; });
    var movs = [];
    hoy.forEach(function (x) { if (x.comisionCobradaC > 0) movs.push({ t: x.finalizada || 0, j: { tipo: 'menos', montoC: x.comisionCobradaC, texto: 'Comisión carrera #' + x.numero, det: (x.origen && x.origen.dir) || '', hora: hora(x.finalizada || 0) } }); });
    var rec = []; try { rec = JSON.parse(ls('aa_recargas') || '[]'); } catch (e) { }
    rec.forEach(function (r) { if (r.t >= desde) movs.push({ t: r.t, j: { tipo: 'mas', montoC: r.montoC, texto: 'Recarga', det: 'Recarga ' + r.codigo, hora: hora(r.t) } }); });
    o.movs = movs.sort(function (a, b) { return b.t - a.t; }).map(function (m) { return m.j; });
    o.bandeja = Object.keys(W.pend).map(function (id) { return carrera(id, W.pend[id]); }).filter(function (x) { return !x.cancelaciones[u]; }).map(function (x) {
      var b = { id: x.id, km: kmCalle(D_.distanciaKm(mi && mi.lat, mi && mi.lng, x.origen && x.origen.lat, x.origen && x.origen.lng)), o: punto(x.origen, x.origenRef), d: punto(x.destino), fijoC: x.precioFijo ? Math.round(x.tarifa * 100) : 0, estC: x.tarifaEstimadaC };
      if (D_.esProgramada(x.raw, t) && x.recogerEn) b.programada = hora(x.recogerEn);
      return b;
    });
    var of = !c && W.activo && W.oferta ? pendiente(W.oferta.id) : null;
    if (of) {
      var j = {}; datosCarrera(j, of);
      var pas = W.ofertaVistaDesde ? Math.floor((mono() - W.ofertaVistaDesde) / 1000) : 0;
      j.km = kmCalle(W.oferta.km); j.totalSeg = OFERTA_SEG; j.restaSeg = Math.min(OFERTA_SEG, Math.max(0, OFERTA_SEG - pas)); j.esperandoAprobacion = !!of.solicitudes[u];
      if (of.recogerEn) j.programada = hora(of.recogerEn);
      o.oferta = j;
    } else o.oferta = null;
    if (c) {
      var jc = {}; datosCarrera(jc, c);
      if (c.estado === 'ejecucion' && !c.precioFijo) {
        var local = TX.id === c.id;
        var mostrado = local ? TX.mostradoC : ((t - (c.taxInicio || c.iniciada || 0)) < SEG_EN_CERO * 1000 ? 0 : D_.taximetroC(c.taxMetros, c.taxEsperaSeg, k));
        jc.taxi = { mostradoC: mostrado, metros: local ? TX.metros : c.taxMetros, esperaSeg: local ? TX.esperaSeg : c.taxEsperaSeg };
      }
      jc.cobrarC = cobroActual(c).tarifaC;
      o.carrera = jc;
    } else o.carrera = null;
    js(function () { AA.estado(JSON.stringify(o)); });
    enviarHistorial();
  }
  var claveHist = '';
  function enviarHistorial() {
    var desde = inicioHoy() - DIAS_HISTORIAL * 86400000;
    var fin = misCarreras().filter(function (x) { return x.estado === 'finalizada' && (x.finalizada || 0) >= desde; });
    var rec = ls('aa_recargas') || '[]';
    var clave = fin.length + '|' + fin.reduce(function (m, x) { return Math.max(m, x.finalizada || 0); }, 0) + '|' + rec.length + '|' + inicioHoy();
    if (clave === claveHist) return; claveHist = clave;
    var h = { carreras: fin.sort(function (a, b) { return (b.finalizada || 0) - (a.finalizada || 0); }).map(function (x) {
      return { t: x.finalizada || 0, numero: x.numero, cliente: x.cliente, o: (x.origen && x.origen.dir) || '', d: (x.destino && x.destino.dir) || '', cobradoC: Math.round(x.tarifa * 100), comC: x.comisionCobradaC, metros: Math.round(x.metrosTotal || (x.metrosRecogida + x.taxMetros)) };
    }), recargas: JSON.parse(rec) };
    js(function () { AA.historial(JSON.stringify(h)); });
  }
  setInterval(function () { if (W.uid) enviarEstado(); }, 1000);

  // ---------------- Puente (lo que en Android es AndroidAA) ----------------
  window.AndroidAA = { accion: function (n, datos) { var d = {}; try { d = JSON.parse(datos || '{}'); } catch (e) { } setTimeout(function () { manejar(n, d); }, 0); } };

  // ---------------- Inicio de sesión ----------------
  var css = '.web-login{position:fixed;inset:0;z-index:100;background:#0A0F3C;display:flex;flex-direction:column;align-items:center;overflow:auto;padding:max(28px,env(safe-area-inset-top)) 20px 28px;font-family:Inter,system-ui,sans-serif}' +
    '.web-login .logo{width:120px;height:120px;border-radius:30px;background:#fff;padding:10px;margin:26px 0 22px;flex:none}' +
    '.web-login .tarj{background:#fff;border-radius:26px;padding:24px 20px;width:100%;max-width:420px;display:flex;flex-direction:column;gap:12px;flex:none}' +
    '.web-login h2{margin:0;font-size:22px;color:#101828}.web-login p{margin:0;color:#667085;font-size:14px}' +
    '.web-login label{display:flex;flex-direction:column;gap:6px;font-size:13.5px;font-weight:700;color:#344054}' +
    '.web-login input[type=text],.web-login input[type=password]{height:54px;border:1px solid #D0D5DD;border-radius:16px;padding:0 16px;font:inherit;font-size:16px;color:#101828}' +
    '.web-login .rec{flex-direction:row;align-items:center;gap:8px;font-weight:500}.web-login .rec input{width:20px;height:20px}' +
    '.web-login .entrar{height:60px;border:0;border-radius:30px;background:#0A0F3C;color:#fff;font:inherit;font-size:18px;font-weight:800;cursor:pointer}' +
    '.web-login .entrar:disabled{opacity:.6}.web-login .err{background:#FEF3F2;color:#B42318;border-radius:12px;padding:12px;font-size:14px}' +
    '.web-login .olvido{border:0;background:none;color:#1570EF;font:inherit;font-weight:700;font-size:15px;cursor:pointer;padding:6px}' +
    '.web-login .crear{width:100%;max-width:420px;margin-top:18px;border:2px solid rgba(255,255,255,.35);background:transparent;color:#C9CDE6;border-radius:20px;padding:15px;font:inherit;font-size:14px;cursor:pointer;display:flex;flex-direction:column;gap:4px;flex:none;text-decoration:none;text-align:center}' +
    '.web-login .crear b{color:#fff;font-size:16.5px}' +
    '.web-login .instalar{width:100%;max-width:420px;margin-top:16px;background:rgba(255,255,255,.08);color:#E4E7EC;border-radius:16px;padding:12px 14px;font-size:13.5px;line-height:1.45;flex:none}';
  var st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
  var esIOS = /iPhone|iPad|iPod/.test(navigator.userAgent), instalada = window.navigator.standalone === true || (window.matchMedia && matchMedia('(display-mode: standalone)').matches);
  var ultimoUsuario = '';
  function pantallaLogin(msg) {
    var el = q('#web-login');
    if (!el) { el = document.createElement('div'); el.id = 'web-login'; el.className = 'web-login'; document.body.appendChild(el); }
    var rec = ultimoUsuario || ls('aa_usuario') || '';
    el.innerHTML = '<img class="logo" src="../logo.png" alt="AutoAmigo"><div class="tarj"><h2>Iniciar sesión</h2><p>Entra con el usuario y la clave que te dio AutoAmigo.</p>' +
      '<label>Usuario<input type="text" id="wl-usuario" autocomplete="username" autocapitalize="none" autocorrect="off" value="' + rec.replace(/"/g, '') + '"></label>' +
      '<label>Contraseña<input type="password" id="wl-clave" autocomplete="current-password"></label>' +
      '<label class="rec"><input type="checkbox" id="wl-rec"' + (rec ? ' checked' : '') + '>Recordarme</label>' +
      '<button class="entrar" id="wl-entrar">Iniciar sesión</button>' + (msg ? '<div class="err">' + msg + '</div>' : '') +
      '<button class="olvido" id="wl-olvido">¿Olvidaste tu contraseña?</button></div>' +
      '<a class="crear" href="registro.html">¿Quieres manejar con nosotros?<b>Crear usuario y ser parte de AutoAmigo</b></a>' +
      (esIOS && !instalada ? '<div class="instalar"><b>Instálala en tu iPhone:</b> en Safari aplasta <b>Compartir</b> (el cuadrito con flecha) → <b>Añadir a pantalla de inicio</b>. Así se abre como una app.</div>' : '') +
      '<div class="instalar">Mientras trabajas, mantén AutoAmigo <b>abierta y con la pantalla encendida</b>: si bloqueas el teléfono o cambias de app no te llegan carreras.</div>';
    el.hidden = false;
    q('#wl-entrar').onclick = entrar;
    q('#wl-clave').onkeydown = function (e) { if (e.key === 'Enter') entrar(); };
    q('#wl-olvido').onclick = function () { alert('Comunícate con la central de AutoAmigo para que te den una nueva contraseña.'); };
  }
  function entrar() {
    desbloquearAudio();
    var usuario = q('#wl-usuario').value.trim().toLowerCase(), clave = q('#wl-clave').value, b = q('#wl-entrar');
    ultimoUsuario = usuario;
    if (!usuario || !clave) { pantallaLogin('Escribe tu usuario y contraseña.'); return; }
    ls('aa_usuario', q('#wl-rec').checked ? usuario : null);
    b.disabled = true; b.textContent = 'Entrando…';
    auth.signInWithEmailAndPassword(usuario.indexOf('@') >= 0 ? usuario : usuario + '@' + DOMINIO, clave).then(function (r) {
      return db.ref('conductores/' + r.user.uid).once('value').then(function (s) {
        if (!s.exists() || s.val().activo === false) { auth.signOut(); pantallaLogin(s.exists() ? 'Tu usuario está bloqueado. Comunícate con la central.' : 'Este usuario no es de conductor.'); }
      });
    }).catch(function (e) {
      var c = (e && e.code) || '';
      pantallaLogin(/invalid|wrong-password|user-not-found/.test(c) ? 'Usuario o contraseña incorrectos.' : /network/.test(c) ? 'Sin conexión a internet.' : /too-many/.test(c) ? 'Demasiados intentos. Espera unos minutos.' : 'No se pudo entrar. Intenta otra vez.');
    });
  }
  function salir(msg) {
    if (W.activo) desconectar();
    detenerDatos(); W.paginaLista = true;
    auth.signOut().then(function () { pantallaLogin(msg); });
  }
  auth.onAuthStateChanged(function (u) {
    if (!u) { detenerDatos(); pantallaLogin(null); return; }
    var el = q('#web-login'); if (el) el.hidden = true;
    iniciarDatos(u);
    // Si recargó la página estando conectado, sigue conectado
    if (ls('aa_conectado') === '1') setTimeout(conectar, 800);
    programar();
  });
  window.__AAWeb = W;   // para pruebas
})();
