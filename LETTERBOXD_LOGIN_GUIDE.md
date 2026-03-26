# Letterboxd 登录问题解决指南

## 问题描述
运行 `python movie_agent.py --check-auth` 后输入账号密码，自动进入 Letterboxd 初始页面，无法登录。

## 解决方案

### 方案 1: 使用配置向导（推荐）

1. **运行配置向导**
   ```bash
   python movie_agent.py --setup
   ```

2. **重要提示**：
   - 用户名使用 Letterboxd 用户名（slug），**不是邮箱**
   - 例如: 如果你的主页是 `https://letterboxd.com/june/`，用户名就是 `june`
   - 密码是你登录 Letterboxd 时使用的密码

3. **测试登录**
   ```bash
   python movie_agent.py --check-auth
   ```

### 方案 2: 手动创建 .env 文件

1. **复制示例文件**
   ```bash
   cp .env.example .env
   ```

2. **编辑 .env 文件**
   ```bash
   # 必填项
   LETTERBOXD_USERNAME=your_username  # 注意：是用户名，不是邮箱！
   LETTERBOXD_PASSWORD=your_password
   GEMINI_API_KEY=your_gemini_key

   # 重要设置
   LETTERBOXD_HEADLESS=false  # 设置为 false 可以看到浏览器窗口
   LETTERBOXD_INTERACTIVE_LOGIN_WAIT_MS=60000  # 增加等待时间
   DEBUG_TRACEBACK=true  # 显示详细错误信息
   ```

3. **测试登录**
   ```bash
   python movie_agent.py --check-auth
   ```

### 方案 3: 使用 Cookie 登录（高级）

如果用户名密码登录失败，可以使用浏览器 Cookie：

1. **手动登录 Letterboxd**
   - 在浏览器中访问 https://letterboxd.com 并登录

2. **获取 Cookie**
   - 打开浏览器开发者工具（F12）
   - 进入 Network 标签
   - 刷新页面，找到任意请求
   - 在 Request Headers 中复制 Cookie 值

3. **配置 Cookie**
   ```bash
   python movie_agent.py --cookie-login
   ```
   
   或直接在 .env 中设置：
   ```bash
   LETTERBOXD_COOKIE=letterboxd.session=xxx; persona=xxx; letterboxd.user.CURRENT=xxx
   LETTERBOXD_USERNAME=
   LETTERBOXD_PASSWORD=
   ```

## 常见问题

### Q1: 用户名格式错误
**错误**: "检测到邮箱格式，请填写 Letterboxd 用户名 slug"

**解决**:
- ❌ 错误: `user@email.com`
- ✅ 正确: `june` (从 URL https://letterboxd.com/june/ 获取)

### Q2: 浏览器窗口一闪而过
**解决**: 在 .env 中设置
```bash
LETTERBOXD_HEADLESS=false
LETTERBOXD_INTERACTIVE_LOGIN_WAIT_MS=60000
```

### Q3: Cloudflare 验证
如果遇到 Cloudflare 验证页面：
1. 确保设置了 `LETTERBOXD_HEADLESS=false`
2. 浏览器窗口会打开，手动完成验证
3. 验证后程序会自动继续

### Q4: HTTP 登录失败
现在程序会显示详细的登录日志，查看输出中的：
```
[Letterboxd] Starting HTTP login...
[Letterboxd] Got CSRF token: yes
[Letterboxd] Login result: success
```

如果 HTTP 登录失败，程序会自动切换到浏览器登录。

### Q5: Cookie 无效
确保 Cookie 包含以下关键字段：
- `letterboxd.session=...`
- `persona=...`
- `letterboxd.user.CURRENT=...`

## 调试步骤

1. **查看详细日志**
   ```bash
   # 在 .env 中设置
   DEBUG_TRACEBACK=true
   
   # 再次运行
   python movie_agent.py --check-auth
   ```

2. **检查配置格式**
   ```bash
   python -c "from dotenv import load_dotenv; import os; load_dotenv(); print('Username:', os.getenv('LETTERBOXD_USERNAME')); print('Has Password:', bool(os.getenv('LETTERBOXD_PASSWORD')))"
   ```

3. **测试网络连接**
   ```bash
   curl https://letterboxd.com
   ```

## 参考项目

本项目的登录机制参考了以下项目：
- [mBaratta96/letterboxd_stats](https://github.com/mBaratta96/letterboxd_stats) - 使用简单的 HTTP 登录

## 技术细节

### 登录策略
程序使用三层登录策略（`LETTERBOXD_LOGIN_STRATEGY=auto`）：

1. **HTTP 登录**（快速）
   - POST 到 `/user/login.do`
   - 使用 CSRF token

2. **浏览器自动登录**（中等速度）
   - 使用 Playwright 自动填写表单
   - 适用于简单的反机器人检测

3. **浏览器手动登录**（最可靠）
   - 打开浏览器让用户手动操作
   - 适用于 Cloudflare 验证等复杂情况

### 环境变量说明

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `LETTERBOXD_USERNAME` | - | 用户名（slug，非邮箱） |
| `LETTERBOXD_PASSWORD` | - | 密码 |
| `LETTERBOXD_HEADLESS` | `true` | 是否无头模式 |
| `LETTERBOXD_LOGIN_STRATEGY` | `auto` | 登录策略：`auto`/`manual` |
| `LETTERBOXD_INTERACTIVE_LOGIN_WAIT_MS` | `45000` | 手动登录等待时间（毫秒） |
| `MCP_INIT_TIMEOUT_SEC` | `30` | MCP 初始化超时（秒） |

## 需要帮助？

如果以上方法都不起作用，请提供：
1. 完整的错误日志
2. .env 配置（隐藏密码）
3. 操作系统和 Node.js 版本

```bash
# 获取版本信息
python --version
node --version
npm --version
```
