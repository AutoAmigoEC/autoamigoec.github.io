#!/usr/bin/env python3
"""Candado del mapa del conductor (aprobado por el dueño el 25-nov-2026, prueba a2f74ed).

Guarda una huella de cada parte del mapa: movimiento del carro, cámara, zoom, efectos, Ir/Salir,
línea azul, cuadro de abajo y sus animaciones. Antes de cada commit se corre:

    python3 herramientas/mapa_protegido.py            -> dice si alguna parte protegida cambió
    python3 herramientas/mapa_protegido.py --guardar  -> SOLO cuando el dueño pidió ese cambio exacto

Si dice CAMBIÓ y el dueño no lo pidió, se deshace con git (no se publica).
"""
import hashlib, json, re, sys, os

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.dirname(AQUI)
HUELLAS = os.path.join(AQUI, 'mapa_protegido.json')

ARCHIVOS = {
    'prueba-conductor/app.html': [
        'posSuave', 'nuevaPosSuave', 'objetivoSuave', 'siguiendo', 'suaveK', 'camActual', 'camIr', 'camAhora', 'NAV_META',
        'rumboSeguir', 'aLaVista', 'vistaRecogida', 'ponerRuta', 'trazar', 'recortarBase', 'puntosViaje', 'seguirFuera',
        'retomar', 'vistaInicio', 'reiniciarCarrera', 'aceptar', 'iniciar', 'finalizar', 'orientarConRuta', 'marcarPasos', 'distPaso',
        'rutaNav', 'pedirRuta', 'ponerMargen', 'proyectar', 'iniciarNav', 'salirNav', 'seguirNav', 'libreArriba', 'vistaNav',
        'ajustarFlecha', 'abajoFlecha', 'relleno', 'rellenoCarro', 'centrar', 'verRuta', 'posBotones', 'deslizarHoja',
        'moverMapa', 'animar', 'ponerHTML', 'igualarNodos', 'render', 'renderBase', 'pintarNav', 'barraMini', 'hojaCarrera',
        '@M.easeTo = function (o)', '@(function cuadro()', '@css',
    ],
    # La app real (publicada el 26-nov-2026 con el mismo comportamiento aprobado)
    'app/conductor.js': [
        'posSuave', 'nuevaPosSuave', 'objetivoSuave', 'siguiendo', 'suaveK', 'camActual', 'camIr', 'camAhora', 'NAV_META',
        'rumboSeguir', 'aLaVista', 'vistaRecogida', 'ponerRuta', 'trazar', 'recortarBase', 'seguirFuera', 'pintarMapa',
        'retomar', 'vistaInicio', 'reiniciarCarrera', 'orientarConRuta', 'marcarPasos', 'distPaso', 'rutaNav', 'pedirRuta',
        'proyectar', 'iniciarNav', 'salirNav', 'seguirNav', 'libreArriba', 'vistaNav', 'ajustarFlecha', 'abajoFlecha',
        'relleno', 'rellenoCarro', 'centrar', 'verRuta', 'posBotones', 'deslizarHoja', 'moverMapa', 'animar', 'ponerHTML',
        'igualarNodos', 'render', 'pintarHoja', 'pintarNav', 'alEstadoNav', 'barraMini', 'hojaCarrera',
        '@M.easeTo = function (o)', '@(function cuadro()',
    ],
    'app/conductor.html': ['@css'],
}

def bloque(txt, inicio):
    i = txt.find(inicio)
    if i < 0: return None
    if txt.find(inicio, i + 1) >= 0 and not inicio.startswith('@'): pass
    j = txt.find('{', i)
    n = 0
    for k in range(j, len(txt)):
        if txt[k] == '{': n += 1
        elif txt[k] == '}':
            n -= 1
            if n == 0: return txt[i:k + 1]
    return None

def partes(ruta, nombres):
    txt = open(os.path.join(RAIZ, ruta), encoding='utf-8').read()
    out = {}
    for nom in nombres:
        if nom == '@css':
            m = re.search(r'<style>(.*?)</style>', txt, re.S)
            lineas = [l for l in (m.group(1) if m else '').splitlines() if re.search(r'hoja|nav-|\.bm|\.yo|brujula|b-centrar|b-ruta|fundiendo', l)]
            out[nom] = '\n'.join(lineas)
        elif nom.startswith('@'):
            out[nom] = bloque(txt, nom[1:])
        else:
            out[nom] = bloque(txt, 'function ' + nom + '(')
    return out

def huella(s): return None if s is None else hashlib.sha256(s.encode('utf-8')).hexdigest()[:16]

def main():
    actual = {r: {n: huella(c) for n, c in partes(r, ns).items()} for r, ns in ARCHIVOS.items()}
    if '--guardar' in sys.argv:
        json.dump(actual, open(HUELLAS, 'w'), indent=1, ensure_ascii=False); print('Huellas guardadas.'); return 0
    guard = json.load(open(HUELLAS))
    cambios = [(r, n) for r in actual for n in actual[r] if actual[r][n] != guard.get(r, {}).get(n)]
    if not cambios: print('OK: el mapa protegido está intacto.'); return 0
    print('CAMBIÓ una parte protegida del mapa:')
    for r, n in cambios: print('  -', r, '→', n)
    print('Solo se permite si el dueño pidió ese cambio exacto. Si no, deshacer con git.')
    return 1

if __name__ == '__main__': sys.exit(main())
