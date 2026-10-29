// =====================================================================
//  AutoAmigo · Panel de la central
// =====================================================================
(function () {
  'use strict';

  var AJ = window.AUTOAMIGO;
  if (!window.FIREBASE_CONFIG || String(window.FIREBASE_CONFIG.apiKey).indexOf('PEGA_AQUI') === 0) {
    document.getElementById('login-error').hidden = false;
    document.getElementById('login-error').textContent =
      'Falta configurar Firebase: abre el archivo config.js y pega los datos de tu proyecto.';
  }

  firebase.initializeApp(window.FIREBASE_CONFIG);
  var auth = firebase.auth();
  var db = firebase.database();
  var TS = firebase.database.ServerValue.TIMESTAMP;
  // Los clientes viven dentro de "recargas" porque esa rama ya es solo para administradores
  var RUTA_CLIENTES = 'recargas/clientes';

  var offset = 0;
  db.ref('.info/serverTimeOffset').on('value', function (s) { offset = s.val() || 0; });
  function ahora() { return Date.now() + offset; }

  // ------------------------------------------------------------------
  //  Estado de la aplicación
  // ------------------------------------------------------------------
  var S = {
    conductores: {},   // uid -> datos
    estados: {},       // uid -> {lat,lng,t,online,estado,carrera}
    saldos: {},        // uid -> {saldoC}
    cubetas: {},       // nombre de consulta -> {id: carrera}
    carreras: {},      // unión de cubetas
    config: Despacho.cfgCompleta({}),
    paquetes: {},
    codigos: {},
    claveHash: null,
    clientes: {},
    filtroCarreras: 'activas',
    filtroCodigos: 'todos',
    reporte: null
  };
  var oyentes = [];

  // ------------------------------------------------------------------
  //  Utilidades
  // ------------------------------------------------------------------
  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function dinero(v) { var n = Number(v) || 0; return '$' + n.toFixed(2); }
  function dineroC(c) { return dinero((Number(c) || 0) / 100); }
  function aCent(v) { return Math.round((Number(v) || 0) * 100); }
  function duracion(ms) {
    if (!(ms >= 0)) return '—';
    var s = Math.floor(ms / 1000);
    if (s < 60) return s + ' s';
    var m = Math.floor(s / 60);
    if (m < 60) return m + ' min';
    var h = Math.floor(m / 60);
    return h + ' h ' + (m % 60) + ' min';
  }
  function hora(ts) {
    if (!ts) return '—';
    return new Date(ts).toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  }
  function fechaHora(ts) {
    if (!ts) return '—';
    var d = new Date(ts);
    return d.toLocaleDateString('es', { day: '2-digit', month: '2-digit' }) + ' ' + hora(ts);
  }
  function setHTML(el, html) {
    if (typeof el === 'string') el = $(el);
    if (el && el.__html !== html) { el.innerHTML = html; el.__html = html; }
  }
  function kmTexto(km) { return isFinite(km) ? km.toFixed(1) + ' km' : '—'; }
  var toastTimer;
  function toast(msg, esError) {
    var t = $('#toast');
    t.textContent = msg;
    t.className = 'toast' + (esError ? ' error' : '');
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.hidden = true; }, esError ? 6000 : 3500);
  }
  function errorTexto(e) {
    var c = (e && e.code) || '';
    var m = {
      'auth/invalid-credential': 'Correo o contraseña incorrectos.',
      'auth/wrong-password': 'Correo o contraseña incorrectos.',
      'auth/user-not-found': 'Correo o contraseña incorrectos.',
      'auth/invalid-login-credentials': 'Correo o contraseña incorrectos.',
      'auth/email-already-in-use': 'Ese usuario ya existe. Elige otro nombre de usuario.',
      'auth/weak-password': 'La contraseña debe tener al menos 6 caracteres.',
      'auth/invalid-email': 'El correo o usuario no es válido.',
      'auth/too-many-requests': 'Demasiados intentos. Espera unos minutos.',
      'auth/network-request-failed': 'Sin conexión a internet.',
      'PERMISSION_DENIED': 'Permiso denegado. Revisa que publicaste las reglas de la base de datos.'
    };
    if (m[c]) return m[c];
    if (e && /permission/i.test(e.message || '')) return m.PERMISSION_DENIED;
    return (e && e.message) || 'Ocurrió un error.';
  }
  var NOMBRE_ESTADO = { libre: 'Libre', aceptada: 'Aceptada', ejecucion: 'En ejecución', sinsaldo: 'Sin recarga', fuera: 'Fuera de servicio' };
  var NOMBRE_CARRERA = { pendiente: 'Esperando', aceptada: 'Aceptada', ejecucion: 'En ejecución', finalizada: 'Finalizada', cancelada: 'Cancelada' };

  function saldoC(uid) { return Despacho.saldoDe(S.saldos, uid); }
  function estadoBase(uid) { return Despacho.estadoVisible(S.estados[uid], ahora()); }
  // Estado para mostrar en el panel (agrega "Sin saldo" a los libres sin saldo)
  function estadoDe(uid) {
    var e = estadoBase(uid);
    if (e === 'libre' && saldoC(uid) < S.config.comisionMinC) return 'sinsaldo';
    return e;
  }
  function nombreCond(uid) {
    var c = S.conductores[uid];
    return c ? c.nombre : '(conductor eliminado)';
  }
  function unidadCond(uid) {
    var c = S.conductores[uid];
    return c && c.unidad ? 'U' + c.unidad : '';
  }
  function telefonoWhatsapp(tel) {
    var n = String(tel || '').replace(/\D/g, '');
    if (!n) return '';
    if (String(tel).trim().charAt(0) === '+') return n;
    if (n.charAt(0) === '0') return '593' + n.slice(1);
    if (n.indexOf('593') !== 0) return '593' + n;
    return n;
  }
  function conductoresActivos() {
    return Object.keys(S.conductores).filter(function (uid) { return S.conductores[uid].activo !== false; });
  }
  function precioTexto(c) {
    if (c.estado === 'finalizada') return '<strong>' + dinero(c.tarifa) + '</strong>' + (c.precioFijo ? '' : ' <small>taxímetro</small>');
    if (c.precioFijo) return '<strong>' + dinero(c.tarifa) + '</strong> <small>fijo</small>';
    if (c.estado === 'ejecucion' && c.taximetro) return '<span class="taxi">Taxímetro ' + dineroC(c.taximetro.totalC || S.config.arranqueC) + '</span>';
    if (c.tarifaEstimadaC) return '≈ ' + dineroC(c.tarifaEstimadaC) + ' <small>taxímetro</small>';
    return 'Taxímetro';
  }

  // Sonido corto de alerta
  var audioCtx = null;
  document.addEventListener('click', function () {
    if (!audioCtx) { try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { audioCtx = null; } }
  }, { once: true });
  function sonar() {
    if (!audioCtx) return;
    try {
      [0, 0.25, 0.5].forEach(function (t) {
        var o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.frequency.value = 880; o.connect(g); g.connect(audioCtx.destination);
        g.gain.setValueAtTime(0.25, audioCtx.currentTime + t);
        g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + t + 0.2);
        o.start(audioCtx.currentTime + t); o.stop(audioCtx.currentTime + t + 0.22);
      });
    } catch (e) { /* sin sonido */ }
  }

  // ------------------------------------------------------------------
  //  Ingreso
  // ------------------------------------------------------------------
  var modoCrearAdmin = false;
  $('#login-modo').addEventListener('click', function () {
    modoCrearAdmin = !modoCrearAdmin;
    $('#login-titulo').textContent = modoCrearAdmin ? 'Crear primer administrador' : 'Panel de la central';
    $('#login-sub').textContent = modoCrearAdmin
      ? 'Solo funciona la primera vez, cuando aún no existe ningún administrador.'
      : 'Ingresa con tu correo de administrador.';
    $('#login-boton').textContent = modoCrearAdmin ? 'Crear administrador' : 'Ingresar';
    $('#login-modo').textContent = modoCrearAdmin ? 'Ya tengo cuenta, ingresar' : '¿Primera vez? Crear el primer administrador';
    $('#login-error').hidden = true;
  });

  var creandoAdmin = false;
  $('#form-login').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var email = $('#login-email').value.trim();
    var pass = $('#login-pass').value;
    var err = $('#login-error');
    err.hidden = true;
    $('#login-boton').disabled = true;
    var p;
    if (modoCrearAdmin) {
      creandoAdmin = true;
      p = auth.createUserWithEmailAndPassword(email, pass).then(function (cred) {
        return db.ref('admins/' + cred.user.uid).set(true).then(function () {
          creandoAdmin = false;
          verificar(cred.user);
        }, function () {
          return cred.user.delete().then(function () {
            creandoAdmin = false;
            throw { message: 'Ya existe un administrador. Pídele que te cree una cuenta desde Configuración.' };
          });
        });
      });
    } else {
      p = auth.signInWithEmailAndPassword(email, pass);
    }
    p.catch(function (e) {
      creandoAdmin = false;
      err.textContent = errorTexto(e);
      err.hidden = false;
    }).then(function () { $('#login-boton').disabled = false; });
  });

  auth.onAuthStateChanged(function (user) {
    if (!user) { mostrarLogin(); return; }
    if (creandoAdmin) return;
    verificar(user);
  });

  function verificar(user) {
    db.ref('admins/' + user.uid).once('value').then(function (s) {
      if (s.val() === true) {
        iniciar(user);
      } else {
        auth.signOut();
        var err = $('#login-error');
        err.textContent = 'Esta cuenta no es de administrador. Los conductores usan la app del celular.';
        err.hidden = false;
      }
    }).catch(function (e) {
      auth.signOut();
      var err = $('#login-error');
      err.textContent = errorTexto(e);
      err.hidden = false;
    });
  }

  $('#boton-salir').addEventListener('click', function () { bloquearRecargas(); auth.signOut(); });

  function mostrarLogin() {
    detener();
    $('#app').hidden = true;
    $('#pantalla-login').hidden = false;
  }

  var iniciado = false;
  var reloj;
  function iniciar(user) {
    if (iniciado) return;
    iniciado = true;
    $('#pantalla-login').hidden = true;
    $('#app').hidden = false;
    $('#admin-email').textContent = user.email || '';
    iniciarMapa();
    escuchar();
    reloj = setInterval(renderTodo, 1000);
    var hoy = fechaInput(new Date());
    ['#rep-desde', '#rep-hasta', '#per-desde', '#per-hasta'].forEach(function (s) { $(s).value = hoy; });
  }

  function detener() {
    iniciado = false;
    clearInterval(reloj);
    oyentes.forEach(function (o) { o.ref.off('value', o.fn); });
    oyentes = [];
    S.conductores = {}; S.estados = {}; S.saldos = {}; S.cubetas = {}; S.carreras = {};
    S.paquetes = {}; S.codigos = {}; S.claveHash = null; S.clientes = {}; S.clientesListos = false;
    Object.keys(marcadores).forEach(function (k) { marcadores[k].remove(); });
    marcadores = {};
    Object.keys(marcadoresCarrera).forEach(function (k) { marcadoresCarrera[k].remove(); });
    marcadoresCarrera = {};
  }

  function on(ref, fn) {
    var cb = function (s) { fn(s.val() || {}); };
    ref.on('value', cb, function (e) { toast(errorTexto(e), true); });
    oyentes.push({ ref: ref, fn: cb });
  }

  function escuchar() {
    on(db.ref('conductores'), function (v) { S.conductores = v; renderTodo(); });
    on(db.ref('estado'), function (v) { S.estados = v; renderTodo(); });
    on(db.ref('saldos'), function (v) { S.saldos = v; renderTodo(); });
    on(db.ref('config'), function (v) { S.config = Despacho.cfgCompleta(v); llenarConfig(); renderTodo(); });
    ['pendiente', 'aceptada', 'ejecucion'].forEach(function (est) {
      on(db.ref('carreras').orderByChild('estado').equalTo(est), function (v) {
        S.cubetas[est] = v; unirCarreras();
      });
    });
    var desde = ahora() - 2 * 24 * 3600 * 1000;
    on(db.ref('carreras').orderByChild('creada').startAt(desde), function (v) {
      S.cubetas.recientes = v; unirCarreras();
    });
    on(db.ref(RUTA_CLIENTES), function (v) { S.clientes = v; S.clientesListos = true; contarCompletadas(); if (vistaActual() === 'clientes') renderClientes(); });
    on(db.ref('recargas/paquetes'), function (v) { S.paquetes = v; renderRecargas(); });
    on(db.ref('recargas/claveHash'), function (v) { S.claveHash = typeof v === 'string' ? v : null; prepararCandado(); });
    on(db.ref('recargas/codigos').orderByChild('creado').limitToLast(300), function (v) { S.codigos = v; renderRecargas(); });
  }

  function unirCarreras() {
    var todas = {};
    ['recientes', 'pendiente', 'aceptada', 'ejecucion'].forEach(function (k) {
      var c = S.cubetas[k] || {};
      Object.keys(c).forEach(function (id) { todas[id] = c[id]; });
    });
    Object.keys(todas).forEach(function (id) {
      var r = (S.cubetas.recientes || {})[id];
      var activa = ['pendiente', 'aceptada', 'ejecucion'].some(function (k) { return (S.cubetas[k] || {})[id]; });
      if (r && !activa) todas[id] = r;
    });
    S.carreras = todas;
    contarCompletadas();
    renderTodo();
  }

  // Suma 1 a "completadas" del cliente cuando su carrera queda FINALIZADA (una sola vez por carrera)
  var contando = {};
  function contarCompletadas() {
    Object.keys(S.carreras).forEach(function (id) {
      var c = S.carreras[id];
      if (!S.clientesListos) return;
      if (c.estado !== 'finalizada' || !c.clienteId || c.contadaCliente || contando[id]) return;
      if (!S.clientes[c.clienteId]) return; // cliente eliminado: no se cuenta
      contando[id] = true;
      db.ref('carreras/' + id + '/contadaCliente').transaction(function (v) { return v ? undefined : true; })
        .then(function (r) {
          if (!r.committed) return;
          return db.ref(RUTA_CLIENTES + '/' + c.clienteId + '/completadas').transaction(function (n) { return (n || 0) + 1; });
        })
        .catch(function () { delete contando[id]; });
    });
  }

  // ------------------------------------------------------------------
  //  Navegación
  // ------------------------------------------------------------------
  $$('.menu-item[data-vista]').forEach(function (b) {
    b.addEventListener('click', function () { irA(b.getAttribute('data-vista')); });
  });
  function irA(vista) {
    $$('.menu-item[data-vista]').forEach(function (b) {
      b.classList.toggle('activo', b.getAttribute('data-vista') === vista);
    });
    $$('.vista').forEach(function (v) { v.hidden = v.id !== 'vista-' + vista; });
    if (vista === 'mapa' && mapa) setTimeout(function () { mapa.resize(); }, 50);
    if (vista === 'recargas') prepararCandado();
    renderTodo();
  }

  // ------------------------------------------------------------------
  //  Mapa en vivo
  // ------------------------------------------------------------------
  var mapa, marcadores = {}, marcadoresCarrera = {}, mapaCentrado = false;
  var MIN30 = 30 * 60 * 1000;
  function iniciarMapa() {
    if (mapa) { setTimeout(function () { mapa.resize(); }, 50); return; }
    mapa = MapaAA.crear('mapa', AJ.centroMapa, AJ.zoomMapa);
  }
  function etiquetaPin(uid) {
    var cd = S.conductores[uid] || {};
    if (cd.unidad) return String(cd.unidad);
    return (cd.nombre || '?').split(' ').map(function (p) { return p.charAt(0); }).join('').slice(0, 2).toUpperCase();
  }

  function renderMapa() {
    if (!mapa) return;
    var t = ahora();
    var vistos = {};
    var puntos = [];
    conductoresActivos().forEach(function (uid) {
      var e = S.estados[uid];
      if (!e || typeof e.lat !== 'number') return;
      var est = estadoDe(uid);
      vistos[uid] = true;
      var cd = S.conductores[uid];
      var html = MapaAA.pinSVG(MapaAA.colores[est] || MapaAA.colores.fuera, etiquetaPin(uid));
      var popup = '<strong>' + esc(nombreCond(uid)) + '</strong><br>' +
        esc(cd.unidad ? 'Unidad ' + cd.unidad : '') + ' · ' + esc(cd.placa || '') + '<br>' +
        '<span class="pill ' + est + '">' + NOMBRE_ESTADO[est] + '</span> · Saldo ' + dineroC(saldoC(uid)) + '<br>' +
        '<small>GPS hace ' + duracion(Math.floor((t - e.t) / 10000) * 10000) + '</small>' +
        (cd.telefono ? '<br><a href="tel:' + esc(cd.telefono) + '">Llamar ' + esc(cd.telefono) + '</a>' : '');
      var m = marcadores[uid];
      if (!m) {
        var el = document.createElement('div');
        el.className = 'marcador-gps';
        m = marcadores[uid] = new maplibregl.Marker({ element: el, anchor: 'bottom' })
          .setLngLat([e.lng, e.lat])
          .setPopup(new maplibregl.Popup({ offset: [0, -46], closeButton: true, maxWidth: '260px' }))
          .addTo(mapa);
      }
      var ll = m.getLngLat();
      if (ll.lat !== e.lat || ll.lng !== e.lng) m.setLngLat([e.lng, e.lat]);
      if (m.__html !== html) {
        m.getElement().innerHTML = html;
        m.getElement().style.zIndex = est === 'fuera' ? 1 : 2;
        m.__html = html;
      }
      if (m.__popup !== popup) { m.getPopup().setHTML(popup); m.__popup = popup; }
      if (est !== 'fuera') puntos.push([e.lat, e.lng]);
    });
    Object.keys(marcadores).forEach(function (uid) {
      if (!vistos[uid]) { marcadores[uid].remove(); delete marcadores[uid]; }
    });

    var vistasC = {};
    Object.keys(S.carreras).forEach(function (id) {
      var c = S.carreras[id];
      if (c.estado !== 'pendiente' || !c.origen || typeof c.origen.lat !== 'number') return;
      vistasC[id] = true;
      var mc = marcadoresCarrera[id];
      if (!mc) {
        var el = document.createElement('div');
        el.className = 'pin-carrera';
        el.style.zIndex = 3;
        mc = marcadoresCarrera[id] = new maplibregl.Marker({ element: el })
          .setLngLat([c.origen.lng, c.origen.lat])
          .setPopup(new maplibregl.Popup({ offset: 16, maxWidth: '260px' }))
          .addTo(mapa);
      }
      var ll = mc.getLngLat();
      if (ll.lat !== c.origen.lat || ll.lng !== c.origen.lng) mc.setLngLat([c.origen.lng, c.origen.lat]);
      var tarde = typeof c.creada === 'number' && t - c.creada >= MIN30;
      mc.getElement().classList.toggle('tarde', tarde);
      var pop = '<strong>#' + esc(c.numero) + ' · ' + esc(c.cliente) + '</strong><br>' + esc(c.origen.dir || '') +
        (typeof c.creada === 'number' ? '<br><small' + (tarde ? ' class="texto-rojo"' : '') + '>Esperando ' + duracion(t - c.creada) + '</small>' : '');
      if (mc.__popup !== pop) { mc.getPopup().setHTML(pop); mc.__popup = pop; }
      puntos.push([c.origen.lat, c.origen.lng]);
    });
    Object.keys(marcadoresCarrera).forEach(function (id) {
      if (!vistasC[id]) { marcadoresCarrera[id].remove(); delete marcadoresCarrera[id]; }
    });

    if (!mapaCentrado && puntos.length) {
      mapaCentrado = true;
      MapaAA.encuadrar(mapa, puntos, 15);
    }
  }

  function enfocar(lat, lng) {
    irA('mapa');
    if (mapa && typeof lat === 'number') setTimeout(function () { mapa.jumpTo({ center: [lng, lat], zoom: 16 }); }, 80);
  }

  // ------------------------------------------------------------------
  //  Render
  // ------------------------------------------------------------------
  function contar() {
    var n = { libre: 0, aceptada: 0, ejecucion: 0, sinsaldo: 0, fuera: 0, pendientes: 0 };
    conductoresActivos().forEach(function (uid) { n[estadoDe(uid)]++; });
    Object.keys(S.carreras).forEach(function (id) { if (S.carreras[id].estado === 'pendiente') n.pendientes++; });
    return n;
  }
  function kpi(clase, texto, valor) {
    return '<div class="kpi"><div class="eti"><i class="punto ' + clase + '"></i>' + esc(texto) +
      '</div><div class="num">' + valor + '</div></div>';
  }
  function renderKpis() {
    var n = contar();
    var total = conductoresActivos().length;
    $('#mapa-sub').textContent = total + ' conductores activos · ' + (total - n.fuera) + ' conectados';
    setHTML('#kpis',
      kpi('libre', 'Libres', n.libre) +
      kpi('aceptada', 'Aceptada · yendo a recoger', n.aceptada) +
      kpi('ejecucion', 'En ejecución', n.ejecucion) +
      kpi('sinsaldo', 'Conectados sin recarga', n.sinsaldo) +
      kpi('fuera', 'Fuera de servicio', n.fuera) +
      kpi('pendiente', 'Carreras esperando', n.pendientes));
  }

  function ordenActivas(a, b) {
    // Siempre primero la más reciente
    var ca = S.carreras[a], cb = S.carreras[b];
    return (cb.creada || 0) - (ca.creada || 0);
  }
  function filtrarEstadosActivos() {
    var r = {};
    conductoresActivos().forEach(function (uid) { if (S.estados[uid]) r[uid] = S.estados[uid]; });
    return r;
  }

  function renderActivas() {
    var t = ahora();
    var ids = Object.keys(S.carreras).filter(function (id) {
      return ['pendiente', 'aceptada', 'ejecucion'].indexOf(S.carreras[id].estado) >= 0;
    }).sort(ordenActivas);
    if (!ids.length) {
      setHTML('#lista-activas', '<div class="vacio">No hay carreras activas.<br>Crea una con "+ Nueva carrera".</div>');
      return;
    }
    var eleg = Despacho.elegibles(filtrarEstadosActivos(), t, S.saldos);
    var limite = S.config.prioridadMin * 60000;
    setHTML('#lista-activas', ids.map(function (id) {
      var c = S.carreras[id];
      var espera = t - (c.creada || t);
      var extra = '', clase = c.estado;
      if (c.estado === 'pendiente') {
        var sonando = Despacho.sonandoA(c, eleg, t, S.config);
        extra = '<div class="meta">' + (sonando.length
          ? 'Sonando a: ' + sonando.map(function (s) { return esc(nombreCond(s.uid).split(' ')[0]) + ' (' + kmTexto(s.km) + ')'; }).join(', ')
          : 'Ningún conductor libre con saldo para ' + dineroC(c.comisionMinC || S.config.comisionMinC) + ' de comisión. Seguirá esperando.') + '</div>';
        if (espera >= limite) clase += ' urgente';
      } else {
        extra = '<div class="meta">' + esc(c.conductorNombre || nombreCond(c.conductor)) + ' ' + esc(c.unidad ? '· U' + c.unidad : '') +
          (c.manual ? ' · asignada por la central' : '') + '</div>';
        if (c.estado === 'ejecucion' && c.taximetro && !c.precioFijo) {
          extra += '<div class="meta">' + ((Number(c.taximetro.metros) || 0) / 1000).toFixed(1) + ' km · ' +
            Math.floor((Number(c.taximetro.esperaSeg) || 0) / 60) + ' min detenido</div>';
        }
      }
      var acciones = '';
      if (c.estado === 'pendiente') {
        acciones = '<button class="btn btn-chico" data-asignar="' + id + '">Asignar manual</button>' +
          '<button class="btn btn-chico" data-editar-carrera="' + id + '">Editar</button>';
      } else {
        var e = S.estados[c.conductor];
        if (e && typeof e.lat === 'number') acciones += '<button class="btn btn-chico" data-ver="' + c.conductor + '">Ver carro</button>';
        if (c.estado === 'aceptada') acciones += '<button class="btn btn-chico" data-reofrecer="' + id + '">Devolver a la cola</button>';
      }
      acciones += '<button class="btn btn-chico btn-peligro" data-cancelar="' + id + '">Cancelar</button>';
      return '<div class="carrera ' + clase + '">' +
        '<div class="fila"><strong>#' + esc(c.numero) + ' · ' + esc(c.cliente) + '</strong>' +
        '<span class="pill ' + c.estado + '">' + NOMBRE_CARRERA[c.estado] +
        (c.estado === 'pendiente' ? ' · ' + duracion(espera) : '') + '</span></div>' +
        '<div class="ruta">De: ' + esc((c.origen || {}).dir || '—') + (c.exacta ? '<br><small>' + esc(c.exacta) + '</small>' : '') + '<br>A: ' + esc((c.destino || {}).dir || 'Sin destino') + '</div>' +
        extra +
        '<div class="fila meta"><span>' + precioTexto(c) + (c.telefono ? ' · ' + esc(c.telefono) : '') + '</span><span>creada ' + hora(c.creada) + '</span></div>' +
        '<div class="acciones">' + acciones + '</div></div>';
    }).join(''));
  }

  // Alertas: conductores con saldo bajo que quieren tomar una carrera sin destino
  var alertasVistas = {};
  function renderAlertas() {
    var items = [];
    Object.keys(S.carreras).forEach(function (id) {
      var c = S.carreras[id];
      if (c.estado !== 'pendiente' || !c.solicitudes) return;
      Object.keys(c.solicitudes).forEach(function (uid) { items.push({ id: id, c: c, uid: uid }); });
    });
    var nuevas = false;
    items.forEach(function (x) {
      var k = x.id + '|' + x.uid;
      if (!alertasVistas[k]) { alertasVistas[k] = true; nuevas = true; }
    });
    if (nuevas) sonar();
    setHTML('#alertas', items.map(function (x) {
      var c = x.c, uid = x.uid, s = saldoC(uid);
      var com = c.comisionMinC || S.config.comisionMinC;
      var tieneDestino = c.destino && typeof c.destino.lat === 'number';
      var detalle = tieneDestino
        ? (s >= com ? 'Con el destino, la comisión estimada es ' + dineroC(com) + ': <strong>sí le alcanza</strong>.'
          : 'Con el destino, la comisión estimada es ' + dineroC(com) + ': <strong>no le alcanza</strong>.')
        : 'Sin destino no se sabe la comisión.';
      return '<div class="alerta"><div class="texto"><strong>' + esc(nombreCond(uid)) + ' ' + esc(unidadCond(uid)) +
        '</strong> tiene <strong>' + dineroC(s) + '</strong> de saldo y quiere la carrera <strong>#' + esc(c.numero) + '</strong>. ' + detalle +
        ' ¿Lo permites?</div><div class="acciones">' +
        '<button class="btn btn-chico btn-primario" data-permitir="' + x.id + '" data-uid="' + uid + '">Permitir</button>' +
        (tieneDestino ? '' : '<button class="btn btn-chico" data-editar-carrera="' + x.id + '">Poner destino</button>') +
        '<button class="btn btn-chico btn-peligro" data-denegar="' + x.id + '" data-uid="' + uid + '">No permitir</button>' +
        '</div></div>';
    }).join(''));
  }

  function renderTablaCarreras() {
    var t = ahora();
    var f = S.filtroCarreras;
    var ids = Object.keys(S.carreras).filter(function (id) {
      var e = S.carreras[id].estado;
      if (f === 'activas') return ['pendiente', 'aceptada', 'ejecucion'].indexOf(e) >= 0;
      if (f === 'todas') return true;
      return e === f;
    }).sort(function (a, b) { return (S.carreras[b].creada || 0) - (S.carreras[a].creada || 0); });
    var filas = ids.map(function (id) {
      var c = S.carreras[id];
      var acc = '';
      if (c.estado === 'pendiente') acc += '<button class="btn btn-chico" data-asignar="' + id + '">Asignar</button><button class="btn btn-chico" data-editar-carrera="' + id + '">Editar</button>';
      if (c.estado === 'aceptada') acc += '<button class="btn btn-chico" data-reofrecer="' + id + '">Devolver a la cola</button>';
      if (['pendiente', 'aceptada', 'ejecucion'].indexOf(c.estado) >= 0)
        acc += '<button class="btn btn-chico btn-peligro" data-cancelar="' + id + '">Cancelar</button>';
      var espera = c.estado === 'pendiente' ? duracion(t - c.creada) :
        (c.aceptada ? duracion(c.aceptada - c.creada) : '—');
      var com = c.estado === 'finalizada' ? dineroC(c.comisionC) + (c.perdidaC ? '<small>pérdida ' + dineroC(c.perdidaC) + '</small>' : '') : '—';
      return '<tr><td><strong>#' + esc(c.numero) + '</strong><small>' + fechaHora(c.creada) + '</small></td>' +
        '<td>' + esc(c.cliente) + '<small>' + esc(c.telefono || '') + '</small></td>' +
        '<td>' + esc((c.origen || {}).dir || '—') + '<small>→ ' + esc((c.destino || {}).dir || 'Sin destino') + '</small></td>' +
        '<td>' + (c.conductor ? esc(c.conductorNombre || nombreCond(c.conductor)) + '<small>' + esc(c.unidad ? 'U' + c.unidad : '') + '</small>' : '—') + '</td>' +
        '<td><span class="pill ' + c.estado + '">' + NOMBRE_CARRERA[c.estado] + '</span></td>' +
        '<td>' + espera + '</td>' +
        '<td>' + precioTexto(c) + '</td>' +
        '<td>' + com + '</td>' +
        '<td><div class="acciones">' + acc + '</div></td></tr>';
    }).join('');
    setHTML('#tabla-carreras', '<thead><tr><th>Carrera</th><th>Cliente</th><th>Ruta</th><th>Conductor</th><th>Estado</th><th>Espera</th><th>Precio</th><th>Comisión</th><th>Acciones</th></tr></thead><tbody>' +
      (filas || '<tr><td colspan="9" class="muted" style="text-align:center;padding:28px">No hay carreras en este filtro.</td></tr>') + '</tbody>');
  }

  $$('#filtros-carreras .chip').forEach(function (b) {
    b.addEventListener('click', function () {
      S.filtroCarreras = b.getAttribute('data-filtro');
      $$('#filtros-carreras .chip').forEach(function (x) { x.classList.toggle('activo', x === b); });
      renderTablaCarreras();
    });
  });

  function renderTablaConductores() {
    var t = ahora();
    var hoy0 = inicioDia(new Date()).getTime();
    var stats = {};
    Object.keys(S.carreras).forEach(function (id) {
      var c = S.carreras[id];
      if (c.estado === 'finalizada' && c.conductor && (c.finalizada || 0) >= hoy0) {
        var s = stats[c.conductor] = stats[c.conductor] || { n: 0, total: 0 };
        s.n++; s.total += Number(c.tarifa) || 0;
      }
    });
    var uids = Object.keys(S.conductores).sort(function (a, b) {
      return String(S.conductores[a].unidad || '').localeCompare(String(S.conductores[b].unidad || ''), 'es', { numeric: true });
    });
    $('#conductores-sub').textContent = uids.length + ' registrados · cada uno entra a la app con su usuario y contraseña';
    var filas = uids.map(function (uid) {
      var c = S.conductores[uid];
      var e = S.estados[uid];
      var est = c.activo === false ? 'bloqueado' : estadoDe(uid);
      var etiqueta = c.activo === false ? 'Bloqueado' : NOMBRE_ESTADO[est];
      var s = stats[uid] || { n: 0, total: 0 };
      var sal = saldoC(uid);
      var acc = '';
      if (e && typeof e.lat === 'number') acc += '<button class="btn btn-chico" data-ver="' + uid + '">Ver en mapa</button>';
      acc += '<button class="btn btn-chico" data-editar="' + uid + '">Editar</button>';
      acc += c.activo === false
        ? '<button class="btn btn-chico" data-bloquear="' + uid + '" data-valor="1">Desbloquear</button>'
        : '<button class="btn btn-chico btn-peligro" data-bloquear="' + uid + '" data-valor="0">Bloquear</button>';
      return '<tr><td><strong>U' + esc(c.unidad || '') + '</strong></td>' +
        '<td>' + esc(c.nombre) + '<small>' + esc(c.telefono || '') + '</small></td>' +
        '<td>' + esc(c.vehiculo || '') + '<small>' + esc(c.placa || '') + '</small></td>' +
        '<td>' + esc(c.usuario || '') + '</td>' +
        '<td><span class="pill ' + est + '">' + etiqueta + '</span></td>' +
        '<td class="' + (sal < S.config.comisionMinC ? 'saldo-bajo' : 'saldo-ok') + '">' + dineroC(sal) + '</td>' +
        '<td>' + (e && e.t ? 'hace ' + duracion(Math.floor((t - e.t) / 10000) * 10000) : '—') + '</td>' +
        '<td>' + s.n + '</td><td><strong>' + dinero(s.total) + '</strong></td>' +
        '<td><div class="acciones">' + acc + '</div></td></tr>';
    }).join('');
    setHTML('#tabla-conductores', '<thead><tr><th>Unidad</th><th>Conductor</th><th>Vehículo</th><th>Usuario</th><th>Estado</th><th>Saldo</th><th>Último GPS</th><th>Carreras hoy</th><th>Cobrado hoy</th><th>Acciones</th></tr></thead><tbody>' +
      (filas || '<tr><td colspan="10" class="muted" style="text-align:center;padding:28px">Aún no hay conductores. Crea el primero con "+ Nuevo conductor".</td></tr>') + '</tbody>');
  }

  function vistaActual() {
    var v = $$('.vista').filter(function (x) { return !x.hidden; })[0];
    return v ? v.id.replace('vista-', '') : 'mapa';
  }

  var pendienteRender = false;
  function renderTodo() {
    if (pendienteRender) return;
    pendienteRender = true;
    requestAnimationFrame(function () {
      pendienteRender = false;
      if (!iniciado) return;
      renderKpis();
      renderAlertas();
      var v = vistaActual();
      if (v === 'mapa') { renderMapa(); renderActivas(); }
      if (v === 'carreras') renderTablaCarreras();
      if (v === 'conductores') renderTablaConductores();
      if (v === 'recargas') renderRecargas();
      if (v === 'clientes') renderClientes();
    });
  }

  // ------------------------------------------------------------------
  //  Acciones (delegación de eventos)
  // ------------------------------------------------------------------
  document.addEventListener('click', function (ev) {
    var b = ev.target.closest('button, a');
    if (!b) return;
    if (b.getAttribute('data-accion') === 'nueva-carrera') { abrirNuevaCarrera(null); return; }
    if (accionCliente(b)) return;
    var id;
    if ((id = b.getAttribute('data-asignar'))) { abrirAsignar(id); return; }
    if ((id = b.getAttribute('data-editar-carrera'))) { abrirNuevaCarrera(id); return; }
    if ((id = b.getAttribute('data-cancelar'))) { cancelarCarrera(id); return; }
    if ((id = b.getAttribute('data-reofrecer'))) { reofrecer(id); return; }
    if ((id = b.getAttribute('data-permitir'))) { permitir(id, b.getAttribute('data-uid'), b); return; }
    if ((id = b.getAttribute('data-denegar'))) { denegar(id, b.getAttribute('data-uid')); return; }
    if ((id = b.getAttribute('data-ver'))) {
      var e = S.estados[id];
      if (e) {
        enfocar(e.lat, e.lng);
        var mk = marcadores[id];
        if (mk) setTimeout(function () { if (!mk.getPopup().isOpen()) mk.togglePopup(); }, 150);
      }
      return;
    }
    if ((id = b.getAttribute('data-editar'))) { abrirConductor(id); return; }
    if ((id = b.getAttribute('data-bloquear'))) { bloquear(id, b.getAttribute('data-valor') === '1'); return; }
    if ((id = b.getAttribute('data-generar'))) { generarCodigo(id); return; }
    if ((id = b.getAttribute('data-borrar-paquete'))) { borrarPaquete(id); return; }
    if ((id = b.getAttribute('data-anular'))) { anularCodigo(id); return; }
    if (b.hasAttribute('data-cerrar')) {
      var d = b.closest('dialog');
      if (d) d.close();
    }
  });

  function liberarConductor(up, c, id) {
    if (c.conductor && S.estados[c.conductor] && S.estados[c.conductor].carrera === id) {
      up['estado/' + c.conductor + '/estado'] = 'libre';
      up['estado/' + c.conductor + '/carrera'] = null;
    }
  }

  function cancelarCarrera(id) {
    var c = S.carreras[id];
    if (!c) return;
    if (!confirm('¿Cancelar la carrera #' + c.numero + ' de ' + c.cliente + '?')) return;
    var up = {};
    up['carreras/' + id + '/estado'] = 'cancelada';
    up['carreras/' + id + '/cancelada'] = TS;
    up['carreras/' + id + '/solicitudes'] = null;
    liberarConductor(up, c, id);
    db.ref().update(up).then(function () { toast('Carrera #' + c.numero + ' cancelada.'); })
      .catch(function (e) { toast(errorTexto(e), true); });
  }

  function reofrecer(id) {
    var c = S.carreras[id];
    if (!c) return;
    if (!confirm('¿Quitarle la carrera #' + c.numero + ' a ' + (c.conductorNombre || 'el conductor') + ' y volver a ofrecerla?')) return;
    var up = {};
    var base = 'carreras/' + id + '/';
    ['conductor', 'conductorNombre', 'unidad', 'manual', 'aceptada', 'rechazos', 'solicitudes'].forEach(function (k) { up[base + k] = null; });
    up[base + 'estado'] = 'pendiente';
    up[base + 'ofertaDesde'] = TS;
    liberarConductor(up, c, id);
    db.ref().update(up).then(function () { toast('La carrera #' + c.numero + ' volvió a la cola.'); })
      .catch(function (e) { toast(errorTexto(e), true); });
  }

  // Asigna una carrera pendiente a un conductor (protegido por si otro la aceptó al mismo tiempo)
  function asignar(id, uid) {
    var cond = S.conductores[uid] || {};
    return db.ref('carreras/' + id).transaction(function (c) {
      if (c === null) return c;
      if (c.estado !== 'pendiente') return;
      c.estado = 'aceptada';
      c.conductor = uid;
      c.conductorNombre = cond.nombre || '';
      c.unidad = cond.unidad || '';
      c.manual = true;
      c.aceptada = TS;
      c.solicitudes = null;
      return c;
    }).then(function (r) {
      var v = r.snapshot.val();
      if (!r.committed || !v || v.conductor !== uid) throw { message: 'La carrera ya no está esperando (alguien la aceptó o fue cancelada).' };
      var up = {};
      up['estado/' + uid + '/estado'] = 'aceptada';
      up['estado/' + uid + '/carrera'] = id;
      return db.ref().update(up);
    });
  }

  function permitir(id, uid, boton) {
    var c = S.carreras[id];
    if (!c) return;
    boton.disabled = true;
    asignar(id, uid).then(function () {
      toast('Carrera #' + c.numero + ' asignada a ' + nombreCond(uid) + '.');
    }).catch(function (e) { boton.disabled = false; toast(errorTexto(e), true); });
  }

  function denegar(id, uid) {
    var up = {};
    up['carreras/' + id + '/solicitudes/' + uid] = null;
    up['carreras/' + id + '/rechazos/' + uid] = TS;
    db.ref().update(up).then(function () { toast('Listo. La carrera sigue buscando otro conductor.'); })
      .catch(function (e) { toast(errorTexto(e), true); });
  }

  function listaConductoresParaAsignar(origen) {
    return conductoresActivos().map(function (uid) {
      var e = S.estados[uid] || {};
      return {
        uid: uid,
        est: estadoDe(uid),
        km: origen ? Despacho.distanciaKm(e.lat, e.lng, origen.lat, origen.lng) : Infinity
      };
    }).sort(function (a, b) {
      var pa = a.est === 'libre' ? 0 : (a.est === 'sinsaldo' ? 1 : (a.est === 'fuera' ? 3 : 2));
      var pb = b.est === 'libre' ? 0 : (b.est === 'sinsaldo' ? 1 : (b.est === 'fuera' ? 3 : 2));
      return pa - pb || a.km - b.km;
    });
  }

  function abrirAsignar(id) {
    var c = S.carreras[id];
    if (!c) return;
    var com = c.comisionMinC || S.config.comisionMinC;
    $('#asignar-titulo').textContent = 'Asignar carrera #' + c.numero;
    $('#asignar-sub').textContent = c.cliente + ' · ' + ((c.origen || {}).dir || '') + '. Comisión estimada ' + dineroC(com) + '. Libres primero, por distancia.';
    var lista = listaConductoresParaAsignar(c.origen);
    setHTML('#asignar-lista', lista.length ? lista.map(function (x) {
      var cd = S.conductores[x.uid];
      var sal = saldoC(x.uid);
      return '<div class="cond-fila"><div class="info"><strong>' + esc(cd.nombre) + '</strong><br><small class="muted">U' +
        esc(cd.unidad || '') + ' · ' + esc(cd.placa || '') + ' · saldo <span class="' + (sal < com ? 'saldo-bajo' : 'saldo-ok') + '">' + dineroC(sal) + '</span></small></div>' +
        '<span class="km">' + kmTexto(x.km) + '</span>' +
        '<span class="pill ' + x.est + '">' + NOMBRE_ESTADO[x.est] + '</span>' +
        '<button class="btn btn-chico btn-primario" data-asignar-a="' + x.uid + '">Asignar</button></div>';
    }).join('') : '<div class="vacio">No hay conductores registrados.</div>');
    $$('#asignar-lista [data-asignar-a]').forEach(function (b) {
      b.addEventListener('click', function () {
        var uid = b.getAttribute('data-asignar-a');
        var est = estadoBase(uid);
        if (est !== 'libre' && !confirm('Este conductor no está libre. ¿Asignarle la carrera de todos modos?')) return;
        if (saldoC(uid) < com && !confirm('Este conductor tiene ' + dineroC(saldoC(uid)) + ' y la comisión estimada es ' + dineroC(com) + '. Si no alcanza, la diferencia queda como pérdida. ¿Asignar igual?')) return;
        b.disabled = true;
        asignar(id, uid).then(function () {
          $('#modal-asignar').close();
          toast('Carrera #' + c.numero + ' asignada a ' + nombreCond(uid) + '.');
        }).catch(function (e) { b.disabled = false; toast(errorTexto(e), true); });
      });
    });
    $('#modal-asignar').showModal();
  }

  // ------------------------------------------------------------------
  //  Nueva carrera / editar carrera
  // ------------------------------------------------------------------
  var NC = { cliente: null, editId: null, origen: null, destino: null, km: null, marcando: null, mapa: null, mOrigen: null, mDestino: null, linea: null, consulta: 0 };

  function abrirNuevaCarrera(editId) {
    var c = editId ? S.carreras[editId] : null;
    if (editId && (!c || ['pendiente', 'aceptada'].indexOf(c.estado) < 0)) { toast('Solo se puede editar una carrera que aún no empieza.', true); return; }
    $('#form-carrera').reset();
    NC.editId = editId; NC.origen = null; NC.destino = null; NC.km = null; NC.marcando = null;
    $('#c-titulo').textContent = editId ? 'Editar carrera #' + c.numero : 'Nueva carrera';
    $('#c-guardar').textContent = editId ? 'Guardar cambios' : 'Crear carrera';
    $('#c-modo').hidden = !!editId;
    $('#c-error').hidden = true;
    $('#c-manual').hidden = true;
    $('#sug-origen').hidden = true; $('#sug-destino').hidden = true;
    resetClienteModal(editId);
    $('#modal-carrera').showModal();
    if (!NC.mapa) {
      var cc = mapa ? mapa.getCenter() : null;
      NC.mapa = MapaAA.crear('mapa-carrera', cc ? [cc.lat, cc.lng] : AJ.centroMapa, 13);
      NC.mapa.on('click', function (ev) {
        if (!NC.marcando) { toast('Primero toca "Marcar en mapa" en Recogida o Destino.'); return; }
        var cual = NC.marcando;
        var lat = ev.lngLat.lat, lng = ev.lngLat.lng;
        ponerPunto(cual, lat, lng, null);
        marcar(null);
        dirInversa(lat, lng).then(function (dir) {
          if (dir && NC[cual] && NC[cual].lat === lat) {
            NC[cual].dir = dir;
            $('#c-' + cual).value = dir;
            pintarGuardadas();
          }
        });
      });
    }
    if (NC.mOrigen) { NC.mOrigen.remove(); NC.mOrigen = null; }
    if (NC.mDestino) { NC.mDestino.remove(); NC.mDestino = null; }
    NC.linea = null;
    MapaAA.ruta(NC.mapa, null, null);
    if (c) {
      $('#c-cliente').value = c.cliente || '';
      $('#c-telefono').value = c.telefono || '';
      $('#c-notas').value = c.notas || '';
      $('#c-exacta').value = c.exacta || '';
      if (c.precioFijo) $('#c-tarifa').value = Number(c.tarifa).toFixed(2);
      if (c.origen && typeof c.origen.lat === 'number') ponerPunto('origen', c.origen.lat, c.origen.lng, c.origen.dir);
      if (c.destino) {
        if (typeof c.destino.lat === 'number') ponerPunto('destino', c.destino.lat, c.destino.lng, c.destino.dir);
        else $('#c-destino').value = c.destino.dir || '';
      }
    }
    actualizarEstimado();
    setTimeout(function () {
      NC.mapa.resize();
      encuadrarModal();
    }, 80);
    llenarSelectConductores();
    setTimeout(function () { $(editId ? '#c-destino' : '#c-cliente').focus(); }, 100);
  }

  function marcar(cual) {
    NC.marcando = cual;
    $('#form-carrera').classList.toggle('mapa-marcando', !!cual);
    $('#c-ayuda-mapa').textContent = cual
      ? 'Toca en el mapa el punto de ' + (cual === 'origen' ? 'RECOGIDA' : 'DESTINO') + '.'
      : 'Usa "Marcar en mapa" y luego toca el punto exacto.';
  }

  $$('[data-marcar]').forEach(function (b) {
    b.addEventListener('click', function () { marcar(b.getAttribute('data-marcar')); });
  });
  $$('[data-buscar]').forEach(function (b) {
    b.addEventListener('click', function () { buscarDireccion(b.getAttribute('data-buscar')); });
  });
  ['origen', 'destino'].forEach(function (cual) {
    $('#c-' + cual).addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); buscarDireccion(cual); }
    });
    $('#c-' + cual).addEventListener('input', function () {
      if (NC[cual] && $('#c-' + cual).value !== NC[cual].dir) {
        NC[cual].confirmado = false;
        if (cual === 'destino') { NC.km = null; actualizarEstimado(); }
      }
    });
  });
  $('#c-tarifa').addEventListener('input', actualizarEstimado);

  function buscarDireccion(cual) {
    var q = $('#c-' + cual).value.trim();
    var caja = $('#sug-' + cual);
    if (q.length < 3) { toast('Escribe al menos 3 letras para buscar.'); return; }
    caja.hidden = false;
    caja.innerHTML = '<button type="button" disabled>Buscando…</button>';
    var c = NC.mapa ? NC.mapa.getCenter() : { lat: AJ.centroMapa[0], lng: AJ.centroMapa[1] };
    var vb = [c.lng - 0.4, c.lat + 0.4, c.lng + 0.4, c.lat - 0.4].join(',');
    var url = 'https://nominatim.openstreetmap.org/search?format=json&limit=6&accept-language=es' +
      '&countrycodes=' + encodeURIComponent(AJ.pais) + '&viewbox=' + vb + '&q=' + encodeURIComponent(q);
    fetch(url).then(function (r) { return r.json(); }).then(function (res) {
      if (!res.length) {
        caja.innerHTML = '<button type="button" disabled>Sin resultados. Usa "Marcar en mapa".</button>';
        return;
      }
      caja.innerHTML = res.map(function (r, i) {
        return '<button type="button" data-i="' + i + '">' + esc(r.display_name) + '</button>';
      }).join('');
      $$('#sug-' + cual + ' button[data-i]').forEach(function (b) {
        b.addEventListener('click', function () {
          var r = res[Number(b.getAttribute('data-i'))];
          var dir = r.display_name.split(',').slice(0, 3).join(',').trim();
          ponerPunto(cual, Number(r.lat), Number(r.lon), dir);
          caja.hidden = true;
          if (!NC.linea) NC.mapa.jumpTo({ center: [Number(r.lon), Number(r.lat)], zoom: 16 });
        });
      });
    }).catch(function () {
      caja.innerHTML = '<button type="button" disabled>No se pudo buscar. Usa "Marcar en mapa".</button>';
    });
  }

  function dirInversa(lat, lng) {
    var url = 'https://nominatim.openstreetmap.org/reverse?format=json&zoom=18&accept-language=es&lat=' + lat + '&lon=' + lng;
    return fetch(url).then(function (r) { return r.json(); }).then(function (r) {
      if (!r || !r.address) return null;
      var a = r.address;
      var partes = [a.road, a.house_number, a.neighbourhood || a.suburb].filter(Boolean);
      return partes.length ? partes.join(', ') : (r.display_name || '').split(',').slice(0, 3).join(',');
    }).catch(function () { return null; });
  }

  function ponerPunto(cual, lat, lng, dir) {
    var texto = dir || $('#c-' + cual).value.trim() || (lat.toFixed(5) + ', ' + lng.toFixed(5));
    NC[cual] = { lat: lat, lng: lng, dir: texto, confirmado: true };
    $('#c-' + cual).value = texto;
    var key = cual === 'origen' ? 'mOrigen' : 'mDestino';
    if (NC[key]) NC[key].remove();
    var el = document.createElement('div');
    el.className = cual === 'origen' ? 'pin-origen' : 'pin-destino';
    NC[key] = new maplibregl.Marker({ element: el, draggable: true }).setLngLat([lng, lat]).addTo(NC.mapa);
    NC[key].on('dragend', function () {
      var p = NC[key].getLngLat();
      NC[cual].lat = p.lat; NC[cual].lng = p.lng;
      actualizarRuta();
      dirInversa(p.lat, p.lng).then(function (d) { if (d) { NC[cual].dir = d; $('#c-' + cual).value = d; } });
    });
    actualizarRuta();
    llenarSelectConductores();
    pintarGuardadas();
  }

  // Distancia por calle (OSRM, gratis); si falla, línea recta × 1.3
  function calcularKm(o, d) {
    var url = 'https://router.project-osrm.org/route/v1/driving/' + o.lng + ',' + o.lat + ';' + d.lng + ',' + d.lat + '?overview=false';
    var recta = Despacho.distanciaKm(o.lat, o.lng, d.lat, d.lng) * 1.3;
    return fetch(url).then(function (r) { return r.json(); }).then(function (j) {
      var m = j && j.routes && j.routes[0] && j.routes[0].distance;
      return typeof m === 'number' ? m / 1000 : recta;
    }).catch(function () { return recta; });
  }

  function actualizarRuta() {
    NC.linea = null;
    NC.km = null;
    if (NC.origen && NC.destino && NC.destino.confirmado !== false) {
      NC.linea = true;
      MapaAA.ruta(NC.mapa, NC.origen, NC.destino);
      encuadrarModal();
      var consulta = ++NC.consulta;
      $('#c-sugerida').textContent = 'Calculando…';
      calcularKm(NC.origen, NC.destino).then(function (km) {
        if (consulta !== NC.consulta) return;
        NC.km = km;
        actualizarEstimado();
      });
    } else {
      MapaAA.ruta(NC.mapa, null, null);
      actualizarEstimado();
    }
  }

  function encuadrarModal() {
    if (!NC.mapa) return;
    if (NC.linea) MapaAA.encuadrar(NC.mapa, [[NC.origen.lat, NC.origen.lng], [NC.destino.lat, NC.destino.lng]], 16);
    else if (NC.origen) NC.mapa.jumpTo({ center: [NC.origen.lng, NC.origen.lat], zoom: 15 });
    else if (mapa) NC.mapa.jumpTo({ center: mapa.getCenter(), zoom: 13 });
  }

  // Calcula la comisión mínima que debe cubrir el conductor para esta carrera
  function datosPrecio() {
    var fijoTxt = $('#c-tarifa').value.trim();
    var cfg = S.config;
    if (fijoTxt !== '' && Number(fijoTxt) >= 0) {
      var fijoC = aCent(fijoTxt);
      return { precioFijo: true, tarifa: fijoC / 100, estimadoC: null, comisionMinC: Despacho.comisionC(fijoC, cfg) };
    }
    if (NC.destino && NC.destino.confirmado !== false && typeof NC.km === 'number') {
      var est = Despacho.tarifaEstimadaC(NC.km, cfg);
      return { precioFijo: false, tarifa: null, estimadoC: est, km: NC.km, comisionMinC: Despacho.comisionC(est, cfg) };
    }
    return { precioFijo: false, tarifa: null, estimadoC: null, comisionMinC: cfg.comisionMinC };
  }

  function actualizarEstimado() {
    var p = datosPrecio();
    if (typeof NC.km === 'number') {
      $('#c-sugerida').textContent = '≈ ' + NC.km.toFixed(1) + ' km · ' + dineroC(Despacho.tarifaEstimadaC(NC.km, S.config));
    } else if ($('#c-sugerida').textContent !== 'Calculando…') {
      $('#c-sugerida').textContent = 'Pon el destino';
    }
    var txt = p.precioFijo
      ? 'Precio fijo ' + dinero(p.tarifa) + ' · comisión ' + dineroC(p.comisionMinC) + '. Solo sonará a quien tenga ese saldo.'
      : (p.estimadoC
        ? 'Taxímetro · comisión estimada ' + dineroC(p.comisionMinC) + '. Solo sonará a quien tenga ese saldo.'
        : 'Taxímetro sin destino · sonará a quien tenga al menos ' + dineroC(p.comisionMinC) + '. Si alguien con menos de ' + dineroC(S.config.saldoAlertaC) + ' la quiere, te aviso.');
    $('#c-comision').textContent = txt;
  }

  $$('input[name="modo"]').forEach(function (r) {
    r.addEventListener('change', function () {
      $('#c-manual').hidden = $('input[name="modo"]:checked').value !== 'manual';
    });
  });

  function llenarSelectConductores() {
    var lista = listaConductoresParaAsignar(NC.origen);
    $('#c-conductor').innerHTML = lista.map(function (x) {
      var cd = S.conductores[x.uid];
      return '<option value="' + x.uid + '">' + esc('U' + (cd.unidad || '') + ' · ' + cd.nombre + ' · ' +
        NOMBRE_ESTADO[x.est] + ' · saldo ' + dineroC(saldoC(x.uid)) + (isFinite(x.km) ? ' · ' + kmTexto(x.km) : '')) + '</option>';
    }).join('');
  }

  $('#form-carrera').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var err = $('#c-error');
    err.hidden = true;
    if (!NC.origen || !NC.origen.confirmado) {
      err.textContent = 'Ubica la recogida: presiona "Buscar" y elige una opción, o usa "Marcar en mapa".';
      err.hidden = false; return;
    }
    var destinoTxt = $('#c-destino').value.trim();
    var destino = null;
    if (destinoTxt) {
      destino = (NC.destino && NC.destino.confirmado) ? { dir: destinoTxt, lat: NC.destino.lat, lng: NC.destino.lng } : { dir: destinoTxt };
    }
    if (destino && typeof destino.lat === 'number' && typeof NC.km !== 'number') {
      err.textContent = 'Espera un momento: aún se está calculando la distancia.';
      err.hidden = false; return;
    }
    var restr = (NC.cliente && NC.cliente.restringido) ? NC.cliente : clienteExacto($('#c-cliente').value, $('#c-telefono').value);
    if (!NC.editId && restr && restr.restringido) {
      mostrarRestringido(restr);
      err.textContent = 'Cliente restringido: no se le pueden crear carreras. Puedes quitar la restricción en Clientes.';
      err.hidden = false; return;
    }
    var p = datosPrecio();
    var datos = {
      cliente: $('#c-cliente').value.trim(),
      telefono: $('#c-telefono').value.trim(),
      origen: { dir: $('#c-origen').value.trim(), lat: NC.origen.lat, lng: NC.origen.lng },
      destino: destino,
      precioFijo: p.precioFijo,
      tarifa: p.tarifa,
      tarifaEstimadaC: p.estimadoC,
      kmEstimado: typeof p.km === 'number' ? Math.round(p.km * 10) / 10 : null,
      comisionMinC: p.comisionMinC,
      notas: $('#c-notas').value.trim(),
      exacta: $('#c-exacta').value.trim()
    };

    // ---- Editar ----
    if (NC.editId) {
      var id = NC.editId;
      $('#c-guardar').disabled = true;
      var up = {};
      Object.keys(datos).forEach(function (k) { up['carreras/' + id + '/' + k] = datos[k]; });
      db.ref().update(up).then(function () {
        $('#modal-carrera').close();
        toast('Carrera actualizada.');
      }).catch(function (e) { err.textContent = errorTexto(e); err.hidden = false; })
        .then(function () { $('#c-guardar').disabled = false; });
      return;
    }

    // ---- Crear ----
    var manual = $('input[name="modo"]:checked').value === 'manual';
    var uid = manual ? $('#c-conductor').value : null;
    if (manual && !uid) { err.textContent = 'Elige un conductor.'; err.hidden = false; return; }
    if (manual && saldoC(uid) < p.comisionMinC &&
      !confirm(nombreCond(uid) + ' tiene ' + dineroC(saldoC(uid)) + ' y la comisión es ' + dineroC(p.comisionMinC) + '. Si no alcanza, la diferencia queda como pérdida. ¿Asignar igual?')) return;

    $('#c-guardar').disabled = true;
    var cliExiste = (NC.cliente && !NC.cliente.restringido) ? NC.cliente : clienteExacto(datos.cliente, datos.telefono);
    var guardarCli = $('#c-guardar-cli').checked;
    var cliId = cliExiste ? cliExiste.id : (guardarCli ? db.ref(RUTA_CLIENTES).push().key : null);
    if (cliId) datos.clienteId = cliId;
    db.ref('contador/carreras').transaction(function (n) { return (n || 1000) + 1; }).then(function (r) {
      var numero = r.snapshot.val();
      var ref = db.ref('carreras').push();
      var c = datos;
      c.numero = numero;
      c.estado = 'pendiente';
      c.creada = TS;
      c.ofertaDesde = TS;
      c.creadaPor = auth.currentUser ? auth.currentUser.uid : '';
      Object.keys(c).forEach(function (k) { if (c[k] === null) delete c[k]; });
      var up = {};
      if (manual) {
        var cd = S.conductores[uid] || {};
        c.estado = 'aceptada';
        c.conductor = uid;
        c.conductorNombre = cd.nombre || '';
        c.unidad = cd.unidad || '';
        c.manual = true;
        c.aceptada = TS;
        up['estado/' + uid + '/estado'] = 'aceptada';
        up['estado/' + uid + '/carrera'] = ref.key;
      }
      up['carreras/' + ref.key] = c;
      return db.ref().update(up).then(function () { return numero; });
    }).then(function (numero) {
      var msg = manual ? 'Carrera #' + numero + ' asignada a ' + nombreCond(uid) + '.' : 'Carrera #' + numero + ' creada. Buscando conductor…';
      $('#modal-carrera').close();
      if (guardarCli && cliId) {
        var aviso = avisoCliente(cliExiste, datos);
        guardarClienteDeCarrera(datos, cliExiste, cliId)
          .then(function () { toast(aviso ? aviso + ' · ' + msg : msg); })
          .catch(function (e) { toast('La carrera se creó, pero no se pudo guardar el cliente: ' + errorTexto(e), true); });
      } else {
        toast(msg);
      }
    }).catch(function (e) {
      err.textContent = errorTexto(e);
      err.hidden = false;
    }).then(function () { $('#c-guardar').disabled = false; });
  });

  // ------------------------------------------------------------------
  //  Clientes guardados
  // ------------------------------------------------------------------
  function norm(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim(); }
  function soloNum(t) { return String(t || '').replace(/\D/g, ''); }
  function listaLugares(v) {
    var arr = Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.keys(v).sort(function (a, b) { return a - b; }).map(function (k) { return v[k]; }) : []);
    return arr.filter(function (x) { return x && x.dir; });
  }
  function clientesLista() {
    return Object.keys(S.clientes).map(function (id) {
      var c = S.clientes[id] || {};
      return { id: id, nombre: c.nombre || '', telefono: c.telefono || '', notas: c.notas || '',
        direcciones: listaLugares(c.direcciones), destinos: listaLugares(c.destinos),
        completadas: c.completadas || 0, ultima: c.ultima || 0, restringido: c.restringido === true, justificacion: c.justificacion || '' };
    });
  }
  function clientePorId(id) { return clientesLista().filter(function (c) { return c.id === id; })[0] || null; }
  function buscarClientes(q) {
    var n = norm(q), d = soloNum(q);
    if (!n) return [];
    return clientesLista().filter(function (c) {
      return (d.length >= 3 && soloNum(c.telefono).indexOf(d) !== -1) || norm(c.nombre).indexOf(n) !== -1;
    }).sort(function (a, b) { return (b.ultima || 0) - (a.ultima || 0); }).slice(0, 8);
  }
  // Cliente que coincide exacto por teléfono (o por nombre si no hay teléfono)
  function clienteExacto(nombre, tel) {
    var d = soloNum(tel), n = norm(nombre);
    var lista = clientesLista();
    if (d.length >= 6) {
      var porTel = lista.filter(function (c) { return soloNum(c.telefono) === d; })[0];
      if (porTel) return porTel;
    }
    return n ? (lista.filter(function (c) { return norm(c.nombre) === n; })[0] || null) : null;
  }
  function agregarLugar(lista, lugar) {
    if (!lugar || !lugar.dir) return lista;
    var nuevo = { dir: lugar.dir };
    if (typeof lugar.lat === 'number') { nuevo.lat = lugar.lat; nuevo.lng = lugar.lng; }
    if (lugar.exacta) nuevo.exacta = lugar.exacta;
    return [nuevo].concat(lista.filter(function (x) { return norm(x.dir) !== norm(lugar.dir); })).slice(0, 10);
  }

  // ---- En "Nueva carrera" ----
  function resetClienteModal(editId) {
    NC.cliente = null;
    $('#c-cliente-ok').hidden = true;
    $('#c-cliente-mal').hidden = true;
    $('#g-origen').hidden = true;
    $('#g-destino').hidden = true;
    $('#g-origen').setAttribute('data-abierto', '');
    $('#g-destino').setAttribute('data-abierto', '');
    $('#sug-cli-cliente').hidden = true;
    $('#sug-cli-telefono').hidden = true;
    $('#c-guardar-cli-fila').hidden = !!editId;
    $('#c-guardar-cli').checked = true;
    $('#c-guardar').disabled = false;
  }
  function mostrarRestringido(c) {
    $('#c-cliente-ok').hidden = true;
    $('#c-cliente-mal').innerHTML = '<strong>⛔ Cliente restringido</strong><span>Justificación: ' + esc(c.justificacion || 'sin justificación') + '</span>';
    $('#c-cliente-mal').hidden = false;
    $('#c-guardar').disabled = true;
  }
  function chipsLugares(caja, campo, lista, titulo) {
    caja.hidden = !lista.length;
    var abierto = caja.getAttribute('data-abierto') === '1';
    var elegido = lista.filter(function (d) { return norm(d.dir) === norm(campo.value); })[0];
    setHTML(caja, '<button type="button" class="plegar' + (abierto ? ' abierto' : '') + '" aria-expanded="' + abierto + '">' +
      '<span class="flecha">▸</span>' + titulo + ' <span class="cuenta">' + lista.length + '</span></button>' +
      '<div class="lista-chips"' + (abierto ? '' : ' hidden') + '>' + lista.map(function (d, i) {
        return '<button type="button" data-i="' + i + '" class="chip-lugar' + (d === elegido ? ' sel' : '') + '"' +
          (d.exacta ? ' title="' + esc(d.exacta) + '"' : '') + '>' + esc(d.dir) + '</button>';
      }).join('') + '</div>');
  }
  function textoCompletadas(n) { return n === 1 ? '1 carrera completada' : n + ' carreras completadas'; }
  function pintarAviso() {
    var c = NC.cliente, ok = $('#c-cliente-ok');
    if (!c || c.restringido || NC.editId) { ok.hidden = true; return; }
    var nd = esNuevoLugar(c.direcciones, { dir: $('#c-origen').value.trim() });
    var nde = esNuevoLugar(c.destinos, { dir: $('#c-destino').value.trim() });
    var extra = nd && nde ? 'Nueva dirección y nuevo destino: se registrarán al crear la carrera'
      : nd ? 'Nueva dirección: se registrará al crear la carrera'
      : nde ? 'Nuevo destino: se registrará al crear la carrera' : '';
    setHTML(ok, '<span>✓ Cliente registrado</span><strong class="cuenta-cli">' + textoCompletadas(c.completadas) + '</strong>' +
      (extra ? '<span class="nueva-dir">📍 ' + extra + '</span>' : ''));
    ok.hidden = false;
  }
  function pintarGuardadas() {
    pintarAviso();
    var c = NC.cliente;
    if (!c || c.restringido) { $('#g-origen').hidden = true; $('#g-destino').hidden = true; return; }
    chipsLugares($('#g-origen'), $('#c-origen'), c.direcciones, 'Direcciones guardadas');
    chipsLugares($('#g-destino'), $('#c-destino'), c.destinos, 'Destinos guardados');
  }
  function usarLugar(cual, l) {
    if (!l) return;
    $('#sug-' + cual).hidden = true;
    if (cual === 'origen') $('#c-exacta').value = l.exacta || '';
    if (typeof l.lat === 'number') {
      ponerPunto(cual, l.lat, l.lng, l.dir);
      if (!NC.linea && NC.mapa) NC.mapa.jumpTo({ center: [l.lng, l.lat], zoom: 15 });
    } else {
      $('#c-' + cual).value = l.dir;
      if (NC[cual]) NC[cual].confirmado = false;
      if (cual === 'destino') { NC.destino = null; actualizarRuta(); }
    }
    pintarGuardadas();
  }
  function llenarCliente(c) {
    $('#sug-cli-cliente').hidden = true;
    $('#sug-cli-telefono').hidden = true;
    NC.cliente = c;
    $('#c-cliente').value = c.nombre;
    $('#c-telefono').value = c.telefono;
    if (c.restringido) { mostrarRestringido(c); pintarGuardadas(); return; }
    $('#c-cliente-mal').hidden = true;
    $('#c-guardar').disabled = false;
    if (c.notas && !$('#c-notas').value) $('#c-notas').value = c.notas;
    if (c.direcciones[0]) usarLugar('origen', c.direcciones[0]);
    if (c.destinos[0]) usarLugar('destino', c.destinos[0]);
    pintarGuardadas();
  }
  [['g-origen', 'origen'], ['g-destino', 'destino']].forEach(function (p) {
    var caja = $('#' + p[0]);
    caja.addEventListener('click', function (ev) {
      if (ev.target.closest('.plegar')) {
        caja.setAttribute('data-abierto', caja.getAttribute('data-abierto') === '1' ? '' : '1');
        pintarGuardadas();
        return;
      }
      var b = ev.target.closest('button[data-i]');
      if (!b || !NC.cliente) return;
      var lista = p[1] === 'origen' ? NC.cliente.direcciones : NC.cliente.destinos;
      caja.setAttribute('data-abierto', '');
      usarLugar(p[1], lista[Number(b.getAttribute('data-i'))]);
    });
    $('#c-' + p[1]).addEventListener('input', pintarGuardadas);
  });
  ['cliente', 'telefono'].forEach(function (k) {
    var inp = $('#c-' + k), caja = $('#sug-cli-' + k), resultados = [];
    inp.addEventListener('input', function () {
      if (NC.editId) return;
      NC.cliente = null;
      $('#c-cliente-ok').hidden = true;
      $('#c-cliente-mal').hidden = true;
      $('#c-guardar').disabled = false;
      pintarGuardadas();
      resultados = buscarClientes(inp.value);
      caja.innerHTML = resultados.map(function (c, i) {
        return '<button type="button" data-i="' + i + '"><strong>' + esc(c.nombre) + ' · ' + esc(c.telefono) +
          (c.restringido ? ' <em class="tag-rest">Restringido</em>' : '') + '</strong><span>' +
          esc(c.direcciones[0] ? c.direcciones[0].dir : '') + (c.destinos[0] ? ' → ' + esc(c.destinos[0].dir) : '') + '</span></button>';
      }).join('');
      caja.hidden = !resultados.length;
    });
    inp.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter') return;
      ev.preventDefault();
      if (NC.editId) return;
      resultados = buscarClientes(inp.value);
      if (resultados.length) llenarCliente(resultados[0]);
      else { caja.hidden = true; toast('No hay un cliente guardado con ese ' + (k === 'cliente' ? 'nombre' : 'número') + '. Llena sus datos y se guardará al crear la carrera.'); }
    });
    inp.addEventListener('blur', function () { setTimeout(function () { caja.hidden = true; }, 200); });
    caja.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
    caja.addEventListener('click', function (ev) {
      var b = ev.target.closest('button[data-i]');
      if (b) llenarCliente(resultados[Number(b.getAttribute('data-i'))]);
    });
  });

  // Guarda o actualiza el cliente al crear la carrera
  function esNuevoLugar(lista, lugar) {
    return !!(lugar && lugar.dir) && !lista.some(function (x) { return norm(x.dir) === norm(lugar.dir); });
  }
  function avisoCliente(c, datos) {
    if (!c) return '✓ Cliente registrado correctamente';
    var nd = esNuevoLugar(c.direcciones, datos.origen), nde = esNuevoLugar(c.destinos, datos.destino);
    return nd && nde ? '📍 Nueva dirección y nuevo destino registrados' : nd ? '📍 Nueva dirección registrada' : nde ? '📍 Nuevo destino registrado' : '';
  }
  function guardarClienteDeCarrera(datos, c, id) {
    var dirs = agregarLugar(c ? c.direcciones : [], datos.origen ? { dir: datos.origen.dir, lat: datos.origen.lat, lng: datos.origen.lng, exacta: datos.exacta } : null);
    var dests = agregarLugar(c ? c.destinos : [], datos.destino);
    var up = {
      nombre: datos.cliente,
      telefono: datos.telefono || '',
      tel: soloNum(datos.telefono),
      direcciones: dirs,
      destinos: dests,
      ultima: TS
    };
    if (datos.notas) up.notas = datos.notas;
    if (!c) { up.creado = TS; up.completadas = 0; }
    return db.ref(RUTA_CLIENTES + '/' + id).update(up);
  }

  // ---- Sección Clientes ----
  function renderClientes() {
    var q = $('#buscar-clientes').value;
    var todos = clientesLista();
    var lista = q.trim() ? buscarClientes(q).concat([]) : todos.sort(function (a, b) { return (b.ultima || 0) - (a.ultima || 0); });
    if (q.trim()) {
      var n = norm(q), d = soloNum(q);
      lista = todos.filter(function (c) { return (d.length >= 3 && soloNum(c.telefono).indexOf(d) !== -1) || norm(c.nombre).indexOf(n) !== -1; });
    }
    var nr = todos.filter(function (c) { return c.restringido; }).length;
    $('#clientes-sub').textContent = todos.length + ' clientes guardados' + (nr ? ' · ' + nr + ' restringido' + (nr > 1 ? 's' : '') : '');
    function corta(arr) {
      if (!arr.length) return '<span class="muted">—</span>';
      return esc(arr[0].dir) + (arr.length > 1 ? '<small>+' + (arr.length - 1) + ' más</small>' : '');
    }
    var filas = lista.slice(0, 300).map(function (c) {
      return '<tr class="' + (c.restringido ? 'restringido' : '') + '"><td><strong>' + esc(c.nombre) + '</strong><small>' + esc(c.telefono) + '</small>' +
        (c.restringido ? '<span class="tag-rest">Restringido</span><small class="just">' + esc(c.justificacion) + '</small>' : '') +
        '</td><td>' + corta(c.direcciones) + '</td><td>' + corta(c.destinos) + '</td><td>' + c.completadas + '</td><td>' +
        (c.ultima ? fechaHora(c.ultima) : '—') + '</td><td><div class="acciones acciones-cli">' +
        (c.restringido ? '<button class="btn btn-chico btn-primario" disabled title="Cliente restringido">Pedir carrera</button>'
                       : '<button class="btn btn-chico btn-primario" data-cli-pedir="' + c.id + '">Pedir carrera</button>') +
        '<button class="btn btn-chico" data-cli-editar="' + c.id + '">Editar</button>' +
        (c.restringido ? '<button class="btn btn-chico" data-cli-quitar="' + c.id + '">Quitar restricción</button>'
                       : '<button class="btn btn-chico btn-peligro" data-cli-restringir="' + c.id + '">Restringir</button>') +
        '<button class="btn btn-chico btn-peligro" data-cli-eliminar="' + c.id + '">Eliminar</button></div></td></tr>';
    }).join('');
    setHTML('#tabla-clientes', '<thead><tr><th>Cliente</th><th>Recogidas</th><th>Destinos</th><th>Completadas</th><th>Última</th><th></th></tr></thead><tbody>' +
      (filas || '<tr><td colspan="6"><div class="vacio">' + (q.trim() ? 'Ningún cliente coincide.' : 'Aún no hay clientes. Se guardan solos al crear carreras, o usa "+ Nuevo cliente".') + '</div></td></tr>') + '</tbody>');
  }
  $('#buscar-clientes').addEventListener('input', renderClientes);

  var clienteEditando = null, clienteRestringiendo = null;
  function lineasLugares(texto, previos) {
    return texto.split('\n').map(function (x) { return x.trim(); }).filter(Boolean).slice(0, 10).map(function (dir) {
      var p = previos.filter(function (x) { return norm(x.dir) === norm(dir); })[0];
      var r = p && typeof p.lat === 'number' ? { dir: dir, lat: p.lat, lng: p.lng } : { dir: dir };
      if (p && p.exacta) r.exacta = p.exacta;
      return r;
    });
  }
  function abrirCliente(id) {
    var c = id ? clientePorId(id) : null;
    clienteEditando = c;
    $('#form-cliente').reset();
    $('#mc-error').hidden = true;
    $('#mc-titulo').textContent = c ? 'Editar cliente' : 'Nuevo cliente';
    if (c) {
      $('#mc-nombre').value = c.nombre; $('#mc-telefono').value = c.telefono; $('#mc-notas').value = c.notas;
      $('#mc-direcciones').value = c.direcciones.map(function (x) { return x.dir; }).join('\n');
      $('#mc-destinos').value = c.destinos.map(function (x) { return x.dir; }).join('\n');
    }
    $('#modal-cliente').showModal();
  }
  $('#nuevo-cliente').addEventListener('click', function () { abrirCliente(null); });
  $('#form-cliente').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var c = clienteEditando;
    var nombre = $('#mc-nombre').value.trim(), tel = $('#mc-telefono').value.trim();
    var otro = clienteExacto('', tel);
    if (otro && (!c || otro.id !== c.id)) {
      $('#mc-error').textContent = 'Ya existe un cliente con ese teléfono: ' + otro.nombre + '.';
      $('#mc-error').hidden = false; return;
    }
    var datos = {
      nombre: nombre, telefono: tel, tel: soloNum(tel), notas: $('#mc-notas').value.trim(),
      direcciones: lineasLugares($('#mc-direcciones').value, c ? c.direcciones : []),
      destinos: lineasLugares($('#mc-destinos').value, c ? c.destinos : [])
    };
    var ref = c ? db.ref(RUTA_CLIENTES + '/' + c.id) : db.ref(RUTA_CLIENTES).push();
    if (!c) { datos.creado = TS; datos.completadas = 0; }
    (c ? ref.update(datos) : ref.set(datos)).then(function () {
      $('#modal-cliente').close();
      toast(c ? 'Cliente actualizado.' : 'Cliente registrado correctamente.');
    }).catch(function (e) { $('#mc-error').textContent = errorTexto(e); $('#mc-error').hidden = false; });
  });
  $('#form-restringir').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var j = $('#mr-justificacion').value.trim();
    if (!j || !clienteRestringiendo) return;
    db.ref(RUTA_CLIENTES + '/' + clienteRestringiendo.id).update({
      restringido: true, justificacion: j, restringidoEn: TS,
      restringidoPor: auth.currentUser ? (auth.currentUser.email || auth.currentUser.uid) : ''
    }).then(function () {
      $('#modal-restringir').close();
      toast(clienteRestringiendo.nombre + ' quedó restringido.');
    }).catch(function (e) { toast(errorTexto(e), true); });
  });
  function accionCliente(b) {
    var id;
    if ((id = b.getAttribute('data-cli-pedir'))) {
      var c = clientePorId(id);
      abrirNuevaCarrera(null);
      if (c) llenarCliente(c);
      return true;
    }
    if ((id = b.getAttribute('data-cli-editar'))) { abrirCliente(id); return true; }
    if ((id = b.getAttribute('data-cli-restringir'))) {
      clienteRestringiendo = clientePorId(id);
      if (!clienteRestringiendo) return true;
      $('#mr-nombre').textContent = clienteRestringiendo.nombre + ' · ' + clienteRestringiendo.telefono;
      $('#form-restringir').reset();
      $('#modal-restringir').showModal();
      return true;
    }
    if ((id = b.getAttribute('data-cli-quitar'))) {
      db.ref(RUTA_CLIENTES + '/' + id).update({ restringido: null, justificacion: null, restringidoEn: null, restringidoPor: null })
        .then(function () { toast('Se quitó la restricción.'); }).catch(function (e) { toast(errorTexto(e), true); });
      return true;
    }
    if ((id = b.getAttribute('data-cli-eliminar'))) {
      var ce = clientePorId(id);
      if (ce && confirm('¿Eliminar al cliente ' + ce.nombre + '? Sus carreras pasadas no se borran.')) {
        db.ref(RUTA_CLIENTES + '/' + id).remove().then(function () { toast('Cliente eliminado.'); }).catch(function (e) { toast(errorTexto(e), true); });
      }
      return true;
    }
    return false;
  }

  // ------------------------------------------------------------------
  //  Conductores
  // ------------------------------------------------------------------
  var editando = null;
  $('#boton-nuevo-conductor').addEventListener('click', function () { abrirConductor(null); });

  function abrirConductor(uid) {
    editando = uid;
    $('#form-conductor').reset();
    $('#cd-error').hidden = true;
    var nuevo = !uid;
    $('#cond-titulo').textContent = nuevo ? 'Nuevo conductor' : 'Editar conductor';
    $('#cd-usuario-fila').hidden = !nuevo;
    $('#cd-pass-fila').hidden = !nuevo;
    $('#cd-usuario').required = nuevo;
    $('#cd-pass').required = nuevo;
    $('#cd-nota').textContent = nuevo
      ? 'Entrégale al conductor su usuario y contraseña para entrar a la app. Empieza con saldo $0: envíale un código de recarga.'
      : 'Usuario: ' + (S.conductores[uid].usuario || '') + '. Para cambiar la contraseña, bloquea este usuario y crea uno nuevo.';
    if (!nuevo) {
      var c = S.conductores[uid];
      $('#cd-nombre').value = c.nombre || '';
      $('#cd-telefono').value = c.telefono || '';
      $('#cd-unidad').value = c.unidad || '';
      $('#cd-placa').value = c.placa || '';
      $('#cd-vehiculo').value = c.vehiculo || '';
    }
    $('#modal-conductor').showModal();
  }

  var appSecundaria = null;
  function authSecundaria() {
    if (!appSecundaria) appSecundaria = firebase.initializeApp(window.FIREBASE_CONFIG, 'secundaria');
    return appSecundaria.auth();
  }

  $('#form-conductor').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var err = $('#cd-error');
    err.hidden = true;
    var datos = {
      nombre: $('#cd-nombre').value.trim(),
      telefono: $('#cd-telefono').value.trim(),
      unidad: $('#cd-unidad').value.trim(),
      placa: $('#cd-placa').value.trim().toUpperCase(),
      vehiculo: $('#cd-vehiculo').value.trim()
    };
    $('#cd-guardar').disabled = true;
    var p;
    var usuario = $('#cd-usuario').value.trim().toLowerCase();
    if (editando) {
      p = db.ref('conductores/' + editando).update(datos);
    } else {
      var email = usuario + '@' + AJ.dominioUsuarios;
      var a2 = authSecundaria();
      p = a2.createUserWithEmailAndPassword(email, $('#cd-pass').value).then(function (cred) {
        var uid = cred.user.uid;
        datos.usuario = usuario;
        datos.activo = true;
        datos.creado = TS;
        return a2.signOut().then(function () {
          var up = {};
          up['conductores/' + uid] = datos;
          up['saldos/' + uid + '/saldoC'] = 0;
          return db.ref().update(up);
        });
      });
    }
    p.then(function () {
      $('#modal-conductor').close();
      toast(editando ? 'Datos guardados.' : 'Conductor creado. Usuario: ' + usuario);
    }).catch(function (e) {
      err.textContent = errorTexto(e);
      err.hidden = false;
    }).then(function () { $('#cd-guardar').disabled = false; });
  });

  function bloquear(uid, activar) {
    var c = S.conductores[uid];
    if (!activar && !confirm('¿Bloquear a ' + c.nombre + '? No podrá usar la app hasta que lo desbloquees.')) return;
    var up = {};
    up['conductores/' + uid + '/activo'] = activar;
    if (!activar) up['estado/' + uid + '/online'] = false;
    db.ref().update(up).then(function () { toast(activar ? 'Conductor desbloqueado.' : 'Conductor bloqueado.'); })
      .catch(function (e) { toast(errorTexto(e), true); });
  }

  // ------------------------------------------------------------------
  //  Recargas (protegidas con clave)
  // ------------------------------------------------------------------
  var recargasAbiertas = false;
  try { recargasAbiertas = sessionStorage.getItem('aa_recargas') === '1'; } catch (e) { recargasAbiertas = false; }

  function hashClave(txt) {
    var datos = 'autoamigo|' + txt;
    if (window.crypto && crypto.subtle && window.TextEncoder) {
      return crypto.subtle.digest('SHA-256', new TextEncoder().encode(datos)).then(function (buf) {
        return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
      });
    }
    var h = 5381;
    for (var i = 0; i < datos.length; i++) h = ((h * 33) ^ datos.charCodeAt(i)) >>> 0;
    return Promise.resolve('d' + h.toString(16));
  }

  function prepararCandado() {
    var primera = !S.claveHash;
    $('#clave-titulo').textContent = primera ? 'Crea la clave de recargas' : 'Sección protegida';
    $('#clave-sub').textContent = primera
      ? 'Elige una clave para que solo tú puedas crear códigos de recarga. Guárdala bien.'
      : 'Ingresa la clave de recargas.';
    $('#clave2-fila').hidden = !primera;
    $('#clave-input2').required = primera;
    $('#clave-boton').textContent = primera ? 'Guardar clave' : 'Entrar';
    var abierta = recargasAbiertas && !primera;
    $('#form-clave').hidden = abierta;
    $('#recargas-contenido').hidden = !abierta;
    $('#boton-bloquear-recargas').hidden = !abierta;
    if (abierta) renderRecargas();
  }

  function bloquearRecargas() {
    recargasAbiertas = false;
    try { sessionStorage.removeItem('aa_recargas'); } catch (e) { /* nada */ }
    prepararCandado();
  }
  $('#boton-bloquear-recargas').addEventListener('click', bloquearRecargas);

  $('#form-clave').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var err = $('#clave-error');
    err.hidden = true;
    var c1 = $('#clave-input').value;
    var primera = !S.claveHash;
    if (primera && c1 !== $('#clave-input2').value) { err.textContent = 'Las claves no coinciden.'; err.hidden = false; return; }
    hashClave(c1).then(function (h) {
      if (primera) return db.ref('recargas/claveHash').set(h);
      if (h !== S.claveHash) throw { message: 'Clave incorrecta.' };
    }).then(function () {
      recargasAbiertas = true;
      try { sessionStorage.setItem('aa_recargas', '1'); } catch (e) { /* nada */ }
      $('#form-clave').reset();
      prepararCandado();
    }).catch(function (e) { err.textContent = errorTexto(e); err.hidden = false; });
  });

  function renderRecargas() {
    if (!recargasAbiertas || vistaActual() !== 'recargas') return;
    // Paquetes
    var paqs = Object.keys(S.paquetes).sort(function (a, b) { return (S.paquetes[a].montoC || 0) - (S.paquetes[b].montoC || 0); });
    setHTML('#lista-paquetes', paqs.length ? paqs.map(function (id) {
      var p = S.paquetes[id];
      return '<div class="paquete"><span class="monto">' + dineroC(p.montoC) + '</span><span class="nombre">' + esc(p.nombre || '') + '</span>' +
        '<button class="btn btn-chico btn-primario" data-generar="' + id + '">Generar código</button>' +
        '<button class="btn btn-chico btn-peligro" data-borrar-paquete="' + id + '" aria-label="Borrar paquete">Borrar</button></div>';
    }).join('') : '<div class="vacio">Aún no hay paquetes. Agrega uno abajo (ej. $10, $20, $50).</div>');

    // Saldos
    var uids = conductoresActivos().sort(function (a, b) { return saldoC(a) - saldoC(b); });
    var totalSaldos = 0;
    uids.forEach(function (u) { totalSaldos += saldoC(u); });
    setHTML('#tabla-saldos', '<thead><tr><th>Conductor</th><th>Saldo</th></tr></thead><tbody>' + uids.map(function (u) {
      var s = saldoC(u);
      return '<tr><td>' + esc(unidadCond(u)) + ' · ' + esc(nombreCond(u)) + '</td><td class="' + (s < S.config.comisionMinC ? 'saldo-bajo' : 'saldo-ok') + '">' + dineroC(s) + '</td></tr>';
    }).join('') + '</tbody>');

    // Códigos
    var cods = Object.keys(S.codigos).sort(function (a, b) { return (S.codigos[b].creado || 0) - (S.codigos[a].creado || 0); });
    var hoy0 = inicioDia(new Date()).getTime(), vendidoHoy = 0, disponibles = 0;
    cods.forEach(function (k) {
      var c = S.codigos[k];
      if (c.usado && (c.usadoEn || 0) >= hoy0) vendidoHoy += c.montoC || 0;
      if (!c.usado) disponibles++;
    });
    setHTML('#recargas-kpis',
      kpi('libre', 'Recargado hoy', dineroC(vendidoHoy)) +
      kpi('pendiente', 'Códigos sin usar', disponibles) +
      kpi('aceptada', 'Saldo total de conductores', dineroC(totalSaldos)));
    var f = S.filtroCodigos;
    var filas = cods.filter(function (k) {
      var c = S.codigos[k];
      return f === 'todos' || (f === 'usado' ? c.usado : !c.usado);
    }).map(function (k) {
      var c = S.codigos[k];
      return '<tr><td class="mono">' + esc(formatoCodigo(k)) + '</td><td><strong>' + dineroC(c.montoC) + '</strong><small>' + esc(c.paquete || '') + '</small></td>' +
        '<td>' + fechaHora(c.creado) + '</td>' +
        '<td>' + (c.usado ? '<span class="pill finalizada">Usado</span>' : '<span class="pill libre">Disponible</span>') + '</td>' +
        '<td>' + (c.usado ? esc(nombreCond(c.usadoPor)) + '<small>' + fechaHora(c.usadoEn) + '</small>' : '—') + '</td>' +
        '<td>' + (c.usado ? '' : '<button class="btn btn-chico btn-peligro" data-anular="' + k + '">Anular</button>') + '</td></tr>';
    }).join('');
    setHTML('#tabla-codigos', '<thead><tr><th>Código</th><th>Monto</th><th>Creado</th><th>Estado</th><th>Usado por</th><th></th></tr></thead><tbody>' +
      (filas || '<tr><td colspan="6" class="muted" style="text-align:center;padding:28px">No hay códigos en este filtro.</td></tr>') + '</tbody>');
  }

  $$('#filtros-codigos .chip').forEach(function (b) {
    b.addEventListener('click', function () {
      S.filtroCodigos = b.getAttribute('data-filtro');
      $$('#filtros-codigos .chip').forEach(function (x) { x.classList.toggle('activo', x === b); });
      renderRecargas();
    });
  });

  $('#form-paquete').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var montoC = aCent($('#paq-monto').value);
    if (montoC < 50) { toast('El monto mínimo es $0.50.', true); return; }
    var nombre = $('#paq-nombre').value.trim() || ('Recarga ' + dineroC(montoC));
    db.ref('recargas/paquetes').push({ nombre: nombre, montoC: montoC }).then(function () {
      $('#form-paquete').reset();
      toast('Paquete agregado.');
    }).catch(function (e) { toast(errorTexto(e), true); });
  });

  function borrarPaquete(id) {
    var p = S.paquetes[id];
    if (!p || !confirm('¿Borrar el paquete ' + dineroC(p.montoC) + '? Los códigos ya generados siguen valiendo.')) return;
    db.ref('recargas/paquetes/' + id).remove().catch(function (e) { toast(errorTexto(e), true); });
  }

  var LETRAS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  function nuevoCodigo() {
    var out = '', buf = new Uint32Array(8);
    if (window.crypto && crypto.getRandomValues) crypto.getRandomValues(buf);
    else for (var j = 0; j < 8; j++) buf[j] = Math.floor(Math.random() * 1e9);
    for (var i = 0; i < 8; i++) out += LETRAS.charAt(buf[i] % LETRAS.length);
    return out;
  }
  function formatoCodigo(k) { return k.length === 8 ? k.slice(0, 4) + '-' + k.slice(4) : k; }

  var codigoActual = null;
  function generarCodigo(paqId) {
    var p = S.paquetes[paqId];
    if (!p) return;
    var k = nuevoCodigo();
    var datos = { montoC: p.montoC, paquete: p.nombre || '', creado: TS, creadoPor: auth.currentUser ? auth.currentUser.uid : '', usado: false };
    // transaction: evita pisar un código existente (casi imposible, pero seguro)
    db.ref('recargas/codigos/' + k).transaction(function (actual) {
      if (actual !== null) return;
      return datos;
    }).then(function (r) {
      if (!r.committed) { generarCodigo(paqId); return; }
      codigoActual = { codigo: k, montoC: p.montoC };
      $('#codigo-texto').textContent = formatoCodigo(k);
      $('#codigo-monto').textContent = 'Recarga de ' + dineroC(p.montoC) + '. Válido una sola vez.';
      $('#codigo-conductor').innerHTML = '<option value="">— Elegir conductor (opcional) —</option>' +
        conductoresActivos().map(function (u) {
          var cd = S.conductores[u];
          return '<option value="' + u + '">' + esc('U' + (cd.unidad || '') + ' · ' + cd.nombre) + '</option>';
        }).join('');
      actualizarEnlaceWhatsapp();
      $('#modal-codigo').showModal();
    }).catch(function (e) { toast(errorTexto(e), true); });
  }

  function actualizarEnlaceWhatsapp() {
    if (!codigoActual) return;
    var uid = $('#codigo-conductor').value;
    var tel = uid ? telefonoWhatsapp((S.conductores[uid] || {}).telefono) : '';
    var msg = 'AutoAmigo · Tu código de recarga de ' + dineroC(codigoActual.montoC) + ' es: ' + formatoCodigo(codigoActual.codigo) +
      '\nIngrésalo en la app: Saldo → Recargar.';
    $('#codigo-whatsapp').href = 'https://wa.me/' + tel + '?text=' + encodeURIComponent(msg);
  }
  $('#codigo-conductor').addEventListener('change', actualizarEnlaceWhatsapp);
  $('#codigo-copiar').addEventListener('click', function () {
    if (!codigoActual) return;
    var t = formatoCodigo(codigoActual.codigo);
    (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { toast('Código copiado.'); })
      .catch(function () { prompt('Copia el código:', t); });
  });

  function anularCodigo(k) {
    if (!confirm('¿Anular el código ' + formatoCodigo(k) + '? Ya no se podrá usar.')) return;
    db.ref('recargas/codigos/' + k).remove().then(function () { toast('Código anulado.'); })
      .catch(function (e) { toast(errorTexto(e), true); });
  }

  // ------------------------------------------------------------------
  //  Reportes
  // ------------------------------------------------------------------
  function fechaInput(d) {
    var m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + dd;
  }
  function inicioDia(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function leerFecha(v) { var p = v.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
  function rango(idDesde, idHasta) {
    var desde = leerFecha($(idDesde).value).getTime();
    var hasta = leerFecha($(idHasta).value).getTime() + 24 * 3600 * 1000 - 1;
    return hasta < desde ? null : [desde, hasta];
  }

  $('#form-reporte').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var r = rango('#rep-desde', '#rep-hasta');
    if (!r) { toast('La fecha "Hasta" debe ser después de "Desde".', true); return; }
    db.ref('carreras').orderByChild('creada').startAt(r[0]).endAt(r[1]).once('value').then(function (s) {
      var todas = s.val() || {};
      var porCond = {}, tot = { n: 0, total: 0, com: 0, cobrada: 0, perdida: 0, canceladas: 0 };
      Object.keys(todas).forEach(function (id) {
        var c = todas[id];
        if (c.estado === 'cancelada') { tot.canceladas++; return; }
        if (c.estado !== 'finalizada') return;
        var k = c.conductor || '-';
        var x = porCond[k] = porCond[k] || { n: 0, total: 0, com: 0, cobrada: 0, perdida: 0, nombre: c.conductorNombre || nombreCond(k), unidad: c.unidad || '' };
        var t = Number(c.tarifa) || 0, cm = Number(c.comisionC) || 0, cb = Number(c.comisionCobradaC) || 0, pe = Number(c.perdidaC) || 0;
        x.n++; x.total += t; x.com += cm; x.cobrada += cb; x.perdida += pe;
        tot.n++; tot.total += t; tot.com += cm; tot.cobrada += cb; tot.perdida += pe;
      });
      S.reporte = { desde: $('#rep-desde').value, hasta: $('#rep-hasta').value, carreras: todas };
      setHTML('#rep-kpis',
        kpi('libre', 'Carreras finalizadas', tot.n) +
        kpi('aceptada', 'Total cobrado a pasajeros', dinero(tot.total)) +
        kpi('pendiente', 'Comisión cobrada', dineroC(tot.cobrada)) +
        kpi('sinsaldo', 'Pérdida por saldo', dineroC(tot.perdida)) +
        kpi('fuera', 'Canceladas', tot.canceladas));
      var filas = Object.keys(porCond).sort(function (a, b) { return porCond[b].total - porCond[a].total; }).map(function (k) {
        var x = porCond[k];
        return '<tr><td><strong>' + esc(x.unidad ? 'U' + x.unidad : '') + '</strong></td><td>' + esc(x.nombre) + '</td><td>' + x.n +
          '</td><td><strong>' + dinero(x.total) + '</strong></td><td>' + dineroC(x.com) + '</td><td>' + dineroC(x.cobrada) +
          '</td><td class="' + (x.perdida ? 'saldo-bajo' : '') + '">' + dineroC(x.perdida) + '</td></tr>';
      }).join('');
      setHTML('#tabla-reporte', '<thead><tr><th>Unidad</th><th>Conductor</th><th>Carreras</th><th>Cobrado</th><th>Comisión</th><th>Comisión cobrada</th><th>Pérdida</th></tr></thead><tbody>' +
        (filas || '<tr><td colspan="7" class="muted" style="text-align:center;padding:28px">No hay carreras finalizadas en esas fechas.</td></tr>') + '</tbody>');
    }).catch(function (e) { toast(errorTexto(e), true); });
  });

  $('#boton-csv').addEventListener('click', function () {
    if (!S.reporte) { toast('Primero presiona "Ver reporte".'); return; }
    var filas = [['Numero', 'Fecha', 'Cliente', 'Telefono', 'Recogida', 'Destino', 'Unidad', 'Conductor', 'Estado', 'Tipo', 'Tarifa', 'Comision', 'Comision cobrada', 'Perdida']];
    var cs = S.reporte.carreras;
    Object.keys(cs).sort(function (a, b) { return (cs[a].creada || 0) - (cs[b].creada || 0); }).forEach(function (id) {
      var c = cs[id];
      filas.push([c.numero, fechaHora(c.creada), c.cliente, c.telefono || '', (c.origen || {}).dir || '', (c.destino || {}).dir || '',
        c.unidad || '', c.conductorNombre || '', NOMBRE_CARRERA[c.estado] || c.estado, c.precioFijo ? 'Precio fijo' : 'Taxímetro',
        (Number(c.tarifa) || 0).toFixed(2), ((Number(c.comisionC) || 0) / 100).toFixed(2),
        ((Number(c.comisionCobradaC) || 0) / 100).toFixed(2), ((Number(c.perdidaC) || 0) / 100).toFixed(2)]);
    });
    var csv = '﻿' + filas.map(function (f) {
      return f.map(function (v) { return '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"'; }).join(';');
    }).join('\r\n');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    a.download = 'autoamigo-carreras-' + S.reporte.desde + '-a-' + S.reporte.hasta + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
  });

  // ------------------------------------------------------------------
  //  Pérdidas
  // ------------------------------------------------------------------
  $('#form-perdidas').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var r = rango('#per-desde', '#per-hasta');
    if (!r) { toast('La fecha "Hasta" debe ser después de "Desde".', true); return; }
    db.ref('perdidas').orderByChild('fecha').startAt(r[0]).endAt(r[1]).once('value').then(function (s) {
      var v = s.val() || {};
      var ids = Object.keys(v).sort(function (a, b) { return (v[b].fecha || 0) - (v[a].fecha || 0); });
      var porCond = {}, total = 0;
      ids.forEach(function (id) {
        var p = v[id];
        total += p.perdidaC || 0;
        var x = porCond[p.conductor] = porCond[p.conductor] || { n: 0, perdida: 0 };
        x.n++; x.perdida += p.perdidaC || 0;
      });
      setHTML('#per-kpis',
        kpi('sinsaldo', 'Pérdida total', dineroC(total)) +
        kpi('pendiente', 'Carreras con pérdida', ids.length) +
        kpi('fuera', 'Conductores', Object.keys(porCond).length));
      setHTML('#tabla-perdidas-cond', '<thead><tr><th>Conductor</th><th>Carreras con pérdida</th><th>Pérdida</th></tr></thead><tbody>' +
        (Object.keys(porCond).sort(function (a, b) { return porCond[b].perdida - porCond[a].perdida; }).map(function (u) {
          return '<tr><td>' + esc(unidadCond(u)) + ' · ' + esc(nombreCond(u)) + '</td><td>' + porCond[u].n + '</td><td class="saldo-bajo">' + dineroC(porCond[u].perdida) + '</td></tr>';
        }).join('') || '<tr><td colspan="3" class="muted" style="text-align:center;padding:28px">Sin pérdidas en esas fechas.</td></tr>') + '</tbody>');
      setHTML('#tabla-perdidas', '<thead><tr><th>Fecha</th><th>Carrera</th><th>Conductor</th><th>Tarifa</th><th>Comisión</th><th>Saldo que tenía</th><th>Pérdida</th></tr></thead><tbody>' +
        (ids.map(function (id) {
          var p = v[id];
          return '<tr><td>' + fechaHora(p.fecha) + '</td><td>#' + esc(p.numero) + '</td><td>' + esc(unidadCond(p.conductor)) + ' · ' + esc(nombreCond(p.conductor)) +
            '</td><td>' + dineroC(p.tarifaC) + '</td><td>' + dineroC(p.comisionC) + '</td><td>' + dineroC(p.cobradoC) + '</td><td class="saldo-bajo"><strong>' + dineroC(p.perdidaC) + '</strong></td></tr>';
        }).join('') || '<tr><td colspan="7" class="muted" style="text-align:center;padding:28px">Sin pérdidas en esas fechas.</td></tr>') + '</tbody>');
    }).catch(function (e) { toast(errorTexto(e), true); });
  });

  // ------------------------------------------------------------------
  //  Configuración (en pantalla en dólares, guardado en centavos)
  // ------------------------------------------------------------------
  var CAMPOS = [
    ['#cfg-cascada', 'cascadaSeg', 1], ['#cfg-prioridad', 'prioridadMin', 1], ['#cfg-rechazo', 'rechazoSeg', 1],
    ['#cfg-arranque', 'arranqueC', 100], ['#cfg-km', 'kmC', 100], ['#cfg-espera', 'esperaC', 100],
    ['#cfg-espera-seg', 'esperaCadaSeg', 1], ['#cfg-gratis', 'gratisSeg', 1], ['#cfg-minima', 'minimaC', 100],
    ['#cfg-com-min', 'comisionMinC', 100], ['#cfg-com-pct', 'comisionPct', 1], ['#cfg-com-desde', 'comisionDesdeC', 100],
    ['#cfg-saldo-alerta', 'saldoAlertaC', 100]
  ];
  function llenarConfig() {
    if (document.activeElement && document.activeElement.closest && document.activeElement.closest('#form-config')) return;
    CAMPOS.forEach(function (f) {
      var v = S.config[f[1]];
      $(f[0]).value = f[2] === 100 ? (v / 100).toFixed(2) : v;
    });
  }
  $('#form-config').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var c = {};
    CAMPOS.forEach(function (f) {
      var n = Number($(f[0]).value);
      c[f[1]] = f[2] === 100 ? Math.round(n * 100) : n;
    });
    db.ref('config').set(c).then(function () { toast('Configuración guardada.'); })
      .catch(function (e) { toast(errorTexto(e), true); });
  });

  $('#form-admin').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var a2 = authSecundaria();
    a2.createUserWithEmailAndPassword($('#adm-email').value.trim(), $('#adm-pass').value).then(function (cred) {
      var uid = cred.user.uid;
      return a2.signOut().then(function () { return db.ref('admins/' + uid).set(true); });
    }).then(function () {
      $('#form-admin').reset();
      toast('Administrador creado.');
    }).catch(function (e) { toast(errorTexto(e), true); });
  });
})();
