# Watchlist 操作问题修复指南

## 问题描述
1. ❌ 添加到 watchlist 时会弹出浏览器窗口（可能显示 Google 页面）
2. ❌ 电影没有成功添加到 watchlist

## 解决方案

### 1. 设置 Headless 模式（避免浏览器窗口弹出）

在 `.env` 文件中添加或修改：

```bash
LETTERBOXD_HEADLESS=true
```

这样浏览器会在后台运行，不会弹出窗口。

### 2. 已添加的改进

我已经从代码层面做了以下改进：

✅ **详细日志输出**
- 显示操作的每个步骤
- 显示按钮查找过程
- 显示状态变化

✅ **多个选择器尝试**
- 尝试不同的 CSS 选择器找到 watchlist 按钮
- 提高成功率

✅ **操作验证**
- 点击后验证状态是否改变
- 如果没有改变，抛出错误

✅ **增强错误处理**
- Python 端显示详细的错误信息
- 显示完整的堆栈跟踪

### 3. 测试流程

1. 确保 `.env` 中设置了 `LETTERBOXD_HEADLESS=true`
2. 运行程序：
   ```bash
   python movie_agent.py
   ```
3. 请求推荐并尝试添加到 watchlist
4. 查看详细日志输出，了解操作过程

### 4. 可能的失败原因

如果操作仍然失败，可能是因为：

1. **Cookie 已过期**
   - 解决：重新获取 Cookie（参考 `COOKIE_LOGIN_QUICK.md`）

2. **页面结构变化**
   - Letterboxd 可能更新了页面结构
   - 需要更新选择器

3. **网络问题**
   - 页面加载超时
   - 解决：重试操作

### 5. 查看详细日志

现在操作时会显示：
```
🔧 正在执行: add_to_watchlist
   参数: {'slug': 'past-lives', 'remove': False}
[addToWatchlist] 开始处理: slug=past-lives, remove=false
[_performAction] 导航到: https://letterboxd.com/film/past-lives/
[_performAction] 页面加载完成
[addToWatchlist] 页面已加载: https://letterboxd.com/film/past-lives/
[addToWatchlist] 找到按钮: a.add-to-watchlist
[addToWatchlist] 当前状态: 不在watchlist
[addToWatchlist] 按钮类名: add-to-watchlist
[addToWatchlist] 执行点击操作...
[addToWatchlist] 点击后状态: 已在watchlist
[addToWatchlist] 新类名: add-to-watchlist -remove
[addToWatchlist] ✅ 操作成功
✅ 操作成功: add_to_watchlist
```

### 6. 如果仍然失败

请运行测试并提供完整的日志输出，包括：
- 所有 `[addToWatchlist]` 开头的日志
- 错误信息和堆栈
- 具体的电影 slug

这将帮助我进一步诊断问题。
