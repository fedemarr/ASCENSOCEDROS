# Los Cedros Night

Sistema completo de invitaciones y control de ingreso, con el escudo y la foto proporcionados para la invitación y el flyer. Interfaz en español, adaptable a celulares, azul, amarillo, negro y blanco.

**Versión publicada en Vercel:** utiliza PostgreSQL de Neon y Vercel Blob privado para las fotos cifradas. Cada actualización del código conserva la base y los documentos. La versión de escritorio local sigue usando SQLite. Ver [DEPLOYMENT.md](DEPLOYMENT.md) para operar la web y realizar respaldos.

## Iniciar

Requiere **Node.js 24 LTS**. Usa SQLite incorporado en Node ([documentación oficial](https://nodejs.org/docs/latest-v24.x/api/sqlite.html)) y Sharp para validar y procesar fotos.

```powershell
npm install
npm start
```

Abrir **http://localhost:3000**. En el primer inicio se crean dos cuentas con contraseñas aleatorias. Leer sus claves en el archivo privado **data/accesos-iniciales.txt**:

- `admin`: invitadores, cupos, invitados, revocaciones, datos del evento y descarga del flyer.
- `seguridad`: búsqueda, consulta de DNI e ingreso.

No se precargan personas ni documentos reales o de ejemplo en la base de uso normal.

## Flujo

1. Entrar en `/admin` y crear un invitador con nombre y cupo.
2. Copiar el link o compartirlo con el botón de WhatsApp. Su formato es `/invitacion/nombre-apellido?token=...`, con UUID interno y token aleatorio de 256 bits. Compartir el **link completo**, incluido el token.
3. El invitado ve quién lo invita y completa nombre, apellido, DNI y foto. El servidor asigna el invitador desde el token, ignorando cualquier invitador enviado por el cliente.
4. Seguridad entra en `/seguridad` y busca por nombre, apellido o DNI. La búsqueda admite acentos y nombres completos. Las personas con el mismo nombre se distinguen por DNI.
5. Abrir la foto para verificar la identidad y marcar **INGRESÓ**. La hora queda guardada y se actualiza por SSE en los demás dispositivos. Un ingreso simultáneo solo se registra una vez.

El DNI es único para todo el evento. Los cupos se validan en una transacción de escritura y no pueden excederse por solicitudes simultáneas. Los invitados revocados conservan su registro y su cupo; para sumar otras personas se puede aumentar el cupo. Revocar un invitador bloquea nuevos registros y el ingreso de todos sus invitados. La revocación individual bloquea a una persona. Reactivar un invitador no elimina revocaciones individuales. Renovar el token invalida el link anterior y mantiene a sus registrados.

## Flyer

En **Evento y flyer**, editar título, frase, fecha, hora, lugar y descripción. La fecha y hora no se inventan: hasta configurarlas aparecen “a confirmar”. Descargar el flyer PNG de **1080 × 1440** para compartir. Los archivos originales utilizados están en `public/assets`.

También queda un primer flyer listo en `flyer/los-cedros-night.png`, con fecha y horario a confirmar.

## Protección de datos y sesiones

- Fotos cifradas con AES-256-GCM en SQLite, fuera de `public`. Solo se sirven a usuarios autenticados de administración o seguridad, con `Cache-Control: no-store`. Cada consulta queda en auditoría.
- El servidor decodifica las imágenes, limita su tamaño y resolución, elimina metadatos y las normaliza a JPG. No admite SVG ni documentos ejecutables.
- Contraseñas con scrypt, cookies HttpOnly y SameSite, sesiones de 12 horas, permisos por rol y protección de solicitudes de escritura. Límite de intentos de inicio de sesión y registro.
- Búsqueda con consultas parametrizadas, resultados de 50 personas por página y protección contra respuestas atrasadas mientras se escribe.
- No hay generación ni lectura de códigos QR. El ingreso es manual por lista.
- Se conserva un registro de altas, cambios de cupo, revocaciones, consultas de foto e ingresos en la tabla `audit`.

Para rotar una contraseña y cerrar todas las sesiones de esa cuenta:

```powershell
npm run password -- admin
npm run password -- seguridad
```

La nueva contraseña queda en `data/nuevo-acceso-<usuario>.txt`. Guardar la clave en un lugar privado y eliminar el archivo de entrega cuando ya no sea necesario. `accesos-iniciales.txt` conserva las claves iniciales, que dejan de funcionar al rotarlas.

## Celulares y publicación

El servidor escucha en `0.0.0.0`. Para probar en celulares de la misma Wi-Fi, usar `http://<IP-de-la-PC>:3000`; `localhost` en un celular apunta al propio celular. Todos los dispositivos deben conectarse al mismo servidor. Copiar el link desde esa dirección para que funcione en la misma red.

Para enlaces de WhatsApp accesibles fuera de esa red hay que alojar el servidor con un **dominio HTTPS**, almacenamiento persistente y respaldo. Configurar `.env` a partir de `.env.example`: `PUBLIC_URL=https://tu-dominio` y `SECURE_COOKIES=true` detrás del proxy HTTPS. El proxy debe permitir SSE sin buffering en `/api/events`. No exponer el puerto HTTP directo si el servicio usa HTTPS.

`npm start` inicia la versión local sobre SQLite. En Vercel, `api/index.mjs` usa exclusivamente PostgreSQL y Blob privado: nunca intenta guardar datos en el disco temporal de una función. Las instancias de Vercel consultan una revisión compartida para sincronizar los dispositivos. Las conexiones SSE se renuevan automáticamente.

Respaldar la carpeta privada `data` con el servidor detenido (base y clave de cifrado juntas). Si se pierde `photo.key`, las fotos no podrán recuperarse. Restringir permisos de la carpeta al usuario del servicio y no publicarla ni subirla a Git. Definir con el club cuándo eliminar los datos tras el evento. La revocación no borra documentos.

## Verificar

```powershell
npm run check
npm test
npm run test:ui
```

Las pruebas de sistema usan bases temporales de SQLite y PostgreSQL (PGlite) y verifican permisos, DNI único, cupos simultáneos, cifrado, ingreso único, SSE, revocación, rotación y persistencia. También verifican la sincronización y los límites de solicitudes entre dos instancias independientes. La prueba visual usa Microsoft Edge instalado y revisa el flujo completo en escritorio y dos celulares, incluido el flyer descargable. Las capturas quedan en `test-results`, sin datos reales.
