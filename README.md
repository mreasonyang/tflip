# Tflip

框架无关的翻滚、起跳与落地动效。以 TypeScript 编写，提供纯轨迹计算、CSS 3D 呈现、可选 Canvas 粒子和 React 薄适配。

当前版本为 **0.3.2**，项目目录为 `tflip/`。在线演示：https://tflip.kyun.si 。命名与升级说明见 [Tflip 全面命名统一](docs/TFLIP_UPDATE.md)。

这是独立组件实现。本项目的动画完成只表示视觉生命周期结束，不代表业务任务成功。

## 安装

npm 包名为 `@kyun.si/tflip`。版本发布到 npm 后，在自己的项目中运行：

```sh
npm install @kyun.si/tflip
```

```ts
import { play } from '@kyun.si/tflip';
```

当前 0.3.2 尚待 npm 账号授权后发布，不能把本地打包成功当作 npm 已上线。现在也可下载 catalog 中的 SDK，运行 `npm install --ignore-scripts ./kyun.si-tflip-0.3.2.tgz`；安装后的导入名相同。React 入口为 `@kyun.si/tflip/react`，无需单独安装另一个 Tflip 包。

## 本地运行

源码开发需要 Node.js 22.22.2+（22.x）、24.15.0+（24.x）或 26+；推荐使用 `.node-version` 指定的 26.11.0。SDK 消费者要求与开发工具链分开，见 [SDK 接入说明](docs/SDK_README.md)。依赖已安装时直接运行：

```sh
npm run build:agent
npm run dev
```

使用开发服务器输出的访问地址，打开其 `playground/` 页面。Playground 包含原地/跨区域运动、参数调节、可编辑路径点、序列示例、时间定位、事件记录与配置复制。页面不加载 CDN、外部图片或业务后端。

首次在另一台机器使用，先运行 `npm ci --ignore-scripts`。浏览器回归需要 Brave，以及 `npx --no-install playwright install webkit` 安装的匹配 WebKit。验证和本地打包：

```sh
npm test
npm run test:browser  # 全部当前浏览器专项；Brave 与 Playwright WebKit
npm run pack:local
```

## 给 Agent 接入

页面的“让 Agent 接入”支持选择 Demo、复制当前配置的指令和下载 JSON。Agent 可直接从 [短入口](agent/index.md) 发现所选 recipe、带校验值的 SDK / 示例 / skill 包；[接入说明](docs/AGENT_INTEGRATION.md) 记录结构和验证方式。

资料链接使用相对路径，复制指令按当前访问地址生成，保留任意部署子目录。`npm run build:agent` 生成静态资料及归档，`npm run preview:sync` 同步到已有静态预览目录，均不配置域名、IP 或网络服务。Skill 包供用户在支持 Agent Skills 的客户端自行加载；本项目不会自动安装到全局目录。

浏览器测试需要本机 Brave 和 Playwright WebKit；可通过测试脚本支持的浏览器路径环境变量 指定路径，详见 [验证说明](docs/VERIFICATION.md)。

当前提供 8 个 Demo：Lab、六个创意场景和双镜头 Stunt。Stunt 先完整播放 8 秒 U 型跑道翻滚镜头，再直接切到完整的 5.8 秒飞越汽车镜头；两套场景保留各自构图、相机与动作，共用一条 13.8 秒播放进度。Roadster / Ramp 场景别名继续映射到整段 Stunt。当前说明见 [双镜头说明](docs/TWO_SHOT_UPDATE.md)。

## 包结构

| 入口 | 内容 | 浏览器依赖 |
| --- | --- | --- |
| `@kyun.si/tflip/core` | `normalizeOptions`、`sample` / `stateAt`、`presets` | 无，纯数学、可在服务端调用 |
| `@kyun.si/tflip/dom` | `play`、`createAnimator`、`sequence`、`wrap` | 调用时需要 DOM；导入安全 |
| `@kyun.si/tflip/effects` | `createParticles` | 创建效果实例时需要 Canvas 2D |
| `@kyun.si/tflip/react` | `Motion`、`useMotion` | 可选 React peer，SSR 可导入和渲染 |
| `@kyun.si/tflip` | core + dom + 公共类型 | 导入安全，不自动包含粒子或 React |

发布格式为 ESM，随包提供 `.d.ts`。浏览器运行时不依赖第三方动画库；React 仅在使用 React 入口时需要。

`@kyun.si/tflip@0.3.2` 使用 [MIT 许可证](LICENSE)，可按许可条款修改、商用和分发。`npm run pack:local` 生成与网站相同字节的规范 SDK；`npm run publish:npm` 将该归档公开发布到 npm。开发仓库的 `private: true` 防止直接误发源码，生成的 SDK 不含该限制。SDK、示例和 Skill 均携带许可证；参考视频和第三方品牌不属于本项目许可范围。

## 原地运动：保持业务元素的 transform

包裹层专门负责运动，内部业务元素保持自己的样式与节点归属。

```html
<div id="motion-wrapper"><button id="business-button">运行任务</button></div>
```

```ts
import { play } from '@kyun.si/tflip/dom';

const playback = play({
  element: document.querySelector<HTMLElement>('#motion-wrapper')!,
  preset: 'launch',
  height: 160,
  turns: 1,
  direction: 1,
  duration: 2400,
  onLand: () => console.log('视觉已落地'),
});

playback.pause();
playback.seek(0.5);             // 0..1
playback.setSpeed(0.35);
playback.resume();
const result = await playback.finished;
if (result.status === 'cancelled') console.log(result.reason);
```

`element` 必须是专门的运动包裹层。运行期间库管理该层的 transform、transform-origin、transform-style、backface-visibility、will-change；完成或取消时恢复原值。内部元素不被 reparent，不覆盖其 transform。

原生 DOM 项目也可显式调用 `wrap(businessElement)`，获得 `{ element, dispose }`；它会把元素放进新包裹层，并在 `dispose()` 时还原。框架项目应由框架渲染包裹层。额外包裹层会影响 flex/grid/选择器布局，因此需要在业务布局中明确安排其尺寸与位置。

## 跨区域：提供临时视觉内容

```ts
import { play } from '@kyun.si/tflip/dom';
import { createParticles } from '@kyun.si/tflip/effects';

const playback = play({
  from: document.querySelector('#ready')!,
  to: document.querySelector('#running')!,
  visual: () => {
    const card = document.createElement('div');
    card.textContent = '任务 001';
    card.className = 'flight-card';
    return card;
  },
  size: { width: 220, height: 140 },
  height: 180,
  axis: 'x',
  direction: -1,
  turns: 2,
  effects: createParticles({ jet: true, trail: true, seed: 42, color: '#ef6136' }),
  shadow: true,
});
```

工厂必须返回一个全新、未挂载、属于同一 Document 的 HTMLElement。内容是装饰性视觉替身，会放入不接收指针/焦点的 `aria-hidden` / `inert` 覆盖层。库不克隆任意交互内容、不移动业务源节点，也不自动隐藏它。业务决定何时显示目标内容、隐藏源内容或改变任务状态。临时视觉内容在完成或取消时移除。

元素锚点取边界框中心；坐标锚点为视口像素，如 `{ x: 120, y: 300 }`。未指定 `to` 时原地翻滚。`z`、高度、路径点都以像素表达，不是原演示界面中的米。

## 播放控制与生命周期

`play()` 同步返回控制对象，初始启动在微任务执行，允许调用方先注册事件。属性包括 `status`、`currentTime`、`duration`、`progress`、`finished`。

| 方法 | 语义 |
| --- | --- |
| `pause()` / `resume()` | 冻结/继续动画时间，粒子使用相同时间轴 |
| `seek(progress)` | 定位 0..1，越界钳制；本身不完成播放，不单独触发落地事件 |
| `setSpeed(speed)` | 正有限数；1 为正常，0.35 为慢放 |
| `cancel(reason?)` | 清理并将 `finished` 解析为取消结果 |
| `dispose()` | 以 `disposed` 原因取消 |
| `replay()` | 强制 replace 策略，返回全新的控制对象和完成 Promise；旧 Promise 不改变 |
| `on(type, listener)` | 订阅 `start/land/finish/cancel/update`，返回取消订阅函数 |

`finished` 正常解析为 `{ status: 'finished' }` 或 `{ status: 'cancelled', reason, error? }`。输入校验失败同步抛错；运行中效果或回调异常导致取消结果。完成/取消的资源清理先于 Promise 处理函数执行。不要把取消当成未处理的 Promise rejection。

同一包裹层或同一源元素共享重复触发策略：`replace`（默认，取消旧播放和旧排队项）、`ignore`（返回现有控制对象）、`queue`（返回排队中的独立对象）。只有纯坐标锚点时没有共享元素键，各次调用互相独立。可使用 `createAnimator(defaults)` 统一持有一组运行，通过 `cancel()` / `dispose()` 清理。

## 路径、阶段与编排

`path` 是不含起终点的绝对视口坐标数组。`pathMode: 'linear' | 'smooth'` 选择折线或 Catmull–Rom 平滑路径；平滑曲线可能越过途经点边界，参数分段不等同于等弧长匀速运动。`height` 与 `depth` 会叠加在该基线路径之上。

`phases` 可设置 `anticipation/launch/roll/descent/settle` 的相对权重；未指定项沿用预设值，最终统一归一化。允许单个阶段为 0，但飞行阶段之和必须大于 0。`bounce` 范围为 0..1。`turns` 可为非负小数，`direction` 为 1 或 -1，`axis` 为 x/y/z。完成时包裹层恢复初始样式，因此半圈等非整圈姿态不会永久写入业务节点。

```ts
import { sequence } from '@kyun.si/tflip/dom';

const timeline = sequence([
  { element: wrapper, preset: 'snappy', axis: 'x' },
  { element: wrapper, preset: 'gentle', axis: 'y', direction: -1 },
]);
timeline.pause();
timeline.seek(0.65); // 整个序列的归一化进度
timeline.resume();
await timeline.finished;
```

序列按顺序创建步骤；定位到另一步会取消并清理当前步骤，再以暂停状态构建目标步骤并定位，随后恢复原播放状态。被跳过的步骤不触发其开始或完成回调。序列取消后不再启动后续步骤。每一步仍是独立视觉，跨区域接力可把上一目标作为下一起点。

序列步骤若采用 `repeat: 'ignore'`，会加入已有播放、保留其进度并共享控制；采用该播放的实际时长，因此后续步骤开始时序列总时长可能更新。需要独立控制时使用 replace 或 queue。轨迹参数立即校验，后续步骤的 DOM 和视觉工厂在进入该步骤时校验。序列重播也强制 replace，保证新对象与新 Promise。

## React

```tsx
import { useRef } from 'react';
import { Motion, useMotion } from '@kyun.si/tflip/react';

export function TaskButton() {
  const ref = useRef<HTMLDivElement>(null);
  const motion = useMotion(ref, { preset: 'snappy', height: 100 });
  return <Motion ref={ref} style={{ display: 'inline-block' }}>
    <button onClick={() => motion.play()}>翻滚</button>
  </Motion>;
}
```

`Motion` 是透传 div 属性与 ref 的专用包裹层；`useMotion` 返回稳定的 `play`、`cancel` 与 `playback` ref。默认参数变化只影响下一次播放；更新 playback ref 不触发 React 重渲染。卸载时取消该 hook 拥有的活动、排队和重播控制对象，抑制其 hook 托管回调。服务端可导入/渲染，在客户端挂载后再调用播放。完整示例见 [examples/react.tsx](examples/react.tsx)。

## 环境策略

- `reducedMotion: 'system'` 为默认值。系统要求减少动态效果时直接完成，无运动或粒子；`always` 强制该行为，`never` 显式关闭。运行时偏好变化为 reduce 会立即结束。业务应为用户保留尊重系统偏好的默认选项。
- `layout: 'cancel'` 默认在滚动或尺寸变化时取消；`freeze` 保持启动时测量坐标；`follow` 重新测量元素锚点。坐标锚点是视口绝对值，不随文档滚动。复杂变换父层/缩放布局需业务验证。
- 源/目标或包裹层脱离 DOM 会取消。取消/卸载后清理 rAF、监听器、Observer、Canvas 和临时节点。
- 页面隐藏期间暂停时间推进，重新可见后继续；手动暂停不被自动覆盖。
- 装饰替身不抢焦点；业务真实控件、可访问名称和业务完成提示由应用负责。
- CSS 3D 需要浏览器支持。父级 overflow、filter、opacity 或变换可能影响 3D 与叠层；应使用专用包裹层，并按目标页面实测。浏览器验证覆盖范围见 [验证记录](docs/VERIFICATION.md)，不将 WebKit 自动化等同于所有 Safari/iOS 版本已验收。

## 更多资料

- [完整参数与接口](docs/API.md)
- [验证与已知边界](docs/VERIFICATION.md)
- [变更记录](CHANGELOG.md)
- [原生接入示例](examples/vanilla.html)

设计参考：[React effect 清理](https://react.dev/reference/react/useEffect)、[CSS transform-style](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/transform-style)、[TypeScript 模块解析](https://www.typescriptlang.org/tsconfig/moduleResolution.html)。本组件使用自有 rAF 时间轴，`finished` 的取消结果是本组件的 API 契约。

## 发布与反馈

[GitHub 源码与问题反馈](https://github.com/mreasonyang/tflip) · [发布和回滚](docs/RELEASING.md) · [支持范围与验收](docs/VERIFICATION.md)

公开演示可直接使用。宿主页面的布局、业务状态与清理仍须按接入指南验证；当前验收不等同于所有浏览器、所有手机和所有宿主框架均已通过。
