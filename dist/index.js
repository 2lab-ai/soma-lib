"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
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
__exportStar(require("./domain/command-safety"), exports);
__exportStar(require("./domain/cron-expression"), exports);
__exportStar(require("./domain/session-state"), exports);
__exportStar(require("./ports/cron-scheduling"), exports);
__exportStar(require("./adapters/minute-cron-job"), exports);
