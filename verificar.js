/* AutoAmigo · Panel
 * Botones para revisar antecedentes penales y procesos judiciales de un conductor en las páginas oficiales.
 * Al tocarlos se copia la cédula y se abre la página: allí solo pegas (Ctrl+V) y das clic en el recuadro de seguridad.
 * (Las páginas del gobierno no dejan que otra página les escriba la cédula; por eso se copia).
 */
(function () {
  var PAGINAS = {
    antecedentes: { url: 'https://certificados.ministeriodelinterior.gob.ec/gestorcertificados/antecedentes/', nombre: 'Antecedentes penales' },
    satje: { url: 'https://procesosjudiciales.funcionjudicial.gob.ec/busqueda-filtros', nombre: 'Procesos judiciales' }
  };
  var CEDULAS = {};   // cédula de cada conductor ya aprobado (se lee de su ficha)
  var pedidas = {};

  function toast(m, mal) {
    var t = document.getElementById('toast'); if (!t) return;
    t.textContent = m; t.className = 'toast' + (mal ? ' error' : ''); t.hidden = false;
    clearTimeout(toast.x); toast.x = setTimeout(function () { t.hidden = true; }, mal ? 6000 : 6500);
  }
  function copiar(texto) {
    try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(texto); return true; } } catch (e) {}
    try {
      var a = document.createElement('textarea'); a.value = texto; a.style.position = 'fixed'; a.style.opacity = '0';
      document.body.appendChild(a); a.select(); var ok = document.execCommand('copy'); document.body.removeChild(a); return ok;
    } catch (e) { return false; }
  }
  function cedulaDe(uid) {
    if (CEDULAS[uid] !== undefined || pedidas[uid]) return CEDULAS[uid];
    pedidas[uid] = true;
    try {
      firebase.database().ref('fichas/' + uid + '/cedula').once('value').then(function (s) {
        CEDULAS[uid] = s.val() ? String(s.val()) : null;

      }, function () { CEDULAS[uid] = null; });
    } catch (e) { CEDULAS[uid] = null; }
    return undefined;
  }

  // HTML de los dos botones (para una cédula conocida, o para un conductor por su uid)
  window.AAVerificar = {
    botones: function (cedula, uid) {
      var at = uid ? ' data-verif-uid="' + uid + '"' : ' data-verif-ced="' + String(cedula || '').replace(/\D/g, '') + '"';
      if (uid) cedulaDe(uid);
      var dis = '';   // sin cédula guardada: al tocarlo se pide una sola vez
      return '<button class="btn btn-chico" data-verif="antecedentes"' + at + dis + '>Antecedentes</button>' +
        '<button class="btn btn-chico" data-verif="satje"' + at + dis + '>Procesos judiciales</button>';
    }
  };

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-verif]'); if (!b) return;
    e.preventDefault();
    var p = PAGINAS[b.getAttribute('data-verif')]; if (!p) return;
    var uid = b.getAttribute('data-verif-uid');
    var ced = b.getAttribute('data-verif-ced') || (uid ? CEDULAS[uid] : '');
    if (!ced && uid && CEDULAS[uid] === undefined) { toast('Todavía no se cargó la cédula de este conductor. Intenta otra vez en un segundo.', true); return; }
    if (!ced && uid) {
      // No tiene cédula guardada (conductor creado a mano): se pide una vez y se guarda en su ficha
      var n = (prompt('Este conductor no tiene la cédula guardada. Escríbela una sola vez (10 números) y quedará guardada:') || '').replace(/\D/g, '');
      if (!n) return;
      if (n.length !== 10) { toast('La cédula debe tener 10 números.', true); return; }
      CEDULAS[uid] = n; ced = n;
      firebase.database().ref('fichas/' + uid + '/cedula').set(n).then(function () { }, function () { toast('No se pudo guardar la cédula, pero se copió.', true); });
    }
    var ok = copiar(ced);
    window.open(p.url, '_blank', 'noopener');
    toast(ok
      ? 'Cédula ' + ced + ' copiada. En la página de ' + p.nombre + ' haz clic en el campo y pega (Ctrl+V).'
      : 'Se abrió ' + p.nombre + '. Escribe la cédula ' + ced + '.');
  });
})();
