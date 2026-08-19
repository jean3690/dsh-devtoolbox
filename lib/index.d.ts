import { a as $strip, i as ZodString, n as ZodObject, r as ZodOptional, t as ZodNumber } from "./schemas-CV4fgSOa.js";
import z from "@deepseek-ai/schemastery";
import { ToolDefinition } from "@deepseek-ai/dsh-tools";
import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
import { Context } from "@deepseek-ai/cordis";
import { CommandDefinition } from "@deepseek-ai/dsh-commands";
//#region src/config.d.ts
/** One user-defined tool (a JS expression evaluated as `(args) => result`). */
interface UserToolSpec {
  /** Tool suffix: registered as `toolbox_<name>`. */
  name: string;
  /** Model-visible one-line description. */
  description: string;
  /** Arg declarations (JSON-schema-ish). */
  args: Record<string, {
    type: 'string' | 'number' | 'boolean';
    required?: boolean;
    description?: string;
  }>;
  /** JS expression `(args) => any` (evaluated via `new Function`). */
  run: string;
}
/** Raw loader configuration for the toolbox. */
interface Config {
  /** Built-in tools to expose to the agent; `'*'` = all, [] = none (default). */
  agentTools?: string[];
  /** User-defined tools (also gated by `agentTools`). */
  userTools?: UserToolSpec[];
  /** Whether the browser "save to project" RPC is served (default true). */
  saveEnabled?: boolean;
  /** Directory for saved outputs; relative to the profile root (default `toolbox-saves`). */
  saveDir?: string;
}
/** Fully resolved configuration captured at plugin load. */
interface ResolvedConfig {
  /** Built-in ids to expose; `'*'` means every agent-exposable built-in. */
  agentTools: readonly string[];
  /** User-defined tool specs (validated). */
  userTools: readonly UserToolSpec[];
  /** Whether the save RPC is served. */
  saveEnabled: boolean;
  /** Save directory (absolute, resolved at load). */
  saveDir: string;
}
/** Schemastery schema for loader-validated configuration. */
declare const Config: z<Config>;
/** Resolve raw config into the frozen runtime policy. */
declare function resolveConfig(config: Config | undefined): ResolvedConfig;
//#endregion
//#region src/wire.d.ts
/** Save request: one output file. */
interface SaveRequest {
  /** File name (basename only; sanitized on the host). */
  fileName: string;
  /** Text content to write. */
  content: string;
  /** Optional subdirectory under the save dir (sanitized). */
  subdir?: string;
}
/** Save result. */
interface SaveResult {
  /** Absolute path of the written file. */
  path: string;
  /** Bytes written. */
  bytes: number;
  /** Where the save dir resolves (for display). */
  saveDir: string;
}
/** Strict wire schema for {@link SaveRequest}. */
declare const SAVE_REQUEST_SCHEMA: ZodObject<{
  fileName: ZodString;
  content: ZodString;
  subdir: ZodOptional<ZodString>;
}, $strip>;
/** Strict wire schema for {@link SaveResult}. */
declare const SAVE_RESULT_SCHEMA: ZodObject<{
  path: ZodString;
  bytes: ZodNumber;
  saveDir: ZodString;
}, $strip>;
/**
 * The `toolbox/save` invocation descriptor, shared verbatim by the host
 * `TYPERT` manifest (`src/typert.host.ts`) and the client Remote
 * contribution (`src/client/remote.ts`).
 */
declare const TOOLBOX_SAVE_DESCRIPTOR: Readonly<{
  readonly id: "dsh-devtoolbox#toolbox/save";
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
      typeSymbol: "dsh-devtoolbox/types#SaveRequest";
      schema: ZodObject<{
        fileName: ZodString;
        content: ZodString;
        subdir: ZodOptional<ZodString>;
      }, $strip>;
    }>;
  }>[];
  readonly result: Readonly<{
    mode: "strict";
    typeSymbol: "dsh-devtoolbox/types#SaveResult";
    schema: ZodObject<{
      path: ZodString;
      bytes: ZodNumber;
      saveDir: ZodString;
    }, $strip>;
  }>;
  readonly sourceLocation: Readonly<{
    file: "src/wire.ts";
    line: 1;
    column: 1;
  }>;
}>;
/** The canonical invocation list both Typert faces register. */
declare const TOOLBOX_INVOCATIONS: readonly Readonly<{
  readonly id: "dsh-devtoolbox#toolbox/save";
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
      typeSymbol: "dsh-devtoolbox/types#SaveRequest";
      schema: ZodObject<{
        fileName: ZodString;
        content: ZodString;
        subdir: ZodOptional<ZodString>;
      }, $strip>;
    }>;
  }>[];
  readonly result: Readonly<{
    mode: "strict";
    typeSymbol: "dsh-devtoolbox/types#SaveResult";
    schema: ZodObject<{
      path: ZodString;
      bytes: ZodNumber;
      saveDir: ZodString;
    }, $strip>;
  }>;
  readonly sourceLocation: Readonly<{
    file: "src/wire.ts";
    line: 1;
    column: 1;
  }>;
}>[];
//#endregion
//#region src/service.d.ts
declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Toolbox save service (this package). */
    toolbox: ToolboxService;
  }
}
/** Sanitize a file name: basename only, safe charset, default fallback. */
declare function sanitizeFileName(name: string, fallback?: string): string;
/** Sanitize a subdir path: safe segments joined by the platform separator. */
declare function sanitizeSubdir(subdir: string): string;
/**
 * Toolbox save service, exported over the `toolbox` Remote namespace
 * (`toolbox/save`). Writes into `saveDir` (absolute path resolved at load).
 */
declare class ToolboxService extends TypertRemoteService {
  static inject: readonly [];
  /** Absolute save directory. */
  readonly saveDir: string;
  /**
   * @param ctx - cordis context.
   * @param saveDir - absolute directory outputs are written into.
   */
  constructor(ctx: Context, saveDir: string);
  /**
   * Write one output file. Sanitizes the name/subdir and reports the
   * absolute path back. Never touches configuration files.
   *
   * @param request - file name, content, optional subdirectory.
   * @returns the written file's absolute path, byte count, and save dir.
   */
  save(request: SaveRequest): Promise<SaveResult>;
  /** Resolve the configured save dir against the profile root. */
  static resolveSaveDir(baseUrl: string | undefined, configured: string): string;
}
//#endregion
//#region src/command.d.ts
type CommandLanguage = 'en' | 'zh';
interface CommandMessages {
  header: (count: number) => string;
  category: (name: string) => string;
  toolLine: (id: string, desc: string) => string;
  usage: string;
  unknownTool: (id: string, known: string) => string;
  ran: (id: string) => string;
  agentHeader: (count: number, exposed: string) => string;
  agentStatus: (id: string, on: boolean) => string;
  agentSuggestion: (id: string) => string;
  agentNote: string;
  enabled: string;
  disabled: string;
}
declare const EN_MESSAGES: CommandMessages;
declare const ZH_MESSAGES: CommandMessages;
declare function parseToolboxArgs(rawInput: string): {
  kind: 'list';
} | {
  kind: 'agent';
} | {
  kind: 'agentToggle';
  id: string;
  on: boolean;
} | {
  kind: 'run';
  id: string;
  args: Record<string, string>;
} | {
  kind: 'usage';
};
/** Build the `/toolbox` command definition. */
declare function toolboxCommand(resolved: ResolvedConfig, language?: CommandLanguage): CommandDefinition;
//#endregion
//#region src/i18n.d.ts
/**
 * dsh-devtoolbox shared dictionaries: tool names/descriptions, category names,
 * and UI copy, in zh + en. One source shared by the browser toolbox view,
 * the `/toolbox` command output, and the agent tool descriptions (so the
 * model never sees raw locale keys). Dependency-free — no DOM, no dsh
 * locale service.
 *
 * @module dsh-devtoolbox/i18n
 */
type ToolboxLang = 'zh' | 'en';
//#endregion
//#region src/tools/text.d.ts
/** Count characters, CJK chars, words, lines, sentences, paragraphs. */
declare const text_stats: ToolFn;
/** Remove blank lines and trim trailing whitespace per line. */
declare const text_remove_blank: ToolFn;
/** Deduplicate lines, preserving first occurrence order. */
declare const text_dedup: ToolFn;
/** Upper/lower/title/sentence case conversion. */
declare const case_change: ToolFn;
/** Convert between snake_case / camelCase / PascalCase / kebab-case / CONSTANT_CASE. */
declare const case_convert: ToolFn;
/** Full-width ⇄ half-width conversion (CJK punctuation & ASCII). */
declare const fullwidth: ToolFn;
/** Simplified ⇄ Traditional Chinese conversion (opencc-js, pure JS, local). */
declare const cn_convert: ToolFn;
/** Regex tester: match against text with flags, list matches with positions. */
declare const regex: ToolFn;
/** Line operations: reverse order, sort, reverse characters. */
declare const text_ops: ToolFn;
/** Convert line endings between LF / CRLF / CR. */
declare const line_convert: ToolFn;
/** JS/JSON string escaping and unescaping. */
declare const escape: ToolFn;
/** Sort / dedupe / reverse / count lines. */
declare const sort_lines: ToolFn;
declare const textTools: readonly ToolFn[];
//#endregion
//#region src/tools/encode.d.ts
declare function utf8ToBase64(s: string): string;
declare function base64ToUtf8(b64: string): string;
/** URL-safe base64 encode (JWT alphabet, no padding). */
declare function base64UrlEncode(s: string): string;
/** URL-safe base64 decode → string (or null on malformed input). */
declare function base64UrlDecode(s: string): string | null;
/** Base64 encode/decode (UTF-8 safe, both directions). */
declare const base64: ToolFn;
/** URL encode/decode + query-string parse/format. */
declare const url: ToolFn;
/** HTML entity escape/unescape. */
declare const html_entity: ToolFn;
/** Unicode \uXXXX / \u{...} escape and unescape. */
declare const unicode_escape: ToolFn;
/** Radix conversion with BigInt (2/8/10/16, arbitrarily large). */
declare const radix: ToolFn;
/** Timestamp ⇄ date/time conversion. */
declare const timestamp: ToolFn;
declare const data_url: ToolFn;
/** QR code generation (PNG data URL). */
declare const qrcode: ToolFn;
declare const encodeTools: readonly ToolFn[];
//#endregion
//#region src/tools/data.d.ts
/** JSON format / minify / validate. */
declare const json_format: ToolFn;
/** JSON array-of-objects ⇄ CSV. */
declare const json_csv: ToolFn;
/** Repair mojibake CSV: decode GBK bytes shown as Latin-1, re-encode UTF-8. */
declare const csv_fix: ToolFn;
/** Line-level diff via LCS; unified-ish output with + / - / space prefixes. */
declare const text_diff: ToolFn;
/** Query a JSON document with a minimal JSONPath subset: `$.a.b[0].*`. */
declare function jsonPathGet(root: unknown, path: string): {
  ok: true;
  value: unknown;
} | {
  ok: false;
  error: string;
};
declare const json_path: ToolFn;
/** JSON ↔ YAML conversion. */
declare const json_to_yaml: ToolFn;
declare const dataTools: readonly ToolFn[];
//#endregion
//#region src/tools/security.d.ts
/** MD5 hex digest of a string (UTF-8). */
declare function md5Hex(text: string): string;
/** MD5 hex digest tool (also verifies against known vectors). */
declare const md5: ToolFn;
/** SHA-1/256/512 hex digest tool. */
declare const sha: ToolFn;
/** UUID v4 batch generator. */
declare const uuid: ToolFn;
/** Random password generator with per-set guarantees and strength estimate. */
declare const password: ToolFn;
/** Random number(s) generator. */
declare const random_num: ToolFn;
declare function crc32Hex(text: string): string;
declare const crc32: ToolFn;
declare const crypto_encrypt: ToolFn;
declare const securityTools: readonly ToolFn[];
//#endregion
//#region src/tools/extract.d.ts
/** CN mobile phone numbers with carrier detection. */
declare const phone: ToolFn<Record<string, unknown>>;
/** Email addresses. */
declare const email: ToolFn<Record<string, unknown>>;
/** URLs with http/https/ftp schemes. */
declare const url_extract: ToolFn<Record<string, unknown>>;
/** IPv4 (and optionally IPv6) addresses. */
declare const ip_extract: ToolFn;
declare function parseIdCard(id: string): {
  ok: true;
  id18: string;
  born: string;
  sex: string;
  region: string;
  valid: boolean;
  from15: boolean;
} | {
  ok: false;
  error: string;
};
declare const id_card: ToolFn;
declare const extractTools: readonly ToolFn[];
//#endregion
//#region src/tools/convert.d.ts
/** RMB amount → standard Chinese uppercase (财务大写). */
declare const money: ToolFn;
/** HEX ⇄ RGB ⇄ HSL conversion with a color swatch preview value. */
declare const color: ToolFn;
declare const unit_convert: ToolFn;
declare const time_convert: ToolFn;
declare const convertTools: readonly ToolFn[];
//#endregion
//#region src/tools/reference.d.ts
declare const http_codes: ToolFn;
declare const ports: ToolFn;
declare const mime: ToolFn;
declare const ascii: ToolFn;
declare const picker: ToolFn;
declare const referenceTools: readonly ToolFn[];
//#endregion
//#region src/tools/api.d.ts
/** Parse the `headers` arg: JSON object, `Key: value` lines, or `key=value` lines. */
declare function parseHeaders(raw: string | undefined): Record<string, string>;
declare const http_request: ToolFn;
declare const apiTools: readonly ToolFn[];
//#endregion
//#region src/tools/network.d.ts
/** Tokenize a shell command line, honouring single/double quotes and backslash escapes. */
declare function tokenizeCommand(line: string): string[];
declare const curl_parse: ToolFn;
declare const url_parse: ToolFn;
declare const jwt: ToolFn;
declare const hmac: ToolFn;
declare const networkTools: readonly ToolFn[];
//#endregion
//#region src/tools/index.d.ts
/**
 * dsh-devtoolbox tool registry: the single catalog shared by all three faces —
 * the browser toolbox UI, the `/toolbox` host command, and the config-driven
 * agent tool registration. A tool is a pure function plus metadata; nothing
 * here touches the DOM, the filesystem, or the network, so the same code runs
 * identically in the web GUI and in the host process.
 *
 * @module dsh-devtoolbox/tools
 */
/** Tool argument declaration (JSON-schema-ish, kept minimal). */
interface ToolArgSpec {
  type: 'string' | 'number' | 'boolean';
  required?: boolean;
  description?: string;
  default?: string | number | boolean;
}
/** A pure toolbox function. */
interface ToolFn<A extends Record<string, unknown> = Record<string, unknown>> {
  /** Stable id (also the agent tool suffix and /toolbox run name). */
  id: string;
  /** Human name (browser label; localized). */
  nameKey: string;
  /** One-line description (localized). */
  descKey: string;
  /** Category id. */
  category: CategoryId;
  /** Argument declarations; {} for no-arg tools. */
  args: Record<string, ToolArgSpec>;
  /** Input hint: whether the primary payload is a text blob (affects UI + agent description). */
  textPayload?: boolean;
  /** Pure implementation (may be async, e.g. WebCrypto SHA). */
  run: (args: A) => ToolResult | Promise<ToolResult>;
}
/** Tool output: text, structured JSON, or a table (rendered in the UI). */
type ToolResult = {
  kind: 'text';
  text: string;
} | {
  kind: 'json';
  json: unknown;
} | {
  kind: 'table';
  columns: string[];
  rows: readonly (readonly (string | number)[])[];
  note?: string;
};
/** Category ids. */
type CategoryId = 'text' | 'encode' | 'data' | 'security' | 'extract' | 'convert' | 'reference' | 'life' | 'network';
declare const CATEGORIES: readonly {
  id: CategoryId;
  nameKey: string;
  icon: string;
}[];
/** All built-in tools, grouped. */
declare const TOOLS: readonly ToolFn[];
/** Index for /toolbox run and agent registration. */
declare const TOOL_BY_ID: ReadonlyMap<string, ToolFn>;
/** Tools safe to expose to the agent (deterministic, cheap, pure). */
declare const AGENT_EXPOSABLE_IDS: readonly string[];
/** Human-readable agent description for one tool (built from metadata). */
declare function agentDescription(tool: ToolFn): string;
/** Validate + coerce raw string args into the typed shape a tool expects. */
declare function coerceArgs(tool: ToolFn, raw: Record<string, unknown>): {
  ok: true;
  value: Record<string, unknown>;
} | {
  ok: false;
  error: string;
};
//#endregion
//#region src/present.d.ts
/** Render a ToolResult as plain text (tables become tab-separated). */
declare function renderResultText(result: ToolResult): string;
//#endregion
//#region src/agentTools.d.ts
/** Host-only tools available for agent exposure (file system capabilities). */
declare const HOST_ONLY_IDS: readonly ["file_hash", "file_encode"];
/**
 * Build the agent tool set for the resolved config.
 *
 * @param resolved - resolved plugin config.
 * @param baseUrl - profile root (for file tools' relative paths).
 * @param lang - description language (default zh).
 * @returns the ToolDefinitions to register (may be empty).
 */
declare function buildAgentTools(resolved: ResolvedConfig, baseUrl: string | undefined, lang?: ToolboxLang): ToolDefinition[];
/** All ids the user can expose (built-ins + host-only + user tools). */
declare function exposableIds(resolved: ResolvedConfig): readonly string[];
//#endregion
//#region src/hostTools.d.ts
/** `toolbox_file_hash`: MD5/SHA-1/SHA-256 digest of a file. */
declare function fileHashTool(baseUrl: string | undefined): ToolDefinition;
/** `toolbox_file_encode`: convert a file's encoding (GBK⇄UTF-8). */
declare function fileEncodeTool(baseUrl: string | undefined): ToolDefinition;
//#endregion
//#region src/index.d.ts
declare const name = "dsh-devtoolbox";
/** Hard services: the tool registry. Everything else is optional. */
declare const inject: string[];
/**
 * Mount the toolbox: the save service, the `/toolbox` command (when commands
 * exist), and the config-driven agent tool set (when tools exist).
 *
 * @param ctx - context carrying tools + loader.
 * @param config - raw loader config; defaults applied through {@link resolveConfig}.
 */
declare function apply(ctx: Context, config: Config): Promise<void>;
//#endregion
export { AGENT_EXPOSABLE_IDS, CATEGORIES, CategoryId, Config, EN_MESSAGES, HOST_ONLY_IDS, type SAVE_REQUEST_SCHEMA, type SAVE_RESULT_SCHEMA, type SaveRequest, type SaveResult, type TOOLBOX_INVOCATIONS, type TOOLBOX_SAVE_DESCRIPTOR, TOOLS, TOOL_BY_ID, ToolArgSpec, ToolFn, ToolResult, ToolboxService, ZH_MESSAGES, agentDescription, apiTools, apply, ascii, base64, base64ToUtf8, base64UrlDecode, base64UrlEncode, buildAgentTools, case_change, case_convert, cn_convert, coerceArgs, color, convertTools, crc32, crc32Hex, crypto_encrypt, csv_fix, curl_parse, dataTools, data_url, email, encodeTools, escape, exposableIds, extractTools, fileEncodeTool, fileHashTool, fullwidth, hmac, html_entity, http_codes, http_request, id_card, inject, ip_extract, jsonPathGet, json_csv, json_format, json_path, json_to_yaml, jwt, line_convert, md5, md5Hex, mime, money, name, networkTools, parseHeaders, parseIdCard, parseToolboxArgs, password, phone, picker, ports, qrcode, radix, random_num, referenceTools, regex, renderResultText, resolveConfig, sanitizeFileName, sanitizeSubdir, securityTools, sha, sort_lines, textTools, text_dedup, text_diff, text_ops, text_remove_blank, text_stats, time_convert, timestamp, tokenizeCommand, toolboxCommand, unicode_escape, unit_convert, url, url_extract, url_parse, utf8ToBase64, uuid };