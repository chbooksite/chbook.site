# ChBook — Visión del Ecosistema (documento maestro)

> Documento vivo. Fuente única de verdad de la **visión ampliada** del producto.
> Complementa (no reemplaza) al documento de traspaso técnico de fases/BD.
> Última actualización: 2026-08-03.

---

## 0. Idea rectora

ChBook no es una app: es un **ecosistema de herramientas digitales para iglesias**.

- Existe una **app base** que define la identidad del producto: **check-in / asistencia por GPS** + **métricas**. Todo el valor analítico nace de aquí, porque de las asistencias y registros salen los datos de los dashboards.
- Sobre esa base se enchufan **extensiones y apps por departamento** (músicos, danzas, multimedia, niños, predicadores, etc.). Cada app de departamento trae las **funciones básicas** pero en un **entorno enfocado** a ese rol, con herramientas propias del área.
- Todo lo adquirido por una iglesia recae en un **perfil maestro** (pastor / administrador) que da **seguimiento a todas las extensiones y herramientas** contratadas para esa iglesia.
- **Backend y datos compartidos**, múltiples frentes de app. Una extensión no necesariamente vive dentro del entorno base: puede ser su propia app enfocada, pero consume y alimenta los mismos datos.

**Modelo comercial:** la app base se vende por **planes según cantidad de miembros** (base: hasta 100 personas registradas). Las extensiones/departamentos se adquieren como **cargos extra**.

**Los dos pilares del sistema:** **PERSONAS** y **ACTIVIDADES**. Todo cuelga de estos dos.

---

## 1. Pilar A — PERSONAS

### 1.1 Registro del perfil principal (pastor / admin) — app base

Datos que captura al registrarse:

- Nombre completo
- Número(s) de identificación
- Correo personal y/o correo de la iglesia
- **Ubicación GPS precisa del auditorio** (ancla del check-in — dato crítico)
- **Número estimado de miembros** → el sistema **sugiere el plan recomendado**
- Selección de **roles necesarios** desde un **listado predeterminado tipo etiquetas** (multi-selección)

La organización tiene **dos niveles**:

**(a) Equipos** (en la jerga son "departamentos", pero **esa palabra NO va en la UI** — el término oficial de la interfaz es **"Equipos"**). Cada equipo tiene **líder(es) interno(s)** y sus miembros. Equipos predeterminados (ampliables por la iglesia):

- Jóvenes
- Niños *(el rol "maestro de niños" vive DENTRO de esta área)*
- Multimedia (sonido, proyección, streaming)
- Danza
- Música
- Diáconos
- **Finanzas** *(base para el módulo/extensión de finanzas — ver §2.5)*

**(b) Roles generales** (etiquetas transversales, multi-selección, ampliables):

- **Miembro** — rol **base/inicial** que recibe toda persona al ser aprobada. Todos son miembros; los demás roles se suman encima.
- **Pastor principal** — el perfil maestro/admin; se asigna al registrar la iglesia.
- **Pastor afiliado** — pastores asociados. *Pastor principal + afiliado pueden agruparse como "Pastores".*
- **Líder** — líder (incl. líder interno de un equipo).
- **Administrador** — rol **asignado** con permisos de gestión; se mantiene explícito e importante.
- **Predicador** — **NO es un rol que se auto-asigne**. Solo puede asignarse a un miembro que **ya sea líder, pastor principal o pastor afiliado** (elegibilidad restringida). Predicadores frecuentes → futuro motor de asignación automática.

- Un miembro puede pertenecer a **varias áreas** y tener **varios roles**.
- **Líder interno**: dentro de un área, un miembro puede marcarse como su líder.
- Roles específicos de área (ej. *maestro de niños*, o un instrumento en Música) cuelgan del área correspondiente.
- El pastor puede **agregar áreas y roles personalizados** además de los predeterminados.

### 1.2 Miembros

- **Alta principal:** cada persona se registra **desde su propia app** cuando llega por primera vez a la iglesia.
- **Alta por líder (excepción):** apps personalizadas de líderes pueden **agregar personas** manualmente.
- **Dependientes:** un miembro puede **registrar a su cargo** niños o adultos mayores (hijos, ancianos). Estos dependientes pueden **no tener cuenta propia**.
  - Al llegar a la iglesia, al miembro se le muestra una **confirmación de asistentes** con los dependientes que tiene en su perfil (marca quién vino).
- **Clasificación de cada miembro por:**
  - **Rango de edad** (niño / adolescente / adulto / adulto mayor — ya calculado en la BD)
  - **Rol / papel** que desempeña (multi-rol vía etiquetas)

### 1.3 Aprobación e ingreso a una iglesia

- Cualquier persona puede **descargar la app desde cualquier lugar** (sin iglesia).
- Al **unirse a una iglesia**, el **pastor / app administrador recibe una notificación y debe confirmar** el ingreso (flujo prospecto → aprobado → miembro activo).
- **Regla de exclusividad:** una persona solo puede pertenecer a **UNA iglesia a la vez**.
- **Retiro:** para salir de una iglesia se envía una **notificación a la cuenta administrativa / del pastor**.

### 1.4 Asistencia

- **Presencial:** check-in por **GPS** validando que la persona esté dentro del radio del auditorio.
- **Online:** los asistentes por transmisión registran su asistencia **manualmente con un código que la transmisión les otorga**.

### 1.5 Herramientas del pilar Personas

- GPS de check-in de asistencia.
- **Análisis de datos**: asistencias, miembros, retención, segmentación por edad y por rol.

---

## 2. Pilar B — ACTIVIDADES

### 2.1 Calendario / definición de actividades

- Modelo habitual: un **calendario** para definir actividades y horarios de la semana.
- ⚠️ **Concepto aún NO cerrado** — el calendario es lo más común pero no convence del todo. Queda **abierto a rediseño**; explorar alternativas antes de fijar la UX.
- Las actividades se **unen con las notificaciones**: avisan a **todas las personas** o a **cierto grupo** según la actividad.

### 2.2 Notificaciones

- Segmentables: a todos o a un grupo/rol específico según la actividad.
- **Antes de cada servicio** se envían notificaciones a **todos los miembros**.

### 2.3 Herramientas de departamento — ejemplo Músicos

- Horarios de **ensayos**.
- **Lista de canciones** por servicio.
- **Equipos / encargados** por servicio.
- **Asignación automática por instrumento** ⭐: la app genera las asignaciones de músicos para cada actividad de la semana (o un rango mayor), **equilibrando la carga de horas** de cada miembro.
  - Maneja **excepciones** (ej.: "el baterista #2 no puede ser asignado los sábados" — las razones se gestionan personalmente).
  - Con **notificaciones** de todas las asignaciones.
- **El mismo motor aplica a predicadores frecuentes**: orden automático bajo los mismos parámetros (equilibrio de carga + excepciones).

### 2.4 ⭐ Actividades en Tiempo Real (dentro de un servicio)

> En la jerga cristiana evangélica, a la actividad principal se le llama **"servicio"**.

- **Línea de tiempo en vivo** que va mostrando **qué actividad se está ejecutando** dentro del servicio en curso.
  - Ej.: el servicio inicia 7:00; a las 7:15 empieza "Alabanza". Desde mi app veo en tiempo real qué se está haciendo → sé si llego a tiempo o qué me perdí si aún no llego.
- El **perfil administrativo** arma la línea de tiempo mediante **etiquetas** que se acomodan una tras otra en el orden requerido.
- **Duración por actividad:** se asigna ingresando el dato directamente **o arrastrando el borde de la barra** con el dedo para ampliar/reducir el tiempo.
- La **duración total del servicio se conoce** porque el servicio se registra con **hora de inicio y de finalización**.
- Antes de cada servicio → notificación a todos los miembros.

**Estado BD:** ya modelado en `activity_tags` (plantillas reutilizables) y `service_activities` (actividades del servicio en vivo). ✅

### 2.5 Finanzas (extensión / módulo planeado)

Contexto: las iglesias normalmente **no tienen cargos administrativos formales**; son **miembros asignados** quienes cuentan ofrendas, firman registros y son testigos del manejo de las entradas monetarias. El módulo de Finanzas apunta a dar herramientas para esta área:

- **Sistema de ofrenda electrónica** (vía Stripe Connect).
- **Registro automático** de las ofrendas (electrónicas y, donde aplique, manuales).
- **Tablas contables** generadas por el sistema, **descargables** (exportables).
- Soporte al flujo humano: asignar quién cuenta, quién firma, quién es testigo.

> Es una **extensión de pago**, no parte del núcleo. Se construye después de la app base. El área "Finanzas" en el listado de áreas es el punto de anclaje.

---

## 3. Implicaciones para el modelo de datos

Lo que la visión ampliada añade o cambia respecto al esquema actual. **A decidir antes de escribir código de Fase 2.**

| # | Tema | Estado actual en BD | Cambio que exige la visión |
|---|---|---|---|
| D1 | **Multi-rol por miembro** | `members.role` es un enum único | Pasar a **N roles por miembro** (tabla `member_roles` M:N) + catálogo de roles **predeterminados + personalizados por iglesia** (etiquetas) |
| D1b | **Equipos (2 niveles)** | No existe | Tabla `teams` (predeterminados + personalizados por iglesia) + `member_teams` M:N con flag **`is_leader`** (líder interno) y rol específico de equipo opcional (ej. maestro de niños). Término UI = **"Equipos"** (nunca "departamento") |
| D2 | **Dependientes** | No existe | Relación **tutor → dependiente** (niño/adulto mayor), posiblemente sin `auth.user`. Confirmación de asistencia por dependiente |
| D3 | **Ecosistema / extensiones** | No existe | Catálogo de extensiones + tabla de **extensiones adquiridas por iglesia** (entitlements) que el perfil maestro monitorea |
| D4 | **Una iglesia a la vez** | Implícito | Regla **explícita** de membresía única activa + flujo de **retiro con notificación** al admin |
| D5 | **Aprobación de ingreso** | Estados `prospect/active` existen | Flujo formal: unirse → **notifica admin** → confirma |
| D6 | **Asistencia online por código** | `services.online_code` existe | Flujo de registro manual con el código de la transmisión |
| D7 | **Motor de asignación automática** | No existe | Disponibilidad, excepciones, asignaciones, equilibrio de carga (músicos y predicadores) — **extensión, fase posterior** |
| D8 | **Notificaciones segmentadas** | `notifications` existe (target null=todos o 1 miembro) | Segmentar por **grupo/rol**, no solo "todos" o "uno" |
| D9 | **Línea de tiempo en vivo** | `activity_tags` + `service_activities` ✅ | Ya cubierto; falta la UX de arrastrar duración |

---

## 4. Roadmap ajustado (respeta la "regla de oro": un paso a la vez)

La visión es grande, pero **el orden de construcción no cambia**: primero la base (Personas + check-in), y solo después las extensiones de departamento.

**Núcleo (app base) — lo que da identidad:**
1. **Fase 2 — Web app del pastor** (SIGUIENTE): cliente Supabase → login → registro de iglesia → CRUD de miembros + aprobación → dashboard con métricas reales.
2. **Fase 3 — App móvil del miembro + check-in GPS**: el corazón de la identidad. Registro del miembro, unión a iglesia con aprobación, check-in GPS, asistencia online por código, dependientes.
3. **Fase 4 — Actividades + notificaciones + línea de tiempo en vivo**.
4. **Fase 5 — Pagos** (Stripe): planes por miembros + cargos extra de extensiones.

**Ecosistema (después del núcleo):**
5. **Perfil maestro de extensiones** (entitlements) + primera **app de departamento: Músicos** (ensayos, canciones, equipos, y luego el motor de asignación automática).
6. Resto de departamentos (danzas, multimedia, niños, predicadores…).

> Ninguna extensión se construye hasta que la app base (Personas + check-in + métricas) funcione de punta a punta.

---

## 5. Decisiones (resueltas 2026-08-03) y abiertas

**✅ Resueltas:**

- **A4 — Arquitectura de apps de departamento:** **UNA sola app** con **entornos que cambian según los roles/extensiones** del usuario (no apps separadas). Un solo código, backend compartido. El "entorno músico", "entorno danzas", etc. se activan según los roles del usuario y las extensiones adquiridas por su iglesia.
- **A2 — Multi-rol (D1):** **Definir el catálogo de roles ahora**; migrar el esquema a **multi-rol** (M:N + catálogo predeterminado + roles personalizados por iglesia) **en Fase 2**, al construir el CRUD de miembros.
- **A3 — Dependientes (D2):** un dependiente es un **`member` sin `auth.user`** con un campo **`guardian_id`** que apunta al tutor. Reusa la lógica de miembros, asistencia y edad.
- **A5 — Conteo del plan:** cuentan **todas las personas ya APROBADAS** por el perfil administrador (miembros activos **+** dependientes aprobados). Los **prospectos aún no aprobados NO consumen cupo**.

**⏳ Abiertas:**

- **A1 — UX de Actividades:** el calendario no convence. Explorar alternativas (línea de tiempo semanal, tablero por servicio, etc.) antes de fijar. Se decide al llegar a **Fase 4**.

---

*ChBook · Ecosistema de herramientas digitales para iglesias — "Organizando la iglesia. Un perfil a la vez."*
