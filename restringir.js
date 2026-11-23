/* AutoAmigo · Panel · Restringir.
 * Lista negra silenciosa: la persona restringida nunca se entera. Si vuelve a registrarse (aunque sea con otra cédula),
 * su solicitud llega con el sello "⛔ Restringido". Si un conductor entra desde el teléfono de alguien restringido,
 * en Conductores sale "⛔ Restringido".
 * Todo pasa por el servidor de revisión, que comprueba que quien pide es administrador.
 */
(function () {
  var R = { lista: [], alertas: {}, url: null, cargado: false };
  function esc(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fecha(ms) { var d = new Date(Number(ms) || 0); return d.getDate() + '/' + (d.getMonth() + 1) + '/' + d.getFullYear(); }
  function toast(m, mal) { var t = document.getElementById('toast'); if (!t) return; t.textContent = m; t.className = 'toast' + (mal ? ' error' : ''); t.hidden = false; clearTimeout(toast.x); toast.x = setTimeout(function () { t.hidden = true; }, mal ? 6000 : 3500); }
  function servidor() {
    if (R.url) return Promise.resolve(R.url);
    return fetch('app/servidor.json?v=' + Date.now()).then(function (r) { return r.json(); }).then(function (s) {
      var u = (s && s.url || '').replace(/\/+$/, ''); if (!/^https:\/\//.test(u)) throw new Error('Falta la dirección del servidor.'); R.url = u; return u;
    });
  }
  function llamar(ruta, cuerpo) {
    var u = firebase.auth().currentUser; if (!u) return Promise.reject(new Error('Inicia sesión.'));
    return Promise.all([servidor(), u.getIdToken()]).then(function (x) {
      return fetch(x[0] + '/' + ruta, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + x[1] }, body: JSON.stringify(cuerpo || {}) });
    }).then(function (r) { return r.json(); }).then(function (j) { if (!j || !j.ok) throw new Error(j && j.error || 'No se pudo.'); return j; });
  }
  function cargar() {
    return llamar('restringidos').then(function (j) {
      R.lista = j.lista || []; R.alertas = {}; R.cargado = true;
      // Avisos solo de restricciones que siguen vigentes (si quitaste la restricción, el aviso desaparece)
      var vivos = {}; R.lista.forEach(function (r) { vivos[r.id] = 1; });
      Object.keys(j.alertas || {}).forEach(function (u) { if (vivos[j.alertas[u].id]) R.alertas[u] = j.alertas[u]; });
      document.dispatchEvent(new Event('aa-restringidos'));
    }, function () { });
  }
  firebase.auth().onAuthStateChanged(function (u) { if (u) cargar(); });
  setInterval(function () { if (firebase.auth().currentUser) cargar(); }, 120000);

  // Sección "Restringidos" en Solicitudes
  function pintarLista() {
    var v = document.getElementById('vista-solicitudes'); if (!v) return;
    var c = document.getElementById('sol-restringidos');
    if (!c) {
      var h = document.createElement('h2'); h.className = 'sol-h'; h.textContent = 'Restringidos';
      var p = document.createElement('p'); p.className = 'muted'; p.style.margin = '0';
      p.textContent = 'Personas que restringiste en silencio. No lo saben: si vuelven a registrarse o entran desde su teléfono, te sale "⛔ Restringido".';
      c = document.createElement('div'); c.id = 'sol-restringidos'; c.className = 'lista-turnos';
      v.appendChild(h); v.appendChild(p); v.appendChild(c);
    }
    var html = R.lista.length ? '<div class="tabla-caja"><table class="tabla"><thead><tr><th>Nombre</th><th>Cédula</th><th>Desde</th><th></th></tr></thead><tbody>' +
      R.lista.map(function (r) { return '<tr><td>' + esc(r.nombre) + '</td><td>' + esc(r.cedula) + '</td><td>' + fecha(r.t) + '</td><td><button class="btn btn-chico" data-restr-quitar="' + esc(r.id) + '">Quitar restricción</button></td></tr>'; }).join('') +
      '</tbody></table></div>' : '<div class="vacio">No has restringido a nadie.</div>';
    if (c.__h !== html) { c.innerHTML = html; c.__h = html; }
  }
  document.addEventListener('aa-restringidos', pintarLista);

  window.AARestringir = {
    // Restringir desde una solicitud ({solicitud: id}) o desde un conductor ({uid})
    restringir: function (q) { return llamar('restringir', q).then(function (j) { cargar(); return j; }); },
    // Sello en la tabla de Conductores: entró desde el teléfono de alguien restringido, o él mismo está restringido
    sello: function (uid) {
      var a = R.alertas[uid];
      if (R.lista.some(function (r) { return r.id === 'c_' + uid; })) return '<span class="sello mal" title="Lo restringiste">⛔ Restringido</span>';
      return a ? '<span class="sello mal" title="Entró desde el teléfono de ' + esc(a.nombre) + ', a quien restringiste">⛔ Restringido</span>' : '';
    },
    botonQuitar: function (uid) { return '<button class="btn btn-chico" data-restr-quitar="c_' + esc(uid) + '" data-restr-cambiar="' + esc(uid) + '">Quitar restricción</button>'; },
    boton: function (uid) { return '<button class="btn btn-chico btn-peligro" data-restr-uid="' + esc(uid) + '">Restringir</button>'; },
    alerta: function (uid) { return R.alertas[uid] || null; },
    esta: function (uid) { return R.lista.some(function (r) { return r.id === 'c_' + uid; }); }
  };

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-restr-quitar],[data-restr-uid]'); if (!b) return;
    var id;
    if ((id = b.getAttribute('data-restr-quitar'))) {
      if (!confirm('¿Quitar la restricción? Podrá volver a registrarse sin que te salga el aviso.')) return;
      b.disabled = true;
      llamar('restringir', { quitar: id }).then(function () {
        toast('Restricción quitada.');
        var u = b.getAttribute('data-restr-cambiar'); if (u) b.outerHTML = AARestringir.boton(u);   // vuelve a "Restringir"
        cargar();
      }, function (er) { b.disabled = false; toast('No se pudo: ' + er.message, true); });
      return;
    }
    if ((id = b.getAttribute('data-restr-uid'))) {
      if (!confirm('¿Restringir a este conductor en silencio? Él no se entera. Si vuelve a registrarse o alguien entra desde su teléfono, te saldrá "⛔ Restringido". (Para que no pueda trabajar, desactívalo también.)')) return;
      b.disabled = true;
      AARestringir.restringir({ uid: id }).then(function () { b.outerHTML = AARestringir.botonQuitar(id); toast('Conductor restringido en silencio.'); }, function (er) { b.disabled = false; toast('No se pudo: ' + er.message, true); });
    }
  });
})();
