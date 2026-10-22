# Tflip 0.3.1 验证与支持范围

验收对象是网站分发的精确 SDK/示例/Skill 字节及其对应源码 revision。历史 0.3.0 回执保留原样，不冒充本版本证据。

## 可重复检查

```sh
npm ci --ignore-scripts
npx --no-install playwright install webkit
npm run test:all
npm run preview:sync
npm run pack:local
node scripts/release-artifacts.mjs
```

Brave 必须已安装，或用 `BRAVE_EXECUTABLE` 指定；不存在时明确失败，不切换 Chrome。WebKit 由当前 Playwright 管理，也可用 `WEBKIT_EXECUTABLE` 显式指定。浏览器专项串行执行，避免互相争用端口/渲染资源。旧的独立 Roadster/Ramp 页面已被双镜头 Stunt 替代；其数值几何测试保留在 `ramp-motion.test.mjs`，当前界面由 Stunt/Agent 专项验证。

## 验收层级

- 单元与类型：轨迹、DOM 生命周期、回调重入、队列锚点脱离、signal 错误清理、React StrictMode/卸载、粒子、语言/主题与配置复制。
- 分发：版本/许可证/相对链接、三个归档完整性、同字节 SDK、干净部署输出与 404。
- 浏览器：Brave 与 Playwright WebKit；桌面及 390px 视口、控制/切镜/焦点/减少动态效果/清理，以及从真实 tarball 独立安装并打包的 Vanilla/React 宿主。
- 线上：公开 HTTPS、下载字节、404、UI 与部署 revision 单独读回。

## 支持边界

SDK 为浏览器 ESM，React 适配器声明支持 React 18/19，core 和 SSR 导入不需要 DOM。Node >=20 是 SDK 消费工具环境；开发工具链要求 Node `^22.22.2 || ^24.15.0 || >=26.0.0`。开发最低版本通过 CI 独立校验。

浏览器自动化覆盖的具体版本写入本次证据。WebKit 自动化、390px 视口和桌面帧耗时均不能证明真实 Safari/iPhone/Android 的性能、功耗和触控体验。真实设备尚未取得本次实测时，移动端仅为待验收，不宣传全机型兼容或固定帧率。Firefox、复杂缩放/变换父层、Shadow DOM 也不自动包含在通过范围。

首次接入应执行 [宿主验收](../agent/references/verification.md)，尤其是滚动/尺寸变化策略、业务元素归属、焦点和卸载清理。问题可提交到 [GitHub Issues](https://github.com/mreasonyang/tflip/issues)，附版本、浏览器、最小复现与脱敏日志，不上传凭据。

## 本次结果

2026-10-22，本机 Node 26.11.0 完成 173 项单元/类型/归档检查及 126 项浏览器检查，全部通过、零跳过。浏览器为 Brave Chromium 154.0.8037.98 和 Playwright WebKit 27.2。独立消费者安装、TypeScript、SSR 和两种浏览器宿主均通过，所测 SDK SHA-256 为 `5680a9afcd307a6ab270e33d54006429629545efb4040cfe5f0a4847734d9571`。

Linux 三个 Node 版本及浏览器矩阵结果由 [GitHub Actions](https://github.com/mreasonyang/tflip/actions) 记录；部署、线上字节与对应 Git SHA 由该版本发布回执记录。上述本地通过不替代 CI、线上或真实手机验收。发布步骤见 [RELEASING.md](RELEASING.md)。
