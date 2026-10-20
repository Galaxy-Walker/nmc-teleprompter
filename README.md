# 提词器（Teleprompter）

内网自用的平板提词器：浏览器打开，上传 md / docx / txt，镜像翻转，按「字/分钟」匀速滚动。

**当前阶段：P0–P3 已完成，P4（Docker / 绿联 NAS 部署）尚未开始。**

## 实机测试状态（重要）

- **Android 平板**：已做过浏览器验证（稿件库、播放、镜像、触控、上传）。
- **iPad**：手边没有 iPad，**未做任何实机验证**。iPad Safari 的播放、镜像、全屏降级、添加到主屏幕、长时间防息屏都待验证。
- **防息屏**：播放时会启动一段带静音音轨的常驻视频（Android 优先 WebM，iOS 用 MP4），控制条里会显示「防息屏：视频播放中」。
  - 如果 Android 上仍然息屏：先开控制条确认状态；若显示「视频播放中」但系统仍锁屏，说明该浏览器/系统不认这个兜底，请把系统的「自动锁定」时间调长。
  - HTTP 内网不是 secure context，`navigator.wakeLock` 不可用，所以没有走标准 Wake Lock API。

## 功能

- 稿件库：上传、粘贴新建、重命名、删除
- 输入格式：`.md` / `.markdown` / `.txt` / `.docx`，上传限制 10MB
- docx 直读 XML：文本框里的文字能读到，`mc:Fallback` 不会重复
- 播放：3-2-1 倒计时、字/分钟匀速滚动、焦点线、暂停/拖动、进度条
- 显示：水平镜像、上下翻转、字号、行距、暗底/亮底/琥珀三种配色
- 触控：左/右 25% 调速，中间暂停，顶部边缘/双指点按呼出控制条
- 键盘：空格暂停、↑↓ 调速、←→ 跳 5 秒、F 全屏、M 镜像
- 全屏：Android Chrome 可用；iPad 隐藏按钮，提示「添加到主屏幕」
- 设备偏好存 `localStorage`；**不记忆播放进度**，刷新后从开头播放

## 快速开始

要求：Python 3.12（用 uv 管理）、Windows / Linux / macOS 均可；前端不需要 Node、不需要构建。

```powershell
# 1. 安装并锁定 Python 3.12
uv python install 3.12
uv python pin 3.12

# 2. 安装依赖
uv sync

# 3. 启动
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

本机打开 `http://127.0.0.1:8000`；平板用同一 Wi-Fi，打开：

```text
http://<电脑的局域网 IP>:8000
```

Windows 第一次运行会弹防火墙，允许「专用网络」；如果平板打不开，先查防火墙和校园网 AP 隔离。

## 使用

1. 首屏是稿件库。点「上传文件」选 md/docx/txt，或点「粘贴文本」新建。
2. 点列表里的稿件进入播放页，点「开始播放」，3-2-1 后开始滚动。
3. 播放中：
   - 左侧 25%：减速；右侧 25%：加速
   - 中间 50%：暂停/继续；暂停后单指上下拖动定位
   - 点逻辑顶部边缘，或双指点按：呼出控制条
   - 控制条里可调速、字号、行距、配色、镜像、进度、全屏
4. 控制条里的「返回稿件库」和结束页的「返回稿件库」都会回到列表。

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
- 内网无鉴权，不要把端口映射到公网

## 数据与备份

```text
data/scripts/<id>/
├── source.docx      # 原始上传文件
├── text.txt         # 解析后的一行一段
└── meta.json        # 标题、字数、时间、原文件名
```

- **唯一需要备份的是 `data/`**。
- `.venv/`、`venv/` 是依赖缓存，可删可重建，不需要备份。
- 示例稿只在首次启动、稿件库为空时生成一次；删掉后重启不会复活。

## 开发与测试

```powershell
uv run pytest -q          # 31 个后端测试
uv run uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

修改依赖后重新生成部署用固定版本：

```powershell
uv export --no-dev --no-emit-project --no-hashes --no-header --no-annotate -o requirements.txt
```

`DATA_DIR` 可指定数据目录，默认 `./data`；容器里一般是 `/data`。

## 目录

```text
app/            FastAPI、稿件库、md/docx/txt 解析
web/            无构建前端（稿件库 + 播放器）
tests/          解析/稿件库/API 测试 + docx 探针
samples/        示例稿
data/           运行时稿件（不入库）
PLAN.md         技术方案与已知坑
```

## 下一步

- **P4**：Dockerfile / compose / start.sh / 绿联 UGOS「项目」部署、README 部署章节
- **P5**：横竖屏重测量、万字稿性能、误触防护等打磨

## License

MIT，见 [LICENSE](LICENSE)。
