# Los Cedros Night

Sistema completo de invitaciones y control de ingreso, con el escudo y la foto proporcionados para la invitación y el flyer. Interfaz en español, adaptable a celulares, azul, amarillo, negro y blanco.

**Versión publicada en Vercel:** utiliza PostgreSQL de Neon; Vercel Blob conserva los documentos cifrados anteriores. Cada actualización del código conserva la base y los documentos. La versión de escritorio local sigue usando SQLite. Ver [DEPLOYMENT.md](DEPLOYMENT.md) para operar la web y realizar respaldos.

**Abrir la web:** https://ascensocedros.vercel.app

## Iniciar

Requiere **Node.js 24 LTS**. Usa SQLite incorporado en Node ([documentación oficial](https://nodejs.org/docs/latest-v24.x/api/sqlite.html)).

```powershell
npm install
npm start
```

Abrir **http://localhost:3000**. En el primer inicio se crean dos cuentas con contraseñas aleatorias. Leer sus claves en el archivo privado **data/accesos-iniciales.txt**:

- `admin`: invitadores, cupos, invitados, revocaciones, datos del evento y descarga del flyer.
- `seguridad`: búsqueda, consulta de DNI e ingreso.

No se precargan personas ni documentos reales o de ejemplo en la base de uso normal.

## Flujo

1. Compartir **https://ascensocedros.vercel.app/invitacion**, el mismo link para todos.
2. El invitado completa nombre, apellido, número de DNI y nombre de quien lo invita. No se solicita ni se guarda una foto nueva del DNI. El evento mantiene el aviso **+18**.
3. Administración puede copiar el link, ajustar el cupo total y abrir o cerrar el registro. Los invitadores aparecen automáticamente, agrupados por nombre sin distinguir mayúsculas ni acentos. Sus nombres son declarados por los invitados.
4. Seguridad busca por nombre, apellido o DNI, consulta el detalle y marca **INGRESÓ**. El ingreso se sincroniza entre dispositivos y conserva una sola hora.

El DNI es único para todo el evento. El cupo global se valida en una transacción y no puede excederse con solicitudes simultáneas. Cerrar el registro no bloquea el ingreso de los ya registrados. Revocar un invitador bloquea nuevos registros a su nombre y el ingreso de sus invitados; la revocación individual bloquea una persona. Los registros anteriores se conservan. Las antiguas rutas personales abren el formulario general y ya no asignan un invitador por token.

## Flyer

En **Evento y flyer**, editar título, frase, fecha, hora, lugar y descripción. La fecha y hora no se inventan: hasta configurarlas aparecen “a confirmar”. Descargar el flyer PNG de **1080 × 1440** para compartir. Los archivos originales utilizados están en `public/assets`.

También queda un flyer listo en `flyer/los-cedros-night.png`. La versión actual incluye el logo oficial, la fecha 17/10/2026 y Open doors 01:00 AM.

## Protección de datos y sesiones

- El formulario solicita solamente el número de DNI, sin foto. Las fotos anteriores se conservan en el almacenamiento privado para no eliminar datos; ya no hay una ruta para consultarlas desde la aplicación.
- Contraseñas con scrypt, cookies HttpOnly y SameSite, sesiones de 12 horas, permisos por rol y protección de solicitudes de escritura. Límite de intentos de inicio de sesión y registro.
- Búsqueda con consultas parametrizadas, resultados de 50 personas por página y protección contra respuestas atrasadas mientras se escribe.
- No hay generación ni lectura de códigos QR. El ingreso es manual por lista.
- Se conserva un registro de altas, cambios de cupo, revocaciones e ingresos en la tabla `audit`.

Para rotar una contraseña y cerrar todas las sesiones de esa cuenta:

```powershell
npm run password -- admin
npm run password -- seguridad
```

La nueva contraseña queda en `data/nuevo-acceso-<usuario>.txt`. Guardar la clave en un lugar privado y eliminar el archivo de entrega cuando ya no sea necesario. `accesos-iniciales.txt` conserva las claves iniciales, que dejan de funcionar al rotarlas.

## Celulares y publicación

El servidor escucha en `0.0.0.0`. Para probar en celulares de la misma Wi-Fi, usar `http://<IP-de-la-PC>:3000`; `localhost` en un celular apunta al propio celular. Todos los dispositivos deben conectarse al mismo servidor. Copiar el link desde esa dirección para que funcione en la misma red.

Para enlaces de WhatsApp accesibles fuera de esa red hay que alojar el servidor con un **dominio HTTPS**, almacenamiento persistente y respaldo. Configurar `.env` a partir de `.env.example`: `PUBLIC_URL=https://tu-dominio` y `SECURE_COOKIES=true` detrás del proxy HTTPS. El proxy debe permitir SSE sin buffering en `/api/events`. No exponer el puerto HTTP directo si el servicio usa HTTPS.

`npm start` inicia la versión local sobre SQLite. En Vercel, `api/index.mjs` usa exclusivamente PostgreSQL para los registros nuevos: nunca intenta guardar datos en el disco temporal de una función. Las instancias de Vercel consultan una revisión compartida para sincronizar los dispositivos. Las conexiones SSE se renuevan automáticamente.

Respaldar la carpeta privada `data` con el servidor detenido (base y clave de cifrado juntas). Si se pierde `photo.key`, las fotos no podrán recuperarse. Restringir permisos de la carpeta al usuario del servicio y no publicarla ni subirla a Git. Definir con el club cuándo eliminar los datos tras el evento. La revocación no borra documentos.

## Verificar

```powershell
npm run check
npm test
npm run test:ui
```

Las pruebas de sistema usan bases temporales de SQLite y PostgreSQL (PGlite), con registros anteriores, y verifican el link general, registro sin foto, nombres de invitadores, DNI único, cupo global, cierre del registro, ingreso único, SSE, revocaciones y persistencia. La prueba visual usa Microsoft Edge y recorre administración, formulario y seguridad desde dos celulares. Las capturas quedan en `test-results`, sin datos reales.
