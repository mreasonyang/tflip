# Tflip Agent 接入层

当前版本为 `@kyun.si/tflip@0.3.2`，已公开发布到 npm，并完成 registry 字节与独立安装验证。SDK、原创示例和 Skill 使用 MIT 许可证；开发仓库的 `private: true` 不进入 SDK。构建只在 `npm-publication.json` 的包名、版本、registry、字节数与 SHA-256 全部匹配时，将 `catalog.package.published` 标为 `true`；新版本不会继承旧版本的发布状态。线上展示由 Cloudflare Pages 托管，接入文件继续使用相对路径，支持任意部署前缀。

## 用户入口

页面可选择 8 个 Demo 和框架偏好，复制当前配置的接入指令，或下载 JSON。场景旁的接入按钮会选中该场景；Lab 导出读取当前参数。复制失败时可展开手动选择的文本。动画状态与业务状态分别由各自调用方管理。

- `agent/index.md`：短入口与 recipe 选择。
- `agent/catalog.json`：SDK 版本、内容修订、相对下载路径、字节数、SHA-256 和 8 个 canonical recipe。
- `agent/tflip/SKILL.md`：唯一 Skill 入口；ZIP 内为 `tflip/SKILL.md`。
- `agent/configuration.schema.json`：版本化 JSON 数据契约；不包含函数、DOM 或回调。
- `agent/recipes/`、`agent/references/`：原生/React 接入、配置映射、清理与验证。
- `agent/examples/`、`agent/runtime/`：可独立挂载的 Gallery 和双镜头 Stunt，以及配套运行时。

当前下载目录只包含 0.3.2 的 SDK、示例和 Skill 三个归档。历史版本不混入当前分发面。

## 接口与升级

SDK preset 为 launch/gentle/snappy/float。Gallery 是六个组合示例；Stunt 是两套独立 Canvas 镜头，8 秒直接切镜，总长 13.8 秒。Roadster / Ramp 场景别名继续选择完整 Stunt，它们与品牌命名无关。

自 0.3.0 起只使用 `data-tflip-*` DOM 属性、`--tflip-scene-height`、`tflip:languagechange` / `tflip:themechange` 事件和 `tflip.language` / `tflip.theme` 偏好键。宿主的自定义选择器和订阅需要同步更新；现有 Tflip 偏好仍然有效。更早品牌的存储键不再读取。

配置 envelope 仍是 schemaVersion 1。历史 SDK 版本只可按 [配置迁移](../agent/references/config.md) 显式升级，不直接交给当前运行时。函数签名、8 个 Demo 与双镜头时序不变。

## 地址与构建

```sh
npm run build:agent
npm run preview:sync
```

构建只使用当前源码、已有 TypeScript、npm 本地打包和系统 Python ZIP 工具。SDK 归档只含 ESM、类型和公开 API 文档，不含内部会话记录或生命周期脚本。示例 ZIP 保留 examples/runtime 相对目录。Skill ZIP 自包含当前 SDK。

`tailnet-preview/` 是静态输出；同步脚本不修改网络配置。构建、归档、类型与单元检查由 `npm test` 验证。浏览器与线上验收边界见 [验证说明](VERIFICATION.md)。
