# ChBook — Sistema de Autenticación (spec)

> Especificación del Paso 2 de la Fase 2. Complementa `VISION_ECOSISTEMA.md`.
> App multi-tenant; **dos niveles de autenticación** según el tipo de usuario.
> Última actualización: 2026-08-03.

---

## Nivel 1 — Miembro base (baja fricción)

**Login:** cédula/identificación + **PIN (4-6 dígitos)**. Sin requerir correo.

**Registro:**
- La **cédula es única a nivel de TODA la plataforma** (no por iglesia). Es la llave para prevenir duplicados y evitar que una persona esté activa en más de una iglesia a la vez.
- Validación al registrar:
  - Cédula con **membresía activa en otra iglesia** → **bloquear** registro y mostrar mensaje: primero solicitar su retiro.
  - Cédula existente pero en estado **retirado** → **permitir** nuevo registro (flujo de **traslado** entre iglesias).
- **Campos obligatorios:** nombre completo + cédula. Correo, teléfono, dirección son **opcionales/completables después** (para que un admin pueda registrar a alguien sin esos datos).
- **PIN:** se **genera automáticamente al aprobar** la solicitud (lo entrega el admin), o lo **define el propio usuario** si se autorregistra.

**Google (opcional):** disponible como alternativa, no obligatoria; útil porque autocompleta algunos datos.

**Aprobación:** toda solicitud cae en una **bandeja de notificaciones del admin** (estilo solicitudes de redes sociales); el admin aprueba o rechaza.

**Retiro:** cuando un miembro decide irse, se genera **notificación al admin** (no pide permiso, solo informa) para que el listado se actualice y la cédula quede libre para otra iglesia.

---

## Nivel 2 — Roles con permisos (gestión)

Aplica a **líderes, administradores y cualquiera que gestione** notificaciones, calendario o base de datos.

- **Login:** **correo verificado + contraseña robusta** (no PIN).
- **2FA obligatorio** (código por correo o SMS es suficiente; no requiere app authenticator).
- **Sesión con expiración más corta** que la del miembro base.
- **Logs de auditoría** en acciones sensibles (cambios de configuración, permisos, etc.).
- Este **rol de seguridad** es **independiente del rol funcional/eclesiástico** que asigna el pastor (líder, predicador, etc.). Todo usuario con capacidad de ejecutar acciones administrativas necesita este nivel, sin importar su rol eclesiástico.

---

## Objetivo de negocio

- Evitar **duplicados y membresías fantasma** que inflen los números públicos de cada iglesia.
- Mantener el registro **simple para el miembro base** (onboarding sin fricción), pero con controles para datos confiables.
- Los **perfiles públicos** mostrarán **métricas de participación real**:
  - **Activos regulares**
  - **Esporádicos** (< 1 vez/mes)
  - **Inactivos** (+6 meses sin registro de asistencia)
  - → Desincentiva inflar cifras desde el lado institucional, no solo desde el registro individual.

---

## Implicaciones técnicas y decisiones abiertas (a resolver antes de implementar)

**T1 — Cédula + PIN sobre Supabase Auth.** Supabase Auth nativo es email/OAuth, no "cédula + PIN". Opciones:
- **(a) Email interno sintético** *(recomendado)*: registrar en Supabase Auth con un correo derivado (ej. `{cedula}@id.chbook.local`) y el **PIN como password**, con **rate-limiting** por la debilidad del PIN. El correo real (si lo dan) va aparte en el perfil. Bajo esfuerzo, reusa toda la infra de Auth/sesiones.
- **(b) Auth personalizada** (Edge Function que valida cédula+PIN y emite JWT). Más control, mucho más trabajo y superficie de seguridad.

**T2 — Dos niveles conviven.** Un mismo humano puede pasar de Nivel 1 (PIN) a Nivel 2 (correo+contraseña+2FA) al recibir un rol de gestión. Definir la **transición/upgrade** de credenciales y cómo se marca el "rol de seguridad" (¿flag `security_tier` en el perfil, separado de los roles eclesiásticos?).

**T3 — Cédula única global.** Nueva columna `cedula` en `members` (o tabla de identidad de plataforma) con **UNIQUE global** + índice. Enforcement de "una iglesia activa a la vez" se apoya en cédula + estado. Reconciliar con la decisión D4 de la visión.

**T4 — Personas sin cédula.** Dependientes (niños/ancianos) y posibles extranjeros **pueden no tener cédula**. Definir identificación alternativa (los dependientes ya son `member` sin cuenta con `guardian_id`; ¿cédula opcional para ellos?). No pueden ser la llave única universal.

**T5 — 2FA por correo/SMS.** Elegir proveedor (Supabase MFA es TOTP; para OTP por correo/SMS puede requerir integración propia o proveedor SMS). Decidir en el sub-paso de Nivel 2.

**T6 — Reconciliar métricas.** La visión previa hablaba de "no asistentes a 2 meses → alerta"; esta spec define **esporádico <1/mes** e **inactivo +6 meses**. Unificar las definiciones de participación en un solo lugar (afecta vistas del dashboard y perfiles públicos).

**T7 — Estados de membresía.** Formalizar `retirado` como estado que **libera la cédula** para traslado, distinto de `inactivo` (métrica) y `archived`. Revisar el enum `status` actual (`prospect/active/inactive/archived`).

**T8 — Entrega de correo + política de confirmación (producción).** El correo integrado de Supabase es **solo pruebas** y está fuertemente rate-limited (en dev un 2º registro seguido no recibió el correo de confirmación). Antes de producción: (a) configurar **SMTP propio** (Resend/SendGrid/etc.); (b) **verificar que "Confirm email" se exige de verdad** en el panel de Auth — durante las pruebas se pudo entrar sin recibir el correo, hay que confirmar el ajuste (alinea con el requisito "correo verificado" del Nivel 2). Observado en dev el 2026-08-13.

---

*Plan de construcción (mañana):* empezar por **Nivel 1** (cédula + PIN, opción T1-a) + React Router + rutas protegidas + bandeja de aprobación; dejar **Nivel 2** (correo+contraseña+2FA+auditoría) y **Google OAuth** como sub-pasos posteriores.
