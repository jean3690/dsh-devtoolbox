# dsh-devtoolbox

**DSH 本地工具箱插件**：侧边栏独立页面 + `/toolbox` 命令 + 配置驱动的 agent 确定性工具。
约 35 个纯本地小工具（文本 / 编码 / 数据 / 安全 / 提取 / 转换 / 参考 / 效率），
参考 [devtoolbox.online](https://devtoolbox.online/zh-CN/tools) 设计，**数据不出本机**。

[![dsh-plugin](https://img.shields.io/badge/ecosystem-dsh--plugin-8b5cf6)](https://github.com/topics/dsh-plugin)
[![CI](https://github.com/jean3690/dsh-devtoolbox/actions/workflows/ci.yml/badge.svg)](https://github.com/jean3690/dsh-devtoolbox/actions/workflows/ci.yml)

## 你能得到什么

| 界面 | 能力 |
|---|---|
| **侧边栏「工具箱」入口** | 点击进入中心列全屏工具箱：分类导航 + 搜索 + 工具卡片网格 |
| **工具页** | 动态参数表单 → 本地运行 → 结果（文本 / JSON / 表格），一键复制、下载、保存到项目 |
| **`/toolbox` 命令** | `/toolbox` 列出全部工具；`/toolbox run <id> key=value …` 直接执行（模型可读、可日志重建） |
| **agent 工具** | **配置驱动**：`agentTools` 决定哪些 `toolbox_*` 工具对模型可见（默认一个都不暴露）；`userTools` 让你用 JS 表达式自定义自己的工具 |
| **文件工具** | `toolbox_file_hash` / `toolbox_file_encode`（GBK⇄UTF-8）——需要时在配置中启用 |

## 快速上手

```sh
dsh plugin --profile web add link:/path/to/dsh-devtoolbox
```

重启 web 面板（bundle 列表在启动时快照），侧边栏出现「工具箱」入口：

```text
/toolbox
/toolbox run md5 text=hello
/toolbox agent
```

## 配置（cordis.patch.yml）

```yaml
- insert:
    - id: dsh-devtoolbox
      name: dsh-devtoolbox
      config:
        # 暴露给模型的内置工具；'*' = 全部，[] = 不暴露（默认）
        agentTools: ['json_format', 'base64', 'md5']
        # 用户自定义工具（JS 表达式；agentTools 含其 name 或 '*' 时注册为 toolbox_<name>）
        # userTools:
        #   - name: shout
        #     description: 把文本转成大写并加感叹号
        #     args:
        #       text: { type: 'string', required: true, description: '输入文本' }
        #     run: !!js |
        #       ((args) => ({ text: String(args.text).toUpperCase() + '!' }))
        # 浏览器「保存到项目」RPC（写入 <profile>/toolbox-saves，可改 saveDir）
        saveEnabled: true
        # saveDir: toolbox-saves
```

**可暴露的内置工具**（`/toolbox agent` 可查看）：`text_stats cn_convert case_convert
fullwidth base64 url html_entity unicode_escape radix timestamp json_format json_csv
csv_fix text_diff md5 sha uuid password random_num phone email url_extract ip_extract
money color http_codes ports mime ascii text_ops text_remove_blank text_dedup
case_change regex` + 宿主文件工具 `file_hash file_encode`。

## 架构

```
src/
├── index.ts            # 宿主插件入口（Cordis function plugin）
├── config.ts           # 配置 schema + 显式 resolve（agentTools / userTools / save）
├── command.ts          # /toolbox 命令（只读：enable/disable 仅给建议，绝不改配置）
├── agentTools.ts       # 配置驱动的 agent 工具注册（默认 0 个）
├── hostTools.ts        # 文件哈希 / 文件编码（宿主专属）
├── service.ts          # toolbox Remote 服务（保存输出到 profile）
├── wire.ts             # Typert wire 协议（toolbox/save，zod 严格编解码）
├── typert.host.ts      # Typert host manifest
├── present.ts          # 结果渲染（无依赖，三端复用）
├── i18n.ts             # zh/en 字典（UI + 命令 + agent 描述共用）
├── tools/              # ★ 35 个纯函数工具（零 DOM/fs/网络，三端复用）
└── client/             # 浏览器半：侧边栏入口 + 中心列视图
```

**核心设计**：工具是纯函数，一份代码三处复用——浏览器 UI 直接同步调用（零延迟）、
`/toolbox run` 输出（模型可读）、agent 工具（模型可调）。浏览器与宿主之间
只有一个 RPC（`toolbox/save`），其余全部本地计算。

**面板互斥**：与任务看板 / SSH 面板共用 `dsh-panel-activate` 事件协议，中心列
同一时刻只有一个面板占用。

**样式规范对齐**（官方 `web-styling.md`，[deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)）：
CSS Modules + 哈希类名（`toolbox.module.css`，lightningcss 编译，运行时注入
`<style data-plugin>`，与官方 client 包同机制）；颜色只用 ui-theme 的
`--dsw-alias-*` 语义 token（无静态色板值、无颜色字面量、无主题选择器）；
字体大小与行高配对；交互控件带 `:focus-visible` 焦点轮廓。

## 开发

```sh
npm install          # 安装依赖
npm test             # vitest：33 个工具测试（含 MD5/SHA 测试向量）
npm run build        # tsc + tsdown → lib/（node 半 ESM + client 半 ModuleLoader 单文件）
```

client bundle 遵循 shell 的 `window.__ModuleLoader__.load({ id, factory })` 握手：
平台模块（react 等）external、其余全部内联，因此 `/plugins/<id>/client.js` 是单文件。

## 诚实契约

- **纯本地**。工具计算发生在浏览器或宿主进程，无任何数据上传。
- **默认不暴露 agent 工具**。模型能调用的 `toolbox_*` 工具完全由 `agentTools` 配置决定；
  命令的 enable/disable 只打印 patch 建议，绝不写配置。
- **路径安全**。保存文件名/子目录经过消毒（防路径穿越），写入目录固定为 saveDir。
- **用户自定义工具自负其责**。`userTools` 是本地 JS 表达式（patch 层本就信任 `!!js`）。

## 兼容性

- 运行时：DeepSeek Harness `0.1.0-rc.6`（peerDependencies 固定包线）
- 依赖：`zod`（内联进宿主）、`opencc-js`（繁简词典，内联进客户端 bundle）

## License

Apache-2.0
