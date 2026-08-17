/**
 * Reference tables: HTTP status codes, common ports, MIME types, ASCII table.
 * Read-only built-in data with query support. Also the "life" category's
 * picker (random selection from a name list).
 *
 * @module dsh-toolbox/tools/reference
 */

import type { ToolFn } from './index.ts'

/* ------------------------------------------------------------------ */
/* HTTP status codes.                                                  */
/* ------------------------------------------------------------------ */

const HTTP_CODES: ReadonlyArray<readonly [number, string, string]> = [
  [100, 'Continue', '继续'], [101, 'Switching Protocols', '切换协议'],
  [200, 'OK', '成功'], [201, 'Created', '已创建'], [202, 'Accepted', '已接受'],
  [204, 'No Content', '无内容'], [206, 'Partial Content', '部分内容'],
  [301, 'Moved Permanently', '永久重定向'], [302, 'Found', '临时重定向'], [304, 'Not Modified', '未修改'],
  [307, 'Temporary Redirect', '临时重定向'], [308, 'Permanent Redirect', '永久重定向'],
  [400, 'Bad Request', '请求错误'], [401, 'Unauthorized', '未认证'], [403, 'Forbidden', '禁止访问'],
  [404, 'Not Found', '未找到'], [405, 'Method Not Allowed', '方法不允许'], [406, 'Not Acceptable', '不可接受'],
  [408, 'Request Timeout', '请求超时'], [409, 'Conflict', '冲突'], [410, 'Gone', '已删除'],
  [413, 'Payload Too Large', '负载过大'], [415, 'Unsupported Media Type', '不支持的媒体类型'],
  [422, 'Unprocessable Entity', '无法处理的实体'], [429, 'Too Many Requests', '请求过多'],
  [500, 'Internal Server Error', '服务器内部错误'], [501, 'Not Implemented', '未实现'],
  [502, 'Bad Gateway', '网关错误'], [503, 'Service Unavailable', '服务不可用'],
  [504, 'Gateway Timeout', '网关超时'], [505, 'HTTP Version Not Supported', 'HTTP 版本不支持'],
]

export const http_codes: ToolFn = {
  id: 'http_codes',
  nameKey: 'tool.http_codes',
  descKey: 'tool.http_codes.desc',
  category: 'reference',
  textPayload: false,
  args: {
    code: { type: 'number', description: 'filter by exact code (optional)' },
  },
  run({ code }) {
    const all = HTTP_CODES.map(([c, en, zh]) => [c, en, zh] as const)
    const rows = code !== undefined
      ? all.filter(([c]) => c === Number(code))
      : all
    if (rows.length === 0) return { kind: 'text', text: `No entry for HTTP ${String(code)}` }
    return { kind: 'table', columns: ['code', 'english', '中文'], rows }
  },
}

/* ------------------------------------------------------------------ */
/* Common ports.                                                       */
/* ------------------------------------------------------------------ */

const PORTS: ReadonlyArray<readonly [number, string, string]> = [
  [20, 'FTP-Data', 'FTP 数据传输'], [21, 'FTP', '文件传输协议'], [22, 'SSH', '安全外壳'],
  [23, 'Telnet', '远程登录'], [25, 'SMTP', '邮件发送'], [53, 'DNS', '域名解析'],
  [67, 'DHCP', '动态主机配置'], [68, 'DHCP', '动态主机配置'],
  [80, 'HTTP', '超文本传输'], [110, 'POP3', '邮件接收'], [123, 'NTP', '网络时间'],
  [143, 'IMAP', '邮件读取'], [161, 'SNMP', '简单网络管理'], [194, 'IRC', '即时聊天'],
  [443, 'HTTPS', '安全超文本传输'], [445, 'SMB', 'Windows 文件共享'], [465, 'SMTPS', '安全邮件发送'],
  [514, 'Syslog', '系统日志'], [587, 'SMTP', '邮件提交'], [631, 'IPP', '网络打印'],
  [873, 'Rsync', '远程同步'], [993, 'IMAPS', '安全邮件读取'], [995, 'POP3S', '安全邮件接收'],
  [1080, 'SOCKS', '代理'], [1433, 'MSSQL', 'SQL Server'], [1521, 'Oracle', 'Oracle 数据库'],
  [2049, 'NFS', '网络文件系统'], [2375, 'Docker', 'Docker API'], [2376, 'Docker', 'Docker TLS API'],
  [3000, 'Dev', '开发服务器(常见)'], [3306, 'MySQL', 'MySQL 数据库'], [3389, 'RDP', '远程桌面'],
  [5432, 'PostgreSQL', 'PostgreSQL 数据库'], [5672, 'AMQP', '消息队列'], [5900, 'VNC', '远程桌面'],
  [6379, 'Redis', 'Redis 缓存'], [6443, 'K8s', 'Kubernetes API'], [8080, 'HTTP-Alt', 'HTTP 备用端口'],
  [8443, 'HTTPS-Alt', 'HTTPS 备用端口'], [8888, 'Dev', '开发服务器(常见)'], [9000, 'Dev', '开发服务器(常见)'],
  [9092, 'Kafka', '消息队列'], [9200, 'Elasticsearch', '搜索引擎'], [9418, 'Git', 'Git 协议'],
  [11211, 'Memcached', '缓存'], [27017, 'MongoDB', 'MongoDB 数据库'],
]

export const ports: ToolFn = {
  id: 'ports',
  nameKey: 'tool.ports',
  descKey: 'tool.ports.desc',
  category: 'reference',
  textPayload: false,
  args: {
    port: { type: 'number', description: 'filter by exact port (optional)' },
  },
  run({ port }) {
    const rows = port !== undefined
      ? PORTS.filter(([p]) => p === Number(port))
      : PORTS
    if (rows.length === 0) return { kind: 'text', text: `No entry for port ${String(port)}` }
    return { kind: 'table', columns: ['port', 'service', '说明'], rows }
  },
}

/* ------------------------------------------------------------------ */
/* MIME types.                                                         */
/* ------------------------------------------------------------------ */

const MIMES: ReadonlyArray<readonly [string, string]> = [
  ['.html', 'text/html'], ['.css', 'text/css'], ['.js', 'text/javascript'],
  ['.mjs', 'text/javascript'], ['.json', 'application/json'], ['.xml', 'application/xml'],
  ['.txt', 'text/plain'], ['.md', 'text/markdown'], ['.csv', 'text/csv'],
  ['.pdf', 'application/pdf'], ['.zip', 'application/zip'], ['.gz', 'application/gzip'],
  ['.tar', 'application/x-tar'], ['.7z', 'application/x-7z-compressed'],
  ['.png', 'image/png'], ['.jpg', 'image/jpeg'], ['.jpeg', 'image/jpeg'],
  ['.gif', 'image/gif'], ['.webp', 'image/webp'], ['.svg', 'image/svg+xml'],
  ['.ico', 'image/x-icon'], ['.bmp', 'image/bmp'], ['.avif', 'image/avif'],
  ['.mp3', 'audio/mpeg'], ['.wav', 'audio/wav'], ['.ogg', 'audio/ogg'], ['.flac', 'audio/flac'],
  ['.mp4', 'video/mp4'], ['.webm', 'video/webm'], ['.mov', 'video/quicktime'], ['.avi', 'video/x-msvideo'],
  ['.ttf', 'font/ttf'], ['.woff', 'font/woff'], ['.woff2', 'font/woff2'],
  ['.doc', 'application/msword'], ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['.xls', 'application/vnd.ms-excel'], ['.xlsx', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  ['.ppt', 'application/vnd.ms-powerpoint'], ['.pptx', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
  ['.wasm', 'application/wasm'], ['.yaml', 'application/yaml'], ['.yml', 'application/yaml'],
]

export const mime: ToolFn = {
  id: 'mime',
  nameKey: 'tool.mime',
  descKey: 'tool.mime.desc',
  category: 'reference',
  textPayload: false,
  args: {
    ext: { type: 'string', description: 'extension with dot, e.g. .json (optional)' },
  },
  run({ ext }) {
    const rows = ext !== undefined
      ? MIMES.filter(([e]) => e === String(ext).toLowerCase())
      : MIMES
    if (rows.length === 0) return { kind: 'text', text: `No entry for ${String(ext)}` }
    return { kind: 'table', columns: ['extension', 'mime'], rows }
  },
}

/* ------------------------------------------------------------------ */
/* ASCII table.                                                        */
/* ------------------------------------------------------------------ */

const ASCII_NAMES: Record<number, string> = {
  0: 'NUL', 9: 'TAB', 10: 'LF', 13: 'CR', 27: 'ESC', 32: 'SPACE',
}

export const ascii: ToolFn = {
  id: 'ascii',
  nameKey: 'tool.ascii',
  descKey: 'tool.ascii.desc',
  category: 'reference',
  textPayload: false,
  args: {
    code: { type: 'number', description: 'look up one code (0-127, optional)' },
  },
  run({ code }) {
    if (code !== undefined) {
      const c = Number(code)
      if (c < 0 || c > 127) return { kind: 'text', text: 'Error: code must be 0-127' }
      const ch = c < 32 || c === 127 ? (ASCII_NAMES[c] ?? `CTRL-${String.fromCharCode(c + 64)}`) : String.fromCharCode(c)
      return { kind: 'table', columns: ['dec', 'hex', 'char'], rows: [[c, c.toString(16).padStart(2, '0').toUpperCase(), ch]] }
    }
    const rows: (string | number)[][] = []
    for (let i = 0; i < 128; i++) {
      const ch = i < 32 || i === 127 ? (ASCII_NAMES[i] ?? `C-${String.fromCharCode(i + 64)}`) : String.fromCharCode(i)
      rows.push([i, i.toString(16).padStart(2, '0').toUpperCase(), ch])
    }
    return { kind: 'table', columns: ['dec', 'hex', 'char'], rows }
  },
}

/* ------------------------------------------------------------------ */
/* Life category: picker (random names from a list).                   */
/* ------------------------------------------------------------------ */

export const picker: ToolFn = {
  id: 'picker',
  nameKey: 'tool.picker',
  descKey: 'tool.picker.desc',
  category: 'life',
  textPayload: true,
  args: {
    text: { type: 'string', required: true, description: 'names, one per line' },
    count: { type: 'number', default: 1, description: 'how many to pick (1-100)' },
  },
  run({ text, count }) {
    const names = String(text).split(/\r\n|\r|\n/).map(s => s.trim()).filter(s => s !== '')
    if (names.length === 0) return { kind: 'text', text: 'Error: empty list' }
    const n = Math.min(100, Math.max(1, Math.floor(Number(count) || 1)))
    const shuffled = [...names]
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1))
      ;[shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!]
    }
    return { kind: 'text', text: shuffled.slice(0, Math.min(n, shuffled.length)).join('\n') }
  },
}

export const referenceTools: readonly ToolFn[] = Object.freeze([
  http_codes,
  ports,
  mime,
  ascii,
  picker,
])
