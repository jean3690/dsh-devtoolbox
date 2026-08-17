import { i as ZodString, n as ZodObject, r as ZodOptional, t as ZodNumber } from "./schemas-CV4fgSOa.js";
//#region src/typert.host.d.ts
/**
 * The hand-written Typert HOST manifest for dsh-toolbox, exported as
 * `./typert` so the harness's typert-loader registers the `toolbox` save
 * invocation when this plugin mounts. Same shape as a generator output
 * (validated by the loader): package face, empty model and schemas, and the
 * canonical invocation list shared with the client Remote contribution.
 *
 * @module dsh-toolbox/typert
 */
/** Host Typert manifest (validated by `@deepseek-ai/dsh-typert-loader`). */
declare const TYPERT: Readonly<{
  package: "dsh-toolbox";
  face: "host";
  schemas: readonly never[];
  invocations: readonly Readonly<{
    readonly id: "dsh-toolbox#toolbox/save";
    readonly service: "toolbox";
    readonly namespace: "toolbox";
    readonly method: "save";
    readonly invocation: Readonly<{
      kind: "direct";
    }>;
    readonly parameters: readonly Readonly<{
      name: string;
      wire: string;
      source: "json";
      codec: Readonly<{
        mode: "strict";
        typeSymbol: "dsh-toolbox/types#SaveRequest";
        schema: ZodObject<{
          fileName: ZodString;
          content: ZodString;
          subdir: ZodOptional<ZodString>;
        }, import("zod/v4/core").$strip>;
      }>;
    }>[];
    readonly result: Readonly<{
      mode: "strict";
      typeSymbol: "dsh-toolbox/types#SaveResult";
      schema: ZodObject<{
        path: ZodString;
        bytes: ZodNumber;
        saveDir: ZodString;
      }, import("zod/v4/core").$strip>;
    }>;
    readonly sourceLocation: Readonly<{
      file: "src/wire.ts";
      line: 1;
      column: 1;
    }>;
  }>[];
  model: Readonly<{
    services: readonly never[];
    events: readonly never[];
    objects: readonly never[];
  }>;
}>;
//#endregion
export { TYPERT };