/* AutoAmigo · Panel · Clientes de la app.
 * Los clientes que crean su cuenta en la app (cédula + cara). Si todo coincide, entran enseguida;
 * si algo no cuadra o la persona está restringida, la cuenta queda "en revisión" (no puede pedir) y sale aquí.
 *   - Por revisar: Sospechosos / Restringidos, con los motivos y las fotos → Aprobar o Restringir.
 *   - Por revisar antecedentes: cuentas ya aprobadas → Antecedentes / Procesos judiciales / Fiscalía → ✓ Limpio o ⛔ Restringir.
 *   - Otra persona intentó pedir: más de 2 selfies que no eran del dueño (con las fotos).
 *   - Todos: Suspender / Reactivar.
 */
(function () {
  var RUTA = 'recargas/clientesApp', FOTOS = 'recargas/clientesAppFotos';
  var C = { lista: {}, fotos: {}, listo: false, buscar: '' };
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function hora(ms) { var d = new Date(Number(ms) || 0); return d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + d.getHours() + ':' + ('0' + d.getMinutes()).slice(-2); }
  function toast(m, mal) { var t = document.getElementById('toast'); if (!t) return; t.textContent = m; t.className = 'toast' + (mal ? ' error' : ''); t.hidden = false; clearTimeout(toast.x); toast.x = setTimeout(function () { t.hidden = true; }, mal ? 6000 : 3500); }
  var ESCALA = [[0, 100], [0.2, 98], [0.35, 93], [0.45, 82], [0.55, 70], [0.62, 60], [0.75, 35], [0.9, 10], [1, 0]];
  function pct(d) { if (d == null) return null; for (var i = 1; i < ESCALA.length; i++) if (d <= ESCALA[i][0]) { var a = ESCALA[i - 1], b = ESCALA[i]; return Math.round(a[1] + (b[1] - a[1]) * (d - a[0]) / (b[0] - a[0])); } return 0; }
  function figura(src, txt, quien) { return '<figure><button class="foto-t" data-ver-foto="1" data-src="' + esc(src) + '" data-txt="' + esc(quien + ' · ' + txt) + '"><img src="' + esc(src) + '" alt=""></button><figcaption>' + esc(txt) + '</figcaption></figure>'; }
  function ref(p) { return firebase.database().ref(RUTA + (p ? '/' + p : '')); }
  function fotosDe(id) {
    if (C.fotos[id] === undefined) { C.fotos[id] = 'cargando'; firebase.database().ref(FOTOS + '/' + id).once('value').then(function (s) { C.fotos[id] = s.val() || {}; pintar(); }, function () { C.fotos[id] = {}; pintar(); }); }
    return C.fotos[id] === 'cargando' ? null : C.fotos[id];
  }

  function grupo(h, texto, id) {
    return '<h2 class="sol-h">' + h + '</h2>' + (texto ? '<p class="muted" style="margin:0">' + texto + '</p>' : '') + '<div class="lista-turnos" id="' + id + '"></div>';
  }
  function montar() {
    var v = document.getElementById('vista-clientes'); if (!v || document.getElementById('cla')) return !!v;
    var d = document.createElement('div'); d.id = 'cla';
    d.innerHTML = '<header class="cabecera" style="margin-top:28px"><div><h1>Clientes de la app</h1><p class="muted" id="cla-sub"></p></div></header>' +
      grupo('Por revisar', 'Algo no cuadró o la persona está restringida. No puede pedir viajes: solo ve "Estamos revisando tu cuenta".', 'cla-revisar') +
      grupo('Por revisar antecedentes', 'Cuentas ya aprobadas. Revisa en las páginas oficiales y marca Limpio o Restringir.', 'cla-antec') +
      grupo('Otra persona intentó pedir', 'Alguien que no es el dueño se tomó la foto antes de pedir más de 2 veces. No pudo pedir.', 'cla-ajenas') +
      '<h2 class="sol-h">Todos</h2><input class="buscador" id="cla-buscar" placeholder="Buscar por nombre, cédula o celular" autocomplete="off">' +
      '<div class="tabla-caja"><table class="tabla" id="cla-tabla"></table></div>';
    v.appendChild(d);
    document.getElementById('cla-buscar').addEventListener('input', function (e) { C.buscar = e.target.value.trim().toLowerCase(); pintar(); });
    return true;
  }
  function poner(id, html) { var c = document.getElementById(id); if (c && c.__h !== html) { c.innerHTML = html; c.__h = html; } }

  function tarjetaRevisar(id, c) {
    var r = c.revision || {}, f = fotosDe(id), p = pct(c.parecido);
    var sellos = (c.restringido ? '<span class="sello mal">⛔ Restringido</span>' : '') + ((r.motivos || []).length ? '<span class="sello duda">Sospechoso</span>' : '') + (c.prueba ? '<span class="sello duda">PRUEBA</span>' : '');
    var porque = (r.motivos || []).map(function (m) { return '<li>' + esc(m) + '</li>'; }).join('') +
      (c.restringido ? '<li>Se parece a ' + esc(c.restringido.nombre) + ', a quien restringiste (por ' + esc((c.restringido.por || []).join(', ')) + ').</li>' : '') +
      (c.restringidoT ? '<li>Lo restringiste el ' + hora(c.restringidoT) + '.</li>' : '');
    return '<article class="turno sospechosa"><div class="fila"><div><strong>' + esc(c.nombre) + ' ' + sellos + '</strong>' +
      '<div class="meta">Cédula ' + esc(c.cedula) + ' · ' + esc(c.tel) + ' · creó su cuenta el ' + hora(c.t) + (p != null ? ' · cara vs cédula: <b>' + p + '%</b>' : '') + '</div></div></div>' +
      (porque ? '<div class="duda-ia"><b>Por qué está aquí:</b><ul style="margin:4px 0 0 18px;padding:0">' + porque + '</ul></div>' : '') +
      (c.lectura && c.lectura.numero ? '<p class="muted" style="margin:6px 0">La cédula de la foto dice: ' + esc(c.lectura.numero) + (c.lectura.nombre ? ' · ' + esc(c.lectura.nombre) : '') + '</p>' : '') +
      (f ? '<div class="fotos-turno"><div class="grupo"><h4>Fotos tomadas en vivo</h4><div class="g">' + (f.cara ? figura(f.cara, 'Su cara', c.nombre) : '') + (f.cedula ? figura(f.cedula, 'Su cédula', c.nombre) : '') + '</div></div></div>' : '<p class="muted">Cargando fotos…</p>') +
      (window.AAVerificar ? '<div class="acciones verif"><span>Revisar en páginas oficiales:</span>' + AAVerificar.botonesCliente(c.cedula) + '</div>' : '') +
      '<div class="acciones"><button class="btn btn-primario" data-cla-aprobar="' + id + '">✓ Aprobar</button>' +
      (c.restringidoT ? '' : '<button class="btn btn-peligro" data-cla-restr="' + id + '">⛔ Restringir</button>') + '</div></article>';
  }
  function tarjetaAntec(id, c) {
    return '<article class="turno"><div class="fila"><div><strong>' + esc(c.nombre) + (c.prueba ? ' <span class="sello duda">PRUEBA</span>' : '') + '</strong>' +
      '<div class="meta">Cédula ' + esc(c.cedula) + ' · ' + esc(c.tel) + ' · ' + hora(c.t) + '</div></div></div>' +
      '<div class="acciones verif"><span>Revisar en páginas oficiales:</span>' + (window.AAVerificar ? AAVerificar.botonesCliente(c.cedula) : '') + '</div>' +
      '<div class="acciones"><button class="btn btn-primario" data-cla-limpio="' + id + '">✓ Limpio</button><button class="btn btn-peligro" data-cla-restr="' + id + '">⛔ Restringir</button></div></article>';
  }
  function tarjetaAjena(id, c) {
    var f = fotosDe(id), aj = f && f.ajenas ? Object.keys(f.ajenas).sort().slice(-6).map(function (k) { return f.ajenas[k]; }) : [];
    return '<article class="turno sospechosa"><div class="fila"><div><strong>' + esc(c.nombre) + ' <span class="sello duda">Sospechoso</span></strong>' +
      '<div class="meta">' + (c.alertaAjena.n || c.intentosAjenos) + ' fotos de otra persona · la última el ' + hora(c.alertaAjena.t) + ' · ' + esc(c.tel) + '</div></div></div>' +
      (f ? '<div class="fotos-turno"><div class="grupo"><h4>El dueño</h4><div class="g">' + (f.cara ? figura(f.cara, 'Dueño de la cuenta', c.nombre) : '') + '</div></div>' +
        '<div class="grupo"><h4>Quién intentó pedir</h4><div class="g">' + aj.map(function (s, i) { return figura(s, 'Intento ' + (i + 1), c.nombre); }).join('') + '</div></div></div>' : '<p class="muted">Cargando fotos…</p>') +
      '<div class="acciones"><button class="btn" data-cla-visto="' + id + '">Ya lo vi</button><button class="btn btn-peligro" data-cla-restr="' + id + '">⛔ Restringir</button></div></article>';
  }
  function estadoTxt(c) { return c.suspendido ? '<span class="sello mal">Suspendido</span>' : c.estado === 'aprobado' ? '<span class="sello ok">Aprobado</span>' : '<span class="sello duda">En revisión</span>'; }

  function pintar() {
    if (!montar() || !C.listo) return;
    var ids = Object.keys(C.lista).sort(function (a, b) { return (C.lista[b].t || 0) - (C.lista[a].t || 0); });
    var rev = ids.filter(function (i) { var c = C.lista[i]; return c.estado === 'revision' && !c.suspendido; });
    var ant = ids.filter(function (i) { var c = C.lista[i]; return c.estado === 'aprobado' && !c.suspendido && c.antecedentes === 'pendiente'; });
    var aje = ids.filter(function (i) { var c = C.lista[i]; return c.alertaAjena && !c.alertaAjena.visto; });
    poner('cla-revisar', rev.length ? rev.map(function (i) { return tarjetaRevisar(i, C.lista[i]); }).join('') : '<div class="vacio">Nadie por revisar.</div>');
    poner('cla-antec', ant.length ? ant.map(function (i) { return tarjetaAntec(i, C.lista[i]); }).join('') : '<div class="vacio">No hay antecedentes por revisar.</div>');
    poner('cla-ajenas', aje.length ? aje.map(function (i) { return tarjetaAjena(i, C.lista[i]); }).join('') : '<div class="vacio">Nadie más intentó pedir con una cuenta ajena.</div>');
    var q = C.buscar, todos = ids.filter(function (i) { var c = C.lista[i]; return !q || (String(c.nombre || '').toLowerCase().indexOf(q) >= 0 || String(c.cedula || '').indexOf(q) >= 0 || String(c.tel || '').indexOf(q) >= 0); });
    poner('cla-tabla', todos.length ? '<thead><tr><th>Nombre</th><th>Cédula</th><th>Celular</th><th>Desde</th><th>Estado</th><th>Antecedentes</th><th></th></tr></thead><tbody>' + todos.map(function (i) {
      var c = C.lista[i];
      return '<tr><td>' + esc(c.nombre) + (c.prueba ? ' <span class="sello duda">PRUEBA</span>' : '') + '</td><td>' + esc(c.cedula) + '</td><td>' + esc(c.tel) + '</td><td>' + hora(c.t) + '</td><td>' + estadoTxt(c) + '</td><td>' +
        (c.antecedentes === 'limpio' ? 'Limpio' : c.antecedentes === 'pendiente' ? 'Por revisar' : '—') + '</td><td>' +
        (c.suspendido ? '<button class="btn btn-chico btn-peligro" data-cla-react="' + i + '">Reactivar</button>' : '<button class="btn btn-chico btn-peligro" data-cla-susp="' + i + '">Suspender</button>') + '</td></tr>';
    }).join('') + '</tbody>' : '<tbody><tr><td class="vacio">' + (ids.length ? 'Nadie coincide con la búsqueda.' : 'Todavía no hay clientes de la app.') + '</td></tr></tbody>');
    var sub = document.getElementById('cla-sub');
    if (sub) sub.textContent = ids.length + ' cuenta' + (ids.length === 1 ? '' : 's') + (rev.length ? ' · ' + rev.length + ' por revisar' : '') + (ant.length ? ' · ' + ant.length + ' antecedentes por revisar' : '');
  }

  firebase.auth().onAuthStateChanged(function (u) {
    if (!u) return;
    ref().on('value', function (s) { C.lista = s.val() || {}; C.listo = true; pintar(); }, function () { });
  });
  document.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('[data-vista="clientes"]')) setTimeout(pintar, 0);
    var b = e.target.closest && e.target.closest('[data-cla-aprobar],[data-cla-restr],[data-cla-limpio],[data-cla-visto],[data-cla-susp],[data-cla-react]'); if (!b) return;
    var id, hecho = function (m) { return function () { toast(m); }; }, mal = function (er) { b.disabled = false; toast('No se pudo: ' + (er && er.message || er), true); };
    if ((id = b.getAttribute('data-cla-aprobar'))) {
      var c = C.lista[id] || {};
      if ((c.restringido || c.restringidoT) && !confirm('Esta persona está restringida. ¿Seguro que quieres aprobarla? Podrá pedir viajes.')) return;
      if (!confirm('¿Aprobar la cuenta de ' + (c.nombre || '') + '? Podrá pedir viajes.')) return;
      b.disabled = true; ref(id).update({ estado: 'aprobado', aprobadoT: Date.now() }).then(hecho('Cuenta aprobada.'), mal); return;
    }
    if ((id = b.getAttribute('data-cla-restr'))) {
      if (!confirm('¿Restringir a esta persona en silencio? No podrá pedir viajes: solo verá "Estamos revisando tu cuenta". Si vuelve a registrarse con otros datos, te saldrá "⛔ Restringido".')) return;
      b.disabled = true;
      AARestringir.restringir({ cliente: id }).then(function () { if (C.lista[id] && C.lista[id].alertaAjena) ref(id + '/alertaAjena/visto').set(true); toast('Restringido en silencio.'); }, mal); return;
    }
    if ((id = b.getAttribute('data-cla-limpio'))) { b.disabled = true; ref(id).update({ antecedentes: 'limpio', antecedentesT: Date.now() }).then(hecho('Marcado como limpio.'), mal); return; }
    if ((id = b.getAttribute('data-cla-visto'))) { b.disabled = true; ref(id + '/alertaAjena/visto').set(true).then(hecho('Listo.'), mal); return; }
    if ((id = b.getAttribute('data-cla-susp'))) {
      if (!confirm('¿Suspender la cuenta? No podrá pedir viajes y verá "Tu cuenta está suspendida".')) return;
      b.disabled = true; ref(id + '/suspendido').set(true).then(hecho('Cuenta suspendida.'), mal); return;
    }
    if ((id = b.getAttribute('data-cla-react'))) {
      if (!confirm('¿Reactivar la cuenta? Podrá volver a pedir viajes.')) return;
      b.disabled = true; ref(id + '/suspendido').remove().then(hecho('Cuenta reactivada.'), mal); return;
    }
  });
})();
