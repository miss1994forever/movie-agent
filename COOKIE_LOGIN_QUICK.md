# Letterboxd 登录问题？使用 Cookie 方法（最可靠）

## 快速修复指南

如果用户名密码登录失败，**强烈建议使用 Cookie 登录**：

### 方法 1: 使用辅助脚本（推荐）

```bash
python setup_cookie_login.py
```

按照提示复制粘贴 Cookie 即可。

### 方法 2: 手动配置

1. **在浏览器中登录 Letterboxd**
   - 访问 https://letterboxd.com
   - 使用正常方式登录

2. **获取 Cookie**
   - 按 F12 打开开发者工具
   - 进入 "Network" 标签
   - 刷新页面（F5）
   - 点击任意请求
   - 找到 "Request Headers" → "Cookie"
   - 复制完整的 Cookie 值（很长的一串）

3. **配置 .env 文件**
   ```bash
   LETTERBOXD_COOKIE=letterboxd.session=xxx; persona=xxx; letterboxd.user.CURRENT=xxx; ...
   
   # 清空其他登录方式
   LETTERBOXD_USERNAME=
   LETTERBOXD_PASSWORD=
   LETTERBOXD_CREDENTIALS=
   ```

4. **测试**
   ```bash
   python movie_agent.py --check-auth
   ```

## 为什么 Cookie 登录更可靠？

- ✅ 绕过 Letterboxd 的反机器人检测
- ✅ 不需要浏览器自动化
- ✅ 登录速度快
- ⚠️  Cookie 可能过期（通常1-2周），过期后需重新获取

## 用户名密码登录失败？

常见问题：
1. **403 Forbidden** - Letterboxd 阻止了自动登录，改用 Cookie
2. **浏览器一闪而过** - 检查是否设置了 `LETTERBOXD_HEADLESS=false`
3. **自动进入初始页面** - 登录被拦截，改用 Cookie 方法

## 更多帮助

- 诊断工具: `python diagnose_login.py`
- 完整文档: [LETTERBOXD_LOGIN_GUIDE.md](LETTERBOXD_LOGIN_GUIDE.md)
- 配置向导: `python movie_agent.py --setup`

---

**推荐配置顺序：**
1. 先尝试 Cookie 登录（最可靠）
2. Cookie 过期后再考虑用户名密码
3. 如果都不行，检查网络和 Letterboxd 服务状态
