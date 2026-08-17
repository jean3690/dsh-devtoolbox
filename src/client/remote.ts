/**
 * The client-side Remote face of the `toolbox` namespace: the hand-written
 * `TypertRemoteContribution` mounted through `ctx.remote.$mount`, plus the
 * declaration merging that types `ctx.remote.toolbox`. The descriptor list
 * is shared with the host `./typert` manifest (`../wire.ts`).
 *
 * @module dsh-devtoolbox/client/remote
 */

import type { RemoteResult, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { TOOLBOX_INVOCATIONS } from '../wire.ts'
import type { SaveRequest, SaveResult } from '../wire.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TypertRemoteNamespace$toolbox {
    /** Save an output file into the profile's toolbox-saves directory. */
    save: (request: SaveRequest) => Promise<RemoteResult<SaveResult>>
  }
  interface TypertRemoteMap {
    'toolbox/save': (request: SaveRequest) => Promise<RemoteResult<SaveResult>>
  }
  interface TypertRemoteNamespaceMap {
    toolbox: TypertRemoteNamespace$toolbox
  }
}

/** The client Remote contribution for the `toolbox` namespace. */
export const TOOLBOX_REMOTE = Object.freeze({
  package: 'dsh-devtoolbox',
  descriptors: TOOLBOX_INVOCATIONS,
} satisfies TypertRemoteContribution)
