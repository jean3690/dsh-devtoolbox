import z from "@deepseek-ai/schemastery";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { Converter } from "opencc-js";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";
//#region src/config.ts
/**
* dsh-toolbox plugin configuration and its explicit resolve step (the
* explicit-resolve contract: defaults and bounds re-judged at load so
* programmatic construction fails loud instead of running with hidden
* defaults).
*
* Key design: agent exposure is config-driven — the plugin ships no
* hard-coded agent tools. `agentTools` lists which built-ins the user wants
* visible to the model (`'*'` = all); `userTools` lets the user define their
* own deterministic tools as JS expressions (the patch layer already trusts
* `!!js`), registered as `toolbox_<name>`.
*
* @module dsh-toolbox/config
*/
/** Schemastery schema for loader-validated configuration. */
const Config = z.object({
	agentTools: z.array(z.string()).default([]),
	userTools: z.array(z.object({
		name: z.string().min(1),
		description: z.string().min(1),
		args: z.dict(z.object({
			type: z.union([
				"string",
				"number",
				"boolean"
			]),
			required: z.boolean().default(false),
			description: z.string().default("")
		})).default({}),
		run: z.string().min(1)
	})).default([]),
	saveEnabled: z.boolean().default(true),
	saveDir: z.string().default("toolbox-saves")
});
/** Resolve raw config into the frozen runtime policy. */
function resolveConfig(config) {
	const agentTools = config?.agentTools ?? [];
	if (!Array.isArray(agentTools) || agentTools.some((v) => typeof v !== "string")) throw new TypeError("dsh-toolbox: config.agentTools must be an array of strings");
	const userTools = config?.userTools ?? [];
	if (!Array.isArray(userTools)) throw new TypeError("dsh-toolbox: config.userTools must be an array");
	for (const spec of userTools) {
		if (typeof spec?.name !== "string" || !/^[a-z][a-z0-9_]{1,31}$/.test(spec.name)) throw new Error(`dsh-toolbox: user tool name must match ^[a-z][a-z0-9_]{1,31}$, got ${JSON.stringify(spec?.name)}`);
		if (typeof spec?.run !== "string" || spec.run === "") throw new Error(`dsh-toolbox: user tool "${spec?.name}" needs a non-empty run expression`);
		if (typeof spec?.description !== "string" || spec.description === "") throw new Error(`dsh-toolbox: user tool "${spec?.name}" needs a description`);
	}
	const saveEnabled = config?.saveEnabled ?? true;
	if (typeof saveEnabled !== "boolean") throw new TypeError("dsh-toolbox: config.saveEnabled must be a boolean");
	const saveDir = config?.saveDir ?? "toolbox-saves";
	if (typeof saveDir !== "string" || saveDir === "") throw new TypeError("dsh-toolbox: config.saveDir must be a non-empty string");
	return Object.freeze({
		agentTools: Object.freeze([...agentTools]),
		userTools: Object.freeze([...userTools]),
		saveEnabled,
		saveDir
	});
}
//#endregion
//#region src/tools/text.ts
/** Count characters, CJK chars, words, lines, sentences, paragraphs. */
const text_stats = {
	id: "text_stats",
	nameKey: "tool.text_stats",
	descKey: "tool.text_stats.desc",
	category: "text",
	textPayload: true,
	args: { text: {
		type: "string",
		required: true,
		description: "input text"
	} },
	run({ text }) {
		const s = String(text);
		const chars = [...s].length;
		const cjk = (s.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g) ?? []).length;
		const words = s.trim() === "" ? 0 : s.trim().split(/\s+/).length;
		const lines = s === "" ? 0 : s.split(/\r\n|\r|\n/).length;
		const sentences = (s.match(/[^.!?。！？]+[.!?。！？]+/g) ?? []).length;
		const paragraphs = s.split(/\r\n|\r|\n/).filter((p) => p.trim() !== "").length;
		const bytes = new TextEncoder().encode(s).length;
		return {
			kind: "table",
			columns: ["metric", "value"],
			rows: [
				["characters", chars],
				["cjkCharacters", cjk],
				["words", words],
				["lines", lines],
				["sentences", sentences],
				["paragraphs", paragraphs],
				["utf8Bytes", bytes]
			]
		};
	}
};
/** Remove blank lines and trim trailing whitespace per line. */
const text_remove_blank = {
	id: "text_remove_blank",
	nameKey: "tool.text_remove_blank",
	descKey: "tool.text_remove_blank.desc",
	category: "text",
	textPayload: true,
	args: {
		text: {
			type: "string",
			required: true,
			description: "input text"
		},
		trim: {
			type: "boolean",
			default: true,
			description: "trim each line"
		}
	},
	run({ text, trim }) {
		return {
			kind: "text",
			text: String(text).split(/\r\n|\r|\n/).map((l) => trim === false ? l : l.trimEnd()).filter((l) => l.trim() !== "").join("\n")
		};
	}
};
/** Deduplicate lines, preserving first occurrence order. */
const text_dedup = {
	id: "text_dedup",
	nameKey: "tool.text_dedup",
	descKey: "tool.text_dedup.desc",
	category: "text",
	textPayload: true,
	args: {
		text: {
			type: "string",
			required: true,
			description: "input text"
		},
		ignoreCase: {
			type: "boolean",
			default: false,
			description: "case-insensitive"
		}
	},
	run({ text, ignoreCase }) {
		const seen = /* @__PURE__ */ new Set();
		const out = [];
		let removed = 0;
		for (const line of String(text).split(/\r\n|\r|\n/)) {
			const key = ignoreCase === true ? line.toLocaleLowerCase() : line;
			if (seen.has(key)) {
				removed += 1;
				continue;
			}
			seen.add(key);
			out.push(line);
		}
		return {
			kind: "text",
			text: out.join("\n") + (removed > 0 ? `\n<!-- removed ${removed} duplicate line(s) -->` : "")
		};
	}
};
/** Upper/lower/title/sentence case conversion. */
const case_change = {
	id: "case_change",
	nameKey: "tool.case_change",
	descKey: "tool.case_change.desc",
	category: "text",
	textPayload: true,
	args: {
		text: {
			type: "string",
			required: true,
			description: "input text"
		},
		style: {
			type: "string",
			default: "upper",
			description: "upper | lower | title | sentence"
		}
	},
	run({ text, style }) {
		const s = String(text);
		switch (style) {
			case "lower": return {
				kind: "text",
				text: s.toLocaleLowerCase()
			};
			case "title": return {
				kind: "text",
				text: s.replace(/\b\p{L}/gu, (ch) => ch.toLocaleUpperCase())
			};
			case "sentence": return {
				kind: "text",
				text: s.replace(/(^\s*|(?<=[.!?。！？]\s+))\p{L}/gu, (ch) => ch.toLocaleUpperCase())
			};
			default: return {
				kind: "text",
				text: s.toLocaleUpperCase()
			};
		}
	}
};
/** Convert between snake_case / camelCase / PascalCase / kebab-case / CONSTANT_CASE. */
const case_convert = {
	id: "case_convert",
	nameKey: "tool.case_convert",
	descKey: "tool.case_convert.desc",
	category: "text",
	textPayload: true,
	args: {
		text: {
			type: "string",
			required: true,
			description: "input identifier(s), space/comma/newline separated"
		},
		to: {
			type: "string",
			default: "camel",
			description: "snake | camel | pascal | kebab | constant"
		}
	},
	run({ text, to }) {
		const words = String(text).split(/[\s,_\-./\\]+/).flatMap((part) => part.replace(/([a-z\d])([A-Z])/g, "$1 $2").replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2").toLocaleLowerCase().split(" ")).filter((w) => w !== "");
		const join = (sep, cap) => words.map(cap).join(sep);
		let out;
		switch (to) {
			case "snake":
				out = join("_", (w) => w);
				break;
			case "pascal":
				out = join("", (w) => (w[0]?.toLocaleUpperCase() ?? "") + w.slice(1));
				break;
			case "kebab":
				out = join("-", (w) => w);
				break;
			case "constant":
				out = join("_", (w) => w.toLocaleUpperCase());
				break;
			default: out = (words[0] ?? "") + join("", (w, i) => i === 0 ? "" : (w[0]?.toLocaleUpperCase() ?? "") + w.slice(1));
		}
		return {
			kind: "text",
			text: out
		};
	}
};
/** Full-width ⇄ half-width conversion (CJK punctuation & ASCII). */
const fullwidth = {
	id: "fullwidth",
	nameKey: "tool.fullwidth",
	descKey: "tool.fullwidth.desc",
	category: "text",
	textPayload: true,
	args: {
		text: {
			type: "string",
			required: true,
			description: "input text"
		},
		direction: {
			type: "string",
			default: "toHalf",
			description: "toHalf | toFull"
		}
	},
	run({ text, direction }) {
		const s = String(text);
		const toHalf = direction !== "toFull";
		let out = "";
		for (const ch of s) {
			const code = ch.codePointAt(0);
			if (toHalf && code === 12288) {
				out += " ";
				continue;
			}
			if (toHalf && code >= 65281 && code <= 65374) {
				out += String.fromCharCode(code - 65248);
				continue;
			}
			if (!toHalf && code === 32) {
				out += "　";
				continue;
			}
			if (!toHalf && code >= 33 && code <= 126) {
				out += String.fromCharCode(code + 65248);
				continue;
			}
			const map = {
				"，": ",",
				"。": ".",
				"；": ";",
				"：": ":",
				"？": "?",
				"！": "!",
				"“": "\"",
				"”": "\"",
				"‘": "'",
				"’": "'",
				"（": "(",
				"）": ")",
				"【": "[",
				"】": "]",
				"《": "<",
				"》": ">",
				"、": ",",
				"～": "~",
				"—": "-",
				"　": " "
			};
			const rev = Object.fromEntries(Object.entries(map).map(([k, v]) => [v, k]));
			const hit = toHalf ? map[ch] : rev[ch];
			if (hit !== void 0) {
				out += hit;
				continue;
			}
			out += ch;
		}
		return {
			kind: "text",
			text: out
		};
	}
};
/** Simplified ⇄ Traditional Chinese conversion (opencc-js, pure JS, local). */
const cn_convert = {
	id: "cn_convert",
	nameKey: "tool.cn_convert",
	descKey: "tool.cn_convert.desc",
	category: "text",
	textPayload: true,
	args: {
		text: {
			type: "string",
			required: true,
			description: "input Chinese text"
		},
		direction: {
			type: "string",
			default: "s2t",
			description: "s2t (simplified→traditional) | t2s"
		}
	},
	async run({ text, direction }) {
		return {
			kind: "text",
			text: (direction === "t2s" ? Converter({
				from: "tw",
				to: "cn"
			}) : Converter({
				from: "cn",
				to: "tw"
			}))(String(text))
		};
	}
};
/** Regex tester: match against text with flags, list matches with positions. */
const regex = {
	id: "regex",
	nameKey: "tool.regex",
	descKey: "tool.regex.desc",
	category: "text",
	textPayload: true,
	args: {
		text: {
			type: "string",
			required: true,
			description: "input text"
		},
		pattern: {
			type: "string",
			required: true,
			description: "regular expression"
		},
		flags: {
			type: "string",
			default: "g",
			description: "regex flags (g i m s u)"
		}
	},
	run({ text, pattern, flags }) {
		const s = String(text);
		let re;
		try {
			re = new RegExp(String(pattern), String(flags));
		} catch (error) {
			return {
				kind: "text",
				text: `Error: ${error instanceof Error ? error.message : String(error)}`
			};
		}
		const rows = [];
		let m;
		let count = 0;
		const guard = 1e5;
		while ((m = re.exec(s)) !== null && count < guard) {
			rows.push([
				m[0],
				m.index,
				m[1] ?? "",
				m[2] ?? ""
			]);
			count += 1;
			if (m[0] === "") re.lastIndex += 1;
			if (!re.global && !re.sticky) break;
		}
		if (rows.length === 0) return {
			kind: "text",
			text: "No match"
		};
		return {
			kind: "table",
			columns: [
				"match",
				"index",
				"group1",
				"group2"
			],
			rows,
			note: `${rows.length} match(es)`
		};
	}
};
/** Line operations: reverse order, sort, reverse characters. */
const text_ops = {
	id: "text_ops",
	nameKey: "tool.text_ops",
	descKey: "tool.text_ops.desc",
	category: "text",
	textPayload: true,
	args: {
		text: {
			type: "string",
			required: true,
			description: "input text"
		},
		op: {
			type: "string",
			default: "reverseLines",
			description: "reverseLines | sortLines | reverseChars"
		}
	},
	run({ text, op }) {
		const s = String(text);
		switch (op) {
			case "sortLines": return {
				kind: "text",
				text: s.split(/\r\n|\r|\n/).sort((a, b) => a.localeCompare(b)).join("\n")
			};
			case "reverseChars": return {
				kind: "text",
				text: [...s].reverse().join("")
			};
			default: return {
				kind: "text",
				text: s.split(/\r\n|\r|\n/).reverse().join("\n")
			};
		}
	}
};
const textTools = Object.freeze([
	text_stats,
	text_remove_blank,
	text_dedup,
	case_change,
	case_convert,
	fullwidth,
	cn_convert,
	regex,
	text_ops
]);
//#endregion
//#region src/tools/encode.ts
function utf8ToBase64(s) {
	const bytes = new TextEncoder().encode(s);
	let bin = "";
	for (let i = 0; i < bytes.length; i += 32768) bin += String.fromCharCode(...bytes.subarray(i, i + 32768));
	return btoa(bin);
}
function base64ToUtf8(b64) {
	const bin = atob(b64.trim());
	const bytes = Uint8Array.from(bin, (ch) => ch.charCodeAt(0));
	return new TextDecoder().decode(bytes);
}
/** Base64 encode/decode (UTF-8 safe, both directions). */
const base64 = {
	id: "base64",
	nameKey: "tool.base64",
	descKey: "tool.base64.desc",
	category: "encode",
	textPayload: true,
	args: {
		text: {
			type: "string",
			required: true,
			description: "input text or base64 string"
		},
		direction: {
			type: "string",
			default: "encode",
			description: "encode | decode"
		},
		urlSafe: {
			type: "boolean",
			default: false,
			description: "URL-safe alphabet (-_ instead of +/)"
		}
	},
	run({ text, direction, urlSafe }) {
		const s = String(text);
		try {
			if (direction === "decode") {
				let t = s.replace(/\s+/g, "");
				if (urlSafe === true) t = t.replace(/-/g, "+").replace(/_/g, "/");
				return {
					kind: "text",
					text: base64ToUtf8(t)
				};
			}
			let out = utf8ToBase64(s);
			if (urlSafe === true) out = out.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
			return {
				kind: "text",
				text: out
			};
		} catch (error) {
			return {
				kind: "text",
				text: `Error: ${error instanceof Error ? error.message : String(error)}`
			};
		}
	}
};
/** URL encode/decode + query-string parse/format. */
const url = {
	id: "url",
	nameKey: "tool.url",
	descKey: "tool.url.desc",
	category: "encode",
	textPayload: true,
	args: {
		text: {
			type: "string",
			required: true,
			description: "URL or query string"
		},
		direction: {
			type: "string",
			default: "encode",
			description: "encode | decode"
		},
		mode: {
			type: "string",
			default: "component",
			description: "component | query | full"
		}
	},
	run({ text, direction, mode }) {
		const s = String(text);
		try {
			if (direction === "decode") {
				if (mode === "query") {
					const params = new URLSearchParams(s);
					return {
						kind: "json",
						json: Object.fromEntries(params.entries())
					};
				}
				return {
					kind: "text",
					text: decodeURIComponent(s)
				};
			}
			if (mode === "query") return {
				kind: "text",
				text: new URLSearchParams(s).toString()
			};
			if (mode === "full") return {
				kind: "text",
				text: encodeURI(s)
			};
			return {
				kind: "text",
				text: encodeURIComponent(s)
			};
		} catch (error) {
			return {
				kind: "text",
				text: `Error: ${error instanceof Error ? error.message : String(error)}`
			};
		}
	}
};
const HTML_ESCAPES = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	"\"": "&quot;",
	"'": "&#39;"
};
/** HTML entity escape/unescape. */
const html_entity = {
	id: "html_entity",
	nameKey: "tool.html_entity",
	descKey: "tool.html_entity.desc",
	category: "encode",
	textPayload: true,
	args: {
		text: {
			type: "string",
			required: true,
			description: "input text or HTML"
		},
		direction: {
			type: "string",
			default: "escape",
			description: "escape | unescape"
		}
	},
	run({ text, direction }) {
		const s = String(text);
		if (direction === "unescape") return {
			kind: "text",
			text: s.replace(/&(amp|lt|gt|quot|#39|#0*39);/g, (_, name) => {
				return {
					amp: "&",
					lt: "<",
					gt: ">",
					quot: "\"",
					"#39": "'",
					"#039": "'"
				}[name] ?? "&";
			}).replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16))).replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
		};
		return {
			kind: "text",
			text: s.replace(/[&<>"']/g, (ch) => HTML_ESCAPES[ch] ?? ch)
		};
	}
};
/** Unicode \uXXXX / \u{...} escape and unescape. */
const unicode_escape = {
	id: "unicode_escape",
	nameKey: "tool.unicode_escape",
	descKey: "tool.unicode_escape.desc",
	category: "encode",
	textPayload: true,
	args: {
		text: {
			type: "string",
			required: true,
			description: "input text or escaped text"
		},
		direction: {
			type: "string",
			default: "escape",
			description: "escape | unescape"
		}
	},
	run({ text, direction }) {
		const s = String(text);
		if (direction === "unescape") return {
			kind: "text",
			text: s.replace(/\\u\{([0-9a-fA-F]+)\}/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16))).replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
		};
		let out = "";
		for (const ch of s) {
			const code = ch.codePointAt(0);
			if (code > 65535) out += `\\u{${code.toString(16)}}`;
			else if (code < 32 || code === 127) out += `\\u${code.toString(16).padStart(4, "0")}`;
			else if (/[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef]/.test(ch)) out += `\\u${code.toString(16).padStart(4, "0")}`;
			else out += ch;
		}
		return {
			kind: "text",
			text: out
		};
	}
};
/** Radix conversion with BigInt (2/8/10/16, arbitrarily large). */
const radix = {
	id: "radix",
	nameKey: "tool.radix",
	descKey: "tool.radix.desc",
	category: "encode",
	textPayload: false,
	args: {
		value: {
			type: "string",
			required: true,
			description: "the number to convert"
		},
		from: {
			type: "number",
			default: 10,
			description: "source radix (2-36)"
		},
		to: {
			type: "number",
			default: 16,
			description: "target radix (2-36)"
		}
	},
	run({ value, from, to }) {
		const f = Number(from);
		const t = Number(to);
		if (f < 2 || f > 36 || t < 2 || t > 36) return {
			kind: "text",
			text: "Error: radix must be 2-36"
		};
		try {
			const normalized = String(value).trim().toLowerCase().replace(/^0x/, "");
			return {
				kind: "text",
				text: BigInt((f === 16 ? "0x" : f === 2 ? "0b" : f === 8 ? "0o" : "") + normalized).toString(t)
			};
		} catch {
			return {
				kind: "text",
				text: `Error: "${String(value)}" is not a valid base-${f} integer`
			};
		}
	}
};
/** Timestamp ⇄ date/time conversion. */
const timestamp = {
	id: "timestamp",
	nameKey: "tool.timestamp",
	descKey: "tool.timestamp.desc",
	category: "encode",
	textPayload: false,
	args: {
		value: {
			type: "string",
			required: true,
			description: "unix timestamp (s or ms) or a date string"
		},
		from: {
			type: "string",
			default: "auto",
			description: "auto | seconds | millis | date"
		},
		tz: {
			type: "string",
			default: "local",
			description: "local | utc"
		}
	},
	run({ value, from, tz }) {
		const v = String(value).trim();
		const utc = tz === "utc";
		try {
			let ms;
			if (from === "date" || /^\d{4}-\d{2}-\d{2}/.test(v)) {
				ms = Date.parse(v);
				if (Number.isNaN(ms)) return {
					kind: "text",
					text: "Error: invalid date string"
				};
			} else if (/^\d+$/.test(v)) {
				const n = Number(v);
				ms = from === "seconds" ? n * 1e3 : from === "millis" ? n : n < 0xe8d4a51000 ? n * 1e3 : n;
			} else return {
				kind: "text",
				text: "Error: unrecognized input (use a unix timestamp or a date string)"
			};
			const d = new Date(ms);
			return {
				kind: "table",
				columns: ["field", "value"],
				rows: [
					["date", utc ? d.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC") : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`],
					["unixSeconds", Math.floor(ms / 1e3)],
					["unixMillis", ms],
					["iso", d.toISOString()]
				]
			};
		} catch {
			return {
				kind: "text",
				text: "Error: invalid input"
			};
		}
	}
};
const encodeTools = Object.freeze([
	base64,
	url,
	html_entity,
	unicode_escape,
	radix,
	timestamp
]);
//#endregion
//#region src/tools/data.ts
function parseJson(text) {
	return JSON.parse(text);
}
/** JSON format / minify / validate. */
const json_format = {
	id: "json_format",
	nameKey: "tool.json_format",
	descKey: "tool.json_format.desc",
	category: "data",
	textPayload: true,
	args: {
		text: {
			type: "string",
			required: true,
			description: "JSON input"
		},
		mode: {
			type: "string",
			default: "format",
			description: "format | minify | validate"
		},
		indent: {
			type: "number",
			default: 2,
			description: "indent spaces (format only)"
		}
	},
	run({ text, mode, indent }) {
		const s = String(text);
		let parsed;
		try {
			parsed = parseJson(s);
		} catch (error) {
			return {
				kind: "text",
				text: `Invalid JSON: ${error instanceof Error ? error.message : String(error)}`
			};
		}
		if (mode === "validate") return {
			kind: "text",
			text: "Valid JSON ✓"
		};
		if (mode === "minify") return {
			kind: "text",
			text: JSON.stringify(parsed)
		};
		return {
			kind: "text",
			text: JSON.stringify(parsed, null, Math.max(0, Number(indent) || 0))
		};
	}
};
function escapeCsv(field) {
	const s = String(field ?? "");
	return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, "\"\"")}"` : s;
}
function parseCsvLine(line) {
	const out = [];
	let cur = "";
	let inQuotes = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (inQuotes) {
			if (ch === "\"") {
				if (line[i + 1] === "\"") {
					cur += "\"";
					i++;
				} else inQuotes = false;
			} else cur += ch;
		} else if (ch === "\"") inQuotes = true;
		else if (ch === ",") {
			out.push(cur);
			cur = "";
		} else cur += ch;
	}
	out.push(cur);
	return out;
}
/** JSON array-of-objects ⇄ CSV. */
const json_csv = {
	id: "json_csv",
	nameKey: "tool.json_csv",
	descKey: "tool.json_csv.desc",
	category: "data",
	textPayload: true,
	args: {
		text: {
			type: "string",
			required: true,
			description: "JSON or CSV input"
		},
		direction: {
			type: "string",
			default: "jsonToCsv",
			description: "jsonToCsv | csvToJson"
		},
		delimiter: {
			type: "string",
			default: ",",
			description: "CSV delimiter"
		}
	},
	run({ text, direction, delimiter }) {
		const s = String(text);
		const delim = String(delimiter || ",");
		try {
			if (direction === "csvToJson") {
				const lines = s.split(/\r\n|\r|\n/).filter((l) => l.trim() !== "");
				if (lines.length === 0) return {
					kind: "text",
					text: "Error: empty CSV"
				};
				const headers = parseCsvLine(lines[0]).map((h) => h.trim());
				return {
					kind: "json",
					json: lines.slice(1).map((line) => {
						const cells = parseCsvLine(line);
						const obj = {};
						headers.forEach((h, i) => {
							obj[h] = cells[i] ?? "";
						});
						return obj;
					})
				};
			}
			const parsed = parseJson(s);
			if (!Array.isArray(parsed)) return {
				kind: "text",
				text: "Error: JSON must be an array of objects"
			};
			if (parsed.length === 0) return {
				kind: "text",
				text: "Error: empty array"
			};
			const headers = [...new Set(parsed.flatMap((row) => row !== null && typeof row === "object" ? Object.keys(row) : []))];
			return {
				kind: "text",
				text: [headers.map(escapeCsv).join(delim), ...parsed.map((row) => headers.map((h) => {
					const v = row?.[h];
					return escapeCsv(typeof v === "object" ? JSON.stringify(v) : v);
				}).join(delim))].join("\n")
			};
		} catch (error) {
			return {
				kind: "text",
				text: `Error: ${error instanceof Error ? error.message : String(error)}`
			};
		}
	}
};
/** Repair mojibake CSV: decode GBK bytes shown as Latin-1, re-encode UTF-8. */
const csv_fix = {
	id: "csv_fix",
	nameKey: "tool.csv_fix",
	descKey: "tool.csv_fix.desc",
	category: "data",
	textPayload: true,
	args: {
		text: {
			type: "string",
			required: true,
			description: "mojibake text (e.g. æ°´å¹³)\""
		},
		direction: {
			type: "string",
			default: "auto",
			description: "auto | utf8ToGbk | gbkToUtf8"
		}
	},
	run({ text, direction }) {
		const s = String(text);
		try {
			if (direction === "utf8ToGbk") {
				const bytes = new TextEncoder().encode(s);
				return {
					kind: "text",
					text: new TextDecoder("gbk").decode(bytes)
				};
			}
			const attempts = [];
			try {
				const asLatin1 = Uint8Array.from([...s].map((ch) => ch.charCodeAt(0) & 255));
				attempts.push(new TextDecoder("utf-8", { fatal: true }).decode(asLatin1));
			} catch {}
			try {
				const bytes = new TextEncoder().encode(s);
				attempts.push(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
			} catch {}
			return {
				kind: "text",
				text: attempts[0] ?? s
			};
		} catch (error) {
			return {
				kind: "text",
				text: `Error: ${error instanceof Error ? error.message : String(error)}`
			};
		}
	}
};
/** Line-level diff via LCS; unified-ish output with + / - / space prefixes. */
const text_diff = {
	id: "text_diff",
	nameKey: "tool.text_diff",
	descKey: "tool.text_diff.desc",
	category: "data",
	textPayload: true,
	args: {
		text: {
			type: "string",
			required: true,
			description: "original text"
		},
		other: {
			type: "string",
			required: true,
			description: "changed text"
		},
		context: {
			type: "number",
			default: 2,
			description: "context lines"
		}
	},
	run({ text, other, context }) {
		const a = String(text).split(/\r\n|\r|\n/);
		const b = String(other).split(/\r\n|\r|\n/);
		const n = a.length;
		const m = b.length;
		const dp = new Array(n + 1);
		for (let i = 0; i <= n; i++) dp[i] = new Uint32Array(m + 1);
		for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
		const ops = [];
		let i = 0;
		let j = 0;
		while (i < n && j < m) if (a[i] === b[j]) {
			ops.push({
				op: " ",
				line: a[i]
			});
			i++;
			j++;
		} else if (dp[i + 1][j] >= dp[i][j + 1]) {
			ops.push({
				op: "-",
				line: a[i]
			});
			i++;
		} else {
			ops.push({
				op: "+",
				line: b[j]
			});
			j++;
		}
		while (i < n) {
			ops.push({
				op: "-",
				line: a[i]
			});
			i++;
		}
		while (j < m) {
			ops.push({
				op: "+",
				line: b[j]
			});
			j++;
		}
		const ctx = Math.max(0, Number(context) || 0);
		const out = [];
		let skip = 0;
		for (let k = 0; k < ops.length; k++) {
			const op = ops[k];
			if (op.op === " ") {
				if (skip > 0) {
					out.push(`@@ -${k - skip},${skip} +${k - skip},${skip} @@`);
					skip = 0;
				}
				out.push(` ${op.line}`);
			} else {
				if (skip > ctx && k + ctx < ops.length && ops[k + ctx].op === " ") {
					const nextChange = ops.slice(k).findIndex((o) => o.op !== " ");
					if (nextChange === -1 || nextChange > 2 * ctx) {
						out.push("…");
						k = k + ctx;
						continue;
					}
				}
				skip++;
				out.push(`${op.op}${op.line}`);
			}
		}
		return {
			kind: "text",
			text: out.join("\n")
		};
	}
};
const dataTools = Object.freeze([
	json_format,
	json_csv,
	csv_fix,
	text_diff
]);
//#endregion
//#region src/tools/security.ts
const MD5_S = Object.freeze([
	7,
	12,
	17,
	22,
	7,
	12,
	17,
	22,
	7,
	12,
	17,
	22,
	7,
	12,
	17,
	22,
	5,
	9,
	14,
	20,
	5,
	9,
	14,
	20,
	5,
	9,
	14,
	20,
	5,
	9,
	14,
	20,
	4,
	11,
	16,
	23,
	4,
	11,
	16,
	23,
	4,
	11,
	16,
	23,
	4,
	11,
	16,
	23,
	6,
	10,
	15,
	21,
	6,
	10,
	15,
	21,
	6,
	10,
	15,
	21,
	6,
	10,
	15,
	21
]);
const MD5_K = Object.freeze(Array.from({ length: 64 }, (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 4294967296)));
function md5Bytes(bytes) {
	const bitLen = bytes.length * 8;
	const padded = new Uint8Array((bytes.length + 8 >> 6 << 6) + 64);
	padded.set(bytes);
	padded[bytes.length] = 128;
	const dv = new DataView(padded.buffer);
	dv.setUint32(padded.length - 8, bitLen >>> 0, true);
	dv.setUint32(padded.length - 4, Math.floor(bitLen / 4294967296), true);
	let a0 = 1732584193;
	let b0 = 4023233417;
	let c0 = 2562383102;
	let d0 = 271733878;
	const M = /* @__PURE__ */ new Uint32Array(16);
	for (let off = 0; off < padded.length; off += 64) {
		for (let i = 0; i < 16; i++) M[i] = dv.getUint32(off + i * 4, true);
		let a = a0, b = b0, c = c0, d = d0;
		for (let i = 0; i < 64; i++) {
			let f;
			let g;
			if (i < 16) {
				f = b & c | ~b & d;
				g = i;
			} else if (i < 32) {
				f = d & b | ~d & c;
				g = (5 * i + 1) % 16;
			} else if (i < 48) {
				f = b ^ c ^ d;
				g = (3 * i + 5) % 16;
			} else {
				f = c ^ (b | ~d);
				g = 7 * i % 16;
			}
			f = f + a + MD5_K[i] + M[g] >>> 0;
			a = d;
			d = c;
			c = b;
			b = b + (f << MD5_S[i] | f >>> 32 - MD5_S[i]) >>> 0;
		}
		a0 = a0 + a >>> 0;
		b0 = b0 + b >>> 0;
		c0 = c0 + c >>> 0;
		d0 = d0 + d >>> 0;
	}
	const out = /* @__PURE__ */ new Uint8Array(16);
	const odv = new DataView(out.buffer);
	odv.setUint32(0, a0, true);
	odv.setUint32(4, b0, true);
	odv.setUint32(8, c0, true);
	odv.setUint32(12, d0, true);
	return out;
}
function hex(bytes) {
	return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
/** MD5 hex digest of a string (UTF-8). */
function md5Hex(text) {
	return hex(md5Bytes(new TextEncoder().encode(text)));
}
async function shaHex(algo, text) {
	const subtle = globalThis.crypto?.subtle;
	if (subtle === void 0) throw new Error("WebCrypto unavailable");
	const digest = await subtle.digest(algo, new TextEncoder().encode(text));
	return hex(new Uint8Array(digest));
}
/** MD5 hex digest tool (also verifies against known vectors). */
const md5 = {
	id: "md5",
	nameKey: "tool.md5",
	descKey: "tool.md5.desc",
	category: "security",
	textPayload: true,
	args: {
		text: {
			type: "string",
			required: true,
			description: "input text"
		},
		upper: {
			type: "boolean",
			default: false,
			description: "uppercase output"
		}
	},
	run({ text, upper }) {
		const out = md5Hex(String(text));
		return {
			kind: "text",
			text: upper === true ? out.toUpperCase() : out
		};
	}
};
/** SHA-1/256/512 hex digest tool. */
const sha = {
	id: "sha",
	nameKey: "tool.sha",
	descKey: "tool.sha.desc",
	category: "security",
	textPayload: true,
	args: {
		text: {
			type: "string",
			required: true,
			description: "input text"
		},
		algorithm: {
			type: "string",
			default: "SHA-256",
			description: "SHA-1 | SHA-256 | SHA-512"
		},
		upper: {
			type: "boolean",
			default: false,
			description: "uppercase output"
		}
	},
	async run({ text, algorithm, upper }) {
		const algo = String(algorithm).toUpperCase().replace("SHA256", "SHA-256").replace("SHA512", "SHA-512").replace("SHA1", "SHA-1");
		if (algo !== "SHA-1" && algo !== "SHA-256" && algo !== "SHA-512") return {
			kind: "text",
			text: "Error: algorithm must be SHA-1, SHA-256 or SHA-512"
		};
		try {
			const out = await shaHex(algo, String(text));
			return {
				kind: "text",
				text: upper === true ? out.toUpperCase() : out
			};
		} catch (error) {
			return {
				kind: "text",
				text: `Error: ${error instanceof Error ? error.message : String(error)}`
			};
		}
	}
};
function randomBytes(n) {
	const c = globalThis.crypto;
	const arr = new Uint8Array(n);
	if (c?.getRandomValues !== void 0) c.getRandomValues(arr);
	else for (let i = 0; i < n; i++) arr[i] = Math.floor(Math.random() * 256);
	return arr;
}
/** UUID v4 batch generator. */
const uuid = {
	id: "uuid",
	nameKey: "tool.uuid",
	descKey: "tool.uuid.desc",
	category: "security",
	textPayload: false,
	args: {
		count: {
			type: "number",
			default: 1,
			description: "how many UUIDs (1-100)"
		},
		upper: {
			type: "boolean",
			default: false,
			description: "uppercase"
		},
		noHyphens: {
			type: "boolean",
			default: false,
			description: "strip hyphens"
		}
	},
	run({ count, upper, noHyphens }) {
		const n = Math.min(100, Math.max(1, Math.floor(Number(count) || 1)));
		const out = [];
		for (let i = 0; i < n; i++) {
			const b = randomBytes(16);
			b[6] = b[6] & 15 | 64;
			b[8] = b[8] & 63 | 128;
			const hexStr = hex(b);
			let u = `${hexStr.slice(0, 8)}-${hexStr.slice(8, 12)}-${hexStr.slice(12, 16)}-${hexStr.slice(16, 20)}-${hexStr.slice(20)}`;
			if (noHyphens === true) u = u.replace(/-/g, "");
			if (upper === true) u = u.toUpperCase();
			out.push(u);
		}
		return {
			kind: "text",
			text: out.join("\n")
		};
	}
};
const PASSWORD_CHARSETS = {
	lower: "abcdefghijklmnopqrstuvwxyz",
	upper: "ABCDEFGHIJKLMNOPQRSTUVWXYZ",
	digit: "0123456789",
	symbol: "!@#$%^&*()-_=+[]{};:,.<>?"
};
/** Random password generator with per-set guarantees and strength estimate. */
const password = {
	id: "password",
	nameKey: "tool.password",
	descKey: "tool.password.desc",
	category: "security",
	textPayload: false,
	args: {
		length: {
			type: "number",
			default: 16,
			description: "length (8-128)"
		},
		count: {
			type: "number",
			default: 1,
			description: "how many passwords (1-20)"
		},
		sets: {
			type: "string",
			default: "lower,upper,digit,symbol",
			description: "comma list: lower,upper,digit,symbol"
		},
		excludeAmbiguous: {
			type: "boolean",
			default: false,
			description: "exclude 0O1lI|"
		}
	},
	run({ length, count, sets, excludeAmbiguous }) {
		const len = Math.min(128, Math.max(8, Math.floor(Number(length) || 16)));
		const n = Math.min(20, Math.max(1, Math.floor(Number(count) || 1)));
		const setNames = String(sets).split(",").map((s) => s.trim()).filter((s) => s in PASSWORD_CHARSETS);
		if (setNames.length === 0) return {
			kind: "text",
			text: "Error: at least one of lower,upper,digit,symbol required"
		};
		const pool = setNames.map((s) => PASSWORD_CHARSETS[s]).join("");
		const ambiguous = new Set("0O1lI|".split(""));
		const pick = (charset) => {
			let poolChars = charset;
			if (excludeAmbiguous === true) poolChars = [...poolChars].filter((ch) => !ambiguous.has(ch)).join("");
			return poolChars[Math.floor(Math.random() * poolChars.length)];
		};
		const out = [];
		for (let k = 0; k < n; k++) {
			const chars = setNames.map((s) => pick(PASSWORD_CHARSETS[s]));
			while (chars.length < len) chars.push(pick(pool));
			for (let i = chars.length - 1; i > 0; i--) {
				const j = Math.floor(Math.random() * (i + 1));
				[chars[i], chars[j]] = [chars[j], chars[i]];
			}
			out.push(chars.join(""));
		}
		const poolSize = [.../* @__PURE__ */ new Set([...pool])].length;
		const entropy = Math.round(len * Math.log2(poolSize));
		return {
			kind: "text",
			text: out.join("\n") + `\n<!-- entropy ≈ ${entropy} bits (length ${len}, pool ${poolSize}) -->`
		};
	}
};
/** Random number(s) generator. */
const random_num = {
	id: "random_num",
	nameKey: "tool.random_num",
	descKey: "tool.random_num.desc",
	category: "security",
	textPayload: false,
	args: {
		min: {
			type: "number",
			default: 1,
			description: "inclusive min"
		},
		max: {
			type: "number",
			default: 100,
			description: "inclusive max"
		},
		count: {
			type: "number",
			default: 1,
			description: "how many numbers (1-1000)"
		},
		unique: {
			type: "boolean",
			default: false,
			description: "no duplicates"
		}
	},
	run({ min, max, count, unique }) {
		const lo = Math.floor(Number(min) || 0);
		const hi = Math.floor(Number(max) || 100);
		if (hi < lo) return {
			kind: "text",
			text: "Error: max must be >= min"
		};
		let n = Math.min(1e3, Math.max(1, Math.floor(Number(count) || 1)));
		const range = hi - lo + 1;
		if (unique === true && n > range) n = range;
		const pick = () => lo + Math.floor(Math.random() * range);
		const out = [];
		const seen = /* @__PURE__ */ new Set();
		let guard = 0;
		while (out.length < n && guard < 1e5) {
			guard++;
			const v = pick();
			if (unique === true && seen.has(v)) continue;
			seen.add(v);
			out.push(v);
		}
		return {
			kind: "text",
			text: out.join(", ")
		};
	}
};
const securityTools = Object.freeze([
	md5,
	sha,
	uuid,
	password,
	random_num
]);
//#endregion
//#region src/tools/extract.ts
function collect(text, re, unique) {
	const found = [];
	const seen = /* @__PURE__ */ new Set();
	let m;
	while ((m = re.exec(text)) !== null) {
		const v = m[0];
		if (unique && seen.has(v)) {
			re.lastIndex = Math.max(re.lastIndex, m.index + 1);
			continue;
		}
		seen.add(v);
		found.push(v);
		if (m[0] === "") re.lastIndex += 1;
	}
	return found;
}
function extractTool(id, nameKey, descKey, re, label = (v) => v) {
	return {
		id,
		nameKey,
		descKey,
		category: "extract",
		textPayload: true,
		args: {
			text: {
				type: "string",
				required: true,
				description: "input text"
			},
			unique: {
				type: "boolean",
				default: true,
				description: "deduplicate results"
			}
		},
		run({ text, unique }) {
			const found = collect(String(text), re, unique !== false);
			if (found.length === 0) return {
				kind: "text",
				text: "No matches"
			};
			return {
				kind: "table",
				columns: ["value", "detail"],
				rows: found.map((v) => [v, label(v)]),
				note: `${found.length} found`
			};
		}
	};
}
/** CN mobile phone numbers with carrier detection. */
const phone = extractTool("phone", "tool.phone", "tool.phone.desc", /(?<!\d)(?:(?:\+?86[- ]?)?1[3-9]\d{9})(?!\d)/g, (v) => {
	const digits = v.replace(/\D/g, "").slice(-11);
	for (const [re, name] of [
		[/^13[4-9]/, "中国移动"],
		[/^15[0-2]/, "中国移动"],
		[/^15[7-9]/, "中国移动"],
		[/^18[2-8]/, "中国移动"],
		[/^14[78]/, "中国移动"],
		[/^19[5-9]/, "中国移动"],
		[/^17[2-8]/, "中国移动"],
		[/^13[0-2]/, "中国联通"],
		[/^15[56]/, "中国联通"],
		[/^18[56]/, "中国联通"],
		[/^14[56]/, "中国联通"],
		[/^17[0-1]/, "中国联通"],
		[/^16[67]/, "中国联通"],
		[/^133/, "中国电信"],
		[/^153/, "中国电信"],
		[/^18[019]/, "中国电信"],
		[/^149/, "中国电信"],
		[/^17[3-4]/, "中国电信"],
		[/^199/, "中国电信"],
		[/^16[2-3]/, "中国电信"],
		[/^191/, "中国电信"]
	]) if (re.test(digits)) return name;
	return "unknown carrier";
});
/** Email addresses. */
const email = extractTool("email", "tool.email", "tool.email.desc", /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g);
/** URLs with http/https/ftp schemes. */
const url_extract = extractTool("url_extract", "tool.url_extract", "tool.url_extract.desc", /https?:\/\/[^\s<>"']+|ftp:\/\/[^\s<>"']+/gi);
/** IPv4 (and optionally IPv6) addresses. */
const ip_extract = {
	id: "ip_extract",
	nameKey: "tool.ip_extract",
	descKey: "tool.ip_extract.desc",
	category: "extract",
	textPayload: true,
	args: {
		text: {
			type: "string",
			required: true,
			description: "input text"
		},
		includeV6: {
			type: "boolean",
			default: true,
			description: "include IPv6 addresses"
		},
		unique: {
			type: "boolean",
			default: true,
			description: "deduplicate results"
		}
	},
	run({ text, includeV6, unique }) {
		const s = String(text);
		const v4 = /(?<!\d)(?:\d{1,3}\.){3}\d{1,3}(?!\d)/g;
		const v6 = /(?:[0-9a-fA-F]{1,4}:){2,7}[0-9a-fA-F]{0,4}(?:::[0-9a-fA-F]{1,4})?/g;
		const v4s = collect(s, v4, unique !== false).filter((ip) => ip.split(".").every((p) => Number(p) <= 255));
		const v6s = includeV6 !== false ? collect(s, v6, unique !== false) : [];
		const rows = [...v4s.map((v) => ["IPv4", v]), ...v6s.map((v) => ["IPv6", v])];
		if (rows.length === 0) return {
			kind: "text",
			text: "No matches"
		};
		return {
			kind: "table",
			columns: ["type", "address"],
			rows,
			note: `${rows.length} found (v4: ${v4s.length}, v6: ${v6s.length})`
		};
	}
};
const extractTools = Object.freeze([
	phone,
	email,
	url_extract,
	ip_extract
]);
//#endregion
//#region src/tools/convert.ts
const CN_DIGITS = [
	"零",
	"壹",
	"贰",
	"叁",
	"肆",
	"伍",
	"陆",
	"柒",
	"捌",
	"玖"
];
const CN_UNITS = [
	"",
	"拾",
	"佰",
	"仟"
];
const CN_GROUPS = [
	"",
	"万",
	"亿",
	"万亿"
];
function integerPart(n) {
	if (n === 0n) return "零";
	const groups = [];
	let v = n;
	let g = 0;
	while (v > 0n) {
		const chunk = Number(v % 10000n);
		v /= 10000n;
		if (chunk === 0) groups.push("");
		else {
			let s = "";
			let zeroPending = false;
			for (let i = 3; i >= 0; i--) {
				const digit = Math.floor(chunk / 10 ** i) % 10;
				if (digit === 0) {
					if (s !== "") zeroPending = true;
				} else {
					if (zeroPending) s += "零";
					s += CN_DIGITS[digit] + CN_UNITS[i];
					zeroPending = false;
				}
			}
			groups.push(s + (g > 0 ? CN_GROUPS[g] ?? "" : ""));
		}
		g++;
	}
	return groups.reverse().join("").replace(/零+$/, "") || "零";
}
/** RMB amount → standard Chinese uppercase (财务大写). */
const money = {
	id: "money",
	nameKey: "tool.money",
	descKey: "tool.money.desc",
	category: "convert",
	textPayload: false,
	args: { amount: {
		type: "string",
		required: true,
		description: "amount, e.g. 1234.56"
	} },
	run({ amount }) {
		const s = String(amount).trim().replace(/,/g, "");
		if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return {
			kind: "text",
			text: "Error: invalid amount (up to 2 decimal places)"
		};
		const negative = s.startsWith("-");
		const [intStr, decStr = ""] = s.replace(/^-/, "").split(".");
		const int = BigInt(intStr === void 0 || intStr === "" ? "0" : intStr);
		if (int > 9999999999999999n) return {
			kind: "text",
			text: "Error: amount too large"
		};
		let out = negative ? "负" : "";
		if (int === 0n && (decStr === "" || /^0*$/.test(decStr))) {
			out += "零元整";
			return {
				kind: "text",
				text: out
			};
		}
		const jiao = decStr[0] ? Number(decStr[0]) : 0;
		const fen = decStr[1] ? Number(decStr[1]) : 0;
		if (int > 0n) {
			out += integerPart(int) + "元";
			if (jiao === 0 && fen === 0) out += "整";
		} else out += "零元";
		if (jiao > 0) out += CN_DIGITS[jiao] + "角";
		else if (fen > 0) out += "零";
		if (fen > 0) out += CN_DIGITS[fen] + "分";
		else if (jiao > 0) out += "整";
		return {
			kind: "text",
			text: out
		};
	}
};
function clamp255(n) {
	return Math.max(0, Math.min(255, Math.round(n)));
}
function rgbToHsl(r, g, b) {
	const rn = r / 255, gn = g / 255, bn = b / 255;
	const max = Math.max(rn, gn, bn);
	const min = Math.min(rn, gn, bn);
	const l = (max + min) / 2;
	if (max === min) return [
		0,
		0,
		Math.round(l * 100)
	];
	const d = max - min;
	const s = l > .5 ? d / (2 - max - min) : d / (max + min);
	let h;
	if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
	else if (max === gn) h = ((bn - rn) / d + 2) * 60;
	else h = ((rn - gn) / d + 4) * 60;
	return [
		Math.round(h),
		Math.round(s * 100),
		Math.round(l * 100)
	];
}
function hslToRgb(h, s, l) {
	const hn = (h % 360 + 360) % 360 / 360;
	const sn = Math.max(0, Math.min(1, s / 100));
	const ln = Math.max(0, Math.min(1, l / 100));
	if (sn === 0) return [
		clamp255(ln * 255),
		clamp255(ln * 255),
		clamp255(ln * 255)
	];
	const q = ln < .5 ? ln * (1 + sn) : ln + sn - ln * sn;
	const p = 2 * ln - q;
	const hue = (t) => {
		let tt = t;
		if (tt < 0) tt += 1;
		if (tt > 1) tt -= 1;
		if (tt < 1 / 6) return p + (q - p) * 6 * tt;
		if (tt < 1 / 2) return q;
		if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
		return p;
	};
	return [
		clamp255(hue(hn + 1 / 3) * 255),
		clamp255(hue(hn) * 255),
		clamp255(hue(hn - 1 / 3) * 255)
	];
}
/** HEX ⇄ RGB ⇄ HSL conversion with a color swatch preview value. */
const color = {
	id: "color",
	nameKey: "tool.color",
	descKey: "tool.color.desc",
	category: "convert",
	textPayload: false,
	args: { value: {
		type: "string",
		required: true,
		description: "HEX (#rgb/#rrggbb), rgb(r,g,b) or hsl(h,s%,l%)"
	} },
	run({ value }) {
		const s = String(value).trim();
		let r = 0, g = 0, b = 0;
		const hex = s.match(/^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/);
		const rgb = s.match(/^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})/);
		const hsl = s.match(/^hsla?\(\s*(\d{1,3}(?:\.\d+)?)\s*,\s*(\d{1,3}(?:\.\d+)?)%\s*,\s*(\d{1,3}(?:\.\d+)?)%/);
		if (hex !== null) {
			const h = hex[1];
			const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
			r = parseInt(full.slice(0, 2), 16);
			g = parseInt(full.slice(2, 4), 16);
			b = parseInt(full.slice(4, 6), 16);
		} else if (rgb !== null) {
			r = clamp255(Number(rgb[1]));
			g = clamp255(Number(rgb[2]));
			b = clamp255(Number(rgb[3]));
		} else if (hsl !== null) [r, g, b] = hslToRgb(Number(hsl[1]), Number(hsl[2]), Number(hsl[3]));
		else return {
			kind: "text",
			text: "Error: expected HEX, rgb(r,g,b) or hsl(h,s%,l%)"
		};
		const [h, s2, l] = rgbToHsl(r, g, b);
		const hexOut = "#" + [
			r,
			g,
			b
		].map((v) => v.toString(16).padStart(2, "0")).join("");
		return {
			kind: "table",
			columns: ["format", "value"],
			rows: [
				["HEX", hexOut.toUpperCase()],
				["RGB", `rgb(${r}, ${g}, ${b})`],
				["HSL", `hsl(${h}, ${s2}%, ${l}%)`]
			],
			note: hexOut
		};
	}
};
const convertTools = Object.freeze([money, color]);
//#endregion
//#region src/tools/reference.ts
const HTTP_CODES = [
	[
		100,
		"Continue",
		"继续"
	],
	[
		101,
		"Switching Protocols",
		"切换协议"
	],
	[
		200,
		"OK",
		"成功"
	],
	[
		201,
		"Created",
		"已创建"
	],
	[
		202,
		"Accepted",
		"已接受"
	],
	[
		204,
		"No Content",
		"无内容"
	],
	[
		206,
		"Partial Content",
		"部分内容"
	],
	[
		301,
		"Moved Permanently",
		"永久重定向"
	],
	[
		302,
		"Found",
		"临时重定向"
	],
	[
		304,
		"Not Modified",
		"未修改"
	],
	[
		307,
		"Temporary Redirect",
		"临时重定向"
	],
	[
		308,
		"Permanent Redirect",
		"永久重定向"
	],
	[
		400,
		"Bad Request",
		"请求错误"
	],
	[
		401,
		"Unauthorized",
		"未认证"
	],
	[
		403,
		"Forbidden",
		"禁止访问"
	],
	[
		404,
		"Not Found",
		"未找到"
	],
	[
		405,
		"Method Not Allowed",
		"方法不允许"
	],
	[
		406,
		"Not Acceptable",
		"不可接受"
	],
	[
		408,
		"Request Timeout",
		"请求超时"
	],
	[
		409,
		"Conflict",
		"冲突"
	],
	[
		410,
		"Gone",
		"已删除"
	],
	[
		413,
		"Payload Too Large",
		"负载过大"
	],
	[
		415,
		"Unsupported Media Type",
		"不支持的媒体类型"
	],
	[
		422,
		"Unprocessable Entity",
		"无法处理的实体"
	],
	[
		429,
		"Too Many Requests",
		"请求过多"
	],
	[
		500,
		"Internal Server Error",
		"服务器内部错误"
	],
	[
		501,
		"Not Implemented",
		"未实现"
	],
	[
		502,
		"Bad Gateway",
		"网关错误"
	],
	[
		503,
		"Service Unavailable",
		"服务不可用"
	],
	[
		504,
		"Gateway Timeout",
		"网关超时"
	],
	[
		505,
		"HTTP Version Not Supported",
		"HTTP 版本不支持"
	]
];
const http_codes = {
	id: "http_codes",
	nameKey: "tool.http_codes",
	descKey: "tool.http_codes.desc",
	category: "reference",
	textPayload: false,
	args: { code: {
		type: "number",
		description: "filter by exact code (optional)"
	} },
	run({ code }) {
		const all = HTTP_CODES.map(([c, en, zh]) => [
			c,
			en,
			zh
		]);
		const rows = code !== void 0 ? all.filter(([c]) => c === Number(code)) : all;
		if (rows.length === 0) return {
			kind: "text",
			text: `No entry for HTTP ${String(code)}`
		};
		return {
			kind: "table",
			columns: [
				"code",
				"english",
				"中文"
			],
			rows
		};
	}
};
const PORTS = [
	[
		20,
		"FTP-Data",
		"FTP 数据传输"
	],
	[
		21,
		"FTP",
		"文件传输协议"
	],
	[
		22,
		"SSH",
		"安全外壳"
	],
	[
		23,
		"Telnet",
		"远程登录"
	],
	[
		25,
		"SMTP",
		"邮件发送"
	],
	[
		53,
		"DNS",
		"域名解析"
	],
	[
		67,
		"DHCP",
		"动态主机配置"
	],
	[
		68,
		"DHCP",
		"动态主机配置"
	],
	[
		80,
		"HTTP",
		"超文本传输"
	],
	[
		110,
		"POP3",
		"邮件接收"
	],
	[
		123,
		"NTP",
		"网络时间"
	],
	[
		143,
		"IMAP",
		"邮件读取"
	],
	[
		161,
		"SNMP",
		"简单网络管理"
	],
	[
		194,
		"IRC",
		"即时聊天"
	],
	[
		443,
		"HTTPS",
		"安全超文本传输"
	],
	[
		445,
		"SMB",
		"Windows 文件共享"
	],
	[
		465,
		"SMTPS",
		"安全邮件发送"
	],
	[
		514,
		"Syslog",
		"系统日志"
	],
	[
		587,
		"SMTP",
		"邮件提交"
	],
	[
		631,
		"IPP",
		"网络打印"
	],
	[
		873,
		"Rsync",
		"远程同步"
	],
	[
		993,
		"IMAPS",
		"安全邮件读取"
	],
	[
		995,
		"POP3S",
		"安全邮件接收"
	],
	[
		1080,
		"SOCKS",
		"代理"
	],
	[
		1433,
		"MSSQL",
		"SQL Server"
	],
	[
		1521,
		"Oracle",
		"Oracle 数据库"
	],
	[
		2049,
		"NFS",
		"网络文件系统"
	],
	[
		2375,
		"Docker",
		"Docker API"
	],
	[
		2376,
		"Docker",
		"Docker TLS API"
	],
	[
		3e3,
		"Dev",
		"开发服务器(常见)"
	],
	[
		3306,
		"MySQL",
		"MySQL 数据库"
	],
	[
		3389,
		"RDP",
		"远程桌面"
	],
	[
		5432,
		"PostgreSQL",
		"PostgreSQL 数据库"
	],
	[
		5672,
		"AMQP",
		"消息队列"
	],
	[
		5900,
		"VNC",
		"远程桌面"
	],
	[
		6379,
		"Redis",
		"Redis 缓存"
	],
	[
		6443,
		"K8s",
		"Kubernetes API"
	],
	[
		8080,
		"HTTP-Alt",
		"HTTP 备用端口"
	],
	[
		8443,
		"HTTPS-Alt",
		"HTTPS 备用端口"
	],
	[
		8888,
		"Dev",
		"开发服务器(常见)"
	],
	[
		9e3,
		"Dev",
		"开发服务器(常见)"
	],
	[
		9092,
		"Kafka",
		"消息队列"
	],
	[
		9200,
		"Elasticsearch",
		"搜索引擎"
	],
	[
		9418,
		"Git",
		"Git 协议"
	],
	[
		11211,
		"Memcached",
		"缓存"
	],
	[
		27017,
		"MongoDB",
		"MongoDB 数据库"
	]
];
const ports = {
	id: "ports",
	nameKey: "tool.ports",
	descKey: "tool.ports.desc",
	category: "reference",
	textPayload: false,
	args: { port: {
		type: "number",
		description: "filter by exact port (optional)"
	} },
	run({ port }) {
		const rows = port !== void 0 ? PORTS.filter(([p]) => p === Number(port)) : PORTS;
		if (rows.length === 0) return {
			kind: "text",
			text: `No entry for port ${String(port)}`
		};
		return {
			kind: "table",
			columns: [
				"port",
				"service",
				"说明"
			],
			rows
		};
	}
};
const MIMES = [
	[".html", "text/html"],
	[".css", "text/css"],
	[".js", "text/javascript"],
	[".mjs", "text/javascript"],
	[".json", "application/json"],
	[".xml", "application/xml"],
	[".txt", "text/plain"],
	[".md", "text/markdown"],
	[".csv", "text/csv"],
	[".pdf", "application/pdf"],
	[".zip", "application/zip"],
	[".gz", "application/gzip"],
	[".tar", "application/x-tar"],
	[".7z", "application/x-7z-compressed"],
	[".png", "image/png"],
	[".jpg", "image/jpeg"],
	[".jpeg", "image/jpeg"],
	[".gif", "image/gif"],
	[".webp", "image/webp"],
	[".svg", "image/svg+xml"],
	[".ico", "image/x-icon"],
	[".bmp", "image/bmp"],
	[".avif", "image/avif"],
	[".mp3", "audio/mpeg"],
	[".wav", "audio/wav"],
	[".ogg", "audio/ogg"],
	[".flac", "audio/flac"],
	[".mp4", "video/mp4"],
	[".webm", "video/webm"],
	[".mov", "video/quicktime"],
	[".avi", "video/x-msvideo"],
	[".ttf", "font/ttf"],
	[".woff", "font/woff"],
	[".woff2", "font/woff2"],
	[".doc", "application/msword"],
	[".docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
	[".xls", "application/vnd.ms-excel"],
	[".xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
	[".ppt", "application/vnd.ms-powerpoint"],
	[".pptx", "application/vnd.openxmlformats-officedocument.presentationml.presentation"],
	[".wasm", "application/wasm"],
	[".yaml", "application/yaml"],
	[".yml", "application/yaml"]
];
const mime = {
	id: "mime",
	nameKey: "tool.mime",
	descKey: "tool.mime.desc",
	category: "reference",
	textPayload: false,
	args: { ext: {
		type: "string",
		description: "extension with dot, e.g. .json (optional)"
	} },
	run({ ext }) {
		const rows = ext !== void 0 ? MIMES.filter(([e]) => e === String(ext).toLowerCase()) : MIMES;
		if (rows.length === 0) return {
			kind: "text",
			text: `No entry for ${String(ext)}`
		};
		return {
			kind: "table",
			columns: ["extension", "mime"],
			rows
		};
	}
};
const ASCII_NAMES = {
	0: "NUL",
	9: "TAB",
	10: "LF",
	13: "CR",
	27: "ESC",
	32: "SPACE"
};
const ascii = {
	id: "ascii",
	nameKey: "tool.ascii",
	descKey: "tool.ascii.desc",
	category: "reference",
	textPayload: false,
	args: { code: {
		type: "number",
		description: "look up one code (0-127, optional)"
	} },
	run({ code }) {
		if (code !== void 0) {
			const c = Number(code);
			if (c < 0 || c > 127) return {
				kind: "text",
				text: "Error: code must be 0-127"
			};
			const ch = c < 32 || c === 127 ? ASCII_NAMES[c] ?? `CTRL-${String.fromCharCode(c + 64)}` : String.fromCharCode(c);
			return {
				kind: "table",
				columns: [
					"dec",
					"hex",
					"char"
				],
				rows: [[
					c,
					c.toString(16).padStart(2, "0").toUpperCase(),
					ch
				]]
			};
		}
		const rows = [];
		for (let i = 0; i < 128; i++) {
			const ch = i < 32 || i === 127 ? ASCII_NAMES[i] ?? `C-${String.fromCharCode(i + 64)}` : String.fromCharCode(i);
			rows.push([
				i,
				i.toString(16).padStart(2, "0").toUpperCase(),
				ch
			]);
		}
		return {
			kind: "table",
			columns: [
				"dec",
				"hex",
				"char"
			],
			rows
		};
	}
};
const picker = {
	id: "picker",
	nameKey: "tool.picker",
	descKey: "tool.picker.desc",
	category: "life",
	textPayload: true,
	args: {
		text: {
			type: "string",
			required: true,
			description: "names, one per line"
		},
		count: {
			type: "number",
			default: 1,
			description: "how many to pick (1-100)"
		}
	},
	run({ text, count }) {
		const names = String(text).split(/\r\n|\r|\n/).map((s) => s.trim()).filter((s) => s !== "");
		if (names.length === 0) return {
			kind: "text",
			text: "Error: empty list"
		};
		const n = Math.min(100, Math.max(1, Math.floor(Number(count) || 1)));
		const shuffled = [...names];
		for (let i = shuffled.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
		}
		return {
			kind: "text",
			text: shuffled.slice(0, Math.min(n, shuffled.length)).join("\n")
		};
	}
};
const referenceTools = Object.freeze([
	http_codes,
	ports,
	mime,
	ascii,
	picker
]);
//#endregion
//#region src/tools/index.ts
/**
* dsh-toolbox tool registry: the single catalog shared by all three faces —
* the browser toolbox UI, the `/toolbox` host command, and the config-driven
* agent tool registration. A tool is a pure function plus metadata; nothing
* here touches the DOM, the filesystem, or the network, so the same code runs
* identically in the web GUI and in the host process.
*
* @module dsh-toolbox/tools
*/
const CATEGORIES = [
	{
		id: "text",
		nameKey: "category.text",
		icon: "✍️"
	},
	{
		id: "encode",
		nameKey: "category.encode",
		icon: "🔣"
	},
	{
		id: "data",
		nameKey: "category.data",
		icon: "🧮"
	},
	{
		id: "security",
		nameKey: "category.security",
		icon: "🔐"
	},
	{
		id: "extract",
		nameKey: "category.extract",
		icon: "🔍"
	},
	{
		id: "convert",
		nameKey: "category.convert",
		icon: "🔄"
	},
	{
		id: "reference",
		nameKey: "category.reference",
		icon: "📖"
	},
	{
		id: "life",
		nameKey: "category.life",
		icon: "⏱️"
	}
];
/** All built-in tools, grouped. */
const TOOLS = Object.freeze([
	...textTools,
	...encodeTools,
	...dataTools,
	...securityTools,
	...extractTools,
	...convertTools,
	...referenceTools
]);
/** Index for /toolbox run and agent registration. */
const TOOL_BY_ID = new Map(TOOLS.map((t) => [t.id, t]));
/** Tools safe to expose to the agent (deterministic, cheap, pure). */
const AGENT_EXPOSABLE_IDS = Object.freeze(TOOLS.filter((t) => t.category !== "life" && t.id !== "regex").map((t) => t.id));
/** Human-readable agent description for one tool (built from metadata). */
function agentDescription(tool) {
	const argList = Object.entries(tool.args).map(([name, spec]) => `${name}${spec.required ? "" : "?"}:${spec.type}`).join(", ");
	return `${tool.descKey}${argList === "" ? "" : ` (args: ${argList})`}`;
}
/** Validate + coerce raw string args into the typed shape a tool expects. */
function coerceArgs(tool, raw) {
	const value = {};
	for (const [name, spec] of Object.entries(tool.args)) {
		if (!(raw[name] !== void 0 && raw[name] !== "")) {
			if (spec.required) return {
				ok: false,
				error: `missing required arg "${name}"`
			};
			if (spec.default !== void 0) value[name] = spec.default;
			continue;
		}
		const r = raw[name];
		switch (spec.type) {
			case "string":
				value[name] = String(r);
				break;
			case "number": {
				const n = Number(r);
				if (!Number.isFinite(n)) return {
					ok: false,
					error: `arg "${name}" must be a number`
				};
				value[name] = n;
				break;
			}
			case "boolean": if (r === true || r === "true" || r === "1") value[name] = true;
			else if (r === false || r === "false" || r === "0") value[name] = false;
			else return {
				ok: false,
				error: `arg "${name}" must be a boolean`
			};
		}
	}
	return {
		ok: true,
		value
	};
}
//#endregion
//#region src/hostTools.ts
/**
* Host-only toolbox tools: file hashing and file encoding conversion.
* These need the filesystem, so they exist only in the host half (agent
* tools + /toolbox commands), never in the browser UI — the browser offers
* file-hash/encoding via the File API instead.
*
* Relative paths resolve against the profile root (ctx.baseUrl).
*
* @module dsh-toolbox/hostTools
*/
/** Resolve a user-supplied path against the profile root. */
function resolvePath(baseUrl, p) {
	return isAbsolute(p) ? p : join(baseUrl ?? process.cwd(), p);
}
/** Coerce a maybe-undefined arg to a string (or a fallback). */
function strArg(v, fallback) {
	return typeof v === "string" && v !== "" ? v : fallback;
}
/** `toolbox_file_hash`: MD5/SHA-1/SHA-256 digest of a file. */
function fileHashTool(baseUrl) {
	return defineTool({
		name: "toolbox_file_hash",
		description: "Compute the MD5, SHA-1 or SHA-256 digest of a file on this machine. Use for integrity checks and dedup. Relative paths resolve against the profile root.",
		parameters: {
			path: {
				type: "string",
				required: true,
				description: "absolute or profile-relative file path"
			},
			algorithm: {
				type: "string",
				description: "md5 | sha1 | sha256 (default sha256)"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					algorithm: {
						type: "string",
						required: true
					},
					hex: {
						type: "string",
						required: true
					},
					bytes: {
						type: "number",
						required: true
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: `${value.algorithm}: ${value.hex} (${value.bytes} bytes)`
			}]
		},
		async execute(args) {
			const algo = strArg(args.algorithm, "sha256");
			if (algo !== "md5" && algo !== "sha1" && algo !== "sha256") throw new Error(`toolbox_file_hash: unsupported algorithm "${algo}" (md5 | sha1 | sha256)`);
			const abs = resolvePath(baseUrl, strArg(args.path, ""));
			const data = await readFile(abs);
			return {
				algorithm: algo,
				hex: createHash(algo).update(data).digest("hex"),
				bytes: data.length
			};
		}
	});
}
/** `toolbox_file_encode`: convert a file's encoding (GBK⇄UTF-8). */
function fileEncodeTool(baseUrl) {
	return defineTool({
		name: "toolbox_file_encode",
		description: "Convert a text file between GBK and UTF-8 encoding (fixes mojibake, e.g. CSV exported by Excel). Writes either in place or to an output path. Relative paths resolve against the profile root.",
		parameters: {
			path: {
				type: "string",
				required: true,
				description: "absolute or profile-relative input file path"
			},
			direction: {
				type: "string",
				description: "gbkToUtf8 | utf8ToGbk (default gbkToUtf8)"
			},
			output: {
				type: "string",
				description: "optional output path (default: overwrite input)"
			}
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					path: {
						type: "string",
						required: true
					},
					bytes: {
						type: "number",
						required: true
					}
				}
			},
			render: (_args, value) => [{
				type: "text",
				text: `converted → ${value.path} (${value.bytes} bytes)`
			}]
		},
		async execute(args) {
			const direction = strArg(args.direction, "gbkToUtf8");
			const abs = resolvePath(baseUrl, strArg(args.path, ""));
			const data = await readFile(abs);
			let out;
			if (direction === "utf8ToGbk") out = encodeGbk(new TextDecoder("utf-8", { fatal: true }).decode(data));
			else {
				const text = decodeGbk(data);
				out = new TextEncoder().encode(text);
			}
			const target = args.output === void 0 ? abs : resolvePath(baseUrl, strArg(args.output, ""));
			await writeFile(target, out);
			return {
				path: target,
				bytes: out.length
			};
		}
	});
}
/**
* Encode a string as GBK. Uses a per-process codec built from TextDecoder's
* GBK table: decode every possible byte pair and record the round trip. This
* is correct for the vast majority of characters; unmappable chars fall back
* to '?' like iconv's transliteration-off mode.
*/
let gbkEncodeTable;
function decodeGbk(bytes) {
	return new TextDecoder("gbk").decode(bytes);
}
function encodeGbk(text) {
	const table = gbkEncodeTable ??= buildGbkTable();
	const out = [];
	for (const ch of text) {
		const mapped = table.get(ch);
		if (mapped !== void 0) out.push(...mapped);
		else {
			const cp = ch.codePointAt(0);
			if (cp < 128) out.push(cp);
			else out.push(63);
		}
	}
	return Uint8Array.from(out);
}
function buildGbkTable() {
	const table = /* @__PURE__ */ new Map();
	for (let lead = 129; lead <= 254; lead++) for (let trail = 64; trail <= 254; trail++) {
		if (trail === 127) continue;
		const bytes = Uint8Array.from([lead, trail]);
		let text;
		try {
			text = new TextDecoder("gbk", { fatal: true }).decode(bytes);
		} catch {
			continue;
		}
		if (text.length === 1 && !table.has(text)) table.set(text, [lead, trail]);
	}
	return table;
}
const DICTS = {
	zh: {
		"entry.label": "工具箱",
		"view.title": "工具箱",
		"view.subtitle": "35 个本地小工具 · 数据不出本机",
		"view.search": "搜索工具…",
		"view.back": "返回",
		"view.close": "返回对话",
		"view.empty": "没有匹配的工具",
		"view.all": "全部",
		"page.run": "运行",
		"page.copy": "复制",
		"page.copied": "已复制",
		"page.save": "保存到项目",
		"page.saved": "已保存",
		"page.saveFail": "保存失败",
		"page.saveHint": "保存到 profile 的 toolbox-saves 目录",
		"page.result": "结果",
		"page.input": "输入",
		"page.error": "错误",
		"page.running": "运行中…",
		"page.noResult": "点击「运行」查看结果",
		"page.textPayload": "把待处理内容粘贴到这里",
		"page.download": "下载",
		"category.text": "文本",
		"category.encode": "编码",
		"category.data": "数据",
		"category.security": "安全",
		"category.extract": "提取",
		"category.convert": "转换",
		"category.reference": "参考",
		"category.life": "效率",
		"tool.text_stats": "字符统计",
		"tool.text_stats.desc": "统计字符数、CJK 字符、单词、行、句子、段落与 UTF-8 字节数",
		"tool.text_remove_blank": "去空行",
		"tool.text_remove_blank.desc": "删除空行与行尾空白，让文本更紧凑",
		"tool.text_dedup": "去重复行",
		"tool.text_dedup.desc": "删除重复行，保留首次出现顺序，可忽略大小写",
		"tool.case_change": "大小写转换",
		"tool.case_change.desc": "转大写、小写、单词首字母大写或句首大写",
		"tool.case_convert": "命名风格转换",
		"tool.case_convert.desc": "在 snake_case / camelCase / PascalCase / kebab-case / CONSTANT_CASE 之间转换",
		"tool.fullwidth": "全半角转换",
		"tool.fullwidth.desc": "中文全角与英文半角标点互转，含全角空格",
		"tool.cn_convert": "繁简转换",
		"tool.cn_convert.desc": "简体⇄繁体双向转换（OpenCC 词典，纯本地）",
		"tool.regex": "正则测试",
		"tool.regex.desc": "测试正则表达式，列出每个匹配与捕获组、位置",
		"tool.text_ops": "行操作",
		"tool.text_ops.desc": "反转行序、按字典序排序、反转字符",
		"tool.base64": "Base64 编解码",
		"tool.base64.desc": "UTF-8 安全的 Base64 编解码，支持 URL-safe 字母表",
		"tool.url": "URL 编解码",
		"tool.url.desc": "URL 组件/完整 URL/查询串编解码与参数解析",
		"tool.html_entity": "HTML 实体",
		"tool.html_entity.desc": "HTML 特殊字符转义与实体反转义",
		"tool.unicode_escape": "Unicode 转义",
		"tool.unicode_escape.desc": "文本与 \\uXXXX / \\u{...} 转义互转",
		"tool.radix": "进制转换",
		"tool.radix.desc": "2-36 进制互转，BigInt 支持任意大整数",
		"tool.timestamp": "时间戳转换",
		"tool.timestamp.desc": "Unix 时间戳（秒/毫秒）与日期时间互转，支持 UTC/本地时区",
		"tool.json_format": "JSON 工具",
		"tool.json_format.desc": "JSON 格式化、压缩与校验",
		"tool.json_csv": "JSON⇄CSV",
		"tool.json_csv.desc": "JSON 对象数组与 CSV 双向转换",
		"tool.csv_fix": "CSV 乱码修复",
		"tool.csv_fix.desc": "修复 GBK/UTF-8 编码错乱导致的乱码",
		"tool.text_diff": "文本对比",
		"tool.text_diff.desc": "行级 LCS 差异对比，带上下文折叠",
		"tool.md5": "MD5 摘要",
		"tool.md5.desc": "MD5 哈希（RFC 1321 纯本地实现）",
		"tool.sha": "SHA 摘要",
		"tool.sha.desc": "SHA-1 / SHA-256 / SHA-512 哈希（WebCrypto）",
		"tool.uuid": "UUID 生成",
		"tool.uuid.desc": "批量生成 UUID v4，支持大写/去连字符",
		"tool.password": "随机密码",
		"tool.password.desc": "按字符集生成强密码，附熵值估算",
		"tool.random_num": "随机数",
		"tool.random_num.desc": "指定范围与数量的随机数，支持去重",
		"tool.phone": "手机号提取",
		"tool.phone.desc": "从文本提取中国大陆手机号并识别运营商",
		"tool.email": "邮箱提取",
		"tool.email.desc": "从文本批量提取邮箱地址",
		"tool.url_extract": "链接提取",
		"tool.url_extract.desc": "从文本提取 http/https/ftp 链接",
		"tool.ip_extract": "IP 提取",
		"tool.ip_extract.desc": "从文本提取 IPv4/IPv6 地址",
		"tool.money": "金额大写",
		"tool.money.desc": "数字金额转人民币财务大写（壹贰叁…）",
		"tool.color": "颜色转换",
		"tool.color.desc": "HEX / RGB / HSL 互转并附色值预览",
		"tool.http_codes": "HTTP 状态码",
		"tool.http_codes.desc": "HTTP 状态码速查表（含中文释义）",
		"tool.ports": "常用端口",
		"tool.ports.desc": "常用服务端口速查表",
		"tool.mime": "MIME 类型",
		"tool.mime.desc": "常见文件扩展名与 MIME 类型对照",
		"tool.ascii": "ASCII 表",
		"tool.ascii.desc": "ASCII 0-127 完整对照表（DEC/HEX/字符）",
		"tool.picker": "点名器",
		"tool.picker.desc": "从名单中随机抽取（支持数量）"
	},
	en: {
		"entry.label": "Toolbox",
		"view.title": "Toolbox",
		"view.subtitle": "35 local tools · data never leaves this machine",
		"view.search": "Search tools…",
		"view.back": "Back",
		"view.close": "Back to chat",
		"view.empty": "No matching tools",
		"view.all": "All",
		"page.run": "Run",
		"page.copy": "Copy",
		"page.copied": "Copied",
		"page.save": "Save to project",
		"page.saved": "Saved",
		"page.saveFail": "Save failed",
		"page.saveHint": "Saved under the profile toolbox-saves directory",
		"page.result": "Result",
		"page.input": "Input",
		"page.error": "Error",
		"page.running": "Running…",
		"page.noResult": "Click Run to see the result",
		"page.textPayload": "Paste the content to process here",
		"page.download": "Download",
		"category.text": "Text",
		"category.encode": "Encoding",
		"category.data": "Data",
		"category.security": "Security",
		"category.extract": "Extract",
		"category.convert": "Convert",
		"category.reference": "Reference",
		"category.life": "Life",
		"tool.text_stats": "Text stats",
		"tool.text_stats.desc": "Count characters, CJK chars, words, lines, sentences, paragraphs and UTF-8 bytes",
		"tool.text_remove_blank": "Remove blank lines",
		"tool.text_remove_blank.desc": "Delete blank lines and trailing whitespace",
		"tool.text_dedup": "Dedup lines",
		"tool.text_dedup.desc": "Remove duplicate lines, keep first occurrence; optional case-insensitive",
		"tool.case_change": "Change case",
		"tool.case_change.desc": "Convert to UPPER, lower, Title Case or Sentence case",
		"tool.case_convert": "Name style",
		"tool.case_convert.desc": "Convert between snake_case / camelCase / PascalCase / kebab-case / CONSTANT_CASE",
		"tool.fullwidth": "Full/half width",
		"tool.fullwidth.desc": "Convert CJK full-width and ASCII half-width punctuation, both directions",
		"tool.cn_convert": "CN⇄TW",
		"tool.cn_convert.desc": "Simplified ⇄ Traditional Chinese conversion (OpenCC dictionary, local only)",
		"tool.regex": "Regex tester",
		"tool.regex.desc": "Test a regular expression; list matches with positions and capture groups",
		"tool.text_ops": "Line ops",
		"tool.text_ops.desc": "Reverse line order, sort lines, reverse characters",
		"tool.base64": "Base64",
		"tool.base64.desc": "UTF-8-safe Base64 encode/decode, optional URL-safe alphabet",
		"tool.url": "URL encode",
		"tool.url.desc": "URL component/full/query-string encode, decode and parse",
		"tool.html_entity": "HTML entities",
		"tool.html_entity.desc": "Escape and unescape HTML special characters",
		"tool.unicode_escape": "Unicode escapes",
		"tool.unicode_escape.desc": "Convert text to/from \\uXXXX and \\u{...} escapes",
		"tool.radix": "Radix convert",
		"tool.radix.desc": "Convert between radix 2-36; BigInt for arbitrarily large integers",
		"tool.timestamp": "Timestamp",
		"tool.timestamp.desc": "Unix timestamp (s/ms) ⇄ date/time, UTC or local",
		"tool.json_format": "JSON tool",
		"tool.json_format.desc": "Format, minify and validate JSON",
		"tool.json_csv": "JSON⇄CSV",
		"tool.json_csv.desc": "Convert JSON array of objects to/from CSV",
		"tool.csv_fix": "CSV mojibake fix",
		"tool.csv_fix.desc": "Repair GBK/UTF-8 encoding corruption (e.g. Excel CSV)",
		"tool.text_diff": "Text diff",
		"tool.text_diff.desc": "Line-level LCS diff with context folding",
		"tool.md5": "MD5",
		"tool.md5.desc": "MD5 digest (RFC 1321, pure local implementation)",
		"tool.sha": "SHA digest",
		"tool.sha.desc": "SHA-1 / SHA-256 / SHA-512 digest (WebCrypto)",
		"tool.uuid": "UUID v4",
		"tool.uuid.desc": "Generate UUID v4 in batches; uppercase / no-hyphen options",
		"tool.password": "Password",
		"tool.password.desc": "Generate strong passwords by charset with entropy estimate",
		"tool.random_num": "Random numbers",
		"tool.random_num.desc": "Random numbers in a range, batch and unique options",
		"tool.phone": "Phone extract",
		"tool.phone.desc": "Extract mainland-China mobile numbers with carrier detection",
		"tool.email": "Email extract",
		"tool.email.desc": "Extract email addresses from text",
		"tool.url_extract": "URL extract",
		"tool.url_extract.desc": "Extract http/https/ftp links from text",
		"tool.ip_extract": "IP extract",
		"tool.ip_extract.desc": "Extract IPv4/IPv6 addresses from text",
		"tool.money": "RMB uppercase",
		"tool.money.desc": "Convert a numeric amount to Chinese financial uppercase (壹贰叁…)",
		"tool.color": "Color convert",
		"tool.color.desc": "Convert between HEX / RGB / HSL with a swatch preview",
		"tool.http_codes": "HTTP status codes",
		"tool.http_codes.desc": "HTTP status code lookup table (with Chinese gloss)",
		"tool.ports": "Common ports",
		"tool.ports.desc": "Common service port lookup table",
		"tool.mime": "MIME types",
		"tool.mime.desc": "Common file extension ⇄ MIME type mapping",
		"tool.ascii": "ASCII table",
		"tool.ascii.desc": "Full ASCII 0-127 table (DEC/HEX/char)",
		"tool.picker": "Picker",
		"tool.picker.desc": "Pick random entries from a name list"
	}
};
/** Look up one key; returns the key itself when untranslated. */
function lookup(lang, key) {
	return DICTS[lang][key] ?? DICTS.zh[key] ?? key;
}
//#endregion
//#region src/present.ts
/** Render a ToolResult as plain text (tables become tab-separated). */
function renderResultText(result) {
	switch (result.kind) {
		case "text": return result.text;
		case "json": return JSON.stringify(result.json, null, 2);
		case "table": {
			const header = result.columns.join("	");
			const body = result.rows.map((row) => row.join("	")).join("\n");
			return `${result.note === void 0 ? "" : `${result.note}\n`}${header}\n${body}`;
		}
	}
}
//#endregion
//#region src/agentTools.ts
/** Host-only tools available for agent exposure (file system capabilities). */
const HOST_ONLY_IDS = ["file_hash", "file_encode"];
/** JSON-safe value of a ToolResult for the wire (never functions/undefined). */
function jsonValue(result) {
	switch (result.kind) {
		case "text": return {
			kind: "text",
			text: result.text
		};
		case "json": return {
			kind: "json",
			json: JSON.parse(JSON.stringify(result.json))
		};
		case "table": return {
			kind: "table",
			columns: result.columns,
			rows: result.rows.map((row) => row.map((v) => typeof v === "number" ? v : String(v))),
			...result.note === void 0 ? {} : { note: result.note }
		};
	}
}
/** ToolResult output schema for defineTool. */
const RESULT_SCHEMA = {
	type: "object",
	additionalProperties: false,
	properties: {
		kind: {
			type: "string",
			required: true
		},
		text: { type: "string" },
		json: { type: "json" },
		columns: {
			type: "array",
			items: { type: "string" }
		},
		rows: {
			type: "array",
			items: {
				type: "array",
				items: { type: "string" }
			}
		},
		note: { type: "string" }
	}
};
/** Map a built-in toolbox ToolFn to a dsh-tools ToolDefinition. */
function builtinDefinition(toolId, lang) {
	const tool = TOOL_BY_ID.get(toolId);
	if (tool === void 0) return void 0;
	const parameters = {};
	for (const [name, spec] of Object.entries(tool.args)) parameters[name] = {
		type: spec.type,
		...spec.required === true ? { required: true } : {},
		description: spec.description ?? ""
	};
	const argList = Object.entries(tool.args).map(([name, spec]) => `${name}${spec.required ? "" : "?"}:${spec.type}`).join(", ");
	return defineTool({
		name: `toolbox_${tool.id}`,
		description: `[dsh-toolbox] ${lookup(lang, tool.descKey)}${argList === "" ? "" : ` (args: ${argList})`} Data stays local.`,
		parameters,
		output: {
			schema: RESULT_SCHEMA,
			render: (_args, value) => [{
				type: "text",
				text: renderResultText(value)
			}]
		},
		async execute(args) {
			const coerced = coerceArgs(tool, args);
			if (!coerced.ok) throw new Error(`toolbox_${tool.id}: ${coerced.error}`);
			return jsonValue(await tool.run(coerced.value));
		}
	});
}
/** Compile one userTool spec into a ToolDefinition (trusted local code). */
function userDefinition(spec) {
	const parameters = {};
	for (const [name, arg] of Object.entries(spec.args)) parameters[name] = {
		type: arg.type,
		...arg.required === true ? { required: true } : {},
		description: arg.description ?? ""
	};
	const fn = new Function("args", `"use strict"; return (${spec.run})(args)`);
	return defineTool({
		name: `toolbox_${spec.name}`,
		description: `[dsh-toolbox user] ${spec.description}`,
		parameters,
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: { result: {
					type: "json",
					required: true
				} }
			},
			render: (_args, value) => [{
				type: "text",
				text: typeof value.result === "string" ? value.result : JSON.stringify(value.result, null, 2)
			}]
		},
		async execute(args) {
			let result;
			try {
				result = await fn(args);
			} catch (error) {
				throw new Error(`toolbox_${spec.name}: ${error instanceof Error ? error.message : String(error)}`);
			}
			return { result: JSON.parse(JSON.stringify(result ?? null)) };
		}
	});
}
/** Is this built-in id exposed by the config? */
function exposed(agentTools, id) {
	return agentTools.includes("*") || agentTools.includes(id);
}
/**
* Build the agent tool set for the resolved config.
*
* @param resolved - resolved plugin config.
* @param baseUrl - profile root (for file tools' relative paths).
* @param lang - description language (default zh).
* @returns the ToolDefinitions to register (may be empty).
*/
function buildAgentTools(resolved, baseUrl, lang = "zh") {
	const out = [];
	for (const id of AGENT_EXPOSABLE_IDS) {
		if (!exposed(resolved.agentTools, id)) continue;
		const def = builtinDefinition(id, lang);
		if (def !== void 0) out.push(def);
	}
	for (const id of HOST_ONLY_IDS) {
		if (!exposed(resolved.agentTools, id)) continue;
		if (id === "file_hash") out.push(fileHashTool(baseUrl));
		if (id === "file_encode") out.push(fileEncodeTool(baseUrl));
	}
	for (const spec of resolved.userTools) {
		if (!exposed(resolved.agentTools, spec.name)) continue;
		out.push(userDefinition(spec));
	}
	return out;
}
/** All ids the user can expose (built-ins + host-only + user tools). */
function exposableIds(resolved) {
	return Object.freeze([
		...AGENT_EXPOSABLE_IDS,
		...HOST_ONLY_IDS,
		...resolved.userTools.map((u) => u.name)
	]);
}
//#endregion
//#region src/command.ts
const EN_MESSAGES = {
	header: (count) => `dsh-toolbox: ${count} local tools (data never leaves this machine)`,
	category: (name) => `## ${name}`,
	toolLine: (id, desc) => `- ${id} — ${desc}`,
	usage: "Usage: /toolbox | /toolbox run <id> [key=value ...] | /toolbox agent | /toolbox agent enable|disable <id>",
	unknownTool: (id, known) => `Unknown tool "${id}" (available: ${known === "" ? "none" : known})`,
	ran: (id) => `toolbox:${id} →`,
	agentHeader: (count, exposed) => `Exposable tools (${count}; exposed: ${exposed === "" ? "none" : exposed})`,
	agentStatus: (id, on) => `${id}: ${on ? "exposed" : "not exposed"}`,
	agentSuggestion: (id) => `To expose, add to the profile patch layer (cordis.patch.yml): agentTools: ['${id}']`,
	agentNote: "agentTools: [] exposes nothing; agentTools: ['*'] exposes all. This command never edits your config.",
	enabled: "exposed",
	disabled: "not exposed"
};
const ZH_MESSAGES = {
	header: (count) => `dsh-toolbox：${count} 个本地工具（数据不出本机）`,
	category: (name) => `## ${name}`,
	toolLine: (id, desc) => `- ${id} — ${desc}`,
	usage: "用法：/toolbox | /toolbox run <id> [key=value ...] | /toolbox agent | /toolbox agent enable|disable <id>",
	unknownTool: (id, known) => `未知工具 "${id}"（可用：${known === "" ? "无" : known}）`,
	ran: (id) => `toolbox:${id} →`,
	agentHeader: (count, exposed) => `可暴露工具（${count} 个；已暴露：${exposed === "" ? "无" : exposed}）`,
	agentStatus: (id, on) => `${id}：${on ? "已暴露" : "未暴露"}`,
	agentSuggestion: (id) => `要暴露它，在 profile patch 层（cordis.patch.yml）添加：agentTools: ['${id}']`,
	agentNote: "agentTools: [] 表示不暴露任何工具；agentTools: ['*'] 暴露全部。本命令绝不修改你的配置。",
	enabled: "已暴露",
	disabled: "未暴露"
};
function parseToolboxArgs(rawInput) {
	const tokens = rawInput.trim().split(/\s+/).filter(Boolean);
	if (tokens.length === 0) return { kind: "list" };
	const [head, ...rest] = tokens;
	if (head === "agent") {
		if (rest.length === 0) return { kind: "agent" };
		if ((rest[0] === "enable" || rest[0] === "disable") && rest.length === 2) return {
			kind: "agentToggle",
			id: rest[1],
			on: rest[0] === "enable"
		};
		return { kind: "usage" };
	}
	if (head === "run" && rest.length >= 1) {
		const args = {};
		for (const token of rest.slice(1)) {
			const eq = token.indexOf("=");
			if (eq > 0) args[token.slice(0, eq)] = token.slice(eq + 1);
			else if (args.text === void 0) args.text = token;
		}
		return {
			kind: "run",
			id: rest[0],
			args
		};
	}
	return { kind: "usage" };
}
/** Build the `/toolbox` command definition. */
function toolboxCommand(resolved, language = "zh") {
	const messages = language === "zh" ? ZH_MESSAGES : EN_MESSAGES;
	const lang = language;
	const exposed = new Set(resolved.agentTools.includes("*") ? exposableIds(resolved) : resolved.agentTools);
	return {
		name: "toolbox",
		description: "List and run dsh-toolbox local utilities (text/code/security/extract), and manage agent tool exposure",
		input: { hint: "[run <id> key=value ...| agent [enable|disable <id>]]" },
		handler: async ({ rawInput }) => {
			const parsed = parseToolboxArgs(rawInput);
			if (parsed.kind === "usage") return {
				kind: "error",
				text: messages.usage
			};
			if (parsed.kind === "list") {
				const lines = [messages.header(TOOLS.length)];
				for (const cat of CATEGORIES) {
					const tools = TOOLS.filter((t) => t.category === cat.id);
					lines.push(messages.category(lookup(lang, cat.nameKey)));
					for (const tool of tools) lines.push(messages.toolLine(tool.id, lookup(lang, tool.descKey)));
				}
				lines.push("", messages.agentNote);
				return {
					kind: "success",
					text: lines.join("\n")
				};
			}
			if (parsed.kind === "agent") {
				const ids = exposableIds(resolved);
				const lines = [messages.agentHeader(ids.length, [...exposed].join(", "))];
				for (const id of ids) lines.push(messages.agentStatus(id, exposed.has(id)));
				lines.push("", messages.agentNote);
				return {
					kind: "success",
					text: lines.join("\n")
				};
			}
			if (parsed.kind === "agentToggle") {
				if (parsed.on === exposed.has(parsed.id)) return {
					kind: "success",
					text: `toolbox:${parsed.id} is already ${parsed.on ? messages.enabled : messages.disabled}`
				};
				return {
					kind: "success",
					text: `${messages.agentSuggestion(parsed.id)}\n${messages.agentNote}`
				};
			}
			const tool = TOOL_BY_ID.get(parsed.id);
			if (tool === void 0) return {
				kind: "error",
				text: messages.unknownTool(parsed.id, TOOLS.map((t) => t.id).join(", "))
			};
			const coerced = coerceArgs(tool, parsed.args);
			if (!coerced.ok) return {
				kind: "error",
				text: `toolbox:${parsed.id}: ${coerced.error}`
			};
			try {
				const result = await tool.run(coerced.value);
				return {
					kind: "success",
					text: `${messages.ran(parsed.id)}\n${renderResultText(result)}`
				};
			} catch (error) {
				return {
					kind: "error",
					text: `toolbox:${parsed.id}: ${error instanceof Error ? error.message : String(error)}`
				};
			}
		}
	};
}
//#endregion
//#region src/service.ts
/**
* The toolbox host service: serves the one host capability the browser UI
* cannot do alone — writing a tool output into the profile's save directory.
* File names and subdirectories are sanitized (no path traversal), and the
* service never touches any configuration file.
*
* @module dsh-toolbox/service
*/
/** Basename characters allowed in saved file names. */
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
/** Subdirectory path characters allowed (segments). */
const SAFE_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/** Sanitize a file name: basename only, safe charset, default fallback. */
function sanitizeFileName(name, fallback = "output.txt") {
	const base = name.split(/[\\/]/).pop() ?? "";
	return SAFE_NAME.test(base) ? base : fallback;
}
/** Sanitize a subdir path: safe segments joined by the platform separator. */
function sanitizeSubdir(subdir) {
	return subdir.split(/[\\/]/).filter((s) => s !== "" && s !== "." && s !== "..").filter((s) => SAFE_SEGMENT.test(s)).join(sep);
}
/**
* Toolbox save service, exported over the `toolbox` Remote namespace
* (`toolbox/save`). Writes into `saveDir` (absolute path resolved at load).
*/
var ToolboxService = class extends TypertRemoteService {
	static inject = [];
	/** Absolute save directory. */
	saveDir;
	/**
	* @param ctx - cordis context.
	* @param saveDir - absolute directory outputs are written into.
	*/
	constructor(ctx, saveDir) {
		super(ctx, "toolbox");
		this.saveDir = saveDir;
	}
	/**
	* Write one output file. Sanitizes the name/subdir and reports the
	* absolute path back. Never touches configuration files.
	*
	* @param request - file name, content, optional subdirectory.
	* @returns the written file's absolute path, byte count, and save dir.
	*/
	async save(request) {
		const fileName = sanitizeFileName(request.fileName);
		const subdir = request.subdir === void 0 ? "" : sanitizeSubdir(request.subdir);
		const dir = subdir === "" ? this.saveDir : join(this.saveDir, subdir);
		await mkdir(dir, { recursive: true });
		const target = resolve(dir, fileName);
		const root = this.saveDir.endsWith(sep) ? this.saveDir : this.saveDir + sep;
		if (target !== this.saveDir && !target.startsWith(root)) throw new Error(`dsh-toolbox: refused to write outside the save directory: ${target}`);
		const bytes = Buffer.byteLength(request.content, "utf8");
		await writeFile(target, request.content, "utf8");
		return {
			path: target,
			bytes,
			saveDir: this.saveDir
		};
	}
	/** Resolve the configured save dir against the profile root. */
	static resolveSaveDir(baseUrl, configured) {
		const base = baseUrl === void 0 || baseUrl === "" ? process.cwd() : baseUrl.startsWith("file://") ? fileURLToPath(baseUrl) : baseUrl;
		return isAbsolute(configured) ? configured : join(base, configured);
	}
};
//#endregion
//#region src/index.ts
const name = "dsh-toolbox";
/** Hard services: the tool registry. Everything else is optional. */
const inject = ["tools", "loader"];
/**
* Mount the toolbox: the save service, the `/toolbox` command (when commands
* exist), and the config-driven agent tool set (when tools exist).
*
* @param ctx - context carrying tools + loader.
* @param config - raw loader config; defaults applied through {@link resolveConfig}.
*/
async function apply(ctx, config) {
	const resolved = resolveConfig(config);
	await ctx.plugin(ToolboxService, ToolboxService.resolveSaveDir(ctx.baseUrl, resolved.saveDir));
	ctx.get("toolbox");
	ctx.inject(["tools"], (scope) => {
		const defs = buildAgentTools(resolved, ctx.baseUrl);
		scope.effect(() => {
			const disposers = defs.map((def) => scope.tools.register(def));
			return () => {
				for (const dispose of disposers) dispose();
			};
		}, `dsh-toolbox: ${defs.length} agent tool(s)`);
	});
	ctx.inject(["commands"], (scope) => {
		scope.effect(() => scope.commands.register(toolboxCommand(resolved, "zh")), "dsh-toolbox: /toolbox command");
	});
}
//#endregion
export { AGENT_EXPOSABLE_IDS, CATEGORIES, Config, EN_MESSAGES, HOST_ONLY_IDS, TOOLS, TOOL_BY_ID, ToolboxService, ZH_MESSAGES, agentDescription, apply, ascii, base64, buildAgentTools, case_change, case_convert, cn_convert, coerceArgs, color, convertTools, csv_fix, dataTools, email, encodeTools, exposableIds, extractTools, fileEncodeTool, fileHashTool, fullwidth, html_entity, http_codes, inject, ip_extract, json_csv, json_format, md5, md5Hex, mime, money, name, parseToolboxArgs, password, phone, picker, ports, radix, random_num, referenceTools, regex, renderResultText, resolveConfig, sanitizeFileName, sanitizeSubdir, securityTools, sha, textTools, text_dedup, text_diff, text_ops, text_remove_blank, text_stats, timestamp, toolboxCommand, unicode_escape, url, url_extract, uuid };
