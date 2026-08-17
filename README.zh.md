# dsh-model-manager

DSH Web 插件：模型增强 —— 新增一个完整复刻官方「模型」页的设置页，并叠加：同族多中转提供方、每模型思考程度（推理档位）配置与自动检测、输入框 Clarendon/Codex 风格思考程度滑杆、模型显隐控制。

## 安装

需要 DSH web profile（`dsh web`）。从本仓库安装：

```bash
dsh plugin --profile web add dsh-model-manager
```

或在你的 profile `package.json` 中加入：

```json
{
  "dependencies": {
    "dsh-model-manager": "github:zmjza/dsh-model-manager"
  }
}
```

然后 `pnpm install` 并重启 `dsh web`。`cordis.patch.yml` 会自动挂载插件，无需手动改 profile。

## 功能一览

设置新增「**模型增强**」页，与官方「模型」页并列。它**共享同一份配置源**（`llm-pi-ai` / `llm-deepseek` namespace + credentials），两页读写同一份文档、始终同步——增强页是官方页的严格超集。

### 1. 同族多中转提供方

「添加提供方」下拉不再因"已配置"而隐藏厂商族。选择已配置的族会创建**同族实例**，使用递增 route（`openai-2`、`openai-3`…），每个实例有独立的中转地址（baseURL）、凭证和模型目录——可以往一个 Harness 里接入多个 OpenAI/Anthropic 兼容网关。首次添加某族仍走官方编辑器（route = 族名）。

### 2. 每模型思考程度（推理档位）

每个模型行的展开区增加「**思考程度**」多选（off / minimal / low / medium / high / xhigh / max，不含 off），写入该模型的 `reasoningEfforts`。pi-ai 提供方编辑器的「**默认思考程度**」下拉写入路由级 `reasoning` 默认。模型选择器随即只显示该模型声明的档位。

### 3. 自动检测

每个模型行提供「**检测**」按钮：从 `llm.models` 读取已注册路由公布的推理档位并**自动回填**选择，常见模型无需手动录入；未公布的模型保留手动选择。

### 4. 输入框思考程度滑杆

工具行新增胶囊 + 弹出滑杆（Claude / Codex 风格）：水平轨道按可用档位布点、可拖拽手柄、每档有随档位强度变化的辉光特效。读写与官方 effort 面板**同一个** per-session ModelDirectory，两边永远一致。当前模型无推理档位时自动隐藏。

### 5. 模型显隐控制

每个模型行有「**在列表显示**」开关，持久化到插件自有 `model-manager` namespace（`visibility.<provider>.<model>`，缺席即显示）。新发现的模型默认显示。

## 配置承载

| 数据 | Namespace |
|---|---|
| 提供方（含多实例）、模型目录、`reasoningEfforts`、`reasoning` 默认 | `llm-pi-ai` / `llm-deepseek`（官方，共享） |
| API 密钥 | `credentials`（官方，只写） |
| 显隐偏好 | `model-manager`（插件自有） |

## 已知限制

- 官方输入框模型选择器直接读 Host `session.models`，没有可注入的过滤点。因此「显示/隐藏」开关把显隐持久化进插件 namespace（本插件自己的界面和将来的自定义选择器可消费），但**官方选择器仍显示全部模型**；要过滤官方席位需要替换该 slot（等于重写整个选择器），暂缓。
- 「检测」读取 `llm.models`，只对已注册路由的模型生效；尚未保存的自定义网关没有可探测的目录，需手动填写。
- 自定义 pi-ai 路由的思考程度线路写法默认取档位名（`reasoningEfforts: { high: "high", max: "max" }`，OpenAI 兼容惯例）；线路写法不同的网关可在 `settings.yaml` 中直接改。

## 开发

```bash
pnpm install
pnpm typecheck
pnpm build        # tsc 类型 + tsdown host ESM + 浏览器 client bundle
```

client bundle 使用官方 DSH client-bundle preset（`window.__ModuleLoader__.load`），直接经模块表加载。

## License

MIT — 见 [LICENSE](LICENSE)。
