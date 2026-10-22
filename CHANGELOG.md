# Tflip changelog

## 0.3.1 — 发布准备与接入修复

- 采用 MIT 许可，建立公开源码仓库与可复现发布流程。
- 修复配置复制的严格 TypeScript 接入、落地回调控制、排队元素脱离及无效 signal 的清理。
- 本地与网站使用同一规范 SDK；补全独立包文档和许可证，发布目录清除退休资源并提供真实 404。
- 统一 Brave/WebKit 全部当前专项与独立 Vanilla/React 消费者回归；区分源码工具链、SDK 消费环境和真实设备证据。

## 0.3.0 — 全面统一 Tflip 命名

- 本地目录统一为 `tflip`，源码、DOM 属性、CSS 变量、语言/主题事件及偏好存储只使用 Tflip 命名。
- 移除旧品牌兼容 Skill 和下载入口；当前站点只分发本版本 SDK、示例和 Skill；旧包不再混入当前分发。
- 同步测试、配置版本、接入文档和 Cloudflare Pages 部署。八个 Demo、双镜头时序及 SDK 函数签名保持现有行为。
- 升级需同步更新自定义 DOM/CSS 选择器、事件订阅和 Skill 地址；详见 [Tflip 命名统一](docs/TFLIP_UPDATE.md)。

## 0.2.1 — 双镜头剪接修正

- 置顶演示恢复两套原场景：完整 8 秒 U/C 型跑道动作后，直接切换到完整 5.8 秒越车动作，总长 13.8 秒。
- 共用播放时间轴，各镜头保留独立构图、相机和本地运动；支持跨切点正反向 seek。
- 更新双语页面、Agent recipe、资源清单与切镜测试；保留旧下载和接入名称，未新增依赖或发布 npm。
- 详情见 [双镜头更新说明](docs/TWO_SHOT_UPDATE.md)。

## 0.2.0 — Tflip 本地预览

- 产品统一命名为 Tflip，包名为 `@tflip/motion`；继续保留 private / UNLICENSED，未发布到 npm。
- 将跑道翻转与飞越汽车合并为一段连续的 Stunt，使用同一时间轴；正式 Demo 数量调整为 8。
- 更新 Agent recipe、配置契约、可移植示例、类型与分发文件；所有资料保持相对地址。
- 旧 Roadster / Ramp 配置 ID、recipe 与 mount 函数明确映射到 Stunt；旧 Skill 链接和已生成 v0.1 下载文件保留。
- 升级说明与本轮验证边界见 [Tflip 更新说明](docs/TFLIP_UPDATE.md)。

## 0.1.0 — 本地候选版本

- 从独立 Canvas 演示衍生框架无关 TypeScript 组件；原演示完整保留。
- 提供 core/dom/effects/react 导入入口、声明类型、确定性数学采样与预设。
- 支持轴向/圈数/方向/高度/深度/路径/回弹/阶段比例与完整播放控制。
- 增加顺序编排、重复触发策略、SSR 安全导入、减少动态效果及资源清理。
- 提供 React 适配、原生示例和中文参数 Playground。
- 提供单元、生命周期、浏览器测试及本地 npm 归档；未对外发布。
