# Reglas del dueño de AutoAmigo (leer antes de tocar cualquier cosa)

## 1. El mapa del conductor está protegido (el dueño lo llama "el revisador")
El 25-nov-2026 el dueño aprobó el mapa del conductor tal como está en la prueba
`prueba-conductor/app.html` (versión a2f74ed). Eso incluye:
el zoom y des-zoom, los efectos, cómo sigue al carro, cómo gira la flecha y el mapa,
Ir y Salir, la línea azul, la vista de la recogida, el cuadro de abajo y sus animaciones,
lo que pasa al volver de otra app y cómo empieza cada carrera.

- **Nunca se edita ese código** por iniciativa propia, ni para "mejorarlo", ni de paso al hacer otro cambio.
- Solo se cambia **exactamente** lo que el dueño pida, y nada más alrededor.
- Antes de cada commit que toque `prueba-conductor/app.html`, `app/conductor.js` o `app/conductor.html` se corre el revisador:
  `python3 herramientas/mapa_protegido.py`
  - Si dice `CAMBIÓ` en algo que el dueño no pidió: se deshace con git y no se publica.
  - Si el dueño pidió ese cambio exacto: se guarda la nueva huella con `--guardar` en el mismo commit
    y se le dice qué parte protegida cambió.
- La versión aprobada queda guardada en GitHub en la rama `mapa-aprobado-2026-11-25` (commit a2f74ed),
  para volver exactamente a ella si algo se daña.
- Al publicar a la app real (`app/conductor.js`), se copia el comportamiento aprobado tal cual.

## 1c. Cómo está armada la prueba del conductor (desde el 26-nov-2026, pedido del dueño: "que el simulador y la app publicada sean iguales")
- `prueba-conductor/app.html` es la MISMA pantalla que `app/conductor.html`; usa sus propias copias de `conductor.js`, `turno.js` y `perfil.js`.
- `prueba-conductor/sim.js` reemplaza a la central (Firebase) y al GPS: inventa carreras, mueve el carro y tiene los controles de la prueba.
- Publicar = copiar `prueba-conductor/conductor.js`, `turno.js` y `perfil.js` a `app/` (y subir el `?v=`). No se copia `sim.js`.
- El revisador protege `prueba-conductor/conductor.js` con la misma lista que `app/conductor.js`.

## 1b. El mapa del cliente también está protegido por el revisador
El 26-nov-2026 el dueño pidió que el mapa del cliente (`prueba-cliente/app.html`) quede protegido igual que el del conductor:
desde "Tu viaje" (antes de pedir) hasta finalizar — encuadres, motor de cámara, Iniciar/Salir, agrandar/minimizar,
seguir al taxi, línea azul, volver de otra app y cómo empieza cada viaje.
- Mismas reglas: no se toca por iniciativa propia; solo exactamente lo que el dueño pida; se corre el revisador antes de cada commit.
- Al cambiar algo del cliente, revisar que no afecte otras pantallas del cliente (ya pasó: un margen puesto en la regla general cambió todas las vistas).

## 1d. La pantalla de inicio nueva del cliente también está protegida (27-nov-2026)
`prueba-cliente/inicio-nuevo.html` es la versión que se va a publicar (el dueño la aprobó en la versión bc92709).
El revisador protege su mapa (igual al de `app.html`), la pantalla de inicio (`pintarInicio`), sus estilos
(`.x-…`, la barra de abajo) y la foto del carro de "Pide a tu manera" (`img/atajos/viaje-dibujo.jpg`).
Mismas reglas: no se toca por iniciativa propia; solo exactamente lo que el dueño pida.

## 2. Otras reglas que siguen vigentes
- Los cambios van primero a la prueba; a la app real solo cuando el dueño dice "publica".
- "Déjalo como antes" = volver exactamente con git.
- "Dime antes de hacer" = explicar el plan y esperar.
- Si se está editando la app del conductor, no se toca la del cliente (y al revés).
- Todo en español.
