import asyncio
import argparse
import os
import json
import re
import socket
import sys
import traceback
from datetime import datetime
from contextlib import suppress
from getpass import getpass
from dotenv import load_dotenv, set_key

# 1. 导入 2026 最新 SDK
from google import genai
from ai_providers import get_ai_provider, get_default_model
from mcp import ClientSession
from mcp.client.sse import sse_client

# 加载 .env 变量（覆盖同名空环境变量，避免凭据被错误置空）
load_dotenv(override=True)

# 配置常量
GEMINI_KEY = os.getenv("GEMINI_API_KEY")
LB_USER = os.getenv("LETTERBOXD_USERNAME")
LB_PASS = os.getenv("LETTERBOXD_PASSWORD")
TMDB_KEY = os.getenv("TMDB_API_KEY")
MCP_HOST = os.getenv("LETTERBOXD_MCP_HOST", "127.0.0.1")
MCP_PORT = int(os.getenv("PORT", "3000"))
MCP_INIT_TIMEOUT = float(os.getenv("MCP_INIT_TIMEOUT_SEC", "30"))
MCP_READY_TIMEOUT = float(os.getenv("MCP_READY_TIMEOUT_SEC", "20"))
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
AI_PROVIDER = os.getenv("AI_PROVIDER", "gemini").lower()
ENV_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")

WRITE_TOOLS = {
    "add_to_watched",
    "add_to_watchlist",
    "write_review",
    "add_to_list",
    "create_list",
    "toggle_like",
    "rate_film",
}


def safe_input(prompt_text):
    try:
        return input(prompt_text)
    except (KeyboardInterrupt, EOFError):
        print("\n\n已取消当前输入。")
        return None


def detect_watchlist_only_intent(text):
    value = (text or "").lower()
    # 更严格的检测：必须明确说"从..."才触发
    patterns = [
        "从watchlist",
        "从 watchlist",
        "从片单",
        "从想看列表",
        "从待看",
        "watchlist里",
        "watchlist中",
        "片单里",
        "片单中",
        "待看列表",
    ]
    return any(p in value for p in patterns)


def extract_result_text(tool_result):
    blocks = getattr(tool_result, "content", []) or []
    for block in blocks:
        text = getattr(block, "text", None)
        if text:
            return text
    return ""


def parse_tool_json(tool_result):
    text = extract_result_text(tool_result)
    if not text:
        return {}
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return {}


def build_watchlist_brief(watchlist_payload, limit=120):
    items = watchlist_payload.get("items", []) if isinstance(watchlist_payload, dict) else []
    pairs = []
    for item in items[:limit]:
        title = (item or {}).get("title") or ""
        slug = (item or {}).get("slug") or ""
        if title and slug:
            pairs.append({"title": title, "slug": slug})
    return pairs


def slugs_from_watchlist(watchlist_payload):
    items = watchlist_payload.get("items", []) if isinstance(watchlist_payload, dict) else []
    out = set()
    for item in items:
        slug = (item or {}).get("slug")
        if slug:
            out.add(slug)
    return out


def response_mentions_any_slug(text, slug_set):
    value = (text or "").lower()
    for slug in slug_set:
        if slug.lower() in value:
            return True
    return False


def extract_slugs_from_response(text):
    return [m.group(1).lower() for m in re.finditer(r"slug\s*[:：]\s*([a-z0-9-]+)", text or "", flags=re.IGNORECASE)]


async def resolve_film_slug(session, raw_input):
    value = (raw_input or "").strip()
    if not value:
        return ""

    if re.fullmatch(r"[a-z0-9-]+", value.lower()):
        return value.lower()

    print(f"\n🔍 搜索电影: {value}")
    search_result = await session.call_tool(
        "search",
        arguments={"query": value, "type": "films", "maxPages": 1},
    )
    payload = parse_tool_json(search_result)
    items = payload.get("items", []) if isinstance(payload, dict) else []
    if not items:
        print("❌ 未找到匹配电影")
        print("提示：Letterboxd 搜索需要英文片名，例如 'Lost in Translation'")
        print("或者直接输入 slug（电影的URL标识符），例如 'lost-in-translation'")
        return ""

    top = items[:5]
    print("\n候选电影：")
    for i, item in enumerate(top, start=1):
        title = (item or {}).get("title", "")
        slug = (item or {}).get("slug", "")
        print(f"{i}) {title} (slug: {slug})")

    pick_raw = safe_input("选择序号(1-5)，或直接回车取消: ")
    if pick_raw is None:
        return ""
    pick = pick_raw.strip()
    if not pick:
        return ""
    if not pick.isdigit() or not (1 <= int(pick) <= len(top)):
        print("输入无效，已取消本次操作。")
        return ""
    chosen = top[int(pick) - 1]
    return (chosen.get("slug") or "").lower()


def normalize_star_to_internal_rating(star_text):
    raw = (star_text or "").strip()
    if not raw:
        return None
    try:
        value = float(raw)
    except ValueError:
        return None
    if value < 0.5 or value > 5:
        return None
    doubled = round(value * 2)
    if doubled < 1 or doubled > 10:
        return None
    return int(doubled)


async def call_write_tool(session, name, arguments):
    try:
        print(f"\n🔧 正在执行: {name}")
        print(f"   参数: {arguments}")
        result = await session.call_tool(name, arguments=arguments)
        payload = parse_tool_json(result)
        
        # 显示工具返回的详细信息
        if isinstance(payload, dict):
            if payload.get("success") is True:
                print(f"✅ 操作成功: {name}")
                return True
            else:
                print(f"⚠️ 操作返回异常:")
                print(f"   {payload}")
                return False
        else:
            print(f"⚠️ 工具返回了非预期格式: {payload}")
            return False

    except Exception as e:
        error_msg = str(e)
        
        # 处理 Turnstile 验证错误
        if "turnstile-dialog" in error_msg.lower():
            print(f"❌ 操作失败: {name}")
            print("   错误类型: Letterboxd Turnstile 验证阻止")
            print("   🔄 正在尝试重新执行...")
            
            # 等待并重试
            await asyncio.sleep(3)
            try:
                result = await session.call_tool(name, arguments=arguments)
                payload = parse_tool_json(result)
                if isinstance(payload, dict) and payload.get("success") is True:
                    print(f"✅ 重试成功: {name}")
                    return True
                else:
                    print("❌ 重试仍然失败")
                    print("💡 建议：请手动访问 Letterboxd 网站完成验证，或稍后重试")
                    return False
            except Exception:
                print("❌ 重试仍然失败") 
                print("💡 建议：请手动访问 Letterboxd 网站完成验证，或稍后重试")
                return False
        else:
            print(f"❌ 操作失败: {name}")
            print(f"   错误详情: {error_msg}")
            # 只显示简化的堆栈信息，不是完整的异常
            if "Timeout" in error_msg:
                print("💡 建议：网络超时，请检查网络连接或稍后重试")
            return False
    except Exception as err:
        print(f"❌ 操作失败: {name}")
        print(f"   错误详情: {str(err)}")
        import traceback
        print(f"   堆栈: {traceback.format_exc()}")
        return False


async def interactive_post_recommendation_actions(session, recommended_films=None):
    while True:
        wants_raw = safe_input("\n要不要把推荐电影同步到你的 Letterboxd？(y/N): ")
        if wants_raw is None:
            return
        wants = wants_raw.strip().lower()
        if wants not in {"y", "yes"}:
            return

        # 如果有推荐的电影列表，先显示快捷选择
        if recommended_films:
            print("\n📝 推荐的电影：")
            for i, film in enumerate(recommended_films, start=1):
                title = film.get('title', '')
                slug = film.get('slug', '')
                print(f"{i}) {title} (slug: {slug})")
            print(f"{len(recommended_films) + 1}) 输入其他电影")
            
            choice_raw = safe_input(f"\n选择 1-{len(recommended_films) + 1}: ")
            if choice_raw is None:
                return
            choice = choice_raw.strip()
            
            if choice.isdigit():
                choice_num = int(choice)
                if 1 <= choice_num <= len(recommended_films):
                    slug = recommended_films[choice_num - 1].get('slug', '')
                    if not slug:
                        print("❌ 该电影没有 slug 信息")
                        continue
                elif choice_num == len(recommended_films) + 1:
                    # 用户选择输入其他电影
                    pass
                else:
                    print("输入无效")
                    continue
            else:
                slug = None
        else:
            slug = None
        
        # 如果没有选择推荐的电影，让用户手动输入
        if not slug:
            film_ref_raw = safe_input("\n输入电影 slug 或英文片名: ")
            if film_ref_raw is None:
                return
            film_ref = film_ref_raw.strip()
            slug = await resolve_film_slug(session, film_ref)
            if not slug:
                continue

        print("\n选择操作:")
        print("1) 加入 watchlist")
        print("2) 标记 watched")
        print("3) 评分（stars）")
        print("4) 点 heart（like）")
        print("5) 一键：watched + stars + heart")
        print("6) 取消")
        action_raw = safe_input("输入 1-6: ")
        if action_raw is None:
            return
        action = action_raw.strip()

        if action == "1":
            await call_write_tool(session, "add_to_watchlist", {"slug": slug, "remove": False})
        elif action == "2":
            await call_write_tool(session, "add_to_watched", {"slug": slug, "remove": False})
        elif action == "3":
            stars_raw = safe_input("输入星级（0.5 - 5，支持半星）: ")
            if stars_raw is None:
                return
            stars = stars_raw.strip()
            rating = normalize_star_to_internal_rating(stars)
            if rating is None:
                print("星级输入无效。")
                continue
            await call_write_tool(session, "rate_film", {"slug": slug, "rating": rating})
        elif action == "4":
            await call_write_tool(session, "toggle_like", {"slug": slug, "remove": False})
        elif action == "5":
            stars_raw = safe_input("输入星级（0.5 - 5，支持半星）: ")
            if stars_raw is None:
                return
            stars = stars_raw.strip()
            rating = normalize_star_to_internal_rating(stars)
            if rating is None:
                print("星级输入无效。")
                continue
            await call_write_tool(session, "add_to_watched", {"slug": slug, "remove": False})
            await call_write_tool(session, "rate_film", {"slug": slug, "rating": rating})
            await call_write_tool(session, "toggle_like", {"slug": slug, "remove": False})
        else:
            print("已取消本次操作。")

        again_raw = safe_input("继续操作其他电影？(y/N): ")
        if again_raw is None:
            return
        again = again_raw.strip().lower()
        if again not in {"y", "yes"}:
            return


def build_mcp_env(port):
    # Start from current shell env, then force project credential values on top.
    # This prevents stale exported variables from overriding .env values.
    username = os.getenv("LETTERBOXD_USERNAME", "").strip()
    password = os.getenv("LETTERBOXD_PASSWORD", "").strip()
    credentials = os.getenv("LETTERBOXD_CREDENTIALS", "").strip()
    cookie = os.getenv("LETTERBOXD_COOKIE", "").strip()

    use_username_password = bool(username and password)
    use_credentials = bool((not use_username_password) and credentials)
    use_cookie = bool((not use_username_password) and (not use_credentials) and cookie)

    return {
        **os.environ,
        "PORT": str(port),
        "LETTERBOXD_USERNAME": username if use_username_password else "",
        "LETTERBOXD_PASSWORD": password if use_username_password else "",
        "LETTERBOXD_CREDENTIALS": credentials if use_credentials else "",
        "LETTERBOXD_COOKIE": cookie if use_cookie else "",
        "TMDB_API_KEY": os.getenv("TMDB_API_KEY", ""),
    }


async def is_port_open(host, port):
    try:
        reader, writer = await asyncio.open_connection(host, port)
        writer.close()
        await writer.wait_closed()
        return True
    except Exception:
        return False


async def wait_for_port(host, port, timeout_sec):
    deadline = asyncio.get_running_loop().time() + timeout_sec
    while asyncio.get_running_loop().time() < deadline:
        if await is_port_open(host, port):
            return
        await asyncio.sleep(0.25)
    raise TimeoutError(f"MCP server did not become ready in {timeout_sec:.0f}s")


def get_free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return sock.getsockname()[1]


def extract_function_call(response):
    candidates = getattr(response, "candidates", []) or []
    if not candidates:
        return None
    content = getattr(candidates[0], "content", None)
    parts = getattr(content, "parts", []) if content else []
    for part in parts:
        call = getattr(part, "func_call", None) or getattr(part, "function_call", None)
        if call:
            return call
    return None


def to_gemini_tool_result(tool_result):
    parsed = []
    for block in getattr(tool_result, "content", []) or []:
        text = getattr(block, "text", None)
        if not text:
            continue
        try:
            parsed.append(json.loads(text))
        except json.JSONDecodeError:
            parsed.append(text)
    if len(parsed) == 1:
        return parsed[0]
    return parsed


def confirm_write_action(tool_name, args):
    print(f"\n⚠️  即将执行账号写操作: {tool_name}")
    print(f"参数: {json.dumps(args or {}, ensure_ascii=False)}")
    choice_raw = safe_input("确认执行？输入 y 确认，其他任意键取消: ")
    if choice_raw is None:
        return False
    choice = choice_raw.strip().lower()
    return choice in {"y", "yes"}


def gemini_model_candidates():
    configured = os.getenv("GEMINI_MODELS", "")
    items = [x.strip() for x in configured.split(",") if x.strip()]
    if not items:
        items = [GEMINI_MODEL, "gemini-2.0-flash"]
    seen = set()
    ordered = []
    for model in items:
        if model not in seen:
            seen.add(model)
            ordered.append(model)
    return ordered


def normalize_ai_provider_name(name):
    value = (name or "").strip().lower()
    if value in {"gemini", "google"}:
        return "gemini"
    if value in {"dashscope", "aliyun", "qwen"}:
        return "dashscope"
    return ""


def print_letterboxd_connection_steps(error_text=""):
    print("\n📋 Letterboxd 连接配置步骤：")
    print("1) 在项目根目录创建 .env 文件，并至少填写以下其一：")
    print("   - LETTERBOXD_USERNAME=<你的用户名>")
    print("   - LETTERBOXD_PASSWORD=<你的密码>")
    print("   或")
    print("   - LETTERBOXD_CREDENTIALS=<用户名:密码>")
    print("2) 确保用户名使用 Letterboxd 用户名（slug），不是邮箱。")
    print("3) 若触发风控/验证码，保持 LETTERBOXD_HEADLESS=false，并在弹出的浏览器中完成验证。")
    print("4) 推荐先运行配置向导：python movie_agent.py --setup")
    print("5) 完成后运行：python movie_agent.py --check-auth")
    print("6) 如只想先测试推荐流程，可设置 LETTERBOXD_LOGIN_FOR_READS=false")

    if error_text:
        print("\n当前失败原因：")
        print(error_text)


async def preflight_letterboxd(session, strict=False):
    try:
        current_user_raw = await asyncio.wait_for(
            session.call_tool("get_current_user", arguments={"tryLogin": True}),
            timeout=MCP_INIT_TIMEOUT,
        )
        current_user = parse_tool_json(current_user_raw)
        if not isinstance(current_user, dict) or not current_user.get("loggedIn"):
            detail = ""
            if isinstance(current_user, dict):
                detail = current_user.get("error") or ""
            raise RuntimeError(detail or "Not authenticated on Letterboxd session")

        # Then use a private/self-scoped endpoint to verify account-scoped reads.
        await asyncio.wait_for(
            session.call_tool("get_member_watchlist", arguments={"username": "me", "maxPages": 1}),
            timeout=MCP_INIT_TIMEOUT,
        )
        print("✅ Letterboxd 账号连通检查通过")
        return True
    except Exception as err:
        if isinstance(err, asyncio.TimeoutError):
            message = (
                "Letterboxd 登录检查超时。请确认弹出的浏览器窗口已出现并完成登录/验证码，"
                "或提高 MCP_INIT_TIMEOUT_SEC（例如 300）。"
            )
        else:
            message = str(err)
        if "Missing Letterboxd credentials" in message:
            cookie = os.getenv("LETTERBOXD_COOKIE", "")
            if cookie:
                has_persona = "persona=" in cookie
                has_current = "letterboxd.user.CURRENT=" in cookie
                print("\n❌ 已检测到 LETTERBOXD_COOKIE，但其中缺少可识别的登录会话标记")
                print(f"cookie 包含 persona: {has_persona}, 包含 letterboxd.user.CURRENT: {has_current}")
                print("请从已登录状态下的 letterboxd.com 请求头重新复制完整 Cookie 值。")
                print_letterboxd_connection_steps(message)
                return False
            print("\n❌ 未检测到有效的 Letterboxd 凭据")
            print_letterboxd_connection_steps(message)
            return False
        if "Login failed" in message:
            print("\n❌ Letterboxd 登录失败（用户名/密码错误或被风控）")
            print_letterboxd_connection_steps(message)
            return False
        if "Browser login did not reach an authenticated page" in message:
            print("\n❌ Letterboxd 登录被风控页面拦截（Cloudflare challenge）")
            print("请保持 LETTERBOXD_HEADLESS=false，并在弹出的浏览器窗口内完成验证后重试。")
            print("你不需要切换到 Cookie 模式。")
            return False
        print("\n⚠️ Letterboxd 连通检查失败，将继续尝试推荐，但结果可能不够个性化")
        print(f"详细信息: {message or '未知错误（可能为超时）'}")
        return not strict


def _prompt_non_empty(prompt_text, secret=False):
    while True:
        value = getpass(prompt_text) if secret else input(prompt_text)
        value = (value or "").strip()
        if value:
            return value
        print("该项不能为空，请重试。")


def normalize_letterboxd_username(raw_username):
    value = (raw_username or "").strip()
    if not value:
        return ""
    if value.startswith("http://") or value.startswith("https://"):
        parts = value.split("//", 1)[-1].split("/", 1)
        path = parts[1] if len(parts) > 1 else ""
        value = (path.split("/")[0] if path else "").strip()
    value = value.strip("/").strip()
    return value


def validate_username_slug(username):
    candidate = normalize_letterboxd_username(username)
    if not candidate:
        return False, "用户名为空"
    if "@" in candidate:
        return False, "检测到邮箱格式，请填写 Letterboxd 用户名 slug（例如 https://letterboxd.com/june/ 中的 june）"
    if any(ch.isspace() for ch in candidate):
        return False, "用户名不能包含空格"
    return True, candidate


def validate_runtime_credentials_shape():
    username = os.getenv("LETTERBOXD_USERNAME", "").strip()
    password = os.getenv("LETTERBOXD_PASSWORD", "").strip()
    credentials = os.getenv("LETTERBOXD_CREDENTIALS", "").strip()
    cookie = os.getenv("LETTERBOXD_COOKIE", "").strip()

    if username or password:
        if not (username and password):
            return False, "LETTERBOXD_USERNAME 和 LETTERBOXD_PASSWORD 需要同时设置"
        ok, info = validate_username_slug(username)
        if not ok:
            return False, f"LETTERBOXD_USERNAME 无效: {info}"
        return True, ""

    if credentials:
        user, sep, _ = credentials.partition(":")
        if not sep:
            return False, "LETTERBOXD_CREDENTIALS 格式无效，应为 username:password"
        ok, info = validate_username_slug(user)
        if not ok:
            return False, f"LETTERBOXD_CREDENTIALS 中的用户名无效: {info}"
        return True, ""

    if cookie:
        return True, ""

    return False, "缺少 Letterboxd 凭据。请设置 USERNAME+PASSWORD（推荐）或 CREDENTIALS。"


def run_setup_wizard():
    print("\n🛠️  Movie Agent 配置向导")
    print("将写入 .env（已存在值会被覆盖）。")

    lb_only = input("是否只更新 Letterboxd 账号？(y/N): ").strip().lower() in {"y", "yes"}

    gemini_key = ""
    tmdb_key = ""
    if not lb_only:
        gemini_key = _prompt_non_empty("GEMINI_API_KEY: ")
        tmdb_key = input("TMDB_API_KEY (可留空): ").strip()

    print("\n选择 Letterboxd 登录方式:")
    print("1) USERNAME + PASSWORD (推荐)")
    print("2) LETTERBOXD_CREDENTIALS=username:password")
    print("3) LETTERBOXD_COOKIE=... (高级)")

    mode = ""
    while mode not in {"1", "2", "3"}:
        mode = input("输入 1/2/3: ").strip()

    if not lb_only:
        set_key(ENV_PATH, "GEMINI_API_KEY", gemini_key, quote_mode="always")
        if tmdb_key:
            set_key(ENV_PATH, "TMDB_API_KEY", tmdb_key, quote_mode="always")

    if mode == "1":
        username_input = _prompt_non_empty("LETTERBOXD_USERNAME (用户名slug，不是邮箱): ")
        ok, info = validate_username_slug(username_input)
        while not ok:
            print(f"❌ 用户名格式错误: {info}")
            username_input = _prompt_non_empty("LETTERBOXD_USERNAME (重新输入): ")
            ok, info = validate_username_slug(username_input)
        username = info
        password = _prompt_non_empty("LETTERBOXD_PASSWORD: ", secret=True)
        set_key(ENV_PATH, "LETTERBOXD_USERNAME", username, quote_mode="always")
        set_key(ENV_PATH, "LETTERBOXD_PASSWORD", password, quote_mode="always")
        set_key(ENV_PATH, "LETTERBOXD_CREDENTIALS", "", quote_mode="always")
        set_key(ENV_PATH, "LETTERBOXD_COOKIE", "", quote_mode="always")
    elif mode == "2":
        creds = _prompt_non_empty("LETTERBOXD_CREDENTIALS (username:password): ", secret=True)
        user, sep, pwd = creds.partition(":")
        while (not sep) or (not pwd):
            print("❌ 格式错误，必须是 username:password")
            creds = _prompt_non_empty("LETTERBOXD_CREDENTIALS (username:password): ", secret=True)
            user, sep, pwd = creds.partition(":")
        ok, info = validate_username_slug(user)
        while not ok:
            print(f"❌ 用户名格式错误: {info}")
            creds = _prompt_non_empty("LETTERBOXD_CREDENTIALS (username:password): ", secret=True)
            user, sep, pwd = creds.partition(":")
            if not sep or not pwd:
                ok = False
                info = "格式错误，必须是 username:password"
                continue
            ok, info = validate_username_slug(user)
        creds = f"{info}:{pwd}"
        set_key(ENV_PATH, "LETTERBOXD_CREDENTIALS", creds, quote_mode="always")
        set_key(ENV_PATH, "LETTERBOXD_USERNAME", "", quote_mode="always")
        set_key(ENV_PATH, "LETTERBOXD_PASSWORD", "", quote_mode="always")
        set_key(ENV_PATH, "LETTERBOXD_COOKIE", "", quote_mode="always")
    else:
        cookie = _prompt_non_empty("LETTERBOXD_COOKIE: ", secret=True)
        set_key(ENV_PATH, "LETTERBOXD_COOKIE", cookie, quote_mode="always")
        set_key(ENV_PATH, "LETTERBOXD_USERNAME", "", quote_mode="always")
        set_key(ENV_PATH, "LETTERBOXD_PASSWORD", "", quote_mode="always")
        set_key(ENV_PATH, "LETTERBOXD_CREDENTIALS", "", quote_mode="always")

    if not lb_only:
        set_key(ENV_PATH, "GEMINI_MODEL", os.getenv("GEMINI_MODEL", "gemini-2.5-flash"), quote_mode="always")
        set_key(ENV_PATH, "GEMINI_MODELS", os.getenv("GEMINI_MODELS", "gemini-2.5-flash,gemini-2.0-flash"), quote_mode="always")
    set_key(ENV_PATH, "PORT", os.getenv("PORT", "3000"), quote_mode="always")

    print(f"\n✅ 已写入配置: {ENV_PATH}")
    print("下一步执行:")
    print("- 仅测 Letterboxd 登录: python movie_agent.py --check-auth")
    print("- 启动完整代理: python movie_agent.py")


def run_cookie_login_setup():
    print("\n🍪 Letterboxd Cookie 登录配置")
    print("请从已登录浏览器复制 letterboxd.com 请求头里的完整 Cookie 值。")
    cookie = _prompt_non_empty("LETTERBOXD_COOKIE: ", secret=True)

    set_key(ENV_PATH, "LETTERBOXD_COOKIE", cookie, quote_mode="always")
    set_key(ENV_PATH, "LETTERBOXD_USERNAME", "", quote_mode="always")
    set_key(ENV_PATH, "LETTERBOXD_PASSWORD", "", quote_mode="always")
    set_key(ENV_PATH, "LETTERBOXD_CREDENTIALS", "", quote_mode="always")

    print("\n✅ 已切换到 Cookie 登录模式。")
    print("下一步执行: python movie_agent.py --check-auth")


async def run_letterboxd_auth_check():
    valid_shape, reason = validate_runtime_credentials_shape()
    if not valid_shape:
        print("\n❌ 本地配置校验失败")
        print(reason)
        print("建议先运行: python movie_agent.py --setup")
        return 1

    current_dir = os.path.dirname(os.path.abspath(__file__))
    plugin_path = os.path.join(current_dir, "Letterboxd-MCP", "index.js")
    external_mcp_url = os.getenv("LETTERBOXD_MCP_URL")
    mcp_url = external_mcp_url
    run_port = MCP_PORT

    server_process = None
    if not external_mcp_url:
        if await is_port_open(MCP_HOST, run_port):
            run_port = get_free_port()

        mcp_url = f"http://{MCP_HOST}:{run_port}/sse"
        print(f"🚀 启动 MCP 服务器... (端口: {run_port})")
        print("=" * 60)
        server_process = await asyncio.create_subprocess_exec(
            "node",
            plugin_path,
            "--mode=sse",
            env=build_mcp_env(run_port),
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        
        # Start a task to print server output in real-time
        async def print_server_output():
            while server_process.returncode is None:
                line = await server_process.stdout.readline()
                if not line:
                    break
                print(line.decode('utf-8', errors='ignore').rstrip())
        
        output_task = asyncio.create_task(print_server_output())
        
        await wait_for_port(MCP_HOST, run_port, MCP_READY_TIMEOUT)

    try:
        async with sse_client(mcp_url, timeout=10, sse_read_timeout=300) as (read, write):
            async with ClientSession(read, write) as session:
                await asyncio.wait_for(session.initialize(), timeout=MCP_INIT_TIMEOUT)
                ok = await preflight_letterboxd(session, strict=True)
                if ok:
                    print("\n" + "=" * 60)
                    print("✅ Letterboxd 登录验证成功。")
                    return 0
                return 1
    finally:
        if server_process is not None and server_process.returncode is None:
            server_process.terminate()
            with suppress(ProcessLookupError, asyncio.TimeoutError):
                await asyncio.wait_for(server_process.wait(), timeout=3)

async def run_movie_agent(ai_provider_override=None):
    valid_shape, reason = validate_runtime_credentials_shape()
    if not valid_shape:
        print("\n❌ 本地配置校验失败")
        print(reason)
        print("建议先运行: python movie_agent.py --setup")
        return

    # 2. 启动 MCP Server (SSE 模式)
    # 获取当前脚本所在目录的绝对路径
    current_dir = os.path.dirname(os.path.abspath(__file__))
    # 拼接插件 index.js 的路径
    plugin_path = os.path.join(current_dir, "Letterboxd-MCP", "index.js")
    external_mcp_url = os.getenv("LETTERBOXD_MCP_URL")
    mcp_url = external_mcp_url
    run_port = MCP_PORT

    server_process = None
    if not external_mcp_url:
        if await is_port_open(MCP_HOST, run_port):
            run_port = get_free_port()

        mcp_url = f"http://{MCP_HOST}:{run_port}/sse"
        server_process = await asyncio.create_subprocess_exec(
            "node",
            plugin_path,
            "--mode=sse",
            env=build_mcp_env(run_port),
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
        )
        await wait_for_port(MCP_HOST, run_port, MCP_READY_TIMEOUT)

    # 3. 初始化 AI 客户端（支持单一选择: gemini / dashscope）
    chosen_provider = normalize_ai_provider_name(ai_provider_override or AI_PROVIDER)
    if not chosen_provider:
        print("\n❌ AI_PROVIDER 配置无效，仅支持: gemini 或 dashscope")
        return

    try:
        ai_provider = get_ai_provider(chosen_provider)
    except Exception as provider_error:
        print(f"\n❌ AI 提供商初始化失败: {provider_error}")
        if chosen_provider == "dashscope":
            print("提示：请确认 .env 中 DASHSCOPE_API_KEY 是百炼 Model Studio 的有效 API Key。")
        return

    # 模型名称可由 AI_MODEL 覆盖；无配置则按 provider 默认值
    model_id = get_default_model(chosen_provider)

    print("🚀 正在连接 Letterboxd 插件并同步你的数据...")

    try:
        # 使用 SSE 方式连接 MCP 服务
        async with sse_client(mcp_url, timeout=10, sse_read_timeout=300) as (read, write):
            async with ClientSession(read, write) as session:
                # 初始化 MCP 并获取工具列表
                await asyncio.wait_for(session.initialize(), timeout=MCP_INIT_TIMEOUT)
                available_tools = await asyncio.wait_for(session.list_tools(), timeout=MCP_INIT_TIMEOUT)

                # 先做账号连通预检查，避免进入对话后才发现凭据问题
                if not await preflight_letterboxd(session):
                    return

                # 将 MCP 工具转换为统一 Tool 格式
                tools_for_ai = [
                    {
                        "function_declarations": [
                            {
                                "name": t.name,
                                "description": t.description,
                                "parameters": t.inputSchema,
                            }
                            for t in available_tools.tools
                        ]
                    }
                ]

                # 4. 获取用户上下文
                now = datetime.now()
                current_time_str = now.strftime("%Y-%m-%d %H:%M")
                mood_raw = safe_input("\n🎥 嗨 June，你现在心情如何？(例如: 写完 CS162 很累/想看王家卫): ")
                if mood_raw is None:
                    return
                mood = mood_raw
                watchlist_only = detect_watchlist_only_intent(mood)

                watchlist_pairs = []
                watchlist_slug_set = set()
                if watchlist_only:
                    print("🔎 检测到你希望从 Watchlist 推荐，先读取你的待看列表...")
                    try:
                        watchlist_raw = await session.call_tool(
                            "get_member_watchlist",
                            arguments={"username": "me", "maxPages": 2},
                        )
                        watchlist_payload = parse_tool_json(watchlist_raw)
                        watchlist_pairs = build_watchlist_brief(watchlist_payload)
                        watchlist_slug_set = slugs_from_watchlist(watchlist_payload)
                    except Exception as watchlist_error:
                        print(f"\n⚠️ 读取 Watchlist 失败：{watchlist_error}")
                        watchlist_pairs = []
                        watchlist_slug_set = set()

                    if not watchlist_pairs:
                        print("⚠️ 你的 Watchlist 为空或暂时不可读取，本次将退回常规推荐。")
                        watchlist_only = False

                if chosen_provider == "dashscope":
                    dashscope_context_lines = []
                    print("🗂️  获取用户上下文信息...")
                    
                    try:
                        me_raw = await session.call_tool("get_current_user", arguments={"tryLogin": False})
                        me_payload = parse_tool_json(me_raw)
                        username = (me_payload or {}).get("username") if isinstance(me_payload, dict) else None
                        if username:
                            dashscope_context_lines.append(f"当前用户: {username}")
                            print(f"   ✓ 已获取用户信息: {username}")
                    except Exception:
                        pass

                    try:
                        if not watchlist_pairs:
                            print("   🔍 正在读取 Watchlist...")
                            wl_raw = await session.call_tool("get_member_watchlist", arguments={"username": "me", "maxPages": 1})
                            wl_payload = parse_tool_json(wl_raw)
                            watchlist_pairs = build_watchlist_brief(wl_payload, limit=30)
                        if watchlist_pairs:
                            preview = ", ".join([f"{x.get('title','')}({x.get('slug','')})" for x in watchlist_pairs[:12]])
                            dashscope_context_lines.append(f"用户 watchlist 样本: {preview}")
                            print(f"   ✓ 已获取 Watchlist: {len(watchlist_pairs)} 部电影")
                    except Exception:
                        pass

                    dashscope_context = "\n".join(dashscope_context_lines) if dashscope_context_lines else "无额外用户上下文"
                    print("🤖 正在生成个性化推荐...")
                    system_prompt = f"""
                    你是一个专业的电影管家。现在是 {current_time_str}。
                    用户当前心情：{mood}。
                    已收集到的用户上下文如下（你只需要基于这些上下文和常识推荐，不要说“无法访问网站”）：
                    {dashscope_context}

                    你的任务：
                    1. 根据用户心情给出 1-2 部电影推荐，并解释理由。
                    2. 每部推荐都必须包含：
                       - 片名（中英文）
                       - 时长（分钟）
                       - 国家/地区
                       - Letterboxd 平均评分（如果有）
                       - slug（电影 URL 标识符，例如 lost-in-translation）
                       - 推荐理由
                    3. 只输出推荐结果，不要输出前置说明、免责声明或工具调用说明。

                    输出格式示例：
                    《迷失东京》Lost in Translation (2003, 美国/日本, 102分钟, ⭐ 3.76)
                    slug: lost-in-translation
                    推荐理由：...
                    """
                else:
                    system_prompt = f"""
                    你是一个专业的电影管家。现在是 {current_time_str}。
                    用户当前心情：{mood}。
                    你的任务：
                    1. 先调用 letterboxd 只读工具获取用户上下文（watchlist、diary、films、pinned）。
                    2. 根据时间和心情给出 1-2 部推荐，并解释理由。
                    3. **重要**：每部推荐电影必须包含以下信息（如果可获取）：
                       - 片名（中英文）
                       - 时长（分钟）
                       - 国家/地区
                       - Letterboxd 平均评分（如果有）
                       - **slug**（电影的URL标识符，例如 lost-in-translation）
                       - 推荐理由
                       格式示例：
                       《迷失东京》Lost in Translation (2003, 美国/日本, 102分钟, ⭐ 3.76)
                       slug: lost-in-translation
                       推荐理由：...
                    4. 如果要调用写操作工具（add_to_watched/add_to_watchlist/write_review/add_to_list/create_list/toggle_like/rate_film），
                       必须先向用户说明将执行什么，再等待用户确认。
                    """

                if watchlist_only:
                    watchlist_json = json.dumps(watchlist_pairs, ensure_ascii=False)
                    system_prompt += f"""

                额外强约束（必须遵守）：
                - 用户明确要求从 watchlist 里推荐，你只能从以下候选中推荐，禁止推荐列表外电影。
                - 候选（title/slug）: {watchlist_json}
                - 输出时请在每部推荐后附带 slug，格式示例：电影名（slug: xxxx）。
                - 若候选里没有合适的“伤感”电影，请明确说“你的 watchlist 里暂时没有明显更伤感的候选”。
                """

                # 5. 与 AI 对话（Gemini 支持模型回退；DashScope 使用单模型）
                chat = None
                response = None
                model_error = None
                if chosen_provider == "gemini":
                    # Gemini 保留回退模型逻辑
                    client = genai.Client(api_key=GEMINI_KEY)
                    for candidate_model in gemini_model_candidates():
                        try:
                            chat = client.chats.create(model=candidate_model, config={"tools": tools_for_ai})
                            response = chat.send_message(system_prompt)
                            model_id = candidate_model
                            break
                        except Exception as err:
                            model_error = err
                    if response is None or chat is None:
                        raise RuntimeError(f"Gemini 请求失败: {model_error}")
                else:
                    # DashScope 在本项目中走稳定文本模式，避免 function-calling 空响应
                    chat = await ai_provider.create_chat(model_id, [])
                    response = await ai_provider.send_message(chat, system_prompt)

                # 6. 工具调用循环
                if chosen_provider == "gemini":
                    for _ in range(20):
                        call = extract_function_call(response)
                        if not call:
                            break

                        call_args = dict(getattr(call, "args", {}) or {})
                        if call.name in WRITE_TOOLS and not confirm_write_action(call.name, call_args):
                            tool_payload = {
                                "ok": False,
                                "cancelled": True,
                                "reason": "User denied write action",
                                "tool": call.name,
                            }
                        else:
                            print(f"🛠️  Agent 正在使用工具: {call.name}...")
                            try:
                                tool_result = await session.call_tool(call.name, arguments=call_args)
                                tool_payload = to_gemini_tool_result(tool_result)
                            except Exception as tool_error:
                                tool_payload = {
                                    "ok": False,
                                    "tool": call.name,
                                    "error": str(tool_error),
                                }

                        try:
                            response = chat.send_message(
                                [
                                    genai.types.Part.from_function_response(
                                        name=call.name,
                                        response={"result": tool_payload},
                                    )
                                ]
                            )
                        except Exception as model_runtime_error:
                            print(f"\n⚠️ {chosen_provider} 暂时不可用: {model_runtime_error}")
                            break
                elif chosen_provider == "dashscope":
                    # DashScope 尝试工具调用（实验性）
                    for _ in range(10):
                        try:
                            call = ai_provider.extract_function_call(response)
                            if not call:
                                break
                            
                            print(f"🛠️  Agent 正在使用工具: {call.name}...")
                            call_args = call.args if hasattr(call, 'args') else {}
                            
                            if call.name in WRITE_TOOLS and not confirm_write_action(call.name, call_args):
                                tool_result_text = json.dumps({"cancelled": True, "reason": "User denied write action"}, ensure_ascii=False)
                            else:
                                try:
                                    tool_result = await session.call_tool(call.name, arguments=call_args)
                                    tool_result_text = json.dumps(parse_tool_json(tool_result), ensure_ascii=False)
                                except Exception as tool_error:
                                    # 处理 Turnstile 验证问题
                                    if "turnstile-dialog" in str(tool_error).lower():
                                        print(f"⚠️ 检测到 Turnstile 验证，正在重试...")
                                        await asyncio.sleep(2)
                                        try:
                                            # 重试一次
                                            tool_result = await session.call_tool(call.name, arguments=call_args)
                                            tool_result_text = json.dumps(parse_tool_json(tool_result), ensure_ascii=False)
                                        except Exception:
                                            tool_result_text = json.dumps({"error": f"操作被 Letterboxd 验证阻止: {str(tool_error)}。请稍后手动访问 Letterboxd 网站完成验证，或重新登录。"}, ensure_ascii=False)
                                    else:
                                        tool_result_text = json.dumps({"error": str(tool_error)}, ensure_ascii=False)
                            
                            # 发送工具调用结果到 DashScope
                            response = await ai_provider.call_tool_and_continue(call.name, tool_result_text)
                        except Exception as tool_loop_error:
                            print(f"\n⚠️ DashScope 工具调用出错: {tool_loop_error}")
                            break

                final_text = getattr(response, "text", "(无文本输出)") if chosen_provider == "gemini" else ai_provider.get_response_text(response)
                if chosen_provider == "dashscope" and (not final_text or final_text == "(无文本输出)"):
                    try:
                        response = await ai_provider.send_message(
                            chat,
                            "你必须直接给出 2 部电影推荐，输出纯文本，不要调用任何工具，不要留空。"
                            "格式：\n《片名》English Title (年份, 国家/地区, 时长分钟, ⭐ 评分)\n"
                            "slug: xxx\n推荐理由：..."
                        )
                        final_text = ai_provider.get_response_text(response)
                    except Exception:
                        pass
                if not final_text or final_text == "(无文本输出)":
                    final_text = "当前模型返回了空响应。请重试，或切换到 --ai gemini。"
                if watchlist_only and watchlist_slug_set:
                    slugs_in_answer = extract_slugs_from_response(final_text)
                    invalid_slugs = [s for s in slugs_in_answer if s not in watchlist_slug_set]
                    if (not slugs_in_answer) or invalid_slugs:
                        allowed = ", ".join(sorted(watchlist_slug_set))
                        repair_prompt = (
                            "你上一个答案不符合约束。"
                            f"不允许的 slug: {invalid_slugs or '无（但你没有输出 slug）'}。"
                            "请严格只使用我提供的候选并重新回答 1-2 部，"
                            "每部必须带 slug（格式：slug: xxx）。"
                            f"允许的 slug 只有：{allowed}。"
                        )
                        if chosen_provider == "gemini":
                            response = chat.send_message(repair_prompt)
                            final_text = getattr(response, "text", "(无文本输出)")
                        else:
                            response = await ai_provider.send_message(chat, repair_prompt)
                            final_text = ai_provider.get_response_text(response)

                    slugs_in_answer = extract_slugs_from_response(final_text)
                    invalid_slugs = [s for s in slugs_in_answer if s not in watchlist_slug_set]
                    if (not slugs_in_answer) or invalid_slugs:
                        preview = watchlist_pairs[:5]
                        fallback_lines = [
                            "你的请求是只从 watchlist 推荐，但模型输出仍包含列表外电影。",
                            "为保证准确性，这里只返回你 watchlist 中可选的候选（title / slug）：",
                        ]
                        for item in preview:
                            fallback_lines.append(f"- {item.get('title', '')} (slug: {item.get('slug', '')})")
                        fallback_lines.append("请告诉我你想在这些候选里偏向哪种题材或年代，我再给你最伤感的 1-2 部。")
                        final_text = "\n".join(fallback_lines)

                # 7. 输出最终建议并支持重新推荐
                # 提取推荐电影的slug信息 - 使用更精确的模式
                recommended_films = []
                
                # 方法1: 尝试匹配《标题》...slug: xxx 这样的完整模式
                # 匹配《xxx》后面200字符内的 slug: yyy
                film_pattern = r'《([^》]+)》[^《]*?slug:\s*([a-z0-9-]+)'
                film_matches = re.finditer(film_pattern, final_text, re.IGNORECASE | re.DOTALL)
                
                for match in film_matches:
                    title = match.group(1)
                    slug = match.group(2)
                    recommended_films.append({'title': title, 'slug': slug})
                
                # 方法2: 如果方法1没匹配到，尝试分别提取但跳过前面的内容
                if not recommended_films:
                    # 找到推荐部分的开始（通常在"推荐"或"建议"之后）
                    recommend_start = max(
                        final_text.find('推荐'),
                        final_text.find('建议'),
                        final_text.find('为您'),
                        0
                    )
                    recommend_text = final_text[recommend_start:] if recommend_start > 0 else final_text
                    
                    slug_matches = list(re.finditer(r'slug:\s*([a-z0-9-]+)', recommend_text, re.IGNORECASE))
                    title_matches = list(re.finditer(r'《([^》]+)》', recommend_text))
                    
                    # 只取推荐部分的标题（通常是最后N个）
                    num_slugs = len(slug_matches)
                    titles = [m.group(1) for m in title_matches[-num_slugs:]] if title_matches else []
                    slugs = [m.group(1) for m in slug_matches]
                    
                    for i, slug in enumerate(slugs):
                        title = titles[i] if i < len(titles) else f"电影 {i+1}"
                        recommended_films.append({'title': title, 'slug': slug})
                
                while True:
                    print("\n" + "=" * 30)
                    print(f"🌟 {chosen_provider} 的私人推荐：")
                    print(final_text)
                    print("=" * 30)
                    
                    # 询问是否需要重新推荐
                    retry_raw = safe_input("\n对推荐满意吗？输入新的要求可重新推荐，直接回车继续: ")
                    if retry_raw is None:
                        return
                    retry = retry_raw.strip()
                    
                    if not retry:
                        # 用户满意，跳出循环
                        break
                    
                    # 用户不满意，根据新要求重新推荐
                    print(f"\n🔄 根据新要求重新推荐：{retry}")
                    refine_prompt = f"""用户对上一个推荐不满意。
                    新要求：{retry}
                    请根据新要求重新推荐 1-2 部电影。
                    记住要包含：片名、年份、国家、时长、Letterboxd评分（如果有）、推荐理由。
                    """
                    
                    try:
                        if chosen_provider == "gemini":
                            response = chat.send_message(refine_prompt)
                        else:
                            response = await ai_provider.send_message(chat, refine_prompt)
                        
                        # 仅 Gemini 使用工具调用循环
                        if chosen_provider == "gemini":
                            for _ in range(10):
                                call = extract_function_call(response)
                                if not call:
                                    break
                                
                                call_args = dict(getattr(call, "args", {}) or {})
                                print(f"🛠️  Agent 正在使用工具: {call.name}...")
                                try:
                                    tool_result = await session.call_tool(call.name, arguments=call_args)
                                    tool_payload = to_gemini_tool_result(tool_result)
                                except Exception as tool_error:
                                    tool_payload = {"ok": False, "tool": call.name, "error": str(tool_error)}
                                
                                response = chat.send_message(
                                    [
                                        genai.types.Part.from_function_response(
                                            name=call.name,
                                            response={"result": tool_payload},
                                        )
                                    ]
                                )
                        
                        final_text = getattr(response, "text", "(无文本输出)") if chosen_provider == "gemini" else ai_provider.get_response_text(response)
                        if chosen_provider == "dashscope" and (not final_text or final_text == "(无文本输出)"):
                            try:
                                response = await ai_provider.send_message(
                                    chat,
                                    "请直接输出纯文本电影推荐结果，不要返回空内容。格式：片名、年份、时长、评分、slug、推荐理由。"
                                )
                                final_text = ai_provider.get_response_text(response)
                            except Exception:
                                pass
                        if not final_text or final_text == "(无文本输出)":
                            final_text = "当前模型返回了空响应。请重试，或切换到 --ai gemini。"
                        
                        # 重新提取推荐电影信息 - 使用改进的逻辑
                        recommended_films = []
                        
                        # 方案1: 尝试匹配《标题》...slug: xxx 这样的完整模式
                        film_pattern = r'《([^》]+)》[^《]*?slug:\s*([a-z0-9-]+)'
                        film_matches = re.finditer(film_pattern, final_text, re.IGNORECASE | re.DOTALL)
                        
                        for match in film_matches:
                            title = match.group(1)
                            slug = match.group(2)
                            recommended_films.append({'title': title, 'slug': slug})
                        
                        # 方案2: 如果方案1没匹配到，尝试分别提取但跳过前面的内容
                        if not recommended_films:
                            recommend_start = max(
                                final_text.find('推荐'),
                                final_text.find('建议'),
                                final_text.find('为您'),
                                0
                            )
                            recommend_text = final_text[recommend_start:] if recommend_start > 0 else final_text
                            
                            slug_matches = list(re.finditer(r'slug:\s*([a-z0-9-]+)', recommend_text, re.IGNORECASE))
                            title_matches = list(re.finditer(r'《([^》]+)》', recommend_text))
                            
                            # 只取推荐部分的标题（通常是最后N个）
                            num_slugs = len(slug_matches)
                            titles = [m.group(1) for m in title_matches[-num_slugs:]] if title_matches else []
                            slugs = [m.group(1) for m in slug_matches]
                            
                            for i, slug in enumerate(slugs):
                                title = titles[i] if i < len(titles) else f"电影 {i+1}"
                                recommended_films.append({'title': title, 'slug': slug})
                        
                    except Exception as retry_error:
                        print(f"\n⚠️ 重新推荐失败: {retry_error}")
                        break

                await interactive_post_recommendation_actions(session, recommended_films)
    finally:
        if server_process is not None and server_process.returncode is None:
            server_process.terminate()
            with suppress(ProcessLookupError, asyncio.TimeoutError):
                await asyncio.wait_for(server_process.wait(), timeout=3)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Movie Agent for Letterboxd")
    parser.add_argument("--setup", action="store_true", help="Run interactive .env setup wizard")
    parser.add_argument("--check-auth", action="store_true", help="Check only Letterboxd authentication")
    parser.add_argument("--cookie-login", action="store_true", help="Configure LETTERBOXD_COOKIE login mode")
    parser.add_argument("--ai", choices=["gemini", "dashscope"], help="Select a single AI provider for this run")
    args = parser.parse_args()

    if args.setup:
        run_setup_wizard()
        sys.exit(0)

    if args.cookie_login:
        run_cookie_login_setup()
        sys.exit(0)

    if args.check_auth:
        try:
            exit_code = asyncio.run(run_letterboxd_auth_check())
        except Exception as e:
            print(f"\n❌ 登录校验异常: {e}")
            if os.getenv("DEBUG_TRACEBACK", "false").lower() in {"1", "true", "yes"}:
                traceback.print_exception(e)
            exit_code = 1
        sys.exit(exit_code)

    try:
        asyncio.run(run_movie_agent(ai_provider_override=args.ai))
    except KeyboardInterrupt:
        print("\n\n已取消当前会话。")
        sys.exit(130)
    except Exception as e:
        print(f"\n❌ 运行出错: {e}")
        if os.getenv("DEBUG_TRACEBACK", "false").lower() in {"1", "true", "yes"}:
            traceback.print_exception(e)
        print("提示：请检查你的 .env 文件和网络连接。")