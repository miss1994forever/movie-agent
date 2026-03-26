#!/usr/bin/env python3
"""
简化的 Letterboxd Cookie 登录测试脚本
"""
import os
import sys
from dotenv import load_dotenv, set_key

print("=" * 70)
print("Letterboxd Cookie 登录配置 - 推荐方法")
print("=" * 70)
print()
print("⚠️  由于 Letterboxd 的反机器人保护，Cookie 登录通常比用户名密码更可靠。")
print()
print("步骤：")
print("1. 在浏览器中访问 https://letterboxd.com 并登录")
print("2. 打开开发者工具（按 F12 或 Cmd+Option+I）")
print("3. 进入 'Network' 标签")
print("4. 刷新页面")
print("5. 点击任意请求，找到 'Request Headers' 部分")
print("6. 复制 'Cookie' 的完整值")
print()
print("=" * 70)
print()

cookie_input = input("请粘贴 Cookie 值（按 Ctrl+D 或 Ctrl+Z 结束输入）:\n")

if not cookie_input.strip():
    print("\n❌ Cookie 为空，配置取消。")
    sys.exit(1)

# 检查 Cookie 是否包含关键标记
has_session = 'letterboxd.session=' in cookie_input
has_persona = 'persona=' in cookie_input  
has_current = 'letterboxd.user.CURRENT=' in cookie_input

print("\n" + "=" * 70)
print("Cookie 验证:")
print(f"  letterboxd.session: {'✅' if has_session else '❌'}")
print(f"  persona: {'✅' if has_persona else '❌'}")
print(f"  letterboxd.user.CURRENT: {'✅' if has_current else '❌'}")

if not (has_session or has_persona or has_current):
    print("\n⚠️  警告: Cookie 中缺少关键的登录标记！")
    print("请确保从已登录状态下复制 Cookie。")
    
    proceed = input("\n是否仍然继续？(y/N): ").strip().lower()
    if proceed not in ['y', 'yes']:
        print("配置已取消。")
        sys.exit(1)

# 写入 .env 文件
load_dotenv()
env_path = '.env'

print(f"\n正在写入配置到 {env_path}...")

set_key(env_path, 'LETTERBOXD_COOKIE', cookie_input, quote_mode='always')
set_key(env_path, 'LETTERBOXD_USERNAME', '', quote_mode='always')
set_key(env_path, 'LETTERBOXD_PASSWORD', '', quote_mode='always')
set_key(env_path, 'LETTERBOXD_CREDENTIALS', '', quote_mode='always')
set_key(env_path, 'LETTERBOXD_LOGIN_FOR_READS', 'true', quote_mode='always')

print("\n✅ Cookie 配置完成！")
print("\n下一步:")
print("  python movie_agent.py --check-auth  # 测试登录")
print("\n提示: Cookie 可能会过期，如果登录失败请重新获取 Cookie。")
print("=" * 70)
