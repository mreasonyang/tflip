# 发布与回滚

源码、SDK 和网站分别校验，所有结果绑定同一个 Git revision。当前由 GitHub 保存源码，Cloudflare Pages 托管 `tflip.kyun.si`；npm 发布保持关闭。

## 生成候选版本

1. 使用 `.node-version` 中的 Node，运行 `npm ci --ignore-scripts`。安装 Brave 和匹配当前 Playwright 的 WebKit：`npx --no-install playwright install webkit`。Linux CI 使用官方 Brave 软件源及 Playwright `--with-deps`。
2. 更新 `package.json`、lockfile、配置 schema/迁移清单、当前接入示例与 CHANGELOG；历史版本说明和历史回执不改写。许可证必须进入 SDK、示例和 Skill。
3. 执行 `npm run test:all`。该命令包含单元、类型、网页生成代码、归档、当前全部浏览器专项及独立安装 SDK 的 Vanilla/React 宿主测试。`TFLIP_TEST_ENGINES=brave` 或 `webkit` 可单独定位失败；单引擎通过不等于完整发布通过。
4. 提交通过的源码，确认工作树没有未提交的发布输入变化。运行 `npm run preview:sync`、`npm run pack:local`、`node scripts/release-artifacts.mjs`。也可使用 `npm run release:prepare` 完整重验并打包。
5. 保存 `release-artifacts/` 内的三份消费者归档、站点 ZIP 与 manifest。manifest 中版本、Git SHA、内容 revision、文件 SHA-256 必须与本次测试对应。网站 SDK 与根目录 `pack:local` 必须字节一致。

`npm pack` 直接作用于开发仓库不是受支持的消费者交付方式；统一使用 `npm run pack:local`。发布目录由干净 staging 生成；不要向其中混入源码、参考视频、秘密、运行日志或历史下载。

## 发布检查

- GitHub Actions 必须通过；它在声明的开发 Node 版本上跑单元/类型检查，并分别跑 Brave、WebKit，再生成候选包。
- 把本次 manifest 对应的站点 ZIP 上传到现有 Cloudflare Pages 项目 `tflip`。部署完成后记录部署 ID 与 Git SHA。
- 对公开 HTTPS 根路径、catalog、SDK、示例、Skill、LICENSE 做读回；版本和归档哈希必须匹配。访问不存在的下载路径必须返回 404，不能返回成功状态的 HTML。
- 在公开域名检查播放、暂停、取消、生成代码与 Agent 指令。浏览器控制台无错误；线上验收不能由本地截图替代。
- 仅在相应结果可证实时发布 release notes；保留真实设备、浏览器版本和宿主环境的验收边界。当前不自动发 npm，也不自动创建访问凭据或修改 DNS。

## 回滚

1. 在 Pages 的 `tflip` 部署历史中选择上一个已验收的生产 deployment，使用该 deployment 的 rollback 操作；或重新上传其完整站点 ZIP。不要把旧 SDK 与新 catalog 混用。
2. 重新核验根路径、catalog、三个归档的 SHA-256、404，以及一次真实播放/取消。
3. 在发布记录中保留被回滚版本、原因、恢复的 deployment/Git SHA。源码用新的修复提交继续，不重写已对外发布的版本或历史证据。

旧下载 URL 的退休是显式行为。需要继续服务历史 SDK 时，应使用受维护的版本存储和对应校验清单，不依赖部署目录里残留的文件。
