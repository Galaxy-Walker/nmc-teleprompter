# 提词器（Teleprompter）

内网自用的平板提词器：浏览器打开，输入访问密码，上传 md / docx / txt，镜像翻转，按「字/分钟」匀速滚动。

## 实机测试状态（重要）

- **绿联 NAS**：已按 Docker「项目」方式部署，`/api/health`、稿件库、播放正常（2026-10-21）；NAS 重启后的容器自启和 `data/` 持久化建议再验一次。
- **2026-10-21 界面更新**：访问密码、操作教程、右上角设置按钮、速度提示已在本机用无头浏览器完成登录/播放/教程全流程验收；NAS 和 Android 平板需更新代码并重新部署后再做实机回归。
- **Android 平板**：实机验证通过（稿件库、播放、镜像、触控、上传、防息屏）。
- **iPad**：手边没有 iPad，**未做任何实机验证**。iPad Safari 的播放、镜像、全屏降级、添加到主屏幕、长时间防息屏都待验证。
- **防息屏**：播放时会启动一段带静音音轨的常驻视频（Android 优先 WebM，iOS 用 MP4）。
  - 如果某台设备仍然息屏：说明该浏览器/系统不认这个兜底，请把系统的「自动锁定」时间调长。
  - HTTP 内网不是 secure context，`navigator.wakeLock` 不可用，所以没有走标准 Wake Lock API。

## 功能

- 访问密码：登录后 30 天内免密，稿件库右上角可「退出登录」
- 操作教程：首次访问自动弹出；稿件库、开始页、设置面板里都有「📖 使用教程」入口
- 稿件库：上传、粘贴新建、重命名、删除
- 输入格式：`.md` / `.markdown` / `.txt` / `.docx`，上传限制 10MB
- docx 直读 XML：文本框里的文字能读到，`mc:Fallback` 不会重复
- 播放：3-2-1 倒计时、字/分钟匀速滚动、焦点线、暂停/拖动、进度条
- 显示：水平镜像、上下翻转、字号、行距、暗底/亮底/琥珀三种配色
- 触控：左/右 25% 调速，中间暂停，顶部边缘/双指点按呼出控制条
- 设置：右上角常驻「⚙ 设置」按钮；面板**不会自动关闭**，点「关闭」或画面空白处才收起
- 速度提示：右上角小字实时显示当前「速度 xxx 字/分」
- 快进：拖动进度条；键盘 ←/→ 跳 5 秒
- 键盘：空格暂停、↑↓ 调速、←→ 跳 5 秒、F 全屏、M 镜像、Esc 关闭设置
- 全屏：Android Chrome 可用；iPad 隐藏按钮，提示「添加到主屏幕」
- 设备偏好存 `localStorage`；**不记忆播放进度**，刷新后从开头播放

## 快速开始

已经部署到 NAS 的话，直接打开 `http://<NAS_IP>:8300`；下面是本机开发环境的启动方式（端口 8000）。

要求：Python 3.12（用 uv 管理）、Windows / Linux / macOS 均可；前端不需要 Node、不需要构建。

```powershell
# 1. 安装并锁定 Python 3.12
uv python install 3.12
uv python pin 3.12

# 2. 安装依赖
uv sync

# 3. 设置访问密码（不设置的话，首次启动会生成一个随机密码并打印到日志）
$env:TELEPROMPTER_PASSWORD = "换成你自己的密码"

# 4. 启动
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

本机打开 `http://127.0.0.1:8000`，输入密码；平板用同一 Wi-Fi，打开：

```text
http://<电脑的局域网 IP>:8000
```

Windows 第一次运行会弹防火墙，允许「专用网络」；如果平板打不开，先查防火墙和校园网 AP 隔离。

> 密码是启动时读取的环境变量。改了密码要重启服务；旧登录 Cookie 会自动失效。

## 使用

1. 打开页面，先输入访问密码；登录状态会保留 30 天。首次访问会自动弹出操作教程，之后可从稿件库、开始页或设置面板的「📖 使用教程」再次打开。
2. 首屏是稿件库。点「上传文件」选 md/docx/txt，或点「粘贴文本」新建。
3. 点列表里的稿件进入播放页，点「开始播放」，3-2-1 后开始滚动。
4. 播放中：
   - 点屏幕**中间 50%**：暂停 / 继续；暂停后单指上下拖动可定位
   - 点屏幕**左侧 25%**：减速；**右侧 25%**：加速（每次 20 字/分）
   - 点右上角 **「⚙ 设置」**：打开设置面板；也可点顶部边缘或双指点按
   - 右上角小字会实时显示「速度 xxx 字/分」和当前进度
   - 设置面板**不会自动关闭**，点「关闭」或画面空白处才收起
   - 设置面板里可调速、字号、行距、配色、镜像、拖动进度、全屏
5. 设置面板里的「返回稿件库」和结束页的「返回稿件库」都会回到列表；稿件库右上角可「退出登录」。

### 键盘快捷键（接电脑时）

`空格` 暂停 / 继续 · `↑` `↓` 调速 · `←` `→` 跳 5 秒 · `F` 全屏 · `M` 镜像 · `Esc` 关闭设置。

## 支持格式与限制

| 格式 | 说明 |
| --- | --- |
| `.md` / `.markdown` | 按行清洗 Markdown 标记，一行一段 |
| `.txt` | UTF-8（含 BOM）/ UTF-16 / GB18030 自动识别，一行一段 |
| `.docx` | 读 `word/document.xml`；文本框可读，`mc:Fallback` 去重 |
| `.doc` | **不支持**，会提示另存为 `.docx` |

其他限制：

- 页眉、页脚、脚注、尾注不读
- 艺术字如果走 DrawingML 的 `a:t`，不保证读到；建议用真实稿件验收
- 单文件 10MB；上传内容只保存在 NAS/本机 `data/`，不执行
- 这是**简单密码门**，不是完整账号系统：内网 HTTP 下密码和 Cookie 是明文传输的，能防住误入和随手访问，防不住同网段抓包。不要把端口映射到公网；需要更强安全时请套 HTTPS 反代或走 VPN

## 数据与备份

```text
data/scripts/<id>/
├── source.docx      # 原始上传文件
├── text.txt         # 解析后的一行一段
└── meta.json        # 标题、字数、时间、原文件名

data/.access-password  # 未设置 TELEPROMPTER_PASSWORD 时生成的访问密码
```

- **唯一需要备份的是 `data/`**（含 `.access-password`）。
- `.venv/`、`venv/` 是依赖缓存，可删可重建，不需要备份。
- 示例稿只在首次启动、稿件库为空时生成一次；删掉后重启不会复活。
- 忘记密码：如果设过 `TELEPROMPTER_PASSWORD`，看 compose 里的值；否则看 NAS 上的 `data/.access-password`，或直接设置新的环境变量后重新部署。

## 部署到绿联 NAS（Docker）

已按 UGOS Pro 的 Docker 应用 →「项目」直接粘贴 compose 的方式部署并正常使用：不 SSH、不在 NAS 上构建镜像。下面是重装/迁移时的步骤。

### 1. 准备文件

在 NAS 的 `docker` 共享文件夹下新建 `teleprompter/`，只上传这些：

```text
teleprompter/
├── app/
├── web/
├── samples/
├── docker/start.sh
├── .env.example
├── requirements.txt
└── docker-compose.yml
```

再手动建一个空目录 `data/`，稿件会写在这里。不要上传本机的 `.venv/`、`tests/`、`.tmp/`；迁移旧稿件时只拷 `data/`。

### 2. 设置访问密码

把仓库里的 `.env.example` 复制为 `.env`（两个文件都在 `docker-compose.yml` 同目录）：

```powershell
Copy-Item .env.example .env      # NAS 的终端里可以用 cp .env.example .env
```

然后编辑 `.env`，把密码换掉：

```env
TELEPROMPTER_PASSWORD=换成你自己的密码
```

`.env` 已在 `.gitignore` 里，不会被提交。也可以跳过 `.env`，直接把 compose 里的 `TELEPROMPTER_PASSWORD: "${TELEPROMPTER_PASSWORD:-}"` 改成固定值。两者都不做也可以：首次启动会生成随机密码，并在项目日志里打印「已生成初始访问密码：xxxxxxxx」，同时存到 `data/.access-password`。

> `.env` 只给 Docker Compose 读取；本机直接 `uv run` 时仍按「快速开始」里的方式设置环境变量。

### 3. 创建项目

1. 第一次用「项目」页，建议先跑一个 hello-world 或 nginx，确认端口映射、相对路径、日志都正常，再部署本项目。
2. Docker 应用 → 项目 → 创建，名称填 `teleprompter`，存放路径选第 1 步的目录。
3. 粘贴 `docker-compose.yml` 的内容（或从 NAS 存储导入文件），点部署。
4. 首次启动会在容器内建 `venv` 并按 `requirements.txt` 安装依赖，约 30–60 秒；日志出现 `Uvicorn running on http://0.0.0.0:8000` 即成功。健康检查要等这个阶段结束才会变绿。

如果项目页按名称自动生成目录，确认它和上传目录是同一个；不是的话把文件移到项目目录，或删掉项目重建。

### 4. 访问

```text
http://<NAS_IP>:8300/api/health   # 期望 {"ok":true}（健康检查不需要密码）
http://<NAS_IP>:8300              # 输入访问密码后进入
```

宿主机端口是 `8300`，容器内是 `8000`。要改端口，改 compose 里 `"8300:8000"` 的左边。

如果打不开登录页，或忘记密码：看项目日志里的「初始访问密码」，或到 NAS 的 `data/.access-password` 读取；也可以在 `.env` / compose 里设置 `TELEPROMPTER_PASSWORD` 后重新部署。

本次部署已通过健康检查和实际使用；如果重装或迁移，建议按这个顺序再验收：健康检查 → 登录 → 上传一篇稿 → 播放/镜像 → 重启 NAS → 再访问，确认容器自启且稿件还在。

### 5. 更新代码

- 前端：覆盖 `web/` 下的文件，平板刷新页面即可（响应头 `no-cache`）。
- 后端：覆盖 `app/` 下的文件，在项目页点「重新部署」。
- 依赖：改 `pyproject.toml` → `uv lock` → 重新导出 `requirements.txt` → 覆盖后重新部署。启动脚本按 requirements 的 SHA-256 判断，变了才重装。

### 6. 常见问题

| 现象 | 处理 |
| --- | --- |
| 没有「项目」标签页 | UGOS 版本较老；升级系统，或用下面的 Dockerfile |
| 拉不到 `python:3.12-slim-bookworm` | 在绿联 Docker 设置里配置镜像加速器 |
| pip 慢或失败 | compose 已用清华源；换成 NAS 能访问的 `PIP_INDEX_URL` |
| 8300 打不开 | 看项目日志；确认 NAS 防火墙放行 8300/TCP，平板和 NAS 同网段 |
| 一直停在登录页 / 密码不对 | 以 `TELEPROMPTER_PASSWORD` 为准（改完要重启）；没有设置就看日志或 `data/.access-password` |
| 想让某台设备重新登录 | 稿件库右上角「退出登录」，或清浏览器 Cookie |
| 容器一直 unhealthy | 首次安装可能超过 90 秒，等日志出现 `Uvicorn running`；仍不行就看 pip 报错 |
| `data/` 里的文件属主是 root | 官方镜像默认 root；先手动建 `data/`，不要随手加 `user:` |
| 启动脚本报 `$'\r'` | `docker/start.sh` 必须是 LF；仓库已用 `.gitattributes` 固定 |

### 可选：自己构建镜像

如果「项目」页不可用，或想固定镜像：把根目录的 `Dockerfile` 和 `.dockerignore` 也传到项目目录，然后：

```bash
docker build -t teleprompter:latest .
docker run -d --name teleprompter --restart unless-stopped \
  -p 8300:8000 -v "$PWD/data:/data" \
  -e TELEPROMPTER_PASSWORD="换成你自己的密码" \
  teleprompter:latest
```

Dockerfile 里已设 `DATA_DIR=/data`；数据仍然只在 `data/`。路径 B/C 的细节见 `PLAN.md` §11。

## 开发与测试

```powershell
$env:TELEPROMPTER_PASSWORD = "dev-password"
uv run pytest -q          # 后端测试
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

`pytest` 会在 `tests/conftest.py` 里把密码固定成 `test-pass`，不影响本机环境。

播放器测试可用 Node.js 18+ 运行（仅测试需要，部署仍无需 Node）：

```sh
node --test tests/test_progress.mjs tests/test_player_lifecycle.cjs
```

测试覆盖快进、回退、结束、重播，以及 60/120 Hz 下的显示一致性和 DOM 写入次数。
生命周期测试通过模拟 DOM、字体加载和动画帧验证切稿、取消初始化、重复销毁及异常清理；不替代浏览器或平板实机验收。

修改依赖后重新生成部署用固定版本：

```powershell
uv export --no-dev --no-emit-project --no-hashes --no-header --no-annotate -o requirements.txt
```

`DATA_DIR` 可指定数据目录，默认 `./data`；容器里一般是 `/data`。`TELEPROMPTER_PASSWORD` 不设置时，密码会生成在 `DATA_DIR/.access-password` 并打印到日志。

## 目录

```text
app/            FastAPI、密码门、稿件库、md/docx/txt 解析
web/            无构建前端（登录页 + 稿件库 + 播放器 + 教程）
docker/         容器启动脚本 start.sh
tests/          解析/稿件库/API/密码测试 + docx 探针
samples/        示例稿
data/           运行时稿件和生成密码（不入库）
Dockerfile      可选，自建镜像时用
docker-compose.yml  绿联「项目」部署
.env.example    访问密码模板（复制为 .env 填写）
PLAN.md         技术方案与已知坑
```

## 下一步

- **P5**：横竖屏重测量、万字稿性能、误触防护等打磨。
- **iPad**：有设备后按「实机测试状态」逐项验收。

## License

MIT，见 [LICENSE](LICENSE)。

