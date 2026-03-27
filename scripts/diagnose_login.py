#!/usr/bin/env python3
"""
快速诊断 Letterboxd 登录配置
"""
import os
from dotenv import load_dotenv

print("=" * 60)
print("Letterboxd 登录配置诊断")
print("=" * 60)

# 加载 .env
load_dotenv(override=True)

# 检查必要的配置
checks = []

# 1. 检查 .env 文件
env_exists = os.path.exists('.env')
checks.append(("✅" if env_exists else "❌", ".env 文件存在", env_exists))

# 2. 检查用户名
username = os.getenv('LETTERBOXD_USERNAME', '').strip()
has_username = bool(username)
is_email = '@' in username
checks.append(("✅" if has_username and not is_email else "❌", 
               f"用户名: {username if has_username else '(未设置)'}", 
               has_username and not is_email))

if is_email:
    print("⚠️  警告: 检测到邮箱格式，Letterboxd 用户名应该是 slug（如 'june'），不是邮箱！")

# 3. 检查密码
password = os.getenv('LETTERBOXD_PASSWORD', '').strip()
has_password = bool(password)
checks.append(("✅" if has_password else "❌", 
               f"密码: {'***设置***' if has_password else '(未设置)'}", 
               has_password))

# 4. 检查 credentials
credentials = os.getenv('LETTERBOXD_CREDENTIALS', '').strip()
has_credentials = bool(credentials)
if has_credentials:
    user_part = credentials.split(':')[0] if ':' in credentials else credentials
    checks.append(("ℹ️", f"CREDENTIALS: {user_part}:***", True))

# 5. 检查 Cookie
cookie = os.getenv('LETTERBOXD_COOKIE', '').strip()
has_cookie = bool(cookie)
has_persona = 'persona=' in cookie
has_current = 'letterboxd.user.CURRENT=' in cookie
if has_cookie:
    checks.append(("✅" if (has_persona or has_current) else "⚠️", 
                   f"Cookie: {'有效标记' if (has_persona or has_current) else '可能无效'}", 
                   has_persona or has_current))

# 6. 检查 Gemini API
gemini_key = os.getenv('GEMINI_API_KEY', '').strip()
has_gemini = bool(gemini_key)
checks.append(("✅" if has_gemini else "❌", 
               f"Gemini API Key: {'设置' if has_gemini else '(未设置)'}", 
               has_gemini))

# 7. 检查登录相关设置
headless = os.getenv('LETTERBOXD_HEADLESS', 'true').lower()
checks.append(("ℹ️", f"无头模式: {headless}", True))

strategy = os.getenv('LETTERBOXD_LOGIN_STRATEGY', 'auto')
checks.append(("ℹ️", f"登录策略: {strategy}", True))

interactive_wait = os.getenv('LETTERBOXD_INTERACTIVE_LOGIN_WAIT_MS', '45000')
checks.append(("ℹ️", f"手动登录等待: {int(interactive_wait)/1000:.0f}秒", True))

print("\n检查结果:")
print("-" * 60)
for mark, desc, _ in checks:
    print(f"{mark} {desc}")

print("\n" + "=" * 60)

# 判断登录方式
auth_method = None
auth_priority = None

if has_cookie and (has_persona or has_current):
    auth_method = "Cookie (已验证)"
    auth_priority = "🥇 优先级 1 - Cookie 将被使用"
elif has_cookie:
    auth_method = "Cookie (可能无效)"
    auth_priority = "⚠️  Cookie 缺少会话标记，可能失败"
elif has_username and has_password:
    auth_method = "用户名+密码"
    auth_priority = "🥈 优先级 2 - 没有 Cookie，将尝试用户名密码"
elif has_credentials:
    auth_method = "CREDENTIALS"
    auth_priority = "🥈 优先级 2 - 没有 Cookie，将尝试凭据"

if auth_method:
    print(f"✅ 识别的登录方式: {auth_method}")
    if auth_priority:
        print(f"   {auth_priority}")
else:
    print("❌ 未检测到任何有效的登录凭据！")

print("\n建议:")
if not env_exists:
    print("1. 运行 'python movie_agent.py --setup' 创建配置")
elif not has_username and not has_password and not has_cookie and not has_credentials:
    print("1. 运行 'python movie_agent.py --setup' 配置凭据")
    print("   或运行 'python setup_cookie_login.py' 使用 Cookie 登录（推荐）")
elif has_cookie and (has_username or has_password):
    print("⚠️  同时检测到 Cookie 和用户名密码配置")
    print("1. Cookie 将被优先使用（推荐）")
    print("2. 如果 Cookie 登录成功，用户名密码将被忽略")
    print("3. 建议清空 LETTERBOXD_USERNAME 和 LETTERBOXD_PASSWORD 避免混淆")
elif is_email:
    print("1. 修改 LETTERBOXD_USERNAME 为用户名 slug（不是邮箱）")
    print("   例如: 从 https://letterboxd.com/june/ 获取 'june'")
elif headless == 'true' and not has_cookie:
    print("1. 如果登录失败，尝试设置 LETTERBOXD_HEADLESS=false")
    print("   这样可以看到浏览器窗口并手动完成验证")
    print("2. 或者使用 Cookie 登录: python setup_cookie_login.py（更可靠）")
else:
    print("1. 配置看起来正常，尝试运行:")
    print("   python movie_agent.py --check-auth")

print("\n调试命令:")
print("  python movie_agent.py --check-auth  # 测试登录")
print("  python movie_agent.py --setup       # 重新配置")

print("=" * 60)
