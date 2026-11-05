# Repartos AJ

Aplicación web estática para registrar pedidos de reparto y compartirlos por WhatsApp.

## Uso

Iniciá el servidor local con `node server.js` y abrí `http://127.0.0.1:4173` en el navegador. No requiere instalar dependencias. Se necesita conexión a internet para geocodificación, OpenStreetMap, resolución de enlaces, fuentes y exportación PDF.

1. Ingresá el comercio (se recuerda en este navegador), cliente, contacto, dirección, monto y observaciones.
2. Escribí una calle para ver coincidencias y elegí una dirección sugerida en **Durazno, Uruguay**. Para una esquina, ingresá, por ejemplo, `18 de Julio esquina Varela`; el sistema encuentra el nodo compartido por ambas calles en OpenStreetMap y coloca el pin en ese cruce. También podés pegar un enlace completo de Google Maps o Apple Maps en **Ubicación compartida**; si incluye coordenadas, la dirección se completa automáticamente tras verificar que pertenece a Durazno. El link no se agrega al pedido ni al mensaje. También podés usar **Ubicar** para seleccionar la primera coincidencia válida.
3. Cargá el pedido. La aplicación conserva el registro localmente y abre el chat del número configurado con el mensaje preparado, organizado por secciones y con un enlace de Google Maps clickeable cuando las coordenadas pasan la validación. Confirmá el envío desde WhatsApp.
4. Exportá el listado desde **Exportar PDF**.

## Servicios y alcance

- El mapa integrado, sus nombres de calles y la búsqueda usan OpenStreetMap/Photon. La aplicación centra el mapa y coloca un marcador en las coordenadas de la coincidencia elegida.
- Las sugerencias se consultan con Photon/OpenStreetMap, con Durazno como área preferida. Se mantienen los filtros de ciudad de Durazno y país Uruguay antes de confirmar una dirección. Si no hay coincidencias, se ofrece abrir la búsqueda directamente en OpenStreetMap.
- La ubicación compartida acepta enlaces completos y cortos de Google Maps (`maps.app.goo.gl`, `goo.gl/maps`) y Apple Maps (`maps.apple/p/...`). El servidor local sigue las redirecciones solo hacia dominios permitidos de Maps y devuelve las coordenadas; luego se valida la ciudad con Photon. El enlace se usa solo para completar la dirección y no se guarda en el pedido.
- Los enlaces cortos requieren usar la aplicación a través de `http://127.0.0.1:4173`; al abrir directamente `index.html` como archivo, el navegador no puede llamar a la API local que expande redirecciones.
- Los pedidos y el comercio se almacenan en `localStorage` del navegador. No se envían a una base de datos ni se sincronizan entre dispositivos.
- El navegador no puede enviar mensajes de WhatsApp silenciosamente. El enlace `wa.me` abre el chat configurado con el texto preparado y la persona usuaria debe tocar **Enviar**. La notificación de la aplicación informa que el mensaje quedó preparado, no que WhatsApp confirmó su entrega.
- Para envíos automáticos en segundo plano se necesita integrar WhatsApp Business Platform/Cloud API mediante un backend seguro; no es posible hacerlo solo con estos archivos estáticos ni exponer credenciales de API en el navegador.
- El PDF se genera en el navegador mediante jsPDF y AutoTable, cargados desde CDN.
