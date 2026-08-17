/**
 * The hand-written Typert HOST manifest for dsh-devtoolbox, exported as
 * `./typert` so the harness's typert-loader registers the `toolbox` save
 * invocation when this plugin mounts. Same shape as a generator output
 * (validated by the loader): package face, empty model and schemas, and the
 * canonical invocation list shared with the client Remote contribution.
 *
 * @module dsh-devtoolbox/typert
 */

import { TOOLBOX_INVOCATIONS } from './wire.ts'

/** Host Typert manifest (validated by `@deepseek-ai/dsh-typert-loader`). */
export const TYPERT = Object.freeze({
  package: 'dsh-devtoolbox',
  face: 'host',
  schemas: Object.freeze([]),
  invocations: TOOLBOX_INVOCATIONS,
  model: Object.freeze({
    services: Object.freeze([]),
    events: Object.freeze([]),
    objects: Object.freeze([]),
  }),
})
