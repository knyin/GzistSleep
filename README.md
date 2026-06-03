# 厂州理工学院自动签到程序

自动登录学校统一门户，识别验证码并完成每日签到，支持本地运行和青龙面板部署。

## 功能特性

- 自动登录统一门户（账号密码 + 验证码自动识别）
- 模拟手机浏览器访问
- 模拟定位信息（学校坐标）
- 自动识别数学算式验证码并计算结果
- 重复签到时自动跳过
- 支持本地定时签到
- 支持青龙面板部署

## 本地运行

### 环境要求

- Node.js 18+
- Python 3.7+
- Playwright Chromium 浏览器

### 安装

```bash
# 安装 Node.js 依赖
npm install

# 安装 Playwright 浏览器
npx playwright install chromium

# 安装 Python 验证码识别库
pip install ddddocr
```

### 配置

编辑 `config.json`：

```json
{
  "account": {
    "username": "你的学号",
    "password": "你的密码"
  },
  "urls": {
    "signin": "签到页面URL"
  },
  "schedule": {
    "enabled": true,
    "time": "21:30"
  }
}
```

门户地址、定位坐标已内置，无需配置。

### 运行

```bash
# 立即签到
npm start

# 或启用定时签到（根据 config.json 中的 schedule 设置）
```

定时模式会保持进程运行，在设定的时间自动执行签到。

## 青龙面板部署（ARM Docker / 仅 Web 界面）

> ⚠️ 以下操作全部在青龙面板 Web 界面完成，无需 SSH 或终端。

### ⚡ 第 0 步（必读）：确认镜像类型

ddddocr 的底层依赖 `onnxruntime` **不支持 Alpine Linux（musl libc）**，必须使用 `debian` 镜像。

**查看方法：** 青龙面板 → 系统设置 → 关于，查看基础镜像。

| 当前镜像 | 状态 | 处理方式 |
|----------|------|----------|
| `whyour/qinglong:debian` | ✅ 可用 | 直接继续下一步 |
| `whyour/qinglong:latest` | ❌ Alpine 系统 | **必须切换为 debian 镜像** |

**如果用了 latest（Alpine），安装 ddddocr 会报如下错误：**
```
ERROR: Cannot install ddddocr... because these package versions have conflicting dependencies.
The conflict is caused by: ddddocr depends on onnxruntime
```
原因：`onnxruntime` 没有 Alpine/musl 的 ARM64 版本，pip 找不到兼容包。

**切换为 debian 镜像的方法：**

青龙面板 → 系统设置 → 备份导出 → 导出备份。然后让服务器管理员执行：

```bash
# 拉取 debian 镜像
docker pull whyour/qinglong:debian

# 停止并删除旧容器
docker stop qinglong
docker rm qinglong

# 用 debian 镜像创建新容器（数据卷路径和原来保持一致）
docker run -dit \
  -v /你的数据路径/ql/data:/ql/data \
  -p 5700:5700 \
  --name qinglong \
  --restart unless-stopped \
  whyour/qinglong:debian
```

容器启动后，在青龙面板 → 系统设置 → 备份导出 → 导入备份，恢复数据。

> 如果宿主机装了 Portainer / 1Panel 等管理面板，也可以在 UI 上直接更换镜像，更简单。

### 第 1 步：上传脚本文件

青龙面板 → **脚本管理** → 上传文件，上传以下 **2 个文件**（放在同一目录）：

| 文件 | 说明 |
|------|------|
| `ql_signin.js` | 主签到脚本 |
| `ocr_helper.py` | Python OCR 辅助脚本 |

### 第 2 步：安装依赖（通过依赖管理页面）

青龙面板 → **依赖管理** → 新建依赖，分三次添加：

**① Node.js 依赖：**

| 字段 | 值 |
|------|-----|
| 类型 | `Nodejs` |
| 名称（每行一个） | `playwright` |

**② Python 依赖：**

| 字段 | 值 |
|------|-----|
| 类型 | `Python3` |
| 名称（每行一个） | `ddddocr` |

**③ Linux 系统依赖：**

| 字段 | 值 |
|------|-----|
| 类型 | `Linux` |
| 名称（每行一个） | `chromium` |

> 这会在容器内自动执行 `apt-get install -y chromium`，安装 Chromium 浏览器本身。<br>
> 如果是 debian 镜像，这步会成功；如果是 Alpine 镜像，这步也会失败（因为没有 `apt-get`）。

### 第 3 步：补全 Playwright 浏览器文件

依赖装完后，还需让 Playwright 下载其所匹配的 Chromium 浏览器二进制文件。

在 **定时任务** 中创建一个 **一次性任务**：

| 字段 | 值 |
|------|-----|
| 名称 | 安装 Playwright 浏览器 |
| 命令 | `npx playwright install chromium` |
| 定时 | 随便填一个过去的时间（如 `0 0 1 1 *`） |

创建后点击 **运行** 按钮执行一次。执行成功后删除此任务。

> 这一步会下载约 200MB 的 Chromium 文件，ARM 平台会自动下载 ARM64 版本。

### 第 4 步：设置环境变量

青龙面板 → **环境变量** → 添加：

| 变量名 | 值 |
|--------|-----|
| `QL_USERNAME` | 你的学号 |
| `QL_PASSWORD` | 你的密码 |
| `QL_SIGNIN_URL` | 签到页面完整 URL |

### 第 5 步：创建定时任务

青龙面板 → **定时任务** → 创建任务：

| 字段 | 值 |
|------|-----|
| 名称 | 自动签到 |
| 命令 | `node /ql/scripts/ql_signin.js` |
| 定时规则 | `30 21 * * *`（每晚 21:30 执行） |
| 任务超时 | `300`（5 分钟足够） |

### 验证

创建任务后，可以点击 **运行** 测试一次，然后查看运行日志确认签到流程正常。

## 文件结构

```
├── ql_signin.js       # 青龙面板专用脚本（无头模式 + 环境变量）
├── ocr_helper.py      # Python OCR 验证码识别
├── config.json        # 本地运行配置
├── package.json       # 项目依赖
└── src/
    ├── index.js       # 本地运行入口
    ├── browser.js     # 浏览器管理（手机UA + 定位）
    ├── login.js       # 门户登录模块
    ├── signin.js      # 签到模块
    └── captcha.js     # OCR 调用模块
```

## 技术栈

| 组件 | 用途 |
|------|------|
| Playwright | 浏览器自动化 |
| ddddocr (Python) | 验证码识别 |
| Node.js | 主程序运行环境 |

## 工作流程

1. 启动 Chromium 浏览器（模拟 iPhone，设置学校定位）
2. 打开统一门户登录页面
3. 填写账号密码，自动识别验证码
4. 提交登录，失败自动重试
5. 携带 Cookie 跳转到签到页面
6. 检测考勤状态，点击签到按钮
7. 确认签到结果

## 注意事项

- 考勤时段为 **21:30~22:30**，非此时间段会提示"非考勤时段"
- 定位默认设置为厂州理工学院坐标（113.45535, 23.25759）
- 验证码为数学算式（如 7x5=），程序会自动识别并计算
