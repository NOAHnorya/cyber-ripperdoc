# 义体增补需求（给 Codex）

目标：每种手术部位再加 2 件义体，共 8 件，让玩家在货架上有"便宜货 / 正合适 / 超预算好货"的取舍。
全部走现有资产流水线，**不改渲染和手术代码**（`src/render/`、`src/surgery/` 正在被另一边改，别碰）。

截止：今天 06:30 前合入。先出模型质量过得去的，细节以后再磨。

## 1. 流水线（和上一轮完全一样）

1. 在 `tools/assets.json` 里加一条 spec（字段见下方表格和第 3 节），`meta` 里的字段会原样写进 `src/data/implants.json`。
2. 用 spec 里的 `prompt` 在 Hi3D 出 2 张候选图（1:1，白底产品图），存 `raw/images/<id>_a.png`、`<id>_b.png`；选一张做封面存 `raw/covers/<id>.image`；用选中的图做 3D，原始 GLB 存 `raw/models/<id>_raw.glb`。任务 id、积分记进 `raw/log.json`，和之前一样。
3. `tools/optimize.sh <id>`：归一化尺寸、挪原点、补法兰接口、压缩贴图、写缩略图，并**自动重写** `src/data/implants.json`（不要手改这个文件，改 `assets.json`）。
4. `node tools/validate.mjs` 必须全绿；`npm run build` 必须通过。
5. 在 `tools/viewer.html` 里看一眼接口朝向；再在游戏里（`npm run dev`，地址栏加 `?auto` 自动跑完三晚）看装上以后的样子。

Hi3D 的 key 和积分找 Noah 要；每件模型大约 45 积分、每张候选图 4 积分，8 件预计 ~430 积分。

## 2. 新增义体一览

价格、负荷是按现有客人的预算/神经容量设计的，别随意改：

| id | 名字 | slot | brand | price | load | difficulty | wires | wiringHidden | 定位 |
|---|---|---|---|---|---|---|---|---|---|
| `night_eye` | 夜视翻新眼 | eye | laozhou | 350 | 1 | 1 | 3 | false | 金牙（预算 1000）的便宜替代，装上他只会说"看得清，分不出真假" |
| `hawk_eye` | 鹰眼瞄准义眼 | eye | tianqiong | 1400 | 2 | 2 | 4 | false | 超出金牙预算的好货，看得见买不起 |
| `rebreather_jaw` | 滤毒呼吸下颌 | face | anvil | 900 | 1 | 1 | 3 | false | 莉莉（预算 2500）的廉价替代，工业味、不好看 |
| `holo_face` | 全息换脸面罩 | face | ghost | 2200 | 3 | 3 | 5 | **true** | 鬼市货，正好卡在莉莉神经容量（3）上限，排异风险高 |
| `refurb_arm` | 老周翻新义手 | arm | laozhou | 1200 | 2 | 2 | 4 | false | 小林（预算 3000）舍不得花钱时的选择 |
| `cargo_arm` | 搬运液压臂 | arm | anvil | 2000 | 3 | 2 | 5 | false | 粗壮工业臂；小林容量 2 会超载，刀疤（容量 6）随便装 |
| `salvage_leg` | 回收工装腿 | leg | laozhou | 900 | 2 | 1 | 3 | false | 阿强（预算 2000）的便宜货，"走是能走" |
| `jump_leg` | 液压弹跳腿 | leg | ghost | 2600 | 4 | 3 | 5 | **true** | 超出阿强预算，正好吃满他容量 4 |

`desc`（货架卡片上的一句话）：

- night_eye：二手夜视镜头，有点花，但夜市走黑路看得清
- hawk_eye：军规变焦加弹道计算，三百米外看清一张脸
- rebreather_jaw：工业滤毒口鼻加下颌骨强化，难看但耐用
- holo_face：全息投影换脸，还能实时翻译；来路不明
- refurb_arm：老周从报废义体上拆的手，关节有点响
- cargo_arm：液压重载臂，单手能扛两百公斤
- salvage_leg：拆车件拼的工装腿，走是能走
- jump_leg：双级液压，原地跳上二楼；鬼市出品，不保修

## 3. 每件的 Hi3D prompt 与后处理参数

prompt 风格跟现有 5 件保持一致：单件、白底、3/4 产品视角、无阴影、高细节；手臂和腿都写明 **left**（左侧），从法兰接口到末端是一整件。

四个品牌的视觉语言要分得开：
- 天穹（tianqiong）：光滑白色/钛灰外壳、细蓝光条、医疗级
- 铁砧（anvil）：拉丝钢、橙色安全漆、警示条纹、外露液压
- 老周翻新（laozhou）：旧钢件、补漆、胶带、不配套的零件、磨损
- 鬼市（ghost）：哑黑、红色光条、拼凑改装、粗焊缝

```jsonc
// 加进 tools/assets.json（dimensions / triangleLimit / textureLimit / origin / calibration 先照抄同部位的现有件）
{ "meta": { "id": "night_eye", "name": "夜视翻新眼", "slot": "eye", "desc": "二手夜视镜头，有点花，但夜市走黑路看得清",
    "load": 1, "price": 350, "brand": "laozhou", "difficulty": 1, "wires": 3, "wiringHidden": false,
    "model": "models/implants/implant_night_eye.glb", "thumb": "models/implants/thumbs/implant_night_eye.png" },
  "dimensions": { "x": 0.025 }, "triangleLimit": 20000, "textureLimit": 1024, "origin": "sphere",
  "calibration": { "anchor": [0.045, 0, -0.015], "featureSpan": { "x": 0.785 } },
  "prompt": "a single cyberpunk cybernetic eye implant, spherical eyeball module with a large night-vision lens glowing faint green, scratched and repainted housing, mismatched screws, a strip of worn tape, held in a thin dented mounting ring, old steel with touch-up paint, standard connector stub at the back with one alignment notch and small colored pin contacts, isolated product shot, centered, 3/4 view, plain white background, soft even studio lighting, no shadows, high detail" }
```

其余 7 件只列 prompt，其它字段按表格和同部位现有件填：

- **hawk_eye**（eye，参数照抄 appraiser_eye，textureLimit 1024）
  `a single cyberpunk cybernetic eye implant, spherical eyeball module with a long multi-stage telescopic zoom lens on the front, smooth white and titanium-grey medical housing, a thin blue light ring around the lens, tiny rangefinder window on one side, held in a thin mounting ring, clean clinical finish, standard connector stub at the back with one alignment notch and small colored pin contacts, isolated product shot, centered, 3/4 view, plain white background, soft even studio lighting, no shadows, high detail`
- **rebreather_jaw**（face，参数照抄 voice_mask：dimensions x 0.16 y 0.12，origin inner，anchor [0,0,0.215]）
  `a cyberpunk lower-face respirator mask covering the mouth, jaw and chin, two round industrial filter canisters on the cheeks, reinforced steel jaw plate, brushed steel with orange safety paint and hazard stripes, rubber seal along the edge, small status LED, isolated product shot, centered, front 3/4 view, plain white background, soft even studio lighting, no shadows, high detail`
- **holo_face**（face，参数照抄 voice_mask）
  `a cyberpunk lower-face holographic projector mask covering the mouth, jaw and chin, matte black shell with a grid of tiny projector lenses on the front, a thin red light strip along the jawline, rough weld seams and improvised wiring at the sides, black-market modified look, isolated product shot, centered, front 3/4 view, plain white background, soft even studio lighting, no shadows, high detail`
- **refurb_arm**（arm，参数照抄 precision_arm：dimensions y 0.75，triangleLimit 50000，textureLimit 2048，origin flange，anchor [0,0.5,0]）
  `a single cyberpunk prosthetic left arm from shoulder to fingertips, assembled from mismatched second-hand parts, dull grey steel with patches of different paint, visible repair welds, a strip of tape around the forearm, exposed cables at the elbow, slightly oversized worn fingers, a round shoulder flange at the top, arm hanging straight down with fingers relaxed, isolated product shot, centered, 3/4 view, plain white background, soft even studio lighting, no shadows, high detail`
- **cargo_arm**（arm，参数照抄 precision_arm，但 dimensions y 0.78）
  `a single heavy-duty cyberpunk prosthetic left arm from shoulder to fingertips, thick industrial build with exposed hydraulic pistons along the upper arm and forearm, brushed steel plates with orange safety paint and black hazard stripes, oversized reinforced knuckles, a round shoulder flange at the top, arm hanging straight down with fingers relaxed, isolated product shot, centered, 3/4 view, plain white background, soft even studio lighting, no shadows, high detail`
- **salvage_leg**（leg，参数照抄 sprint_leg：dimensions y 0.85，origin flange，anchor [0,0.5,-0.09]）
  `a single cyberpunk prosthetic left leg from mid-thigh to foot, built from salvaged vehicle parts, a simple steel pipe shin, a boxy repainted knee joint with a rubber boot, a flat work-boot style foot, dull grey and faded blue paint with scratches, a round thigh flange at the top, standing straight, isolated product shot, centered, 3/4 view, plain white background, soft even studio lighting, no shadows, high detail`
- **jump_leg**（leg，参数照抄 sprint_leg）
  `a single cyberpunk prosthetic left leg from mid-thigh to foot, two-stage hydraulic jump leg with a large exposed piston and coil spring behind the knee, reverse-jointed digitigrade lower leg, matte black armor plates with a thin red light strip, rough weld seams, a round thigh flange at the top, standing straight, isolated product shot, centered, 3/4 view, plain white background, soft even studio lighting, no shadows, high detail`

## 4. 朝向与标定（手臂、腿必看）

- 模型 Y 轴沿肢体，+Y 朝法兰（接口在上），这是 `origin: "flange"` 的前提；归一化后原点在法兰中心。
- 游戏运行时义体挂在病人骨骼上，膝/肘以下会自动跟着小腿/小臂弯，所以**手臂和腿必须是伸直的、手指放松**，不要出弯曲或握拳的姿势。
- 现有两件手臂生成出来手心朝后，游戏里用 `src/data/calibration/implant_<id>.json` 的 `rot: [0, 1.5707963, 0]`（绕手臂轴转 90°）把手心转成朝外。新手臂归一化后在游戏里看一眼：手心该朝外、前臂上的显示面板/刀具朝外；不对就建同名 json 调 `rot`（只改 Y 分量，±1.5707963 或 3.1415926）。腿一般不用调，脚尖朝前即可。
- 面部和眼睛义体挂在头骨上，不弯，只要 anchor 对（照抄同部位的值，然后在游戏里核对贴合）。

## 5. 验收

- `node tools/validate.mjs` 通过；`npm run build` 通过。
- `?auto` 自动跑完三晚不报错（货架已按"客人点名件优先"排序，自动模式仍会选到原来那 5 件，这一步只是防止数据写坏）。
- 手动开一局，接诊时货架上每个部位都能看到 3 件：便宜货能选但客人只会说"一般"的台词；超预算的卡片是灰的。
- 装上后在站立、说话、坐到床沿时义体不穿模、不悬空；手臂手心朝外。
- 每件模型 ≤ 50k 三角面（眼/面 ≤ 20k），GLB ≤ 3MB，缩略图 512×512 PNG 已生成。
- 在 `ASSET_REPORT.md` 里按现有表格格式补 8 行（任务 id、面数、尺寸、备注）。

## 6. 第二阶段（义体做完还有时间再做）：高级客户

想法：升级店铺后能接到更有钱的客人（公司高管）。数据层已经够用，只缺一个病人模型和配音。

- 新病人 `exec`（公司高管，西装，1.78 m）：和现有病人一样走 Hi3D → `raw/models/exec_raw.glb` → `optimize.sh exec` → 游戏里的 `calibrate.html` 标定槽位 → Mixamo 绑骨（流程见 `tools/blender_glb2fbx.py` 和 `tools/blender_mixamo2glb.py` 开头注释，下载时 Pose 选 **Original Pose**，骨架选 No Fingers）→ `tools/rig-compress.mjs` 压缩 → `patients.json` 填 `rigged` 和 `riggedAnims: models/patients/rigged/anims_shared.glb`。
- `customers.json` 加一条：slot `eye`，预算 6000，容量 5，best `hawk_eye`，台词走"高管"口吻（进门：时间就是钱；满意：下周董事会我要用它看穿所有人；一般：这价钱就这？；失败：我的律师会来找你）。
- `nights.json` 第 3 晚队列末尾加 `"vip:exec"`，`systems/nights.js` 的 `parseEntry` 识别 `vip:` 前缀，只有 `store.state.upgrades.neon >= 1`（霓虹招牌，`upgrades.json` 里 key 是 `neon`）时才入队，否则跳过。这一小段逻辑在 `src/game/flow.js` / `systems/nights.js`，可以改。
- 配音：在 `tools/voices.mjs` 的 `CAST` 里加 `exec`（四十岁男性，低沉平稳、带压迫感的公司高管腔），跑 `node tools/voices.mjs` 只会生成缺的句子。

突发事件已经做了两个（第 2 晚车祸伤员、第 3 晚巡警），数据在 `src/data/incidents.json`，加新事件照着写即可，配音同样跑 `voices.mjs`。
