# dsh-model-manager

[English](README.md) | 中文

**DSH 模型管理增强插件。** 新增一个完整复刻官方「模型」页的设置页「**模型增强**」，并叠加：同族多中转提供方、每模型思考程度（推理档位）配置（自动检测 + 按模型名推断）、输入框 Claude/Codex 风格思考程度滑杆、每模型显隐控制。

增强页与官方「模型」页**共享同一份配置源**——同一个 `llm-pi-ai` / `llm-deepseek` 配置文档、同一套凭证——两页始终读写相同内容、天然同步。增强页是官方页的严格超集：官方页能做的这里都能做，外加下面这些新能力。

## 安装

在你的 web profile `package.json` 中按全家桶插件的方式从本仓库安装：

```json
{
  "dependencies": {
    "dsh-model-manager": "github:zmjza/dsh-model-manager"
  }
}
```

```sh
cd ~/.dsh/profiles/web
pnpm update dsh-model-manager   # 拉取最新提交并自动构建
```

然后重启 `dsh web`。`cordis.patch.yml` 会自动挂载插件，无需手动改 profile。

发布到 npm 后也可以用 CLI：

```sh
dsh plugin --profile web add dsh-model-manager
```

## 功能一览

设置中新增「**模型增强**」，紧挨官方「模型」页：

```
设置
├── 模型            （官方页，原样保留）
└── 模型增强         （本插件：完整复刻 + 增强）
    ├── 提供方行（列表 / 添加 / 编辑 / 删除）
    ├── 添加提供方     → 同族多中转
    ├── 添加自定义提供方
    └── 每个模型：容量 + 思考程度 + 检测 + 显隐开关
```

| # | 功能 | 位置 |
|---|---|---|
| 1 | 同族多中转提供方 | 「添加提供方」下拉 |
| 2 | 每模型思考程度 + 默认档位 | 模型行展开区 + 提供方编辑器 |
| 3 | `llm.models` 自动检测 + 按名称推断 | 「思考程度-检测」+ 输入自动回填 |
| 4 | 输入框思考程度滑杆（Claude/Codex 风格） | 工具行，模型选择器旁 |
| 5 | 每模型显示/隐藏 | 模型行展开区 |

## 1. 同族多中转提供方

「添加提供方」下拉不再因为"已配置"而隐藏厂商族。每个可配置族始终可选；选择**已配置的族**会创建**同族实例**，使用递增 route（`openai-2`、`openai-3`…），每个实例有独立的中转地址、凭证和模型目录。

- **首次添加**某族 → 走官方编辑器（route = 族名，填密钥 + 可选扩展项）。
- **再次添加**已配置的族 → 弹出克隆卡片，route 预填下一个可用别名，并提示填写不同的中转地址。

```
添加提供方 ▾
  openai · 实例：1     ← 仍然可选
  anthropic · 实例：3
  deepseek · 实例：0
→ 生成 openai-2、openai-3、…
```

为什么有用：可以把多个 OpenAI/Anthropic 兼容网关接入同一个 Harness——每个实例一个 baseURL、一个凭证、独立的模型目录。

## 2. 每模型思考程度（推理档位）

每个模型行的展开区新增「**思考程度**」多选。勾选的档位写入该模型的 `reasoningEfforts`（线路写法 = 档位名，OpenAI 兼容惯例），模型选择器随即只显示你声明的档位。

pi-ai 提供方编辑器新增「**默认思考程度**」下拉，写入路由级 `reasoning` 默认——这是没有指定档位时请求回退用的档位。

| off | minimal | low | medium | high | xhigh | max |
|---|---|---|---|---|---|---|

- 不勾选的模型保持继承能力（或无），与官方行为完全一致。
- 线路写法不同的网关可在 `settings.yaml` 直接改。

## 3. 自动检测 + 按模型名推断

思考程度有两个来源：

1. **检测（llm.models）**——读取已注册路由公布的推理档位并回填。最适合官方目录里的模型。
2. **按名称推断（兜底）**——当路由未注册或无档位公布时，内置规则表根据模型 id/名称推断该家族的档位，并在**输入 id 时自动回填**（仅当当前未勾选任何档位时）。

| 模型 id / 名称 | 推断档位 |
|---|---|
| `gpt-5.6`、`gpt-5`、`gpt-4o`、`gpt-4.1` | minimal / low / medium / high |
| `o3`、`o3-mini`、`o1`、`o4` | minimal / medium / high |
| `claude-*`（3.5+） | low / medium / high |
| `deepseek-r1`、`deepseek-v3.1`、`deepseek-v4` | high / max |
| `gemini-2.5-*` | low / medium / high |
| `grok-3` | low / medium / high |
| `qwq`、`qwen3` | low / medium / high |
| 其他 | 留空（手动勾选） |

推断规则表在 [`src/client/model-efforts.ts`](src/client/model-efforts.ts)，遇到新家族可以自行扩展。

## 4. 输入框思考程度滑杆

工具行新增「胶囊 + 弹出滑杆」（Claude / Codex 风格）：水平轨道按可用档位布点、可拖拽手柄、每档有随档位强度增强的辉光——`off` 无光、`max` 满光。

```
  (思考)  ●————————————————◉——————○   low  [high]  max
         trigger              弹出滑杆
```

- 读写与官方 effort 面板**同一个 per-session ModelDirectory**，两边永远一致。
- 当前模型无推理档位时自动隐藏。
- 可折叠：收起时显示小圆点 + 当前档位名。

## 5. 每模型显示/隐藏

每个模型行有「**在列表显示**」开关。切换后持久化到 `localStorage`（`dsh.modelManager.visibility`），新模型默认显示（缺席即显示）。

> **为什么用 localStorage 而不是 settings namespace？** 官方 settings proxy 只对配置客户端暴露模型提供方 namespace 和一份硬编码白名单，第三方 namespace 会被拒绝（`settings namespace "…" is not exposed to configuration clients`）。显隐本是纯 UI 偏好，放浏览器本地存储最合适——无需任何 Host 注册。

## 配置承载

| 数据 | 位置 |
|---|---|
| 提供方（含多实例）、模型目录、`reasoningEfforts`、`reasoning` 默认 | `llm-pi-ai` / `llm-deepseek` namespace（官方，与模型页共享） |
| API 密钥 | `credentials`（官方，只写） |
| 每模型显隐 | `localStorage` → `dsh.modelManager.visibility` |

## 开发

```sh
pnpm install
pnpm typecheck
pnpm build        # tsc 类型 + tsdown host ESM + 浏览器 client bundle（__ModuleLoader__）
```

client bundle 使用官方 DSH client-bundle preset（`window.__ModuleLoader__.load`），经模块表直接加载。

## 已知限制与后续

- **官方输入框模型选择器的过滤**：官方选择器直接读 Host `session.models` RPC，没有可注入的过滤点。显隐开关已把偏好存进 `localStorage`（本插件界面及将来的自定义选择器可用），但**官方选择器仍列出全部模型**；要过滤官方席位需要替换该 slot（等于重写整个选择器），暂缓。
- **检测需要已注册路由**：按名称推断对任意输入都生效；`llm.models` 探测只回填适配器已注册的路由，因此未保存的自定义网关主要靠名称推断或手动勾选。
- **线路写法**：自定义 pi-ai 路由的思考程度默认用档位名做线路值（`reasoningEfforts: { high: "high", max: "max" }`）。写法不同的网关请在 `settings.yaml` 改；自定义线路写法的 UI 字段计划中。

## License

MIT — 见 [LICENSE](LICENSE)。
