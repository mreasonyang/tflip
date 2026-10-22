# Tflip Playground

构建 `npm run build:agent` 后从项目根目录启动现有静态服务器，打开 `playground/`。页面使用原生 HTML/CSS/JavaScript 与本地 `dist/`；不依赖外部字体、图片、CDN 或后端。

## 演示与控制

置顶 Stunt 是两个独立镜头的顺序剪辑：先完整播放 8 秒 U/C 型坡道翻滚动作（含落地），在 8 秒处直接切镜头，再完整播放 5.8 秒原 Roadster 飞越汽车动作。两套场景保留各自世界坐标、构图与相机，共用一条 13.8 秒时间轴，支持播放、暂停/继续、重播、取消、定位与速度调整。喷气默认开启；系统减少动态效果时显示第二镜头的静态完成姿态并停用喷气。

定位到 8 秒前属于第一镜头，恰好 8 秒或之后属于第二镜头；向前、向后跨过切点均直接切换，不在两个空间之间插值。

下方保留六个组合场景：轨道穿梭、传送门、黑胶唱片、糖果弹跳、街机连击和纸飞机。它们直接复用 SDK 的 `play` / `sequence` 与可选粒子效果。参数实验室提供起终点、原地运动、路径、旋转、阶段、重复触发和清理策略，以及配置复制。当前共有 8 个 canonical 接入入口。

动画完成只表示视觉播放完成，业务任务的成功与失败由应用独立管理。

## 语言、主题与地址

语言支持自动、中文与 English；主题支持自动、浅色与深色。切换不重置正在播放的动画。新偏好使用 `tflip.language` / `tflip.theme`，兼容读取旧键，用户手动选择后迁移到新键。

资源链接基于所在文档或模块地址解析。复制 Agent 指令时才根据当前地址生成完整链接；不固定部署 IP、域名或路径前缀。旧 `#roadster` / `#ramp` 页面链接跳到合并演示。

## Agent 接入

页面的“让 Agent 接入”提供当前参数 JSON、按需读取的 recipe、SDK、独立示例和 Skill 包。入口见 [agent/index.md](../agent/index.md)，构建生成 [catalog.json](../agent/catalog.json) 中的版本与 SHA-256。当前 SDK 为 `@tflip/motion`，仅供本地预览，未发布 npm。

新示例导出 `mountStunt()`；旧 `mountRoadster()` / `mountRamp()` 作为兼容别名。旧 recipe 地址和配置 id 有明确迁移说明。旧数据属性保留为兼容别名，新代码使用 `data-tflip-*`。

## 验证

`npm test` 覆盖类型、SDK、运动与下载包契约。浏览器检查使用 Brave 和 Playwright WebKit：`tests/stunt.e2e.mjs`、`tests/agent.e2e.mjs`、`tests/i18n.e2e.mjs`、`tests/theme.e2e.mjs`。WebKit 检查不等同于实体 iPhone 或 Safari 验收。

当前双镜头实现见 [TWO_SHOT_UPDATE.md](../docs/TWO_SHOT_UPDATE.md)。此前共享世界的 12 秒实现与验证仍记录在 [TFLIP_UPDATE.md](../docs/TFLIP_UPDATE.md)，作为历史版本保留。旧 `ramp.e2e.mjs` 与 `jet-roadster.e2e.mjs` 对应被替换的独立场景界面，保留作历史实现参考；它们不作为新版页面验收。
