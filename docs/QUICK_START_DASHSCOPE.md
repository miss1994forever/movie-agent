# 🚀 快速入门：添加阿里云百炼支持

## 方式 1: 只安装 DashScope（推荐尝试）

```bash
# 1. 安装阿里云百炼 SDK
pip install dashscope

# 2. 配置环境变量
cat >> .env << EOF
AI_PROVIDER=dashscope
DASHSCOPE_API_KEY=your_dashscope_key_here
AI_MODEL=qwen-plus
EOF

# 3. 运行（无需修改 movie_agent.py）
python movie_agent.py
```

## 方式 2: 同时支持两个 API（灵活切换）

```bash
# 配置两个 API
cat >> .env << EOF
# 选择使用哪个（gemini 或 dashscope）
AI_PROVIDER=gemini

# Google Gemini
GEMINI_API_KEY=your_gemini_key

# 阿里云百炼
DASHSCOPE_API_KEY=your_dashscope_key
EOF

# 临时切换到阿里云百炼
AI_PROVIDER=dashscope python movie_agent.py

# 临时切换到 Gemini
AI_PROVIDER=gemini python movie_agent.py
```

## 获取阿里云百炼 API Key

1. 访问 https://dashscope.console.aliyun.com/
2. 注册/登录阿里云账号
3. 进入"API-KEY管理"
4. 创建新的 API Key
5. 复制并添加到 `.env` 文件

**新用户福利：**
- 🎁 免费 tokens 额度
- 💰 价格比 Gemini 便宜约 80%
- ⚡ 响应速度更快（国内服务器）

## 测试你的配置

```bash
# 测试阿里云百炼 API
python -c "
import asyncio
from ai_providers import get_ai_provider, get_default_model

async def test():
    provider = get_ai_provider('dashscope')
    model = get_default_model('dashscope')
    print(f'✅ 使用模型: {model}')
    
    chat = await provider.create_chat(model, [])
    response = await provider.send_message(chat, '你好')
    text = provider.get_response_text(response)
    print(f'✅ AI 回复: {text}')

asyncio.run(test())
"
```

## 对比测试

创建 `compare_apis.py`:

```python
import asyncio
import time
from ai_providers import get_ai_provider, get_default_model

async def test_provider(name):
    print(f"\n测试 {name}...")
    start = time.time()
    
    provider = get_ai_provider(name)
    model = get_default_model(name)
    
    chat = await provider.create_chat(model, [])
    response = await provider.send_message(chat, "推荐一部科幻电影")
    text = provider.get_response_text(response)
    
    elapsed = time.time() - start
    print(f"⏱️  耗时: {elapsed:.2f}秒")
    print(f"📝 回复: {text[:100]}...")
    
    return elapsed

async def compare():
    times = {}
    for provider in ['gemini', 'dashscope']:
        try:
            times[provider] = await test_provider(provider)
        except Exception as e:
            print(f"❌ {provider} 失败: {e}")
    
    print("\n" + "="*50)
    print("📊 性能对比:")
    for name, t in times.items():
        print(f"  {name}: {t:.2f}秒")

asyncio.run(compare())
```

运行对比：
```bash
python compare_apis.py
```

## 常见问题

### Q: 必须修改 movie_agent.py 吗？
**A:** 不需要！`ai_providers.py` 提供了兼容层，只需要设置环境变量即可。

### Q: 可以混用两个 API 吗？
**A:** 可以。配置两个 Key，通过 `AI_PROVIDER` 环境变量切换。

### Q: 哪个更好？
**A:** 
- **价格：** 阿里云百炼便宜 80%
- **速度：** 阿里云百炼在国内更快
- **中文理解：** 阿里云百炼（Qwen）略胜一筹
- **国际访问：** Gemini 更稳定

### Q: 我该选哪个？
**A:** 推荐日常使用阿里云百炼，节省成本。如果遇到不满意的推荐，临时切换到 Gemini。

## 下一步

✅ **完成 API 集成后，可以考虑：**

1. 📱 开发 Web 应用（参考 `WEB_VS_APP_GUIDE.md`）
2. 🎨 添加更多 AI 功能（情感分析、个性化偏好学习）
3. 📊 数据分析（观影习惯、推荐准确率）
4. 🤝 社交功能（分享推荐、好友观影）

查看完整指南：
- 阿里云百炼详细配置：`DASHSCOPE_SETUP.md`
- Web vs App 开发建议：`WEB_VS_APP_GUIDE.md`
