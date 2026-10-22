# Tflip 0.3.0 全面命名统一

0.3.0 将项目名称统一为 Tflip，包名为 `@tflip/motion`，站点为 https://tflip.kyun.si 。0.3.2 起，npm 安装名是 `@kyun.si/tflip`。下表是 0.3.0 发布时的名称。

## 0.3.0 当时的名称

| 范围 | 名称 |
| --- | --- |
| 产品与项目目录 | Tflip / `tflip` |
| TypeScript 包 | `@tflip/motion@0.3.0` |
| DOM 属性 | `data-tflip-overlay`、`data-tflip-shadow`、`data-tflip-wrapper`、`data-tflip-particles` |
| CSS 场景高度 | `--tflip-scene-height` |
| 语言与主题事件 | `tflip:languagechange`、`tflip:themechange` |
| 手动偏好 | `tflip.language`、`tflip.theme` |
| Skill | `agent/tflip/SKILL.md` |
| 下载 | `tflip-motion-0.3.0.tgz`、`tflip-examples-0.3.0.zip`、`tflip-skill-0.3.0.zip` |

旧品牌的兼容属性、CSS fallback、事件、偏好读取、Skill 和下载入口已从当前源码及分发移除。升级时同步更新宿主的自定义选择器、事件订阅和资源地址。当前 Tflip 偏好继续保留；仅存在于更早品牌键中的偏好会回到跟随系统。

版本升为 0.3.0，明确记录兼容接口的移除。SDK 函数签名、8 个 Demo、镜头内容和 13.8 秒时序保持现有行为。Roadster / Ramp 是场景名称，其既有映射继续保留。

## 验证边界

历史版本的测试结果不自动适用于当前版本。当前支持范围与可重复检查见 [验证说明](VERIFICATION.md)。
