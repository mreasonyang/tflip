# API 参数参考

轨迹、DOM 与生命周期类型位于 `src/types.ts`，发布包中对应 `dist/types.d.ts`；粒子配置 `ParticleOptions` / `ParticleEmitter` 从 `effects` 入口导出，源文件为 `src/effects/index.ts`。单位：时间为毫秒，x/y/z/height/depth 为 CSS 像素，旋转为度。

## 轨迹

| 参数 | 默认 | 范围/含义 |
| --- | --- | --- |
| `preset` | `launch` | `launch / gentle / snappy / float` |
| `from` / `to` | 原点/起点 | core 用 Point；DOM 可用 Element |
| `height` | 160（launch） | 非负有限数，基线上方的起跳高度 |
| `turns` | 1 | 非负有限数，允许小数 |
| `direction` | 1 | 1 / -1 |
| `axis` | x | x / y / z |
| `duration` | 3600（launch） | 正有限数 |
| `bounce` | 0.14（launch） | 0..1，落地回弹强度 |
| `depth` | 40（launch） | 有限数，飞行中的 z 偏移 |
| `path` | `[]` | 中间绝对坐标，不含起终点 |
| `pathMode` | smooth | linear / smooth |
| `phases` | 0.55 / 0.60 / 1.15 / 0.70 / 0.60 | 蓄力/起跳/翻滚/下降/缓冲的相对权重；总和归一化 |

`normalizeOptions(options)` 会复制、校验并冻结结果，不修改输入。`sample(timeMs, options)` 与别名 `stateAt` 返回确定的 `Pose`；时间钳制到起终点。可重复调用来实现自有渲染器或进度预览，采样不读取 DOM 或时钟。

`Pose` 包含 `x/y/z`、`rotateX/Y/Z`、`scaleX/Y`、`progress`、`phase`、`thrust`、`shadowScale`、`shadowOpacity`。中间路径线段按相等参数区间分配，并对整体飞行缓动；不是速度恒定的物理仿真。

## DOM 扩展参数

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `element` | 无 | 专用运动包裹层；原地模式必需 |
| `mode` | 有 visual 时 transfer，否则 in-place | 可显式指定 |
| `visual` | 无 | 返回全新未挂载 HTMLElement 的工厂；transfer 必需 |
| `size` | 起点元素尺寸，或 220×140 | 替身宽高，均需大于 0 |
| `speed` | 1 | 正有限倍率 |
| `autoplay` | true | false 创建暂停的播放，可先 seek |
| `repeat` | replace | replace / ignore / queue |
| `layout` | cancel | cancel / freeze / follow |
| `reducedMotion` | system | system / always / never |
| `perspective` | 900 | 正有限像素距离 |
| `shadow` | false | 可选地面阴影 |
| `backface` | visible | visible / hidden；自定义背面可由 visual 内部 DOM 构造 |
| `effects` | 无 | 一个或多个 EffectFactory，主体不强制引入 Canvas |
| `signal` | 无 | AbortSignal；中止会取消该次播放 |
| `onStart/Land/Finish/Cancel/Update` | 无 | 生命周期回调 |

事件对象：`{ type, playback, progress, pose, result? }`。`result` 仅在 finish/cancel 中提供。进度定位本身只发 update；完成路径会保证落地事件先于完成事件且每次播放最多一次。取消不发完成事件。回调可暂停、取消或发起新播放。

状态为 `queued / running / paused / finished / cancelled`。排队中的暂停操作决定轮到该项时是否自动运行。已结束的控制对象不复活；调用 `replay()` 获取新对象。

`replay()` 强制使用 replace，即使最初配置为 ignore，也一定得到新的对象与 Promise。

`cancel` 的常见原因：`user`、`replaced`、`disposed`、`detached`、`layout`、`aborted`、`error`；也可传自定义字符串。运行异常放在结果的 `error` 字段；该对象可能不是可序列化值，业务日志需自行处理。

## 可选效果接口

```ts
type EffectFactory = (context: {
  container: HTMLElement;
  document: Document;
  width: number;
  height: number;
}) => {
  render(frame: EffectFrame): void;
  dispose(): void;
};
```

`EffectFrame` 提供 `pose / time / delta / duration / progress / reducedMotion`，以及可选历史采样函数 `sample(timeMs)`。效果应使用该时间轴，不启动独立循环；`dispose` 应幂等。内建粒子采用种子随机，倒放定位与重播能重现相同粒子分布。

### 内建喷气与拖尾

`createParticles(options)` 返回可传入 `play({ effects })` 的工厂。主体不默认安装效果；调用该工厂后，喷气与拖尾默认都开启。

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `jet` | true | 显示喷口短喷流、白色核心及历史喷气粒子 |
| `trail` | true | 显示沿历史轨迹分布的尾迹粒子，可独立于 jet 开关 |
| `density` | 1 | 0..4 的有限数，调节粒子发射密度；0 完全关闭效果 |
| `intensity` | 1 | 0..4 的有限数，调节喷流亮度与长度；0 完全关闭效果 |
| `color` | `#7c8cff` | 非空 CSS 颜色，可选蓝色、白色冷气等；不限于橙色火焰 |
| `seed` | 1 | 安全整数，决定可复现的粒子分布 |
| `emitter.offset` | `{ x: 0, y: 48 }` | 喷口相对主体中心的 CSS 像素偏移，x/y 必须有限；建议根据主体实际宽高设置在边缘 |
| `emitter.direction` | `{ x: 0, y: 1 }` | 排气方向，x/y 必须有限且不能同时为 0；工厂自动归一化 |
| `emitter.rotate` | false | true 时，喷口及方向随 pose 的 X/Y/Z 旋转，偏移同时跟随 scaleX/scaleY |
| `clip` | 无 | 同一 Document 中有定位上下文的 HTMLElement；将 Canvas 挂在它内部并限制画布尺寸 |

```ts
import { play } from '@tflip/motion/dom';
import { createParticles } from '@tflip/motion/effects';

// stage 需由应用设置 position: relative；motionWrapper 是独立运动包裹层。
const size = motionWrapper.getBoundingClientRect();
const playback = play({
  element: motionWrapper,
  reducedMotion: 'system',
  effects: createParticles({
    jet: true,
    trail: true,
    color: '#eef7ff',
    density: 1.2,
    intensity: 1.5,
    emitter: {
      offset: { x: 0, y: size.height / 2 + 6 },
      direction: { x: 0, y: 1 },
      rotate: true,
    },
    clip: stage,
  }),
});
```

不传 `clip` 时，Canvas 使用固定定位覆盖视口。传入 `clip` 后，Canvas 使用局部绝对定位，位图尺寸取该元素当前矩形；pose 和历史 sample 仍使用视口坐标。效果每帧重新读取裁切元素的位置，再转换坐标，因此容器移动后喷口不会使用旧偏移。局部画布 `z-index` 为 4，应用可把运动主体放在更高的层级，保留喷流从主体边缘露出的效果。工厂不会修改宿主的定位样式。

喷流直接使用当前 `pose.thrust`、位置、旋转与 `time`；尾迹使用历史采样。两者共用播放时间轴，不另开 RAF 或 CSS 动画，所以暂停会冻结，seek/重播可复现。Canvas 的 DPR 上限为 2，`dispose()` 会移除节点并释放位图。`jet=false, trail=false`、`density=0` 或 `intensity=0` 都不会创建 Canvas；仅 `jet=false` 仍可保留拖尾。

默认 `reducedMotion: 'system'` 尊重系统减少动态效果设置：DOM 播放器跳过动态呈现；若自定义渲染器传入 `frame.reducedMotion=true`，粒子实例会清空已有画面并停止采样和绘制。无需为了显示喷气而覆盖为 `never`。关闭正在播放的效果时，调用方应先清理原 playback，再以新效果配置创建播放；工厂配置不是响应式状态。

## 序列

`sequence(steps: readonly MotionOptions[])` 返回 Sequence，提供与 Playback 相同的控制和整体进度；`replay()` 返回新 Sequence。步骤顺序执行，取消阻止后续步骤。跨步骤 seek 会清理当前步骤，跳过的步骤不执行其生命周期。逐步骤回调和序列 `on()` 订阅是两个层级，具体边界见验证记录与测试。

显式取消序列会通知当前步骤的 onCancel；内部跨步定位的取消不触发被跳过步骤的取消回调。ignore 步骤加入已有播放，保留其当前进度并共享控制，使用该播放实际时长；这可能更新序列 duration。序列重播强制 replace。第一步的 autoplay 控制整体初始播放状态，后续步骤受序列控制；步骤速度影响实际耗时，但不改变其标称时间轴占比。后续步骤的 DOM/visual 校验在进入时进行，失败将序列解析为 cancelled/error。

## Lifecycle edge cases

During ordinary playback, `onLand` may pause or seek and the controller respects that operation before finishing, including after seeking to the endpoint and resuming. System reduced-motion activation is different: it completes immediately at progress 1, while explicit cancellation still wins. Element anchors are observed while queued as well as active; disconnecting an anchor cancels at the next MutationObserver delivery. Invalid AbortSignal inputs fail synchronously before animation scheduling or registry replacement.
