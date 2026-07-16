#!/usr/bin/env python3
"""
测试阿里云百炼 API 集成
"""

import asyncio
import os
import sys
import pytest
from dotenv import load_dotenv

pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        os.getenv("RUN_DASHSCOPE_INTEGRATION_TESTS") != "1",
        reason="set RUN_DASHSCOPE_INTEGRATION_TESTS=1 to call external AI providers",
    ),
]

# 加载环境变量
load_dotenv()

def check_dependencies():
    """检查依赖是否安装"""
    try:
        import dashscope
        print("✅ dashscope SDK 已安装")
        return True
    except ImportError:
        print("❌ dashscope SDK 未安装")
        print("\n请运行: pip install dashscope")
        return False

def check_api_key():
    """检查 API Key 是否配置"""
    api_key = os.getenv("DASHSCOPE_API_KEY")
    if not api_key:
        print("❌ DASHSCOPE_API_KEY 未配置")
        print("\n请在 .env 文件中添加:")
        print("DASHSCOPE_API_KEY=your_key_here")
        return False
    
    print(f"✅ DASHSCOPE_API_KEY 已配置: {api_key[:8]}...{api_key[-4:]}")
    return True

async def test_basic_chat():
    """测试基础对话功能"""
    print("\n" + "="*50)
    print("测试 1: 基础对话")
    print("="*50)
    
    try:
        from ai_providers import get_ai_provider, get_default_model
        
        provider = get_ai_provider("dashscope")
        model = get_default_model("dashscope")
        
        print(f"使用模型: {model}")
        
        chat = await provider.create_chat(model, [])
        response = await provider.send_message(chat, "你好，请用一句话介绍自己")
        
        text = provider.get_response_text(response)
        print(f"✅ AI 回复: {text}")
        
        return True
    except Exception as e:
        print(f"❌ 测试失败: {e}")
        import traceback
        traceback.print_exc()
        return False

async def test_movie_recommendation():
    """测试电影推荐功能"""
    print("\n" + "="*50)
    print("测试 2: 电影推荐")
    print("="*50)
    
    try:
        from ai_providers import get_ai_provider, get_default_model
        
        provider = get_ai_provider("dashscope")
        model = get_default_model("dashscope")
        
        chat = await provider.create_chat(model, [])
        response = await provider.send_message(
            chat, 
            "我想看一部轻松搞笑的电影，请推荐一部并说明理由（50字以内）"
        )
        
        text = provider.get_response_text(response)
        print(f"✅ AI 推荐: {text}")
        
        return True
    except Exception as e:
        print(f"❌ 测试失败: {e}")
        import traceback
        traceback.print_exc()
        return False

async def test_function_calling():
    """测试函数调用功能（Tool Calling）"""
    print("\n" + "="*50)
    print("测试 3: 函数调用")
    print("="*50)
    
    try:
        from ai_providers import get_ai_provider, get_default_model
        
        provider = get_ai_provider("dashscope")
        model = get_default_model("dashscope")
        
        # 定义一个简单的工具
        tools = [{
            "function_declarations": [{
                "name": "get_weather",
                "description": "获取指定城市的天气信息",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "city": {
                            "type": "string",
                            "description": "城市名称，例如：北京、上海"
                        }
                    },
                    "required": ["city"]
                }
            }]
        }]
        
        chat = await provider.create_chat(model, tools)
        response = await provider.send_message(chat, "北京今天天气怎么样？")
        
        # 检查是否调用了函数
        function_call = provider.extract_function_call(response)
        
        if function_call:
            print(f"✅ AI 尝试调用函数: {function_call.name}")
            print(f"   参数: {function_call.args}")
            return True
        else:
            text = provider.get_response_text(response)
            print(f"⚠️  AI 没有调用函数，直接回复: {text}")
            print("   (这是正常的，取决于模型的判断)")
            return True
            
    except Exception as e:
        print(f"❌ 测试失败: {e}")
        import traceback
        traceback.print_exc()
        return False

async def test_comparison():
    """对比 Gemini 和 DashScope"""
    print("\n" + "="*50)
    print("测试 4: 性能对比")
    print("="*50)
    
    import time
    
    results = {}
    
    for provider_name in ['gemini', 'dashscope']:
        api_key = os.getenv(f"{provider_name.upper()}_API_KEY" if provider_name == "gemini" else "DASHSCOPE_API_KEY")
        if not api_key:
            print(f"⚠️  {provider_name} API Key 未配置，跳过")
            continue
        
        try:
            print(f"\n测试 {provider_name}...")
            from ai_providers import get_ai_provider, get_default_model
            
            provider = get_ai_provider(provider_name)
            model = get_default_model(provider_name)
            
            start = time.time()
            chat = await provider.create_chat(model, [])
            response = await provider.send_message(chat, "推荐一部科幻电影")
            text = provider.get_response_text(response)
            elapsed = time.time() - start
            
            results[provider_name] = {
                "time": elapsed,
                "preview": text[:80] + "..." if len(text) > 80 else text
            }
            
            print(f"  ⏱️  耗时: {elapsed:.2f}秒")
            print(f"  📝 回复预览: {results[provider_name]['preview']}")
            
        except Exception as e:
            print(f"  ❌ 失败: {e}")
    
    if len(results) >= 2:
        print("\n" + "="*50)
        print("📊 对比结果:")
        print("="*50)
        for name, data in results.items():
            print(f"  {name}: {data['time']:.2f}秒")
        
        fastest = min(results.items(), key=lambda x: x[1]['time'])
        print(f"\n🏆 最快: {fastest[0]} ({fastest[1]['time']:.2f}秒)")
    
    return True

async def main():
    """主测试流程"""
    print("\n🧪 阿里云百炼 API 集成测试")
    print("="*50)
    
    # 1. 检查依赖
    if not check_dependencies():
        sys.exit(1)
    
    # 2. 检查配置
    if not check_api_key():
        sys.exit(1)
    
    # 3. 运行测试
    tests = [
        ("基础对话", test_basic_chat),
        ("电影推荐", test_movie_recommendation),
        ("函数调用", test_function_calling),
    ]
    
    results = []
    for name, test_func in tests:
        try:
            success = await test_func()
            results.append((name, success))
        except Exception as e:
            print(f"\n❌ {name} 测试异常: {e}")
            results.append((name, False))
    
    # 4. 性能对比（可选）
    gemini_key = os.getenv("GEMINI_API_KEY")
    if gemini_key:
        await test_comparison()
    
    # 5. 总结
    print("\n" + "="*50)
    print("📋 测试总结")
    print("="*50)
    
    passed = sum(1 for _, success in results if success)
    total = len(results)
    
    for name, success in results:
        status = "✅ 通过" if success else "❌ 失败"
        print(f"  {name}: {status}")
    
    print(f"\n总计: {passed}/{total} 测试通过")
    
    if passed == total:
        print("\n🎉 所有测试通过！阿里云百炼 API 集成成功")
        print("\n下一步:")
        print("  1. 在 .env 中设置: AI_PROVIDER=dashscope")
        print("  2. 运行: python movie_agent.py")
    else:
        print("\n⚠️  部分测试失败，请检查配置和网络连接")
        sys.exit(1)

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n\n⚠️  测试被中断")
        sys.exit(130)
