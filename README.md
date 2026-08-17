# dsh-model-manager

中文 | [English](README.en.md)

**DSH 模型管理增强插件。** 新增一个完整复刻官方「模型」页的设置页「**模型增强**」，并叠加：同族多中转提供方、每模型思考程度（推理档位）配置（自动检测 + 按模型名推断）、输入框 Claude/Codex 风格**思考程度滑杆**（紫色粒子填充 + 白手柄 + 分档动画 + 清脆电子音效 + 浅深色自适应 + 默认上方弹出）、每模型显隐控制。

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
| 4 | 输入框思考程度滑杆（Claude/Codex 风格，v5 增强） | 工具行，模型选择器旁 |
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

推断规则以 2026-08-18 各厂商官方文档核实结果为准（见下文「官方核实结果表」），**官网没明说的一律留空、不猜**：

| 模型 id / 名称 | 推断档位 |
|---|---|
| `gpt-5.5`、`gpt-5.6`、`gpt5X` | low / medium / high / xhigh / max |
| `o1`、`o3`、`o4`（o 系列） | minimal / medium / high |
| `claude-fable`、`claude-mythos`、`claude-opus-5`、`claude-sonnet-5`、`claude-opus-4.6+`、`claude-sonnet-4.6+` | low / medium / high / xhigh / max |
| `deepseek-v4`（flash / pro） | low / high / max |
| 其他（Gemini / Grok / Qwen / QwQ / Llama / 老 Claude 等） | 留空（手动勾选，官网未公布档位梯） |

推断规则表在 [`src/client/model-efforts.ts`](src/client/model-efforts.ts)，遇到新家族可以自行扩展。

## 4. 输入框思考程度滑杆（v5：粒子 + 分档动画 + 音效 + 主题自适应 + 上方弹出）

工具行新增「胶囊 + 弹出滑杆」（Claude / Codex「Effort」风格，端点文案已确认决策 A）:

```
  思考程度          （弹出卡片标题）
 [高]              （当前档位名，副标题）
 低 ── ●──────○─── 高   （紫色粒子填充 + 白色圆角手柄）
 off  minimal  low  medium  high  xhigh  max
```

- **视觉复刻**：水平轨道 + 从当前档位左起的**紫色像素化粒子填充** + **白色圆角手柄**（浅色模式下仍为白 / 高对比）。
- **端点文案（决策 A）**：标题为「**思考程度**」，两端标注「**低 ── 高**」（左低右高）。
- **浅深色自适应**：卡片面/边框/文字使用本套 DSH 构建真实提供的主题 token（`--dsw-alias-bg-base`、`--dsw-alias-border-l2/3`、`--dsw-alias-label-*` 等，已真机核实），页面主题切换卡片自动跟随；紫色粒子用主题紫（浅 `#8b5cff` / 深 `#a678ff`，因本构建未暴露紫色 accent token，由 `--effort-purple` 按 `data-ds-dark-theme` 明暗切换）。
- **分档动画（R4）**：每档位有各自不同的动画形态（由 `data-tier` 驱动）：`off` = 无粒子 / `minimal` = 极少静态星点 / `low` = 零星闪烁 / `medium` = 中等密度 + 浮动 / `high` = 稠密 + 环形飘动 / `xhigh` = 更亮 + 光晕渐大 / `max` = 满轨粒子 + 彗星拖尾（最炫）。
- **清脆电子音效（决策：按推荐）**：切换档位播放 Web Audio 合成的**清脆电子音，音高随档位递进**（五声音阶，`off` 最低沉 → `max` 最明亮，像调音量咔哒），无外部音频资源；`AudioContext` 在**首次交互后**才创建（兼容浏览器自动播放策略），系统静音可打断，受限环境自动降级为无声并 console 提示。
- **弹出位置（R5）**：默认在按钮**上方**显示（`bottom: calc(100% + 8px)`），短窗口才翻转到下方。
- 读写与官方 effort 面板**同一个 per-session ModelDirectory**，两边永远一致；当前模型无推理档位时自动隐藏；可折叠（收起时显示小圆点 + 当前档位名）。

### 星芒动画方案（R6：开源调研决策 = 自写）

检索方向：`claude stardust` / `sparkle slider` / `reasoning effort slider` / `cosmic particle`。结论：**没有现成可插拔、License 宽松且同时满足「浅深色自适应 + 分档动画 + 上方弹出 + 音效 + 主题 token」的 Effort 滑杆组件**——Claude Code 官方滑杆闭源；`basmilius/sparkle` 等是通用 canvas 视觉特效库（过重、需大量胶水）；其余是散落的 UI 实验。因此决定 **CSS radial-gradient 粒子层自写**：最轻、自控最强、与 DSH 主题体系和 CSS Modules 天然一致。自写实现仍然全部满足既有约束。

## 5. 每模型显示/隐藏

每个模型行有「**在列表显示**」开关。切换后持久化到 `localStorage`（`dsh.modelManager.visibility`），新模型默认显示（缺席即显示）。

> **为什么用 localStorage 而不是 settings namespace？** 官方 settings proxy 只对配置客户端暴露模型提供方 namespace 和一份硬编码白名单，第三方 namespace 会被拒绝（`settings namespace "…" is not exposed to configuration clients`）。显隐本是纯 UI 偏好，放浏览器本地存储最合适——无需任何 Host 注册。

## 官方核实结果表（R2，2026-08-18）

按 v5 需求逐条核对各厂商官方文档，**官网没明说的模型不留档位**（保守口径）：

| 家族 / 模型 | 官网 / 依据 | 真实支持档位 | 结论 |
|---|---|---|---|
| OpenAI GPT-5.x（gpt-5.5 / 5.6 等） | [Reasoning models 指南](https://developers.openai.com/api/docs/guides/reasoning) | low / medium / high / xhigh / max（另可含 none/minimal，按模型而异） | ✅ 确认（保守剔除 none/minimal） |
| OpenAI o 系列（o1/o3/o4） | 同上 | minimal / medium / high | ✅ 确认 |
| Anthropic Claude（Fable 5 / Mythos 5 / Opus 5 / Sonnet 5 / Opus 4.6+ / Sonnet 4.6+） | [Effort 文档](https://platform.claude.com/docs/en/build-with-claude/effort) | low / medium / high / xhigh / max | ✅ 确认（**修正：官方 Effort 档位无 minimal**，v5 表原 6 档减为 5 档） |
| DeepSeek V4（flash / pro） | [Thinking Mode 指南](https://api-docs.deepseek.com/guides/thinking_mode) | low / high / max（medium、xhigh 映射到 high） | ✅ 确认（**修正：官网含 low**，v5 表原 high/max 补为 3 档） |
| Google Gemini（3 / 2.5） | [Gemini 思考文档](https://ai.google.dev/gemini-api/docs/thinking) | 无档位梯（预算 / thinkingConfig 驱动） | ⬜ 保守留空 |
| xAI Grok（grok-4.6 等） | [xAI Models](https://docs.x.ai/docs/models) | 模型卡仅标注「configurable reasoning」，无档位枚举 | ⬜ 保守留空 |
| Qwen / QwQ | Qwen 文档 | OpenAI 兼容面未公布档位梯 | ⬜ 保守留空 |
| Llama（4 等） | Llama 文档 | OpenAI 兼容面未公布档位梯 | ⬜ 保守留空 |

## 配置承载

| 数据 | 位置 |
|---|---|
| 提供方（含多实例）、模型目录、`reasoningEfforts`、`reasoning` 默认 | `llm-pi-ai` / `llm-deepseek` namespace（官方，与模型页共享） |
| API 密钥 | `credentials`（官方，只写） |
| 每模型显隐 | `localStorage` → `dsh.modelManager.visibility` |

## 截图

> 以下均为**真机截图**（本地 `dsh web` 实时渲染；主题经应用「外观」切换实测，卡片随深/浅主题自适应）。

**输入框思考程度滑杆 · 展开（浅色 / 深色）**

| 浅色 | 深色 |
|---|---|
| ![浅色-滑杆全貌](docs/screens/01-effort-slider-light.png) | ![深色-滑杆全貌](docs/screens/02-effort-slider-dark-full.png) |

**滑杆卡片特写（浅色 / 深色）**

| 浅色 | 深色 |
|---|---|
| ![浅色-特写](docs/screens/04-effort-slider-light-closeup.png) | ![深色-特写](docs/screens/03-effort-slider-dark-closeup.png) |

**设置 → 模型增强页**

![模型增强设置页](docs/screens/05-models-enhanced-settings-light.png)

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
- **音效依赖浏览器允许音频**：`AudioContext` 首次交互后创建；若 DSH Client 环境禁止创建，自动降级为无声（不阻塞滑杆）。

## License

MIT — 见 [LICENSE](LICENSE)。
