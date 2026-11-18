// Colores del mapa de la iglesia, compartidos con las tablas de cada sección para
// que el color de un equipo/líder coincida en ambos sitios. El color de una entidad
// se deriva DETERMINÍSTICAMENTE de su id (mismo id → mismo color), así no hay que
// sincronizar listas ni órdenes entre componentes.

export const MAP_PALETTE = ['#2a78d6', '#1baf7a', '#eb6834', '#e34949', '#eda100', '#6250d6', '#0f8a8a', '#b5651d', '#c2185b', '#558b2f', '#7b5e57', '#00897b']
export const MAP_VARIOS = '#8e7cc3'
export const MAP_SIN = '#a3abb5'
export const MAP_PRESENT = '#1baf7a'
export const MAP_ABSENT = '#d9dbde'

// Color estable de una entidad (equipo/líder) por su id.
export function entityColor(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return MAP_PALETTE[h % MAP_PALETTE.length]
}
