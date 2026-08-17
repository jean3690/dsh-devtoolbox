/**
 * dsh-toolbox wire vocabulary: the `toolbox` Remote namespace types, zod v4
 * schemas (the strict codec both Typert faces carry), and the shared
 * invocation descriptors. One canonical source for host and client keeps the
 * two wire codecs from ever drifting apart.
 *
 * The toolbox UI computes tool results locally (the tool library is bundled
 * into the browser half), so the wire carries exactly one host capability:
 * saving an output into the profile's save directory.
 *
 * @module dsh-toolbox/wire
 */

import { z } from 'zod'
import type { InvocationDescriptor } from '@deepseek-ai/dsh-typert-protocol'

/** Save request: one output file. */
export interface SaveRequest {
  /** File name (basename only; sanitized on the host). */
  fileName: string
  /** Text content to write. */
  content: string
  /** Optional subdirectory under the save dir (sanitized). */
  subdir?: string
}

/** Save result. */
export interface SaveResult {
  /** Absolute path of the written file. */
  path: string
  /** Bytes written. */
  bytes: number
  /** Where the save dir resolves (for display). */
  saveDir: string
}

/** Strict wire schema for {@link SaveRequest}. */
export const SAVE_REQUEST_SCHEMA = z.object({
  fileName: z.string().min(1).max(200),
  content: z.string(),
  subdir: z.string().max(120).optional(),
})

/** Strict wire schema for {@link SaveResult}. */
export const SAVE_RESULT_SCHEMA = z.object({
  path: z.string(),
  bytes: z.number().int(),
  saveDir: z.string(),
})

/**
 * The `toolbox/save` invocation descriptor, shared verbatim by the host
 * `TYPERT` manifest (`src/typert.host.ts`) and the client Remote
 * contribution (`src/client/remote.ts`).
 */
export const TOOLBOX_SAVE_DESCRIPTOR = Object.freeze({
  id: 'dsh-toolbox#toolbox/save',
  service: 'toolbox',
  namespace: 'toolbox',
  method: 'save',
  invocation: Object.freeze({ kind: 'direct' }),
  parameters: Object.freeze([
    Object.freeze({
      name: 'request',
      wire: 'request',
      source: 'json',
      codec: Object.freeze({
        mode: 'strict',
        typeSymbol: 'dsh-toolbox/types#SaveRequest',
        schema: SAVE_REQUEST_SCHEMA,
      }),
    } satisfies InvocationDescriptor['parameters'][number]),
  ]),
  result: Object.freeze({
    mode: 'strict',
    typeSymbol: 'dsh-toolbox/types#SaveResult',
    schema: SAVE_RESULT_SCHEMA,
  }),
  sourceLocation: Object.freeze({ file: 'src/wire.ts', line: 1, column: 1 }),
} as const) satisfies InvocationDescriptor

/** The canonical invocation list both Typert faces register. */
export const TOOLBOX_INVOCATIONS = Object.freeze([
  TOOLBOX_SAVE_DESCRIPTOR,
])
