# Diseño de la app web — ChBook

Este documento aterriza en código la guía oficial **03_ChBook_Brand_Guidelines**.
Si algo aquí contradice la guía, manda la guía.

**iPhone, no Android.** Minimalista, bien hecho, sobrio. ChBook es una herramienta
de gestión (el ERP de la iglesia), no una app devocional. Los dashboards giran
alrededor de **personas**, con **números reales**.

## Reglas

- **Paleta plana:** nada de degradados, vidrio (`backdrop-blur`) ni brillos de color.
  **Excepción acordada (vidrio en toda la app):** `PageShell` pinta el fondo `.aura` (manchas suaves de sage, agua y vela) y, dentro de él, toda `.tarjeta` se vuelve vidrio (blanco translúcido con desenfoque; las anidadas solo se aclaran). `.vidrio` es la misma superficie para usarla a mano. `PageShell aura={false}` vuelve al crema plano. Los botones, campos y textos siguen planos.
- **Gráficos** (`components/charts.tsx`): serie principal sage oscuro `#2D5A50`, segunda vela `#B8956A`, tercera agua `#6B9E91` (`SERIES` en `lib/ui.ts`). El par sage/vela pasa la prueba de daltonismo; como la vela tiene poco contraste con el fondo, siempre van con leyenda, etiquetas y tooltip.
- **Máximo 3 colores por pantalla:** sage manda, el marrón contrasta y la crema da respiro.
- **Sin imágenes religiosas** en la interfaz (cruces decorativas, palomas…). La única cruz es la del logo.
- **Datos reales siempre.** Si un valor no existe se muestra `—`, nunca un número de ejemplo.

## Color

Los nombres de token son heredados; lo que importa es el valor y el uso.

| Token | Valor | Guía | Úsalo para… |
|---|---|---|---|
| `sage-dark` | `#2D5A50` | Sage oscuro | Encabezado, botón principal, números de KPI. |
| `sage-deep` | `#244A42` | — | Solo el *hover* del botón principal. |
| `sage` | `#4A7C6F` | Sage medio | Acentos, iconos activos. |
| `sage-water` | `#6B9E91` | Verde agua | Métricas y *highlights*. |
| `sage-light` | `#E6EFEC` | — | Tinte de fondo: elemento activo, anillo de foco. |
| `clay` / `vela` | `#8B6F47` | Marrón cálido | Acción secundaria y contraste: equipos, cumpleaños, prospectos, «Día de culto». |
| `vela-light` | `#F2EBDF` | — | Fondo de las etiquetas y avisos en marrón. |
| `bronze` | `#B8956A` | Marrón claro | Bordes premium (p. ej. el aviso de prospectos). |
| `paper` | `#F8F5EF` | Crema | Fondo de página y texto sobre sage oscuro. |
| `cream` / `clay-light` | `#F1ECE2` / `#E8E0D2` | — | *Hover* y sublistas / bordes. |
| `charcoal` | `#1E2A24` | Carbón verde | Texto fuerte. |
| `graysage` | `#4A5E58` | Gris sage | Texto secundario. |
| `faint` | `#8A9893` | — | Marcadores de posición (*placeholders*). |
| `danger` | `#B3261E` | — | **Solo** errores y acciones destructivas. |
| `ink` / `gold` | `#1C1C1E` / `#C9A84C` | Logo | Solo la insignia del logo. |

Los colores que cada iglesia asigna a sus tipos de actividad y a sus rangos de edad
son datos suyos y se muestran tal cual. La personalización por iglesia (R-20) debe
ofrecer combinaciones aprobadas.

## Tipografía

| Uso | Familia | Clase |
|---|---|---|
| Títulos y números de KPI | DM Serif Display 400 | `font-serif`. `index.css` fuerza el peso 400 para evitar negritas falsas. |
| Interfaz | Plus Jakarta Sans 400–700 | `font-sans` (por defecto) |
| Códigos (CHBK-4821, horas) | DM Mono | `font-mono` |
| Etiquetas | Plus Jakarta Sans 600, 11–12 px, MAYÚSCULAS | `text-[0.7rem] font-semibold uppercase tracking-wider` |

**Letra grande** (Ajustes → Apariencia) sube todo un 12,5 % (`html.letra-grande`) y se guarda en el dispositivo.

## Logo

Es el monograma «Ch» con la cruz sobre la h, en la versión **monolínea**
(`ChBook-Logos/02-Propuestas`, propuesta 1): trazos redondeados en dorado plano,
sin degradado. En tamaños chicos el trazo se engrosa para no bajar de ~2 px.
El favicon usa la misma figura con trazo grueso.

- `LogoMark`: insignia `ink` con las letras en `gold`, igual que el *app icon*.
- `LogoMark badge={false}`: solo las letras, sobre fondo claro en `charcoal`.
- `public/favicon.svg`: la misma insignia.
- Nombre escrito: **ChBook**.

## Componentes

| Pieza | Dónde | Notas |
|---|---|---|
| `PageShell`, `PageLoading` | `src/components/PageShell.tsx` | Marco de toda pantalla protegida: encabezado, título, acciones, hueco para la barra móvil. |
| `AppHeader` | `src/components/AppHeader.tsx` | Encabezado en sage oscuro. En móvil la navegación pasa a una barra inferior blanca. |
| `Avatar` | `src/components/Avatar.tsx` | Iniciales sobre un tono sage o marrón, estable por nombre. Toda persona se muestra con su avatar. |
| `.tarjeta` | `src/index.css` | Tarjeta blanca, borde fino, sin sombra llamativa. |
| `btnPrimary`, `btnSecondary`, `fieldCls` | `src/lib/ui.ts` | Botones y campos estándar. |
| Etiquetas | — | Roles: `bg-sage-light text-sage-dark`. Equipos: `bg-vela-light text-clay`. Forma `rounded-full`. |

## Tono de voz

- Directo y concreto: «Sabe quién llegó al culto sin pasar lista.»
- Profesional pero cálido. Sin jerga religiosa: nada de «bendición» ni «aleluya».
- Nombres propios en inglés (**ChBook, Dashboard, Check-in, Plan**); el resto de la interfaz, en español.

## Movimiento

Solo para orientar:

- Entrada suave del contenido (`.subir`).
- Cambio de paso en el login (`.paso`).
- Trazo del logo al cargar el login.
- Arrastre de tarjetas en el calendario.

Todo respeta `prefers-reduced-motion`.

## Dashboard

El contenido sigue el flujo #7 de *02_ChBook_Flujos_Usuario*:

- KPIs (miembros, activos, % activos, asistencia promedio).
- Aviso de prospectos pendientes.
- **Esta semana** (`src/lib/pastoral.ts`):
  - cumpleaños de los próximos 7 días;
  - personas por aprobar;
  - miembros activos que asistieron en los últimos 90 días pero no en las últimas 3 semanas.
- Próximos 7 días del calendario.
