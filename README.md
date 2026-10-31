# ICT & FCT 测试仿真平台实验

本仓库用于保存 ICT（在线测试）与 FCT（功能测试）仿真平台的实验工程。内容来自本地暂存目录：

```text
G:\暂存00000000001
```

本次上传保留原始工程目录名、工程内 README、源代码和原始 ZIP 归档，方便按来源路径、工程版本和文件职责追溯。所有仿真均为浏览器端教学/方案验证模型，不等同于真实治具、真实 MCU 固件或经过计量校准的测试设备。

## 工程清单

| 原始目录 | 仓库目录 | 用途 | 入口 |
| --- | --- | --- | --- |
| `CAP_Test_3D_NodeJS_%E5%AE%8C%E6%95%B4%E5%B7%A5%E7%A8%8B/CAP_Test_3D_Lab` | 同名目录 | 电容恒流充放电 3D 仿真 | `index.html` |
| `CAP_Test_3D_STM32_NodeJS_%E5%AE%8C%E6%95%B4%E5%B7%A5%E7%A8%8B/CAP_Test_3D_STM32_Lab` | 同名目录 | 电容、STM32、ADC 全链路概念演示 | `index.html` 或单文件入口（以目录内容为准） |
| `DiodeLab_3D_Project/DiodeLab_3D` | 同名目录 | 二极管/双向 TVS FCT 恒流测试仿真 v1 | `index.html`、`DiodeLab_Standalone.html` |
| `DiodeLab_3D_V2_Project/DiodeLab_3D` | 同名目录 | 二极管/ESD、双向击穿与 ADC 仿真 v2 | `index.html`、`DiodeLab_Standalone.html` |

根目录的三个 ZIP 文件保留为原始归档：

- `CAP_Test_3D_STM32_NodeJS_%E5%AE%8C%E6%95%B4%E5%B7%A5%E7%A8%8B.zip`
- `DiodeLab_3D_Project.zip`
- `DiodeLab_3D_V2_Project.zip`

## 快速运行

所有工程均不依赖 CDN 和第三方 3D 库。优先使用 Chrome 或 Edge。

### 方式一：直接打开

进入任一工程目录，双击 `index.html`。DiodeLab 工程也可以直接打开 `DiodeLab_Standalone.html`，无需启动服务器。

### 方式二：Node.js 本地服务器

Node.js 18 或更新版本即可。进入包含 `server.js` 的目录后运行：

```powershell
node server.js
```

然后打开：

```text
http://127.0.0.1:5173/
```

CAP 工程提供 `package.json`，也可以运行：

```powershell
npm start
```

不需要执行 `npm install`。如果 5173 端口已占用，DiodeLab v2 可通过 `PORT` 环境变量改用其他端口。

## 仿真范围

### CAP Test 3D

- 恒流源给电容充电和反向放电；
- 记录 1.0 V 与 3.0 V 阈值时间；
- 根据 `C(µF) = 1000 × I(mA) × Δt(s) / ΔV(V)` 计算容量；
- STM32 版本额外演示分压、12 位 ADC 量化、1 ms 采样和阈值判断；
- 3D 电路、PCB、引脚和信号光点用于解释流程，不代表已经验证的硬件原理图或 PCB 布线。

### DiodeLab 3D

- 恒流源、继电器极性切换、DUT、AFE、ADC 和 MCU 流程；
- 正向/反向测试、上下限判断、PASS/FAIL/INVALID 状态；
- v2 增加带符号电压范围、ESD/TVS 示意、ADC 平均和 CSV 导出；
- 反向 1 mA、12 V 顺从电压等参数仅为实验模型，必须按真实器件数据手册、ERS 和安全限制重新确认。

## 中文注释与来源追溯

本仓库使用中文 README 记录每个工程的用途、运行方法、模型边界和来源路径；原始 JavaScript/CSS/HTML 源码中的英文注释保持原样，避免上传时改变实验逻辑。需要追溯时按以下顺序查看：

1. 先看本文件的工程清单，确认原始目录与仓库目录对应关系。
2. 再看对应工程目录内的 README，确认版本说明、操作步骤和模型边界。
3. 进入 `app.js` 查看物理模型、采样和测试状态机。
4. 进入 `renderer3d.js` 或 DiodeLab 的 `app.js` 查看三维几何、PCB、器件和动态信号绘制。
5. 查看 `index.html`、`style.css`/`styles.css` 和 `server.js`，分别追溯界面、样式和本地服务。

常见注释对应关系：

| 注释位置 | 中文含义 | 追溯文件 |
| --- | --- | --- |
| `CAP.../app.js` 顶部及测量窗口注释 | 电容模型、阈值采样、曲线刷新 | CAP 工程 `app.js` |
| `CAP.../renderer3d.js` 的 wire、capacitor、current 注释 | 三维导线、电容外观和约定电流方向 | CAP 工程 `renderer3d.js` |
| `CAP...STM32.../renderer3d.js` 的 MCU PCB 注释 | STM32 封装、PCB、ADC/UART 示意 | STM32 工程 `renderer3d.js` |
| `DiodeLab.../app.js` 的 V/I、ADC、WebGL 注释 | 二极管/TVS 模型、ADC和三维引擎 | DiodeLab v1/v2 `app.js` |
| 各工程 README 的“注意/边界”内容 | 说明模型不能替代真实治具测量 | 各工程 `README.md` |

源码注释中的 `model`、`ADC`、`WebGL`、`PCB`、`DUT` 等英文术语与对应 README 的中文说明配套使用。后续修改仿真模型时，应同时更新相关源码注释、工程 README 和本文件的追溯表。

## 版本和文件策略

- 本次上传基线：2026-10-31，来源为 `G:\暂存00000000001`。
- 每个工程保留自己的 `README.md`、HTML、JavaScript、CSS、Node 启动文件和 `package.json`（如果存在）。
- ZIP 文件作为原始归档保留，不替代可阅读的工程源文件。
- 不提交 `node_modules`、缓存、日志、临时文件和本地编辑器状态。
- 不自动添加开源许可证；工程仅用于实验、教学和方案讨论。

## 安全和使用边界

这些工程生成的是 JavaScript 仿真数据，没有连接真实 STM32、STC12C5A60S2、ADC、恒流源、继电器、串口或被测器件。尤其是二极管/TVS 反向测试，不能直接把仿真参数用于实物治具；实际方案必须重新完成电流限制、输出限压、极性切换保护、ADC 输入保护、隔离、放电和校准验证。

## Git 追溯

每次变更应使用清晰的提交信息，例如：

```text
feat: update diode FCT simulation model
fix: correct ADC threshold display
chore: refresh source archive
docs: update Chinese traceability README
```

提交说明应指出涉及的工程目录和主要文件，避免只写“修改代码”。发布或交付时同时记录 Git 提交号、工程目录和运行入口。

