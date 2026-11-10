/* AutoAmigo · Panel
 * Botones para revisar antecedentes penales y procesos judiciales de un conductor en las páginas oficiales.
 * Al tocarlos se copia la cédula y se abre la página: allí solo pegas (Ctrl+V) y das clic en el recuadro de seguridad.
 * (Las páginas del gobierno no dejan que otra página les escriba la cédula; por eso se copia).
 */
(function () {
  var PAGINAS = {
    antecedentes: { url: 'https://certificados.ministeriodelinterior.gob.ec/gestorcertificados/antecedentes/', nombre: 'Antecedentes penales' },
    satje: { url: 'https://procesosjudiciales.funcionjudicial.gob.ec/busqueda', nombre: 'Procesos judiciales' }
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
        document.querySelectorAll('[data-verif-uid="' + uid + '"]').forEach(function (b) { b.disabled = !CEDULAS[uid]; b.title = CEDULAS[uid] ? '' : 'Este conductor no tiene cédula en su ficha'; });
      }, function () { CEDULAS[uid] = null; });
    } catch (e) { CEDULAS[uid] = null; }
    return undefined;
  }

  // HTML de los dos botones (para una cédula conocida, o para un conductor por su uid)
  window.AAVerificar = {
    botones: function (cedula, uid) {
      var at = uid ? ' data-verif-uid="' + uid + '"' : ' data-verif-ced="' + String(cedula || '').replace(/\D/g, '') + '"';
      if (uid) cedulaDe(uid);
      var dis = uid && !CEDULAS[uid] ? ' disabled' : '';
      return '<button class="btn btn-chico" data-verif="antecedentes"' + at + dis + '>🔎 Antecedentes</button>' +
        '<button class="btn btn-chico" data-verif="satje"' + at + dis + '>⚖️ Procesos judiciales</button>';
    }
  };

  document.addEventListener('click', function (e) {
    var b = e.target.closest && e.target.closest('[data-verif]'); if (!b) return;
    e.preventDefault();
    var p = PAGINAS[b.getAttribute('data-verif')]; if (!p) return;
    var ced = b.getAttribute('data-verif-ced') || (b.getAttribute('data-verif-uid') ? CEDULAS[b.getAttribute('data-verif-uid')] : '');
    if (!ced) { toast('Todavía no se cargó la cédula de este conductor. Intenta otra vez en un segundo.', true); return; }
    var ok = copiar(ced);
    window.open(p.url, '_blank', 'noopener');
    toast(ok
      ? 'Cédula ' + ced + ' copiada. En la página de ' + p.nombre + ' haz clic en el campo y pega (Ctrl+V).'
      : 'Se abrió ' + p.nombre + '. Escribe la cédula ' + ced + '.');
  });
})();
