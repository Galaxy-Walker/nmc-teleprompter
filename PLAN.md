# 提词器（Teleprompter）技术方案

> 目标：平板浏览器打开一个内网网页，上传 md/docx，镜像翻转显示，按「字/分钟」匀速自动滚动。
> 部署：绿联 NAS 上的 Docker 容器，校园网内网访问 `http://<NAS_IP>:8300`。

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
| 部署 | 绿联 DXP 系列（x86_64 / amd64），**NAS 上 SSH + `docker compose build`** |

### 功能范围（已确认）

**做**：md/docx/txt 上传解析 · 稿件库（列表/重命名/删除/粘贴新建）· 字/分钟匀速滚动 · 水平镜像 + 上下翻转 · 字号/行距/配色调节 · 焦点行指示线 · 屏幕常亮兜底（静音音频）· 开播前 3-2-1 倒计时 · 触控分区操作 · 键盘快捷键（接电脑时）

**不做**：多设备遥控（手机控平板）· 账号/鉴权 · HTTPS · 逐屏翻页模式 · 标题样式/图片/表格/公式渲染 · PWA/Service Worker（http 内网下不可用）· 记忆上次播放位置（未选，架构上留了 localStorage 位置，随时可加）

---

## 2. 架构总览

```
平板浏览器（校园网 Wi-Fi）
      │  http://<NAS_IP>:8300
      ▼
┌─────────────────────────────────────────┐
│ Docker 容器: teleprompter               │
│  uvicorn + FastAPI                      │
│   ├─ GET  /            → web/ 静态文件  │
│   ├─      /api/scripts → 稿件库 CRUD    │
│   └─      /data        → 挂载到 NAS 目录 │
└─────────────────────────────────────────┘
```

一个容器、一个端口、一个数据卷。前端静态文件由 FastAPI 的 `StaticFiles` 直接托管，不引入 nginx。

---

## 3. 技术选型与理由

| 层 | 选型 | 理由 | 备选 & 未选原因 |
| --- | --- | --- | --- |
| 语言/框架 | Python 3.12 + FastAPI + uvicorn | 本机已有 uv；multipart 上传、JSON、自动 `/docs` 调试页开箱即用；单文件可跑 | Flask（可用但类型/文档弱）；Node/Next（前端要构建链，维护成本更高） |
| 依赖管理 | uv（`uv.lock` + 容器内 `uv sync --frozen`） | 符合本机现状，可复现、构建快 | pip + requirements.txt（也行，uv 更快更稳） |
| docx 解析 | **标准库** `zipfile` + `xml.etree`，提取 `word/document.xml` 里的 `<w:p>` / `<w:t>` | docx 本质是 zip+xml；零依赖；**连文本框里的文字都能拿到**（`python-docx` 恰好会漏掉文本框） | `python-docx`（读不到文本框）；pandoc/mammoth（重，需额外二进制或 JS 库） |
| md 处理 | 轻量清洗：去 `#`、`*`、`` ` ``、`[]()`、代码围栏、内联 HTML，保留段落与换行 | 念稿要的是「一行一句」的干净文本，不需要样式渲染 | markdown-it-py → HTML → 取文本（多两个依赖，标题层级用不上） |
| 前端 | 原生 HTML + CSS + ES Modules，**无构建、无框架、无 npm** | 你不懂前端也能看懂和改；出问题 F12 直接定位；容器里不用装 Node | Vue3 + Vite + TS（组件化更好，但要构建链，镜像更大） |
| 数据存储 | 文件系统 `/data/scripts/<id>/`，**无数据库** | 稿件量很小；可直接在绿联文件管理器里看到文件，出错好排查 | SQLite（需迁移/ORM，收益低） |
| 部署 | 单容器 + docker compose | 最简 | nginx + api 双容器（多一层网络配置） |

### 稿件在磁盘上的样子

```
/data/scripts/2026-10-20_开学致辞/
├── source.docx      # 原始上传文件（原样留存，便于回溯）
├── text.txt         # 解析后的干净纯文本（一行一段）
└── meta.json        # {"title": "...", "chars": 1234, "created_at": "...", "updated_at": "..."}
```

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

> 折中做法：UI 偏好（字号、速度、翻转、配色、上次播放位置）存 **浏览器 localStorage**，稿件正文存 **NAS**。
> 偏好属于设备，稿件属于内容——这样多设备互不干扰。

---

## 5. 核心算法：「字/分钟」→ 平滑像素滚动

这是提词器最容易做砸的地方。如果用「像素/秒」，换个字号体感速度就全变了。做法：

1. **测量**：渲染完成后遍历每个段落块，用 `offsetTop` / `offsetHeight` 建立
   `cumChars[i] → cumPixels[i]` 的分段线性映射表。
2. **播放**：每帧 `charsRead = wpm / 60 * elapsed`，二分查表插值得到目标 `y`，
   用 `transform: translate3d(0, -y, 0)` 移动内容层（不用 `scrollTop`，避免 iOS 惯性滚动干扰）。
3. **重测**：字号 / 行距 / 边距 / 翻转 / 横竖屏变化 → 重新测量映射表，
   **并保持「当前字符位置」不变**（改字号不会跳回开头）。
4. **反查**：手动拖动定位、暂停、保存进度时，由 `y` 反查 `charsRead`，因此进度可以用
   「第几个字 / 百分比」表示，与字号无关。

字数口径：中文按字符计，连续拉丁字母/数字串按 1 个词计（`200 字/分钟` 对中英混排都合理）。
默认速度 220，可调范围 60–600。

---

## 6. 交互设计（仅平板自身操作）

**播放页**

- 内容单列，最大宽度约 60%（左右留黑边，减少眼球横移）
- 焦点线：距顶约 30% 处一条 2px 半透明横线 + 上方轻微渐变遮罩，眼睛跟住这里
- 触控分区（按逻辑坐标，见 §7 的镜像坑）：
  - 左 25% = 减速（-20 字/分）
  - 右 25% = 加速（+20 字/分）
  - 中 50% = 暂停 / 继续
  - 暂停状态下可单指上下拖动自由定位
- 控制条（双指点击或点顶部边缘呼出，3 秒自动隐藏）：
  速度滑杆+数字、字号、行距、镜像X、镜像Y、配色、全屏、进度条（可拖）、返回稿件库
- 键盘快捷键（接笔记本时可用）：`空格` 暂停、`↑↓` 调速、`←→` 前后跳 5 秒、`F` 全屏、`M` 镜像

**稿件库页**：列表（标题/字数/更新时间）、上传（拖拽或点选）、粘贴文本新建、重命名、删除（二次确认）、点击进入播放。

---

## 7. 已知的坑与对策（内网 http + iPad Safari）

| # | 坑 | 影响 | 对策 |
| --- | --- | --- | --- |
| 1 | `http://192.168.x.x` **不是 secure context** | 屏幕常亮（Wake Lock）、Service Worker、剪贴板 API 全部不可用 | ① 探测 Wake Lock，可用就用；② 不可用时兜底：播放期间循环播放一段 **0 音量音频**（点击「播放」的用户手势正好满足自动播放策略）阻止息屏；③ 再兜底：提示把系统自动息屏调长 |
| 2 | iOS/iPadOS Safari **不支持对普通元素的全屏 API**（仅 `<video>`） | iPad 上无法真全屏，顶部留地址栏 | ① `webkitRequestFullscreen` + try/catch；② 引导「添加到主屏幕」获得 standalone 无地址栏体验；③ UI 用 `dvh` 自适应，不依赖全屏 |
| 3 | iOS `100vh` 包含地址栏高度 | 底部内容被遮 | 用 `100dvh`，并以 JS 写入 `--vh` 兜底 |
| 4 | 整屏 `scaleX(-1)` 后**左右触控区反转** | 点「加速」变成「减速」 | 点击坐标先做逆变换转成逻辑坐标：`lx = flipX ? W - x : x`，`ly = flipY ? H - y : y`，再判定分区 |
| 5 | 控制条是否要跟着翻转？ | —— | **要跟着翻**。通过分光镜看到的是整屏，控制条一起翻转才是正的；不要给它单独反向翻转 |
| 6 | docx 文本框 / 艺术字里的文字 | `python-docx` 读不到，稿件缺内容 | 用 §3 的 XML 直读方案，天然覆盖 |
| 7 | 校园网 AP 隔离 / 客户端隔离，平板 ping 不通 NAS | 页面打不开 | 部署后先用平板访问 `http://NAS_IP:8300/api/health` 验证；不通则检查 NAS 防火墙、确认同一网段/VLAN，或临时用手机热点验证功能 |
| 8 | 绿联 NAS CPU 架构（Intel N100/N305 = amd64，部分型号 ARM） | 镜像跑不起来 | compose 里显式 `platform`，构建时 `--platform linux/amd64` |
| 9 | 长文一次性重排 | 万字稿首次渲染可能卡顿 | 段落级懒测量 + `content-visibility: auto`；首屏只测前若干段，滚动中增量补测 |
| 10 | 播放中切后台 / 来电话 | 计时错乱，回来位置跳飞 | `visibilitychange` 时暂停并记录位置，回前台从原位继续 |

---

## 8. 项目结构

```
teleprompter/
├── PLAN.md                 # 本文件
├── README.md               # 部署与使用说明（最后写）
├── pyproject.toml          # uv 管理：fastapi / uvicorn / python-multipart
├── uv.lock
├── Dockerfile
├── docker-compose.yml
├── app/
│   ├── main.py             # FastAPI 应用、路由、静态托管
│   ├── library.py          # 稿件库：列目录 / 存 / 读 / 改 / 删
│   └── parse.py            # docx|md|txt → 干净纯文本段落列表
├── web/
│   ├── index.html
│   ├── style.css           # CSS 变量驱动字号/行距/配色/翻转
│   ├── library.js          # 稿件库视图 + 上传
│   ├── player.js           # 播放核心：测量 / 滚动 / 速度模型 / 触控
│   ├── settings.js         # 设置项 + localStorage 持久化
│   └── wake.js             # 常亮：Wake Lock 探测 + 静音音频兜底
├── samples/                # 测试稿：长文、中英混排、带格式的 docx
└── data/                   # 运行时稿件目录（.gitignore 忽略）
```

---

## 9. API 草案

```
GET    /                     → index.html
GET    /api/health           → {"ok": true}
GET    /api/scripts          → [{"id","title","chars","updated_at"}]
POST   /api/scripts          → multipart(file[, title]) 或 json({title, text}) → {id,title,chars}
GET    /api/scripts/{id}     → {"id","title","paragraphs":[...],"chars"}
PATCH  /api/scripts/{id}     → {"title"?,"text"?}
DELETE /api/scripts/{id}     → 204
```

错误统一 `{"detail": "..."}`；上传限制 10MB，扩展名白名单 `.md .markdown .txt .docx`。

---

## 10. 实施步骤

| 阶段 | 内容 | 验收 |
| --- | --- | --- |
| **P0** | uv 初始化 + FastAPI + 静态托管 + `/api/health` | 本机 `uv run` 起服务，**平板访问 `http://<PC_IP>:8000/api/health` 通**（先排掉校园网连通性问题） |
| **P1** | 播放核心：测量映射表、字/分钟滚动、触控分区、镜像/翻转、字号/行距/配色、焦点线 | 用 `samples/long.md` 在两台平板上滚得平滑、镜像正确、触控不错位 |
| **P2** | 上传解析（docx/md/txt）+ 稿件库列表/删除 | 传一个带文本框的 docx，内容不缺 |
| **P3** | 常亮兜底、全屏兜底、进度记忆、`visibilitychange` 处理 | 播放 5 分钟不息屏；切后台回来位置不乱 |
| **P4** | Dockerfile + compose，NAS 上跑通，写 README | NAS 重启后容器自启，稿件还在 |
| **P5** | 打磨：设置面板收纳、误触防护、横竖屏切换重测量、万字稿性能 | —— |

---

## 11. 部署方案（绿联 DXP / amd64 / NAS 上构建）

### 11.1 交付物

```
teleprompter/  →  打包成 tar.gz 或 git clone 到 NAS 的某个共享目录，例如 /volume1/docker/teleprompter
```

### 11.2 Dockerfile（草案）

```dockerfile
FROM python:3.12-slim
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=0 \
    UV_DEFAULT_INDEX=https://pypi.tuna.tsinghua.edu.cn/simple
COPY --from=ghcr.io/astral-sh/uv:0.5 /uv /uvx /bin/
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project   # 依赖层单独缓存，改代码不重装依赖
COPY app ./app
COPY web ./web
RUN uv sync --frozen --no-dev
EXPOSE 8000
CMD ["/app/.venv/bin/uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### 11.3 docker-compose.yml（草案）

```yaml
services:
  teleprompter:
    build: { context: . }
    image: teleprompter:latest
    platform: linux/amd64
    container_name: teleprompter
    ports: ["8300:8000"]
    volumes: ["./data:/data"]
    environment: { TZ: Asia/Shanghai }
    restart: unless-stopped
```

### 11.4 NAS 上的操作

```bash
ssh <user>@<NAS_IP>
cd /volume1/docker/teleprompter
docker compose up -d --build
docker compose logs -f          # 看到 Uvicorn running on 0.0.0.0:8000 即成功
curl http://127.0.0.1:8300/api/health
```

之后平板访问 `http://<NAS_IP>:8300`。更新代码 = 覆盖文件后 `docker compose up -d --build`。

### 11.5 部署风险与对策

| 风险 | 对策 |
| --- | --- |
| 校园网拉 `docker.io` / `ghcr.io` 慢或不通 | 在绿联 Docker 设置里配镜像加速器；`uv` 那一层若拉不到，改成 `pip install uv -i <清华源>` |
| PyPI 拉包慢 | Dockerfile 里已设 `UV_DEFAULT_INDEX` 指向清华源 |
| 8300 端口被占用 | compose 里改宿主机端口即可 |
| NAS 重启后服务没起 | `restart: unless-stopped` 已覆盖；绿联 Docker 面板里也可设为开机自启 |
| 稿件目录权限写不进去 | `./data` 先在 NAS 上建好并确认 UID 可写，必要时 compose 加 `user: "1000:1000"` |

---

## 12. 开发环境（本机）

```bash
uv init --python 3.12 && uv add fastapi "uvicorn[standard]" python-multipart
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

`--host 0.0.0.0` 让平板能直接用电脑 IP 访问，**P0 阶段先用这个验证校园网连通性**，通了再谈容器化。

