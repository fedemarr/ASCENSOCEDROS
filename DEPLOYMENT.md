# Operación en Vercel

Repositorio: https://github.com/fedemarr/ASCENSOCEDROS

Equipo Vercel: `fmcodes-projects`. Proyecto: `ascensocedros`.

Web pública: https://ascensocedros.vercel.app

Paneles: https://ascensocedros.vercel.app/admin y https://ascensocedros.vercel.app/seguridad. Ambos requieren iniciar sesión.

## Datos persistentes

- **Neon PostgreSQL**, recurso `ascensocedros-db`, plan `free_v3`, región São Paulo (`gru1`): cuentas, sesiones, invitadores, cupos, invitados, ingresos y auditoría.
- **Vercel Blob privado**, `ascensocedros-dni`, región `gru1`: fotos normalizadas a JPG y cifradas con AES-256-GCM antes de subirlas. Las URLs de almacenamiento no son públicas. El servidor exige sesión y permisos para entregar la foto.
- La clave `PHOTO_KEY` se almacena como variable privada de Vercel. Nunca subirla a Git ni cambiarla al redeployar. Copiarla junto con la base y las fotos al hacer un respaldo.
- Una nueva versión de Vercel modifica el código, conserva los recursos de almacenamiento y no recrea usuarios ni bases. Si falta la configuración, el servicio falla sin crear una base temporal.

Las altas y los cambios de cupo bloquean la fila del invitador en PostgreSQL. El DNI es único a nivel base. El ingreso usa una operación atómica y conserva una sola hora aunque se marque desde dos dispositivos. Cada cambio incrementa una revisión compartida, que las conexiones SSE consultan cada segundo; el ingreso también refresca inmediatamente el dispositivo que lo marcó.

Las fotos seleccionadas pueden pesar hasta 5 MB. El navegador las optimiza antes de enviarlas para respetar el límite de cuerpo de las funciones de Vercel, y el servidor las valida y normaliza de nuevo.

## Accesos

La migración inicial conserva las cuentas y contraseñas de la base local. Las claves iniciales están en el archivo privado `data/accesos-iniciales.txt`, si aún no fueron rotadas. No hay contraseñas en el repositorio.

Para cambiar una clave **de la web publicada** e invalidar todas las sesiones de esa cuenta:

```powershell
vercel env pull .env.cloud.local --environment production --yes --scope fmcodes-projects
npm run password:cloud -- admin
# O: npm run password:cloud -- seguridad
```

La nueva clave queda en `data/nuevo-acceso-cloud-<usuario>.txt`. `npm run password` cambia solamente la versión SQLite local.

## Respaldos

Cerrar o reiniciar el navegador, la PC o el despliegue no elimina los datos en la nube. Para cubrir borrados accidentales, realizar copias privadas independientes:

```powershell
vercel env pull .env.cloud.local --environment production --yes --scope fmcodes-projects
npm run backup:cloud
```

El respaldo se guarda en `data/backups/<fecha>/`. Incluye una instantánea coherente de las tablas, las fotos cifradas y `photo.key`. Solo es completo si existe `COMPLETE.txt`. Copiar la carpeta a otro disco o almacenamiento privado. Contiene datos personales y la clave de descifrado: no publicarla ni enviarla al repositorio.

Las sesiones no se respaldan; ante una restauración el equipo vuelve a iniciar sesión. Guardar solo la carpeta SQLite local no respalda los nuevos registros de la web. Los backups no son automáticos: ejecutar este comando periódicamente y al terminar el evento.

## Desarrollo y despliegue

```powershell
npm ci
npm run check
npm test
npm run test:ui
vercel --prod --scope fmcodes-projects
```

`vercel.json` define explícitamente la función Node de producción. El código local SQLite no se usa como servidor de Vercel. Los archivos `data`, `.env*`, `.vercel` y los resultados de pruebas quedan excluidos del repositorio y/o del despliegue.

El proyecto está conectado al repositorio: un `git push` a `main` dispara una actualización automática de producción. Revisar las comprobaciones de GitHub antes de enviar cambios.

Para verificar los servicios reales con un registro temporal, ejecutar `node --env-file=.env.cloud.local scripts/smoke-cloud.mjs https://ascensocedros.vercel.app`. Utiliza las claves iniciales del archivo local, por lo que no debe usarse después de rotarlas sin actualizar ese archivo. El script elimina únicamente sus propios datos y fotos de prueba al finalizar.

Para probar localmente la base de la nube: `npm run start:cloud`, disponible en `http://localhost:3001`. Esa vista utiliza los datos reales de la web: las acciones modifican esa base.

`npm run migrate:cloud` importa los datos locales sin borrar los registros de destino y comprueba que la clave de cifrado coincida. No sobrescribe cupos, personas o configuración ya presentes. Se usa para la migración inicial; las actualizaciones habituales del código no requieren ejecutarlo.

El plan gratuito de Neon y los recursos de Vercel tienen límites de uso. No eliminar los recursos ni el proyecto mientras deban conservarse los registros. Consultar el panel de almacenamiento para revisar consumo y mantener las copias independientes.
