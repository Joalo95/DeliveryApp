# Repartos AJ

Aplicación web estática para registrar pedidos de reparto y compartirlos por WhatsApp.

## Uso

Iniciá el servidor local con `node server.js` y abrí `http://127.0.0.1:4173` en el navegador. Si el servidor ya estaba ejecutándose antes de actualizar la aplicación, reinicialo para habilitar el proxy de búsqueda de direcciones. No requiere instalar dependencias. Se necesita conexión a internet para geocodificación, OpenStreetMap, resolución de enlaces, fuentes y exportación PDF.

1. Ingresá el comercio (se recuerda en este navegador), cliente, contacto, dirección, monto y observaciones.
2. Escribí la calle y, si la conocés, el número de puerta en **Dirección de entrega**. Las sugerencias aparecen también para calles sin número. Al encontrar una coincidencia exacta numerada, el pin se ubica automáticamente. Si no hay número o no aparece, completá la segunda calle en el campo **casi**; al terminar o elegir una sugerencia se busca automáticamente el cruce. También podés pegar un enlace completo de Google Maps o Apple Maps en **Ubicación compartida**; si incluye coordenadas, la dirección se completa automáticamente tras verificar que pertenece a Durazno. El enlace no se agrega al pedido ni al mensaje.
3. Cargá el pedido. La aplicación conserva el registro localmente y abre el chat del número configurado con el mensaje preparado, organizado por secciones. Confirmá el envío desde WhatsApp.
4. Exportá el listado desde **Exportar PDF**.

## Servicios y alcance

- El mapa usa mosaicos de OpenStreetMap.de; el servidor local consulta Photon para las sugerencias y reutiliza sus respuestas durante un minuto. Las calles y cruces se verifican con OpenStreetMap, sin consultas adicionales de geocodificación inversa.
- La búsqueda de direcciones numeradas consulta Photon con la dirección completa y solo acepta coincidencias del mismo número y calle en Durazno. No estima ni extrapola números faltantes. Si falta el número o no hay coincidencia, **Esquina** pasa a ser obligatoria: se elige una calle de Durazno y se ubica el nodo compartido por ambas calles en OpenStreetMap. Las intersecciones no se infieren a partir de texto libre; ambas calles deben existir y conectar en el mapa.
- La ubicación compartida acepta enlaces completos y cortos de Google Maps (`maps.app.goo.gl`, `goo.gl/maps`) y Apple Maps (`maps.apple/p/...`). El servidor local sigue las redirecciones solo hacia dominios permitidos de Maps y devuelve las coordenadas; luego se valida la ciudad con Photon. El enlace se usa solo para completar la dirección y no se guarda en el pedido.
- Los enlaces cortos requieren usar la aplicación a través de `http://127.0.0.1:4173`; al abrir directamente `index.html` como archivo, el navegador no puede llamar a la API local que expande redirecciones.
- Los pedidos y el comercio se almacenan en `localStorage` del navegador. No se envían a una base de datos ni se sincronizan entre dispositivos.
- El navegador no puede enviar mensajes de WhatsApp silenciosamente. El enlace `wa.me` abre el chat configurado con el texto preparado y la persona usuaria debe tocar **Enviar**. La notificación de la aplicación informa que el mensaje quedó preparado, no que WhatsApp confirmó su entrega.
- Para envíos automáticos en segundo plano se necesita integrar WhatsApp Business Platform/Cloud API mediante un backend seguro; no es posible hacerlo solo con estos archivos estáticos ni exponer credenciales de API en el navegador.
- El PDF se genera en el navegador mediante jsPDF y AutoTable, cargados desde CDN.
