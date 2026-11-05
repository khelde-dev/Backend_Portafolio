# Documentación legacy (v2): Hono sobre Turso

Esta carpeta conserva, **sin editar**, la documentación del backend de cuando
guardaba en **Turso (libSQL)** y se hizo la auditoría de seguridad inicial.
Es historial: no describe el sistema actual.

> La documentación vigente está en [`../ARQUITECTURA.md`](../ARQUITECTURA.md)
> y [`../PRUEBAS-Y-CI.md`](../PRUEBAS-Y-CI.md).

| Archivo                                                                              | De qué trata                                               |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| [`00-auditoria.md`](./00-auditoria.md)                                               | Auditoría de seguridad inicial y sus hallazgos             |
| [`02-comentarios-y-contacto.md`](./02-comentarios-y-contacto.md)                     | Diseño de los comentarios y de la tabla `contact_messages` |
| [`04-hono-projects-experiences-crud.md`](./04-hono-projects-experiences-crud.md)     | CRUD de proyectos y experiencia                            |
| [`05-hono-language-and-best-practices.md`](./05-hono-language-and-best-practices.md) | Idiomas y buenas prácticas de Hono                         |
| [`06-about-education-skills.md`](./06-about-education-skills.md)                     | Acerca de, educación y habilidades                         |
| [`07-testing-y-ci.md`](./07-testing-y-ci.md)                                         | Pruebas y CI de esa etapa                                  |

El respaldo de Turso (`01-backup-turso.md`) que cita la auditoría no está en el
repositorio.

## Cómo leerlo

- Las menciones a Turso, `@libsql/client`, Vercel y `/tlgrm` describen el estado
  de entonces. La migración a D1 está documentada en
  [`../../legacy/turso-migration/README.md`](../../legacy/turso-migration/README.md).
- Los hallazgos de seguridad de `00-auditoria.md` están corregidos; lo que sigue
  vigente (token por rutas, Cloudflare Access, validaciones, límite de peticiones)
  está resumido en [`../ARQUITECTURA.md`](../ARQUITECTURA.md).
