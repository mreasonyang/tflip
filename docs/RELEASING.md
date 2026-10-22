# 发布与回滚

源码、SDK 和网站分别校验，所有结果绑定同一个 Git revision。当前由 GitHub 保存源码，Cloudflare Pages 托管 `tflip.kyun.si`；npm 包名为 `@kyun.si/tflip`，由拥有 `kyun.si` scope 发布权限的账号公开发布。

## 生成候选版本

1. 使用 `.node-version` 中的 Node，运行 `npm ci --ignore-scripts`。安装 Brave 和匹配当前 Playwright 的 WebKit：`npx --no-install playwright install webkit`。Linux CI 使用官方 Brave 软件源及 Playwright `--with-deps`。
2. 更新 `package.json`、lockfile、配置 schema/迁移清单、当前接入示例与 CHANGELOG；历史版本说明和历史回执不改写。许可证必须进入 SDK、示例和 Skill。
3. 执行 `npm run test:all`。该命令包含单元、类型、网页生成代码、归档、当前全部浏览器专项及独立安装 SDK 的 Vanilla/React 宿主测试。`TFLIP_TEST_ENGINES=brave` 或 `webkit` 可单独定位失败；单引擎通过不等于完整发布通过。
4. 提交通过的源码，确认工作树没有未提交的发布输入变化。运行 `npm run preview:sync`、`npm run pack:local`、`node scripts/release-artifacts.mjs`。也可使用 `npm run release:prepare` 完整重验并打包。
5. 保存 `release-artifacts/` 内的三份消费者归档、站点 ZIP 与 manifest。manifest 中版本、Git SHA、内容 revision、文件 SHA-256 必须与本次测试对应。网站 SDK 与根目录 `pack:local` 必须字节一致。

`npm pack` 直接作用于开发仓库不是受支持的消费者交付方式；统一使用 `npm run pack:local`。发布目录由干净 staging 生成；不要向其中混入源码、参考视频、秘密、运行日志或历史下载。

## npm 发布

SDK 的 `publishConfig` 指定 npm 官方 registry 与 `access: public`，不含 `private`、开发依赖或生命周期脚本。开发仓库保留 `private: true`，防止把源码目录作为另一份包直接发布。

准备并验证规范 SDK 后，执行：

```sh
npm run publish:npm -- --dry-run
npm login
npm run publish:npm
```

预演不会上传。正式发布要求已登录账号拥有 `kyun.si` scope 的发布权限；登录和二次验证在 npm 自己的流程中完成。发布脚本先核对 catalog 中的包名、版本、文件名、字节数与 SHA-256，再发布同一归档，不重新打包开发目录。

发布后通过 `npm view @kyun.si/tflip@0.3.2 dist --json` 读取 registry 元数据，下载 registry tarball 并与规范 SDK 核对字节，独立运行 `npm install @kyun.si/tflip` 后检查实际安装的版本、五个导出入口、类型和 SSR。替换命令中的版本为本次版本。确认这些步骤后，把 registry、tarball URL、包名、版本、字节数、SHA-256、integrity、验证时间及源提交写入 `npm-publication.json`，并把同一份 registry tarball 保存到 `published-sdk/` 后提交。

重新构建时，逐文件比较新构建的 SDK 与冻结归档的解包内容；内容相同后使用已发布归档的精确字节，避免不同平台的 npm/tar 压缩差异。内容变化必须升级版本，不能覆盖已发布版本。回执、冻结归档及构建内容全部匹配时才设置 `package.published: true`，不会继承到新版本。没有匹配的 registry 证据时保持 `false`，不宣称 npm 已上线。

静态输出会根据全部输入文件和生成器源码计算 `assetRevision`，并为 HTML 入口、嵌套 ESM、CSS 及 JSON 的本地资源引用统一添加 `?v=`。源码及规范 SDK/示例/Skill 下载的 URL、归档字节不因此改变。manifest 分别记录输入哈希与最终输出哈希；资源变化后重新生成整份站点，避免只上传部分文件。

输出中的 `_headers` 使用单条全路径规则设置 `Cache-Control: no-cache, max-age=0, must-revalidate`，避免多个规则合并出冲突值。Cloudflare 将它作为部署配置解析，不公开为资源；HTTP 读回应跳过 manifest 中 `served: false` 的条目，其余文件继续按哈希核验。规则行为见 [Cloudflare Pages Headers](https://developers.cloudflare.com/pages/configuration/headers/)。发布时核对根路径、JS 和 catalog 的响应头，以及入口与嵌套资源中的 `v` 是否等于本次 `assetRevision`。

## 发布检查

- GitHub Actions 必须通过；它在声明的开发 Node 版本上跑单元/类型检查，并分别跑 Brave、WebKit，再生成候选包。
- 把本次 manifest 对应的站点 ZIP 上传到现有 Cloudflare Pages 项目 `tflip`。部署完成后记录部署 ID 与 Git SHA。
- 对公开 HTTPS 根路径、catalog、SDK、示例、Skill、LICENSE 做读回；版本和归档哈希必须匹配。访问不存在的下载路径必须返回 404，不能返回成功状态的 HTML。
- 在公开域名检查播放、暂停、取消、生成代码与 Agent 指令。浏览器控制台无错误；线上验收不能由本地截图替代。
- 仅在相应结果可证实时发布 release notes；保留真实设备、浏览器版本和宿主环境的验收边界。npm 发布单独执行，不自动创建访问凭据或修改 DNS。

## 回滚

1. 在 Pages 的 `tflip` 部署历史中选择上一个已验收的生产 deployment，使用该 deployment 的 rollback 操作；或重新上传其完整站点 ZIP。不要把旧 SDK 与新 catalog 混用。
2. 重新核验根路径、catalog、三个归档的 SHA-256、404，以及一次真实播放/取消。
3. 在发布记录中保留被回滚版本、原因、恢复的 deployment/Git SHA。源码用新的修复提交继续，不重写已对外发布的版本或历史证据。

旧下载 URL 的退休是显式行为。需要继续服务历史 SDK 时，应使用受维护的版本存储和对应校验清单，不依赖部署目录里残留的文件。
