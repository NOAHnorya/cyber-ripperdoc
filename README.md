# 赛博义体诊所 · CYBER RIPPERDOC

网页 3D 小游戏。玩家是赛博都市下城区的地下义体医生，每晚接待 2–3 位客人。每台手术亲手做完"切开、拆除、对位、接线、缝合"五步，赚钱升级诊所。病人、义体和道具都由 Hi3D 生成。

**在线试玩：<https://noahnorya.github.io/cyber-ripperdoc/>**（桌面 Chrome / Edge，需要声音，首次加载约 25 MB）

技术要点：Three.js 着色器切割一整块 AI 网格 · Mixamo 动捕按骨骼名重定向给五个人物 · 义体运行时按关节自动蒙皮 · MOSS 语音模型按人设设计音色 · Web Audio 程序化音乐与全部音效 · 数据驱动的随机事件。

## 运行

```bash
npm install
npm run dev          # 打开终端里显示的地址
npm test             # 纯逻辑单元测试（经济、评分、接线、夜晚、升级、存档）
npm run build        # 打包到 dist/
```

调试参数（加在网址后面）：

| 参数 | 作用 |
| --- | --- |
| `?auto` | 自动演示：对话、选件、五步手术全部自动完成，用来快速走完整个流程 |
| `?night=3` | 从第 3 晚开始 |
| `?money=9999` | 开局给钱，方便测试升级 |

标定工具：开发服务器下打开 `/calibrate.html`。

## 资产怎么接进来

游戏只读 `src/data/*.json` 里的路径，不写死文件名。Hi3D 的 GLB 放进 `public/models/` 后刷新就会替换占位模型，代码不用改。文件还没生成时，游戏自动用同尺寸、同原点的占位模型，所以随时都能完整玩一遍。

| 文件 | 谁维护 | 说明 |
| --- | --- | --- |
| `src/data/implants.json`、`patients.json`、`props.json` | Codex（资产） | 路径、尺寸、面数；义体的数值也在这里 |
| `src/data/customers.json` | 游戏 | 客人台词、预算、神经容量、最佳方案 |
| `src/data/nights.json` | 游戏 | 每晚来哪些客人，`revisit:<id>` 是回访 |
| `src/data/upgrades.json` | 游戏 | 6 项升级及每级效果（`mvp: false` 是加分项） |
| `src/data/balance.json` | 游戏 | 所有数值：起始资金、房租、质量倍率、扣时、排异率 |
| `src/data/slots.json` | 游戏 | 四个部位的手术参数：切口、拆除手感、对位轴数、针数、节拍 |
| `src/data/calibration/*.json` | 标定工具 | 每个病人的切割框和接口位置、每个义体的偏移 |

资产约定（与《3D 美术资产交接》一致）：单位米，+Y 朝上，正面朝 +Z。义体原点在接口中心，四肢沿 -Y 垂下，缺口朝 +Z。病人身高 1.75 m，脚底在 y = 0，A 字站姿。病人自己的左侧是 +X。

## 代码结构

```
src/
  main.js                 启动
  game/Game.js            组装各模块、主循环、输入、读数据和标定
  game/flow.js            流程：标题 → 三晚（接诊 → 选件 → 手术 → 结算 → 打烊升级）→ 结局；回访
  surgery/SurgerySession  一台手术：依次跑五步，管麻醉条、心率、失误扣时、评分
  surgery/*Step.js        五个步骤，接口统一：start() 返回分数 Promise，另有 update/draw/指针/键盘/auto/dispose
  surgery/paths.js        切口路径（切开和缝合共用）
  systems/                纯逻辑，可单测：economy、scoring、pathMath、wiring、nights、upgrades
  core/                   存档、事件、随机数、合成音效
  render/Renderer.js      渲染器 + 后期（辉光、胶片颗粒、色差、扫描线）
  render/Clinic.js        诊所场景、灯光、窗外雨夜和轻轨扫光、道具摆放、升级后的场景变化
  render/PatientRig.js    病人：加载、按部位切开、旧部件、挂义体、走进走出
  render/materials.js     切割着色器、义体霓虹发光、全息材质
  render/placeholders.js  占位模型（病人、义体、道具）
  render/CameraDirector   镜头：全景、部位特写、拆除视角
  render/Overlay.js       2D 叠加层：切口虚线、节拍圈、激光点
  ui/                     HTML 界面和样式
  tools/calibrate.js      标定工具
```

### 关键技术：在静态 AI 模型上切开

Hi3D 输出的是一整块静态网格。手臂和腿的手术里，同一个病人模型渲染两份：身体那份丢弃切割框内的像素，肢体那份只保留框内的像素（`materials.js` 里用 `onBeforeCompile` 注入）。判断用的是各自根节点的局部坐标，所以拖走肢体时，它的可见部分会跟着走。切口处露出的模型背面着色成发光的橙色，看起来像激光烧灼面，也不血腥。

眼睛和面部不切真实的脸，改成先取下一个"旧镜片 / 旧面罩"，再装义体。

### 换成真模型后要做的事

1. 打开 `/calibrate.html`，逐个病人检查四个部位：橙色框要只罩住要切的肢体，不能罩到躯干；坐标轴原点放在切口中心。
2. 选一个义体预览，如果装上去方向或位置不对，切到"调义体偏移"微调，然后点"保存义体偏移"。
3. 点"保存病人标定"，会生成 `src/data/calibration/patient_<id>.json`，游戏刷新后自动使用。

## 已知的后续工作

- 回访只做了阿强；P1 客人（老陈、私家侦探、黑衣客）和 4 款干扰项义体加进 JSON 就能用，部位已经都支持。
- 缝合的节拍目前用合成节拍声，可以换成一首约 100 BPM 的音乐。
- 移动端只保证能打开，操作按鼠标设计。
