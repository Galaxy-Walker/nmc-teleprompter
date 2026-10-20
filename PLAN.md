# 提词器（Teleprompter）技术方案

> 目标：平板浏览器打开一个内网网页，上传 md/docx/txt，镜像翻转显示，按「字/分钟」匀速自动滚动。
> 部署：绿联 NAS 上的 Docker 容器，校园网内网访问 `http://<NAS_IP>:8300`。
> 本版：2026-10-20。相对上一版，修正了 compose、权限、测量模型、字数口径等会直接导致返工的问题，并把主路径收敛为一条。变更清单见 §14。

---

## 0. 执行摘要（先看这段）

一句话：**单容器 FastAPI + 无构建原生前端；稿件存 NAS 文件系统；绿联 Docker「项目」粘贴 compose，官方 Python 镜像 + 固定版本 `requirements.txt`；播放用「字→像素」映射 + `translate3d`；防息屏用静音 mp4 循环。**

五条实现铁律（防止方案膨胀）：

1. **一个容器、一个端口、一个数据目录**。不引入数据库、nginx、Node、前端框架。
2. **开发用 uv，部署用 `requirements.txt`**。版本由 `uv export` 从 `uv.lock` 固定；容器里不装 uv。
3. **播放核心只做三件事**：全量测量、字→像素映射、`translate3d`。不做懒测量/虚拟列表；实测慢再优化。
4. **防息屏只做静音 mp4 循环**。http 内网下 Wake Lock 必然不可用，v1 不写这条死代码。
5. **部署只维护路径 A**（UGOS「项目」+ 官方镜像）。路径 B/C 只作逃生通道，不在主流程里。

---

## 1. 需求确认结果

| 项 | 结论 |
| --- | --- |
| 设备 | iPad Safari + 安卓平板 Chrome 都要兼容（按最保守能力做，优雅降级） |
| 操控 | 只有平板自己操作，不做多设备遥控（架构上预留升级空间） |
| 文档内容 | 只需要**纯文本段落**，不需要标题样式/图片/表格/公式 |
| 输入格式 | `.md` / `.docx`（另送 `.txt` 与「直接粘贴文本」兜底） |
| 滚动模型 | 匀速连续滚动，语速单位 = **字/分钟** |
| 访问方式 | 仅校园网内网，`http://NAS_IP:端口`，无 HTTPS、无鉴权 |
| 技术栈 | Python(FastAPI) 后端 + **无构建**原生前端 |
| 显示 | 镜像翻转（水平）+ 上下翻转（垂直）两个独立开关 |
| 稿件库 | **Tier 1**：后端 + 文件系统稿件库（见 §4） |
| 部署 | 绿联 DXP 系列（x86_64 / amd64），**免构建**：Docker 应用「项目」里粘贴 compose（见 §11） |

### 功能范围（已确认）

**做**：

- md/docx/txt 上传解析；粘贴文本新建
- 稿件库：列表/重命名/删除
- 字/分钟匀速滚动
- 水平镜像 + 上下翻转
- 字号/行距/配色调节
- 焦点行指示线
- 防息屏：静音 mp4 循环
- 开播前 3-2-1 倒计时
- 触控分区操作
- 键盘快捷键（接电脑时）

**不做**：

- 多设备遥控（手机控平板）
- 账号/鉴权
- HTTPS
- 逐屏翻页模式
- 标题样式/图片/表格/公式渲染
- PWA/Service Worker（http 内网下不可用）
- 记忆上次播放位置（未选；本次不做，避免状态同步复杂度）
- 富文本编辑/重新解析按钮（API 保留纯文本 `PATCH text` 兜底，UI 暂不做）

> 设备偏好（速度、字号、行距、配色、翻转）仍然存 `localStorage`，但**不存播放进度**。刷新/重进播放页回到开头；暂停、切后台只在本次会话内保持位置。

---

## 2. 架构总览

```
平板浏览器（校园网 Wi-Fi）
      │  http://<NAS_IP>:8300
      ▼
┌──────────────────────────────────────────────┐
│ Docker 容器: teleprompter                    │
│  uvicorn + FastAPI                           │
│   ├─ GET /              → web/ 静态文件      │
│   ├─ GET /api/health    → 健康检查           │
│   ├─ /api/scripts       → 稿件库 CRUD        │
│   └─ /data              → 挂载 NAS 稿件目录  │
└──────────────────────────────────────────────┘
```

一个容器、一个端口、一个数据卷。前端静态文件由 FastAPI 的 `StaticFiles` 直接托管，不引入 nginx。

**缓存策略**：HTML/JS/CSS 返回 `Cache-Control: no-cache`（每次刷新都能拿到新前端），API 返回 `no-store`。这样「改前端只需刷新页面」在 Safari 上也成立，不依赖用户手动清缓存。

---

## 3. 技术选型与理由

| 层 | 选型 | 理由 | 备选 & 未选原因 |
| --- | --- | --- | --- |
| 语言/框架 | Python 3.12 + FastAPI + uvicorn | 本机已有 uv；multipart 上传、JSON、自动 `/docs` 调试页开箱即用；单文件可跑 | Flask（可用但类型/文档弱）；Node/Next（前端要构建链，维护成本更高） |
| 依赖管理 | 开发 uv（`uv.lock`）；部署 `requirements.txt`（`uv export` 固定版本） | 开发可复现；运行容器不装 uv，少一层工具和网络依赖 | 容器内 `uv sync --frozen`（要装 uv，首次启动更重）；pip 手写 requirements（版本会漂） |
| docx 解析 | **标准库** `zipfile` + `xml.etree`，读 `word/document.xml` 里的 `<w:p>` / `<w:t>` | docx 本质是 zip+xml；零依赖；**文本框里的文字能拿到**（`python-docx` 会漏掉） | `python-docx`（读不到文本框）；pandoc/mammoth（重，需额外二进制或 JS 库） |
| md 处理 | 轻量、逐行清洗：去标题/引用/列表/链接/强调/代码围栏/内联 HTML | 念稿要的是「一行一句」的干净文本，不需要样式渲染 | markdown-it-py → HTML → 取文本（多两个依赖，标题层级用不上） |
| 前端 | 原生 HTML + CSS + ES Modules，**无构建、无框架、无 npm** | 不懂前端也能看懂和改；出问题 F12 直接定位；容器里不用装 Node | Vue3 + Vite + TS（组件化更好，但要构建链，镜像更大） |
| 数据存储 | 文件系统 `/data/scripts/<id>/`，**无数据库** | 稿件量很小；可直接在绿联文件管理器里看到文件，出错好排查 | SQLite（需迁移/ORM，收益低） |
| 部署 | 单容器 + docker compose | 最简 | nginx + api 双容器（多一层网络配置） |

### 3.1 稿件在磁盘上的样子

```
/data/scripts/2026-10-20_开学致辞/
├── source.docx      # 原始上传文件（原样留存，便于回溯）
├── text.txt         # 解析后的干净纯文本（一行一段）
└── meta.json        # 标题、字数、时间、原文件名
```

`meta.json` 示例：

```json
{
  "schema": 1,
  "title": "开学致辞",
  "chars": 1234,
  "source_name": "致辞.docx",
  "source_format": "docx",
  "created_at": "2026-10-20T14:03:00+00:00",
  "updated_at": "2026-10-20T14:03:00+00:00"
}
```

约定：

- 目录名就是稿件 `id`，创建时生成：`YYYY-MM-DD_<清洗后的标题>`；重名自动加 `-2`、`-3`。
- **重命名只改 `meta.json` 的 `title`，不改目录名**。目录名是稳定 ID，避免路径漂移和引用失效。
- `text.txt` 的不变量：**一行一段**。docx 里的 `w:br`、嵌套文本框段落，解析时一律拆成新段，保证这个不变量。
- `chars` 是「阅读单位数」，不是字节数，口径见 §3.4。
- 时间统一存 UTC ISO 8601，前端按本地时区显示。
- 列表接口按 `updated_at` 倒序；读不出的 `meta.json` 跳过并记日志，不让整个列表挂掉。

### 3.2 docx 解析：实测验证 + 实现规则

构造一个模仿 Word 真实输出结构的 docx（段落中嵌文本框），对比三种提取方式：

| 提取方式 | 文本框内容 | 结论 |
| --- | --- | --- |
| `python-docx` 1.2.0 的 `doc.paragraphs` | **出现 0 次** | 确认丢失：`CT_P.text` 只走 `w:p` 的直接 `w:r` 子节点，`mc:AlternateContent` 被整个忽略 |
| XML 直读，遍历所有 `<w:t>` | **出现 2 次** | 确认重复：Word 把文本框同时存在 `mc:Choice`(DrawingML) 与 `mc:Fallback`(VML) 两份 |
| XML 直读，**跳过 `mc:Fallback` 子树** | 出现 1 次 | 正确 |

`parse.py` 的实现规则：

1. 先看文件头：`PK` 开头按 zip 读；OLE 头（`D0 CF 11 E0`）说明是旧 `.doc`，返回 400「请另存为 `.docx`」。
2. 只读 `word/document.xml`；读不到这个条目就报 400「不是有效的 docx」。读之前检查 `ZipInfo.file_size`，超过 20MB 直接拒绝，避免 zip 炸弹。
3. 递归遍历：遇到 `mc:Fallback` 整棵剪掉；`w:p` 记段落边界；`w:t` 取文本；`w:tab` 记 `\t`；`w:br`、`w:cr` 记换行。
4. `w:txbxContent` 里的嵌套 `w:p` 也按段落边界处理，所以文本框会另起一行；文本框前后的外层文字会分成相邻两段。提词场景可接受。
5. 把文本按换行拆开，逐行 `strip()`，丢掉空行，得到 `list[str]`。
6. 页眉/页脚/脚注/尾注不读（不在 `document.xml` 里）；图片没有文字，自然跳过。
7. 艺术字如果走 DrawingML 的 `a:t` 而不是 `w:t`，本方案不单独处理；**验收时用真实稿件确认**，不要假设全覆盖。

边界行为：

- 段落里的软换行 `w:br` 会被拆成两段，而不是保留在同一段里——这是为了守住 `text.txt` 的「一行一段」不变量。
- 表格单元格里的 `w:p` 会按顺序变成多段文字；不渲染表格，但不丢字。
- 修订模式下，`w:ins` 的文字会读到；`w:delText`（已删除）不会读到，符合直觉。

> 实测脚本：`tests/probe_docx_textbox.py`（`uv run --no-project --with python-docx python tests/probe_docx_textbox.py` 可复跑）。正式实现转成 `tests/test_parse.py` 的回归用例。

### 3.3 md / txt 解析

**md**：按行处理，不做完整 Markdown 解析。

- 去 ATX 标题前缀 `#{1,6}`、引用 `>`、列表 `- * +` / `1.`、任务列表 `[ ]`
- `[text](url)`、`![alt](url)`、`[text][ref]` 只留文字
- 去成对强调 `**` / `__` / `*` / `_`、行内代码反引号
- 去代码围栏行（三反引号 / 三波浪线）
- 去内联 HTML 标签，`html.unescape` 解实体
- 去水平线 `---` / `***` / `___`
- 空行丢弃；每行一段

不做：表格对齐、脚注、front matter、嵌套列表层级。念稿用不到，强行做只会引入边界 bug。

**txt**：按行，去首尾空白，空行丢弃。

**编码**：

1. UTF-8 BOM / UTF-16 BOM 优先按 BOM 解
2. 否则先试 `utf-8`
3. 失败再试 `gb18030`（兼容 GBK/GB2312，覆盖中文 Windows 记事本）
4. 都失败 → 400「文本编码不支持，请另存为 UTF-8」

换行统一把 `\r\n` / `\r` 归一成 `\n`。

### 3.4 字数口径（单一来源）

**后端算，前端只加总**。`GET /api/scripts/{id}` 返回每段的 `units`，前端用这些数做映射；前端不再写一份 JS 计数逻辑，避免两边口径漂移。

规则：

- 空白字符不计
- 连续拉丁字母/数字串算 1 个单位（`hello`、`2026` 各 1）
- 其他每个非空白字符算 1 个单位（中文、标点都算）

例子：

| 文本 | units |
| --- | --- |
| `你好，世界。` | 6 |
| `hello world 2026` | 3 |
| `第 1 章` | 3 |

说明：英文按「词」计，和中文按「字」计不是严格等价的语音时长；中英混排时按试读微调速度即可，不追求理论精确。默认速度 220，可调范围 60–600。

---

## 4. 稿件库要不要做？——复杂度对比

| | **Tier 0** 纯前端 | **Tier 1** 后端 + 文件稿件库（推荐） | **Tier 2** + DB + 账号 + 遥控 |
| --- | --- | --- | --- |
| 稿件存在哪 | 浏览器 localStorage / IndexedDB | NAS 目录 | NAS + SQLite |
| 换设备 / 清缓存后 | **稿件丢失** | 稿件还在 | 还在 |
| 后端代码量 | 0（只需静态托管） | **~200 行** | ~800 行 |
| 部署复杂度 | 任意静态容器 | 1 容器 + 1 volume | 1 容器 + volume + 迁移 |
| 主要风险 | 5MB 配额、iOS 清缓存 | 几乎没有 | 鉴权/权限坑多 |
| 实现工时 | 0.5 天 | **1 天** | 3 天+ |

**结论：Tier 1 的复杂度增量非常小**（多一个 `library.py`，compose 多一行 volume 挂载），但收益明显：

- 稿件跨设备可见（平板、电脑都能调同一份稿子）
- 原始 docx 留存，解析规则以后改进了可以重新解析
- 你本来就要用 Docker 部署后端，Tier 0 反而浪费了这个前提
- 以后想加「手机遥控」「多稿件」「导出」都有地方挂

Tier 2 里的**账号系统在内网单机场景纯属负担**，不建议。

> 折中做法：UI 偏好（字号、速度、翻转、配色）存 **浏览器 localStorage**，稿件正文存 **NAS**。
> 偏好属于设备，稿件属于内容——这样多设备互不干扰。**不存播放进度**。

### 4.1 文件写入与并发

- 所有写文件用「同目录临时文件 + `os.replace`」原子替换；`meta.json` **最后写**，这样半成品目录不会被列表当成有效稿件。
- 创建目录用 `mkdir(exist_ok=False)`，撞名就加后缀重试，避免并发创建撞车。
- `id` 只由服务端生成；客户端传进来的 `{id}` 先做正则校验（`^[\w-]{1,80}$`），再 `resolve()` 确认在 `DATA_DIR` 下，防路径穿越。
- 单用户场景不引入文件锁/数据库；路由用同步 `def`，FastAPI 自动丢线程池，小文件 IO 不阻塞事件循环。

---

## 5. 核心算法：「字/分钟」→ 平滑像素滚动

这是提词器最容易做砸的地方。如果用「像素/秒」，换个字号体感速度就全变了。做法如下。

### 5.1 坐标与初始状态

- 外层 `.stage` 负责镜像：`transform: scaleX(-1)` / `scaleY(-1)`（两个开关独立）。
- 内层 `.content` 负责滚动：`transform: translate3d(0, -y, 0)`。
- **两层必须分开**。`translate` 和 `scale` 放在同一个元素上时，顺序会改变位移方向；分开后逻辑简单，镜像和滚动互不干扰。
- 焦点线在 `.stage` 内，距逻辑顶部 30%，跟着整屏一起翻转。
- `.content` 的逻辑顶部 = 焦点线 - 半个行高（CSS 变量 `--focus-offset`），底部留 70vh 空白。于是 `y = 0` 时首行**中心**在焦点线上；`y` 增大时文字向上走，下一行经过焦点线。
- `y` 的最大值 = 最后一段底部 - 一个行高（`maxY`），让末行中心落在焦点线；底部留白保证能滚到这个位置。

### 5.2 测量

渲染完成后（**必须等 `await document.fonts.ready`**，否则首次测量用的是 fallback 字体，字体一换全部偏移）：

1. 遍历每个段落块，读 `offsetTop` 和 `offsetHeight`。
2. 建三组数组：
   - `units[i]`：该段阅读单位数（来自 API）
   - `cum[i]`：前 i 段的累计单位数，`cum[n] = total`
   - `tops[i]`：该段顶部相对内容层的像素位置；`tops[0] = 第一段 offsetTop`（没有 top padding 时为 0），`tops[n] = 最后一段底部`
   - `maxY = max(0, tops[n] - 行高)`：末行中心对齐焦点线；`charsToY`/`yToChars` 在最后一段用 `maxY` 作为终点
3. 测量只读一次布局，不要边读边改样式（避免 layout thrash）。
4. 字号/行距/列宽/横竖屏/全屏变化 → 重新测量；**用当前的 `charsRead` 反算 `y`，不要跳回开头**。
5. 翻转 `flipX/flipY` 不改变布局尺寸，**不需要重测**；只改 `.stage` 的 transform。

**不要用 `content-visibility: auto`**：它会给元素开启 size containment，未渲染内容的尺寸是 `contain-intrinsic-size` 的估算值（MDN），`offsetTop/offsetHeight` 不再可信，字→像素映射会错位。v1 全量测量；万字稿约几百段，预期在几十毫秒量级，P5 用 `samples/long.md` 实测确认。真的卡再按段分块测量，但不要用 `content-visibility` 做滚动内容。

### 5.3 播放

用单调时钟，不用 `Date.now()`：

```js
// 每帧
const dt = Math.min((now - lastTs) / 1000, 0.1); // 切后台/掉帧时防止跳一大段
charsRead = Math.min(total, charsRead + (wpm / 60) * dt);
const y = charsToY(charsRead);       // 二分 + 分段线性插值
content.style.transform = `translate3d(0, ${-y}px, 0)`;
```

- `charsRead` 是唯一状态；`y` 永远由它推导。
- 暂停 = 取消 `requestAnimationFrame`；继续时把 `lastTs` 重置为当前时间，不补算暂停时长。
- 调速只改 `wpm`，下一帧生效，不重置位置。
- 到 `charsRead >= total` 停住，显示「已到末尾」。
- 用 `translate3d`，不用 `scrollTop`，避免 iOS 惯性滚动和 `scroll` 事件干扰。

### 5.4 反查与拖动

- 暂停时单指上下拖动：先按 §7 的逆变换把物理坐标转成逻辑坐标，再改 `y`；松手后用 `y → charsRead` 反查（对 `tops` 二分），保证进度显示正确。
- 进度条拖动同理：拖动期间暂停自动滚动，松手后恢复拖动前的播放状态。
- 不做进度持久化；刷新后从 0 开始。

### 5.5 性能边界

- 目标稿件 1 万字以内；全量测量 + 单个 `translate3d` 层足够。
- 单个超高 DOM（十万字级）会让合成层过大，移动端可能掉帧；不在目标范围，上传限制 10MB 只是兜底。
- 首次进入播放页显示 loading，等字体和测量完成再显示内容，避免「先闪一下再跳」。

---

## 6. 交互设计（仅平板自身操作）

### 6.1 播放页布局

- 内容单列，列宽默认约 65vw（可调 55–75vw），左右留边，减少眼球横移。
- 焦点线：距逻辑顶部约 30% 处一条 2px 半透明横线 + 上方轻微渐变遮罩。
- 控制条、焦点线都在 `.stage` 内、`.content` 外，**跟着整屏一起翻转**；不要给控制条单独反向翻转，否则通过分光镜看会歪。
- 所有触控/拖动先把物理坐标逆变换成逻辑坐标：`lx = flipX ? W - x : x`，`ly = flipY ? H - y : y`，再判定分区。
- iPad 隐藏全屏按钮（点了也没用），显示「分享 → 添加到主屏幕」提示；安卓保留全屏按钮。

### 6.2 开播与倒计时

- 进入播放页先显示「开始」大按钮；点击后播放静音视频（满足用户手势），再走 3-2-1 倒计时。
- 倒计时期间不响应触控分区；点任意处可取消。
- 倒计时结束才开始累计 `charsRead`，避免「还没准备好字就跑了」。

### 6.3 触控分区

按逻辑坐标：

- 左 25%：减速（-20 字/分）
- 右 25%：加速（+20 字/分）
- 中 50%：暂停 / 继续
- 暂停状态下：单指上下拖动自由定位
- 双指点击（`preventDefault`，避免触发浏览器手势），或点逻辑顶部 5% 边缘：呼出控制条
- 控制条 3 秒无操作自动隐藏；任何控制条交互都重置计时

### 6.4 控制条

- 速度滑杆 + 数字（60–600）
- 字号（32–96px，默认 48）
- 行距（1.3–2.0，默认 1.6）
- 镜像 X、镜像 Y
- 配色：暗底白字 / 亮底黑字 / 黑底琥珀字
- 全屏（安卓）
- 进度条（可拖）
- 返回稿件库

### 6.5 键盘快捷键（接笔记本时）

- `空格` 暂停/继续
- `↑` / `↓` 调速
- `←` / `→` 前后跳 5 秒
- `F` 全屏
- `M` 镜像 X
- 输入框聚焦时忽略快捷键

### 6.6 稿件库页

- 列表：标题 / 字数 / 更新时间；按更新时间倒序
- 上传：拖拽或点选，支持 `.md .markdown .txt .docx`
- 粘贴文本新建：标题 + 多行文本
- 重命名：只改显示标题，不改目录名
- 删除：二次确认
- 点击进入播放；空库显示引导文案
- 上传/删除失败用页面内 toast，不用 `alert`

### 6.7 切后台/来电

- `visibilitychange` 到 hidden：暂停自动滚动，停掉静音视频，记住 `charsRead`
- 回到前台：不自动继续（浏览器可能限制播放），显示「已暂停，点继续」；用户点击后再启动视频和滚动
- 这样既不会计时错乱，也不会在用户没准备时突然开跑

---

## 7. 已知的坑与对策（内网 http + iPad Safari）

| # | 坑 | 影响 | 对策 |
| --- | --- | --- | --- |
| 1 | `http://192.168.x.x` **不是 secure context**（MDN：只有 `https://`、`http://localhost`/`127.0.0.1`/`*.localhost`、`file://` 算 potentially trustworthy，私网 IP 不算） | Wake Lock、Service Worker、剪贴板 API 全部不可用 | **v1 不写 Wake Lock/Service Worker**；防息屏只用静音 mp4 循环。将来上 HTTPS 再补 Wake Lock，约 15 行 |
| 1b | 防息屏必须用**视频**而非音频 | `<audio>` 在 iOS 上不可靠 | `<video muted loop playsinline>` + base64 内联极小 mp4；由「开始」按钮的用户手势启动；**暂停时不要停视频**（暂停久了也会息屏），离开播放页/切后台才停 |
| 1c | Wake Lock 在 iOS 上的版本差异 | 16.4–18.3 部分支持，主屏幕 standalone 下不工作（WebKit bug 254545）；18.4 起完整 | 本方案跑在 http 下，Wake Lock 必然不可用，所以不实现；记录在此，供以后上 HTTPS 参考 |
| 2 | Fullscreen API：**iOS Safari 不支持对普通元素全屏**（web-features 标注 "Safari on iOS: Not supported"，Baseline 已被它阻塞 43 个月） | iPad 上无法真全屏，顶部留地址栏 | **安卓平板在 http 内网下可以真全屏**——只要求 transient user activation，**不要求 secure context**（Chrome Android 71+）。iPad 降级：引导「添加到主屏幕」+ 布局用 `dvh` 不依赖全屏；iPad 上隐藏全屏按钮 |
| 3 | iOS `100vh` 包含地址栏高度 | 底部内容被遮 | `dvh/svh/lvh` 自 **iOS Safari 15.4** 起支持 → CSS 层叠兜底（先 `height:100vh` 再 `height:100dvh`），**不需要** JS 算 `--vh` |
| 4 | 整屏 `scaleX(-1)` / `scaleY(-1)` 后**触控区反转** | 点「加速」变成「减速」 | 点击坐标先逆变换成逻辑坐标：`lx = flipX ? W - x : x`，`ly = flipY ? H - y : y`，再判定分区；拖动方向同理 |
| 5 | 控制条是否要跟着翻转？ | —— | **要跟着翻**。通过分光镜看到的是整屏，控制条一起翻转才是正的；放在 `.stage` 内、`.content` 外即可，不要单独反向 |
| 6 | docx 文本框 / `mc:Fallback` | `python-docx` 读不到文本框；天真遍历所有 `<w:t>` 又会读两遍 | XML 直读 + **跳过 `mc:Fallback` 子树**；嵌套 `w:txbxContent` 段落另起一行；`.doc` 用文件头识别并明确报错。详见 §3.2 |
| 7 | 校园网 AP 隔离 / 客户端隔离，平板 ping 不通 NAS | 页面打不开 | 部署后先用平板访问 `http://NAS_IP:8300/api/health`；不通则查 NAS 防火墙（放行 8300/TCP）、确认同一网段/VLAN，或临时用手机热点验证。**P0 先用电脑当服务器验证连通性**；Windows 首次运行要允许专用网络防火墙 |
| 8 | 绿联 NAS CPU 架构（DXP 系列 Intel N100/N305 = amd64） | 架构不符则容器起不来 | **不要写 `platform: linux/amd64`**：`python:3.12-slim-bookworm` 是多架构镜像，Docker 会自动选对；强行指定反而会让 ARM 机器走模拟或起不来。部署前 `uname -m` 复核即可 |
| 9 | 长文一次性测量 | 万字稿首次渲染可能卡顿 | **全量测量**；不用 `content-visibility: auto`（size containment 会让 `offsetHeight` 变成估算值，直接破坏映射）。实测 >100ms 再按段分块，但保持同一套 `tops/cum` 模型 |
| 10 | 播放中切后台 / 来电话 | 计时错乱，回来位置跳飞 | `visibilitychange` 暂停并保留 `charsRead`；回前台不自动继续，等用户点；rAF 的 `dt` 上限 0.1s 兜底 |
| 11 | 启动脚本的 `$` 和换行 | Compose 会插值 `$`；CRLF 会让 bash 报 `\r` 错 | 启动逻辑放 `docker/start.sh`，compose 只写 `command: ["bash", "/app/start.sh"]`；`.gitattributes` 强制 `*.sh eol=lf` |
| 12 | 容器写出来的文件属主是 root | 文件管理器里可能只能读、不能改 | 官方 Python 镜像默认 root；`./data` 先在文件管理器里建好（目录归你，方便删除/备份）。**不要依赖 PUID/PGID**：官方镜像不读这两个变量；也不要随手加 `user:`，否则 `./venv` 可能写不进去 |
| 13 | Compose `environment` 写法 | 写错会直接部署失败 | 只能用「映射」或「字符串数组」：`TZ: Asia/Shanghai` 或 `- TZ=Asia/Shanghai`；**不能写 `- TZ: Asia/Shanghai`**（这是数组里套映射，不合法） |
| 14 | 启动时装依赖依赖网络 | PyPI/镜像不通时首次启动失败 | 固定版本 `requirements.txt` + venv 持久化；requirements 哈希不变时重启**不联网**；首次失败看日志换镜像源，不要反复重建 |

---

## 8. 项目结构

```
teleprompter/
├── PLAN.md                 # 本文件
├── README.md               # 部署与使用说明（最后写）
├── .gitattributes          # *.sh eol=lf，防止 Windows 把 start.sh 写成 CRLF
├── .python-version         # uv pin 3.12，保证本机和容器都用 3.12
├── pyproject.toml          # uv 管理：fastapi / uvicorn / python-multipart；requires-python = ">=3.12,<3.13"
├── uv.lock
├── requirements.txt        # uv export 生成，部署用（固定版本）
├── Dockerfile              # 可选，仅路径 B/C 需要
├── docker-compose.yml      # 路径 A 主用
├── docker/
│   └── start.sh            # 建 venv + 按 requirements 哈希安装 + exec uvicorn
├── app/
│   ├── main.py             # FastAPI 应用、路由、静态托管、缓存头
│   ├── library.py          # 稿件库：列目录 / 存 / 读 / 改 / 删、ID 校验
│   └── parse.py            # docx|md|txt → 段落列表 + 字数口径
├── web/
│   ├── index.html          # 稿件库 + 播放页两个 section
│   ├── style.css           # CSS 变量驱动字号/行距/配色/翻转
│   ├── app.js              # 入口 + hash 路由（#/、#/play/<id>）
│   ├── api.js              # fetch 封装
│   ├── library.js          # 稿件库视图 + 上传/粘贴/重命名/删除
│   ├── player.js           # 播放核心：测量 / 映射 / 滚动 / 触控
│   ├── settings.js         # 设置项 + localStorage 持久化
│   └── wake.js             # 静音 mp4 循环（v1 不做 Wake Lock）
├── tests/
│   ├── probe_docx_textbox.py
│   ├── test_health.py      # health/静态页/只读 scripts 接口
│   ├── test_parse.py       # md/docx/txt 解析、编码、字数
│   ├── test_library.py     # 示例种子、CRUD、重名、路径穿越
│   └── test_api.py         # 上传/粘贴/重命名/删除
├── samples/                # 测试稿：长文、中英混排、带文本框的 docx
└── data/                   # 运行时稿件目录（.gitignore 忽略）
```

规模约束：`main.py` / `library.py` / `parse.py` 各自尽量控制在 200 行以内；`player.js` 控制在 350 行以内。超过就拆函数，但不要提前引入抽象层/状态管理库。前端 8 个文件（6 个 JS + HTML + CSS）、后端 3 个文件，是刻意保持的上限。

---

## 9. API 草案

```
GET    /                     → index.html
GET    /api/health           → {"ok": true}
GET    /api/scripts          → [{"id","title","chars","updated_at"}]
POST   /api/scripts          → multipart/form-data：file? | text? | title? → 201 {id,title,chars}
GET    /api/scripts/{id}     → {id,title,chars,updated_at,paragraphs:[{text,units}]}
PATCH  /api/scripts/{id}     → JSON：{"title"?,"text"?} → 200 {id,title,chars,updated_at}
DELETE /api/scripts/{id}     → 204
```

### 9.1 创建

`POST /api/scripts` 统一用 `multipart/form-data`，**不要同时支持 JSON 和 multipart 两个分支**（FastAPI 里要手动看 Content-Type，增加无谓复杂度）：

- `file` 与 `text` 二选一；都给或都不给 → 400
- `title` 可选；不传时用文件名去扩展名，或正文首行截断
- 文件扩展名白名单：`.md .markdown .txt .docx`
- 上传限制 10MB；超限 413
- `.doc` → 400「旧版 .doc 不支持，请另存为 .docx」
- 解析后没有文字 → 400「没有可读文字」

### 9.2 详情与更新

`GET /api/scripts/{id}` 返回 `paragraphs` 对象数组：`{"text": "...", "units": 12}`。前端只用 `units` 做累计，不再自己数字数。

`PATCH` 的 `text` 是纯文本：按行拆段、去空白、丢空行；重新算 `chars`。`title` 只改 `meta.json`，目录名不动。`title` / `text` 为空 → 400。

### 9.3 错误与缓存

- 业务错误统一 `{"detail": "..."}`；422 保留 FastAPI 默认校验结构
- API 响应 `Cache-Control: no-store`
- 静态文件（HTML/JS/CSS）`Cache-Control: no-cache`
- 同步 `def` 路由 + 线程池；不引入 `aiofiles` 之类的额外依赖

### 9.4 安全边界

- 无鉴权是需求，但**只能在内网使用**；不要把 8300 映射到公网
- 上传大小、扩展名、文件头三重校验
- `id` 正则 + `resolve()` 边界检查，防路径穿越
- 不执行上传内容；docx 只读 XML，不解压到磁盘

---

## 10. 实施步骤

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| **P0** | uv 初始化 + FastAPI + 静态托管 + `/api/health` | 本机 `uv run` 起服务，**平板访问 `http://<PC_IP>:8000/api/health` 通**（先排掉校园网连通性/Windows 防火墙） |
| **P1** | 播放核心：字体就绪后测量、字/分钟滚动、3-2-1 倒计时、触控分区、镜像/翻转、字号/行距/配色、焦点线 | 用 `samples/long.md` 在两台平板上滚得平滑、镜像正确、触控不错位；暂停/继续不跳位置 |
| **P2** | 上传解析（docx/md/txt）+ 稿件库 CRUD + 测试 | 传一个带文本框的 docx，内容不缺、不重复；md/txt 编码正确；重名/路径穿越测试过 |
| **P3** | 防息屏（静音 mp4，**需 iPad 实机验证**）、全屏降级、`visibilitychange` 处理 | 播放 5 分钟不息屏；切后台回来位置不乱；暂停 5 分钟也不息屏 |
| **P4** | compose（路径 A）→ 绿联 Docker「项目」部署，写 README | 先用 hello-world 验证项目页；再部署正式服务；NAS 重启后容器自启，稿件还在 |
| **P5** | 打磨：设置面板收纳、误触防护、横竖屏切换重测量、万字稿性能 | 只在实测有问题时做；不做提前优化 |

> 当前进度（2026-10-21）：P0 平板连通性通过；P1 滚动/暂停/镜像/触控/改字号通过；P2 上传/粘贴/重命名/删除通过（**31 个后端测试 + 无头 UI 全流程**）；P3 静音 mp4 防息屏、iPad 全屏降级、切后台暂停/停视频已实现并通过无头检查，**待 iPad 实机确认 5 分钟不息屏**。

---

## 11. 部署方案（绿联 UGOS Pro / amd64）

### 11.1 三条部署路径（结论：主用 A）

| | **A. 免构建**：Docker 应用「项目」粘贴 compose（推荐） | B. SSH 进 NAS 构建镜像 | C. 本机构建 → 导出 tar → NAS 导入 |
| --- | --- | --- | --- |
| 需要 SSH | 不需要 | 需要 | 不需要 |
| 需要本机装 Docker | 不需要 | 不需要 | 需要（你目前没有） |
| 需要 `docker compose` CLI | 不需要（UGOS 项目页代劳） | 需要（老 UGOS 没有，得自己 wget 二进制） | 不需要 |
| 更新代码 | 覆盖文件 → 重新部署；前端改动只需刷新页面 | 重新 build | 重新构建 + 重新导入 |
| 代价 | 首次启动联网装依赖；之后按 requirements 哈希判断，不重复装 | SSH 是临时口令，3 天过期 | 每次改动都很重 |

**为什么主用 A**：查到的绿联实际情况是——SSH 走 **922 端口**、需在管理界面开启「远程调试」、密码是**只有 3 天有效期的手机验证码**；老 UGOS 底层是 OpenWrt + opkg，连 `apt`/`yum` 都没有，`docker compose` 得自己下载二进制安装。这条路对「以后还要改功能」的项目很不友好。

而 UGOS Pro（1.0.0.1150，2024-08 起）的 Docker 应用新增了 **「项目」** 功能，可直接粘贴 compose 部署堆叠，系统底层也已从 OpenWrt 换成 Debian。路径 A 全程点鼠标：代码放进共享文件夹 → Docker 应用新建项目 → 粘贴 yaml → 部署。

> 待确认：Docker 应用里能否看到「项目」标签页（能看到就说明是 UGOS Pro 且版本够新）。若看不到，退回路径 B 或 C。
>
> **未确认项**：UGOS「项目」页是否支持 compose 的 `build:`。本方案**不依赖 build**，所以不把它作为前置条件；如果你实测支持，可以改用 §11.5 的 Dockerfile，镜像会更可复现，但不是必需。

### 11.2 路径 A 的 docker-compose.yml（可直接用）

```yaml
services:
  teleprompter:
    image: python:3.12-slim-bookworm
    working_dir: /app
    ports:
      - "8300:8000"
    volumes:
      - ./app:/app/app:ro
      - ./web:/app/web:ro
      - ./docker/start.sh:/app/start.sh:ro
      - ./requirements.txt:/app/requirements.txt:ro
      - ./data:/data
      - ./venv:/app/.venv
    environment:
      TZ: Asia/Shanghai
      PIP_INDEX_URL: https://pypi.tuna.tsinghua.edu.cn/simple
      DATA_DIR: /data
      PYTHONDONTWRITEBYTECODE: "1"
    command: ["bash", "/app/start.sh"]
    restart: unless-stopped
```

启动脚本 `docker/start.sh`（**LF 换行**）：

```bash
#!/usr/bin/env bash
set -euo pipefail

REQ=/app/requirements.txt
VENV=/app/.venv
STAMP="$VENV/.req.sha256"

want="$(sha256sum "$REQ" | cut -d' ' -f1)"
have="$(cat "$STAMP" 2>/dev/null || true)"

if [ ! -x "$VENV/bin/uvicorn" ] || [ "$want" != "$have" ]; then
  python -m venv "$VENV"
  "$VENV/bin/pip" install --no-cache-dir -r "$REQ"
  printf '%s\n' "$want" > "$STAMP"
fi

exec "$VENV/bin/uvicorn" app.main:app \
  --host 0.0.0.0 --port 8000 --app-dir /app
```

为什么这么写：

- **不把启动脚本内联进 compose**：Compose 会对 `$` 做变量插值，`$WANT`/`$(...)` 很容易被替换；放脚本里最稳。
- **脚本必须 LF**：Windows 下编辑后若变成 CRLF，bash 会报 `$'\r': command not found`。`.gitattributes` 已强制 `*.sh eol=lf`。
- **requirements 哈希**：依赖没变时重启不联网、秒起；改了 `requirements.txt` 自动重装。
- **不写 `platform`**：`python:3.12-slim-bookworm` 是多架构镜像，自动匹配 amd64/arm64；强行写 amd64 反而有风险。
- **不写 `container_name`**：项目名已经能定位容器，少一个重名冲突点。
- **`app`/`web` 只读挂载**：应用不需要写代码目录；`PYTHONDONTWRITEBYTECODE=1` 避免只读挂载下写 `__pycache__`。
- **`./venv` 独立挂载**：重建容器不用重装依赖；首次启动约 30–60 秒，之后秒起。

### 11.3 卷路径、权限、首次启动

**卷路径**：

- UGOS Pro 的共享文件夹在系统里的绝对路径**不统一**：社区案例里出现过 `/volume/docker/...`、`/volume1/docker/...`、`/volume2/docker/...`。本项目**不写死绝对路径**，一律用 `./` 相对路径，以项目页显示的存放路径为基准。
- 绝对路径下目录不存在时，绿联不会自动 `mkdir`，compose 会直接报错；相对路径 `./data` 会由 Docker 自动创建（但建议先手动建，见下）。
- 不要把项目放在 SMB/CIFS 网络共享上再挂进容器；venv 里的符号链接和权限会出问题。用 NAS 本地 `docker` 共享文件夹。

**权限**：

- 官方 `python` 镜像默认以 root 运行，写 `./data`、`./venv` 不会失败。
- 它**不读取 PUID/PGID**；UGOS 自动注入这两个环境变量只对声明支持它们的镜像有效。不要因为「绿联会自动填」就以为官方镜像会降权。
- 代价是 `./data` 里的文件属主为 root：文件管理器通常能看、能备份，但手动改内容可能不行。应用自己（root）能正常读写。
- 建议：先在文件管理器里手动建好 `./data` 目录（归你的用户所有），这样你至少能删除/替换里面的文件；目录本身可写，文件内容仍由应用管理。
- 不要随手加 `user: "1000:1000"`：`./venv` 如果是 root 创建的，非 root 用户建 venv 会失败。保持 root 最简单。

**首次启动**：

- 日志里会看到 `pip install`，然后 `Uvicorn running on http://0.0.0.0:8000`；装依赖期间 8300 可能拒绝连接，正常。
- 如果卡在 pip：检查 NAS 到 `pypi.tuna.tsinghua.edu.cn` 的连通性，或把 `PIP_INDEX_URL` 换成能用的源；不要反复重建容器。
- 如果 venv 坏了（例如换了 Python 大版本）：在文件管理器里删除 `./venv` 目录，重新部署；会按 requirements 重建。
- 依赖升级：改 `pyproject.toml` → `uv lock` → `uv export ...` → 覆盖 `requirements.txt` → 重新部署；哈希变化会自动重装。

### 11.4 操作步骤（路径 A，全程点鼠标）

0. **先做连通性预检**：在 Docker「项目」里跑一个 hello-world 或 nginx，确认项目页能创建、相对路径能挂载、端口能映射、日志能看。再部署正式服务，避免把 UGOS 问题误判成应用问题。
1. 绿联文件管理器：在 `docker` 共享文件夹下新建目录 `teleprompter`，把项目的 `app/`、`web/`、`docker/`、`requirements.txt`、`docker-compose.yml` 传进去；顺手建一个空的 `data/` 目录。
2. Docker 应用 → **项目** → 创建 → 名称填 `teleprompter`。如果页面要求选择存放路径，选第 1 步的目录；如果按项目名自动生成，确认它指向同一目录。不要重复建。粘贴 §11.2 的 yaml（也可从 NAS 存储导入文件）→ 部署。
3. 打开该项目的「日志」页，看到 `Uvicorn running on http://0.0.0.0:8000` 即成功。
4. 平板浏览器访问 `http://<NAS_IP>:8300/api/health`，返回 `{"ok":true}` 说明网络通；再访问 `http://<NAS_IP>:8300`。
5. 以后改代码：
   - 前端：覆盖 `web/` 下的文件，平板刷新页面即可（响应头 `no-cache`）。
   - 后端：覆盖 `app/` 下的文件，在项目页点「重新部署」。
   - 依赖：按 §11.3 更新 `requirements.txt` 后重新部署；哈希变化会自动重装。

若走路径 B（SSH，仅作逃生通道，**未实测**）：

```bash
ssh root@<NAS_IP> -p 922      # 社区帖：端口 922；密码 = 开启「远程调试」时手机收到的验证码，3 天有效
cd <项目目录>                  # 以项目页显示的存放路径为准，可能是 /volume1、/volume2 或 /volume
docker compose up -d --build
```

没有 compose CLI 时，退回纯 docker：

```bash
docker build -t teleprompter:latest .
docker run -d --name teleprompter --restart unless-stopped \
  -p 8300:8000 -v "$PWD/data:/data" teleprompter:latest
```

### 11.5 Dockerfile（可选，仅路径 B/C）

```dockerfile
FROM python:3.12-slim-bookworm
COPY --from=ghcr.io/astral-sh/uv:0.12.23 /uv /uvx /bin/
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=0 \
    UV_DEFAULT_INDEX=https://pypi.tuna.tsinghua.edu.cn/simple \
    PYTHONDONTWRITEBYTECODE=1
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY app ./app
COPY web ./web
RUN uv sync --frozen --no-dev
EXPOSE 8000
CMD ["/app/.venv/bin/uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--app-dir", "/app"]
```

说明：

- `--no-install-project` 先装依赖，利用 Docker 层缓存；本项目是 virtual project（无 build-system），第二次 `uv sync` 不会安装项目本身，只补齐依赖。
- `ghcr.io/astral-sh/uv:0.12.23` 拉不到时，改成 `RUN pip install --no-cache-dir uv==0.12.23 -i https://pypi.tuna.tsinghua.edu.cn/simple`。
- 路径 A 不需要这个 Dockerfile；不要为了「有个 Dockerfile」而强行在 NAS 上 build。

### 11.6 备份与恢复

- **唯一需要备份的是 `data/`**：稿件正文、元数据、原始 docx 都在里面。
- `venv/` 是缓存，可删可重建，不备份。
- 恢复：把 `data/` 放回项目目录 → 重新部署 → 列表自动出现。
- 想重新解析旧稿：`source.docx` 还在，后续加一个「重新解析」接口即可；v1 不做。

### 11.7 部署风险与对策

| 风险 | 对策 |
| --- | --- |
| 校园网拉 `docker.io` 慢或不通（路径 A 也要拉 `python:3.12-slim-bookworm`） | 在绿联 Docker 设置里配置镜像加速器；这是路径 A 唯一的镜像拉取依赖 |
| PyPI 拉包慢/不通 | compose 里已设 `PIP_INDEX_URL` 指向清华源；失败时换成可达的源 |
| 首次启动装依赖，8300 暂时打不开 | 看日志等 `Uvicorn running`；requirements 哈希不变时后续重启不联网 |
| 8300 端口被占用 | compose 里改宿主机端口即可 |
| NAS 重启后服务没起 | `restart: unless-stopped` 已覆盖；绿联 Docker 面板里也可设为开机自启 |
| `./data` 权限/属主不符合预期 | 先手动建 `data/`；应用以 root 写入；不要依赖 PUID/PGID，也不要随手加 `user:` |
| Docker 应用里没有「项目」标签页 | 说明 UGOS 版本较老 → 退回路径 B/C，或先升级系统 |
| 项目页不支持 `build:` | 本方案不依赖 build；继续用官方镜像 + `start.sh` 装依赖 |
| 启动脚本 CRLF | `.gitattributes` 强制 LF；用 `bash start.sh` 跑之前先确认文件格式 |

---

## 12. 开发环境（本机）

```powershell
# 0. 装并锁定 Python 3.12（uv 管理，不全局安装；会生成 .python-version）
uv python install 3.12
uv python pin 3.12

# 1. 初始化（已有 PLAN.md 也能跑；--bare 只生成 pyproject.toml）
uv init --bare --python 3.12

# 2. 手动确认 requires-python（避免锁到 3.13+）
#    pyproject.toml 里写：requires-python = ">=3.12,<3.13"

# 3. 运行依赖
uv add fastapi uvicorn python-multipart

# 4. 开发依赖
uv add --dev pytest httpx2 watchfiles

# 5. 生成部署用固定版本（提交到仓库）
uv export --no-dev --no-emit-project --no-hashes --no-header --no-annotate -o requirements.txt

# 6. 起服务
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000

# 7. 测试
uv run pytest
```

- `uvicorn` 不带 `[standard]`：uvicorn 本体只需要 h11 + click，少装 uvloop/httptools/websockets 等；开发时的 `--reload` 由 dev 依赖 `watchfiles` 提供。
- `TestClient` 用 `httpx2`：Starlette 1.9 起旧 `httpx` 会触发弃用警告；它只用于测试，不进部署 `requirements.txt`。
- `pyproject.toml` 里配了 `[tool.pytest.ini_options]` 的 `testpaths` / `pythonpath`；`uv run pytest` 能直接 `import app`，不需要为了 `sys.path` 额外加 `conftest.py`（`tests/conftest.py` 只放 docx fixture）。
- `--host 0.0.0.0` 让平板能直接用电脑 IP 访问，**P0 阶段先用这个验证校园网连通性**，通了再谈容器化。
- Windows 首次运行会弹防火墙，勾选「专用网络」；否则平板访问不到。
- 本机 `DATA_DIR` 默认 `./data`（已在 `.gitignore` 里）；容器里是 `/data`。
- `requirements.txt` 每次改依赖后重新生成并提交；不要在部署时手写 `pip install fastapi` 这种浮动版本。

---

## 13. 事实核实记录（2026-10-20）

本轮重点核了「会直接影响实现」的几条。✅ = 已确认；⚠️ = 有条件成立/未完全确认；❌ = 原方案写错。

| # | 断言 | 核实结果 | 来源 |
| --- | --- | --- | --- |
| 1 | iOS Safari 不支持对普通元素全屏 | ✅ 成立。web-features 标注 Safari on iOS "Not supported"，Baseline 被 Safari 阻塞 43 个月（截至 2026-10） | [web-features: Fullscreen](https://web-platform-dx.github.io/web-features-explorer/features/fullscreen/) |
| 2 | 全屏 API 要求 HTTPS | ❌ **不要求**。MDN 只写 transient user activation + Permissions-Policy；安卓 Chrome 71+ 在 http 下可全屏 | [MDN: requestFullscreen()](https://developer.mozilla.org/en-US/docs/Web/API/Element/requestFullscreen) |
| 3 | 内网 http 下 Wake Lock 不可用 | ✅ 成立。MDN 标注 secure-context only；私网 IP 不属于 potentially trustworthy | [MDN: Navigator.wakeLock](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/wakeLock) |
| 4 | Wake Lock 在 iOS 的版本 | ⚠️ Safari on iOS 16.4–18.3 部分支持（standalone 主屏幕下不工作，WebKit bug 254545），18.4 起完整；web-features 标 18.4，Baseline 2025-03-31。**http 下反正不可用，v1 不实现** | [MDN 镜像](https://monge.univ-eiffel.fr/~forax/MDN/en-US/docs/Web/API/Navigator/wakeLock.html)、[web-features: Wake Lock](https://web-platform-dx.github.io/web-features-explorer/features/screen-wake-lock/) |
| 5 | `dvh/svh/lvh` 需要 JS 兜底 | ❌ **不需要**。iOS Safari 15.4 起支持，CSS 层叠即可 | [caniuse: viewport unit variants](https://caniuse.com/viewport-unit-variants) |
| 6 | `content-visibility: auto` 可用于长文测量 | ❌ **不能**。它开启 layout/style/paint containment，未渲染内容的尺寸由 `contain-intrinsic-size` 估算，`offsetTop/offsetHeight` 不再可信 | [MDN: content-visibility](https://developer.mozilla.org/en-US/docs/Web/CSS/content-visibility) |
| 7 | `python:3.12-slim-bookworm` 自带 tzdata/venv/pip | ✅ 成立。官方 Dockerfile 安装 `tzdata`/`ca-certificates`/`netbase`，Python 构建带 `--with-ensurepip` | [docker-library/python Dockerfile](https://raw.githubusercontent.com/docker-library/python/master/3.12/slim-bookworm/Dockerfile) |
| 8 | Compose `environment` 可以写 `- TZ: Asia/Shanghai` | ❌ **不合法**。只能是映射，或字符串数组 `- TZ=Asia/Shanghai` | [Docker Compose services: environment](https://docs.docker.com/reference/compose-file/services/#environment) |
| 9 | UGOS Pro 卷路径是 `/volume/docker/...` | ❌ **不统一**。社区实机有 `/volume1`、`/volume2`、`/volume` 三种；不要写死绝对路径，统一用 `./` | [绿联 compose 项目实测](https://post.smzdm.com/p/arr08d5q/)、[openclaw 教程](https://club.ugnas.com/forum.php?mod=viewthread&tid=3114)、[homelab README](https://github.com/alisohail/ugreen-nas-homelab) |
| 10 | 绿联「项目」会自动建目录、支持相对路径 | ✅ 成立。项目名对应 docker 共享文件夹下的同名目录；绝对路径目录必须预先存在；相对路径 `./data` 可用 | [绿联 compose 项目实测](https://post.smzdm.com/p/arr08d5q/) |
| 11 | 绿联会自动注入 PUID/PGID，权限不用管 | ⚠️ 注入环境变量是真，但**官方 Python 镜像不读它们**；容器仍以 root 写文件。不要依赖它降权 | 同上 + 官方镜像行为 |
| 12 | 绿联「项目」支持 compose `build:` | ⚠️ **未找到权威说明**。本方案不依赖 build；若实测支持，可改用 Dockerfile | —— |
| 13 | `python-docx` 读不到文本框 | ✅ 本机实测（python-docx 1.2.0）：文本框内容出现 0 次 | `tests/probe_docx_textbox.py` |
| 14 | XML 直读会把文本框读两遍 | ✅ 本机实测：Word 在 `mc:Choice` 和 `mc:Fallback` 各存一份，必须剪掉 Fallback | 同上 |
| 15 | `uv export` 能生成部署用固定版本 | ✅ 本机验证（uv 0.12.23）：`uv export --no-dev --no-emit-project --no-hashes --no-header --no-annotate -o requirements.txt` 可用 | 本机命令 |
| 16 | 绿联 SSH 是 922 端口 + 3 天验证码 | ⚠️ 来自社区帖，本次未复核成功（页面 521）。只影响路径 B，不影响主路径 A | [CSDN 社区帖](https://blog.csdn.net/qq_28550263/article/details/139510912) |

> 说明：本机校园网 DNS 会把不少站点解析到 `198.18.x.x`（透明代理段），`web_fetch` 会以「非公网 IP」拒绝；上述页面是通过本机 HTTP 客户端 + 文本提取读到的。MDN 原文用 `monge.univ-eiffel.fr` 镜像交叉验证。网页内容会变，关键结论以本机实测/项目验收为准。

**仍需实机验证（无法靠查资料确认）**：

1. 静音 mp4 循环能否在**你那台 iPad 的具体 iOS 版本**上真正阻止息屏；不行就退化为「提示把系统自动锁定调长」。
2. UGOS「项目」页：相对路径、8300 端口、重启策略、日志是否都符合 §11.4 的描述。
3. 项目页是否支持 `build:`（不影响主路径，但决定以后要不要换 Dockerfile）。
4. 两台平板上的镜像/翻转/触控分区是否一致，尤其是 flipX+flipY 同时开。
5. 真实 docx（含文本框、表格、艺术字）解析后的字数与原文是否一致。
6. 1 万字稿的首次测量耗时；超过 100ms 再考虑分块测量。
7. 校园网 AP 隔离/NAS 防火墙是否放行 8300。

---

## 14. 本轮修订（相对上一版）

**修正的硬伤**：

1. **compose `environment` 语法**：原草案 `- TZ: Asia/Shanghai` 是「数组套映射」，不合法；改为映射写法。
2. **`platform: linux/amd64`**：多架构镜像不需要；强行指定在 ARM 上反而起不来。删除。
3. **部署依赖浮动**：原草案容器启动时 `pip install fastapi ...` 不固定版本；改为 `requirements.txt`（`uv export` 生成）+ 哈希判断，重启不联网。
4. **启动脚本内联**：Compose 会插值 `$`，CRLF 会炸；改为 `docker/start.sh` + `.gitattributes` 强制 LF。
5. **`content-visibility` 懒测量**：会开启 size containment，破坏 `offsetTop/offsetHeight`；v1 改为全量测量。
6. **UGOS 路径写死**：`/volume/docker` 不是所有机器都一样；改为相对路径，绝对路径以项目页为准。
7. **PUID/PGID 误解**：官方 Python 镜像不读这两个变量；明确 root 运行与文件属主后果。
8. **进度记忆自相矛盾**：§1 说不做、§4/§5 又说存；统一为「不存播放进度，只存设备偏好」。
9. **防息屏写 Wake Lock**：http 下必然不可用；v1 只做静音 mp4，删除死代码。
10. **API 双 Content-Type**：原草案同时支持 multipart 和 JSON；改为统一 FormData，少一个分支。
11. **字数口径两套**：原计划前后端各算一遍；改为后端返回每段 `units`，前端只加总。
12. **`uvicorn[standard]`**：部署用不到 uvloop/websockets；改为普通 `uvicorn`，开发用 `watchfiles` 提供 `--reload`。

**简化的地方**：

- 主路径只保留 A；B/C 压缩成逃生通道，不再并列维护三套步骤。
- 删除 Wake Lock 分支、`content-visibility` 分支、进度持久化分支。
- 明确「全量测量」为默认，性能优化降级到 P5。
- 把「字数/解析/CRUD」测试写进 P2 验收，不靠人工点。

**保持不变的核心判断**：

- Tier 1 文件稿件库（不是 localStorage，也不是数据库）。
- 原生无构建前端。
- docx 用标准库 XML 直读 + 跳过 `mc:Fallback`。
- 字/分钟 → 像素映射 + `translate3d`。
- 单容器、单端口、单数据卷。
