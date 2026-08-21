/**
 * soma-lib — shared hexagonal core for soma and soma-work.
 *
 * Layering (see README.md):
 *   src/domain/*   pure domain logic — no I/O, no framework imports
 *   src/ports/*    interfaces the domain needs from the outside world (to come)
 *   src/adapters/* shared implementations of ports (to come)
 *
 * Everything is re-exported flat from the package root; subpath exports get
 * added when the surface grows enough to collide.
 */
export * from './domain/command-safety';
