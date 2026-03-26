"""
AI 提供商抽象层 - 支持多个 AI API
支持: Google Gemini, 阿里云百炼 (DashScope)
"""

import os
from abc import ABC, abstractmethod
from typing import List, Dict, Any, Optional
import json


class AIProvider(ABC):
    """AI 提供商基类"""
    
    @abstractmethod
    async def create_chat(self, model: str, tools: List[Dict]) -> Any:
        """创建对话会话"""
        pass
    
    @abstractmethod
    async def send_message(self, chat: Any, message: str) -> Any:
        """发送消息"""
        pass
    
    @abstractmethod
    def extract_function_call(self, response: Any) -> Optional[Any]:
        """提取函数调用"""
        pass
    
    @abstractmethod
    def get_response_text(self, response: Any) -> str:
        """获取响应文本"""
        pass
    
    @abstractmethod
    async def send_function_response(self, chat: Any, function_name: str, result: Dict) -> Any:
        """发送函数执行结果"""
        pass


class GeminiProvider(AIProvider):
    """Google Gemini 提供商"""
    
    def __init__(self, api_key: str):
        from google import genai
        self.client = genai.Client(api_key=api_key)
        self.genai = genai
    
    async def create_chat(self, model: str, tools: List[Dict]) -> Any:
        chat = self.client.chats.create(model=model, config={"tools": tools})
        return chat
    
    async def send_message(self, chat: Any, message: str) -> Any:
        return chat.send_message(message)
    
    def extract_function_call(self, response: Any) -> Optional[Any]:
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
    
    def get_response_text(self, response: Any) -> str:
        return getattr(response, "text", "(无文本输出)")
    
    async def send_function_response(self, chat: Any, function_name: str, result: Dict) -> Any:
        return chat.send_message([
            self.genai.types.Part.from_function_response(
                name=function_name,
                response={"result": result},
            )
        ])


class DashScopeProvider(AIProvider):
    """阿里云百炼 (DashScope) 提供商"""
    
    def __init__(self, api_key: str):
        try:
            import dashscope
            from dashscope import Generation
        except ImportError:
            raise ImportError(
                "需要安装 dashscope SDK: pip install dashscope\n"
                "参考: https://help.aliyun.com/zh/model-studio/developer-reference/sdk-for-python"
            )
        
        self.api_key = api_key
        dashscope.api_key = api_key
        self.Generation = Generation
        self.messages = []
        self.tools = []
    
    async def create_chat(self, model: str, tools: List[Dict]) -> Any:
        """
        DashScope 使用不同的 API 格式
        模型: qwen-max, qwen-plus, qwen-turbo 等
        """
        # 转换 MCP 工具格式为 DashScope 格式
        self.tools = self._convert_tools_format(tools)
        self.model = model or "qwen-max"
        self.messages = []
        return self  # 返回自己作为 chat 对象
    
    def _convert_tools_format(self, mcp_tools: List[Dict]) -> List[Dict]:
        """将 MCP 工具格式转换为 DashScope 格式"""
        dashscope_tools = []
        for tool_group in mcp_tools:
            for func_decl in tool_group.get("function_declarations", []):
                dashscope_tools.append({
                    "type": "function",
                    "function": {
                        "name": func_decl["name"],
                        "description": func_decl.get("description", ""),
                        "parameters": func_decl.get("parameters", {}),
                    }
                })
        return dashscope_tools

    @staticmethod
    def _obj_to_dict(value: Any) -> Any:
        if value is None:
            return None
        if isinstance(value, dict):
            return value
        if hasattr(value, "to_dict"):
            try:
                return value.to_dict()
            except Exception:
                pass
        if hasattr(value, "__dict__"):
            return dict(value.__dict__)
        return value

    def _normalize_message_for_history(self, message: Any) -> Dict[str, Any]:
        """DashScope history expects plain dict messages; normalize SDK objects/lists/dicts."""
        msg = self._obj_to_dict(message)
        if not isinstance(msg, dict):
            return {"role": "assistant", "content": str(msg)}

        role = msg.get("role", "assistant")
        content = msg.get("content", "")
        tool_calls = msg.get("tool_calls")

        # If content is a complex list structure, preserve it for tool-calling,
        # but keep as JSON-serializable data.
        if isinstance(content, list):
            normalized_content = []
            for part in content:
                normalized_content.append(self._obj_to_dict(part) if not isinstance(part, (str, dict)) else part)
            content = normalized_content

        normalized = {"role": role, "content": content}
        if tool_calls is not None:
            normalized_calls = []
            for tc in tool_calls if isinstance(tool_calls, list) else [tool_calls]:
                normalized_calls.append(self._obj_to_dict(tc) if not isinstance(tc, dict) else tc)
            normalized["tool_calls"] = normalized_calls
        return normalized

    def _extract_message(self, response: Any) -> Any:
        output = getattr(response, "output", None)
        if output is None and isinstance(response, dict):
            output = response.get("output")
        if output is None:
            return None

        choices = getattr(output, "choices", None)
        if choices is None and isinstance(output, dict):
            choices = output.get("choices")
        if not choices:
            return None

        choice0 = choices[0]
        if isinstance(choice0, dict):
            return choice0.get("message")
        return getattr(choice0, "message", None)

    def _content_to_text(self, content: Any) -> str:
        if content is None:
            return ""
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            texts = []
            for part in content:
                if isinstance(part, str):
                    texts.append(part)
                    continue
                part_dict = self._obj_to_dict(part)
                if isinstance(part_dict, dict):
                    if isinstance(part_dict.get("text"), str):
                        texts.append(part_dict["text"])
                    elif isinstance(part_dict.get("content"), str):
                        texts.append(part_dict["content"])
            return "\n".join([t for t in texts if t]).strip()

        content_dict = self._obj_to_dict(content)
        if isinstance(content_dict, dict):
            if isinstance(content_dict.get("text"), str):
                return content_dict["text"]
            if isinstance(content_dict.get("content"), str):
                return content_dict["content"]
        return str(content)
    
    async def send_message(self, chat: Any, message: str) -> Any:
        """发送消息到 DashScope"""
        self.messages.append({
            "role": "user",
            "content": message
        })
        
        # 调用 DashScope API
        response = self.Generation.call(
            model=self.model,
            messages=self.messages,
            tools=self.tools if self.tools else None,
            result_format='message'
        )
        
        if response.status_code == 200:
            assistant_msg = self._extract_message(response)
            self.messages.append(self._normalize_message_for_history(assistant_msg))
            return response
        else:
            if str(response.code) == "InvalidApiKey":
                raise Exception(
                    "DashScope API 错误: InvalidApiKey - Invalid API-key provided.\n"
                    "请确认你使用的是阿里云百炼(Model Studio) API Key（而不是其他产品的Key），并且Key未过期、未禁用。\n"
                    "建议到控制台重新生成 Key 后更新 .env 的 DASHSCOPE_API_KEY。"
                )
            raise Exception(f"DashScope API 错误: {response.code} - {response.message}")
    
    def extract_function_call(self, response: Any) -> Optional[Any]:
        """提取函数调用"""
        try:
            message = self._extract_message(response)
            if message is None:
                return None

            tool_calls = None
            if isinstance(message, dict):
                tool_calls = message.get("tool_calls")
            else:
                tool_calls = getattr(message, "tool_calls", None)

            if tool_calls and len(tool_calls) > 0:
                # 返回一个兼容的对象
                tool_call = tool_calls[0]
                func = tool_call.get("function") if isinstance(tool_call, dict) else getattr(tool_call, "function", None)
                if not func:
                    return None

                name = func.get("name") if isinstance(func, dict) else getattr(func, "name", None)
                arguments = func.get("arguments") if isinstance(func, dict) else getattr(func, "arguments", None)
                if not name:
                    return None
                
                class FunctionCall:
                    def __init__(self, name, args):
                        self.name = name
                        self.args = args
                
                return FunctionCall(
                    name=name,
                    args=json.loads(arguments) if isinstance(arguments, str) else (arguments or {})
                )
        except Exception:
            pass
        return None
    
    async def call_tool_and_continue(self, tool_name: str, tool_result: str) -> Any:
        """调用工具并继续对话"""
        # 添加工具调用结果到对话历史
        self.messages.append({
            "role": "tool",
            "name": tool_name,
            "content": tool_result
        })
        
        # 继续对话
        response = self.Generation.call(
            model=self.model,
            messages=self.messages,
            tools=self.tools if self.tools else None,
            result_format='message'
        )
        
        if response.status_code == 200:
            assistant_msg = self._extract_message(response)
            self.messages.append(self._normalize_message_for_history(assistant_msg))
            return response
        else:
            raise Exception(f"DashScope API 错误: {response.code} - {response.message}")
    
    def get_response_text(self, response: Any) -> str:
        """获取响应文本"""
        try:
            message = self._extract_message(response)
            if message is None:
                return "(无文本输出)"

            if isinstance(message, dict):
                content = message.get("content")
            else:
                content = getattr(message, "content", None)

            text = self._content_to_text(content)
            return text if text else "(无文本输出)"
        except Exception:
            return "(无文本输出)"
    
    async def send_function_response(self, chat: Any, function_name: str, result: Dict) -> Any:
        """发送函数执行结果"""
        # DashScope 需要将工具调用结果添加到消息历史
        self.messages.append({
            "role": "tool",
            "name": function_name,
            "content": json.dumps(result, ensure_ascii=False)
        })
        
        # 继续对话
        response = self.Generation.call(
            model=self.model,
            messages=self.messages,
            tools=self.tools if self.tools else None,
            result_format='message'
        )
        
        if response.status_code == 200:
            assistant_msg = self._extract_message(response)
            self.messages.append(self._normalize_message_for_history(assistant_msg))
            return response
        else:
            if str(response.code) == "InvalidApiKey":
                raise Exception(
                    "DashScope API 错误: InvalidApiKey - Invalid API-key provided.\n"
                    "请确认你使用的是阿里云百炼(Model Studio) API Key（而不是其他产品的Key），并且Key未过期、未禁用。\n"
                    "建议到控制台重新生成 Key 后更新 .env 的 DASHSCOPE_API_KEY。"
                )
            raise Exception(f"DashScope API 错误: {response.code} - {response.message}")


def get_ai_provider(provider_name: str = None) -> AIProvider:
    """
    获取 AI 提供商实例
    
    Args:
        provider_name: 'gemini' 或 'dashscope'，默认从环境变量 AI_PROVIDER 读取
    
    Returns:
        AIProvider 实例
    
    Raises:
        ValueError: 如果提供商不支持或配置错误
    """
    provider_name = provider_name or os.getenv("AI_PROVIDER", "gemini").lower()
    
    if provider_name == "gemini":
        api_key = (os.getenv("GEMINI_API_KEY") or "").strip().strip('"').strip("'")
        if not api_key:
            raise ValueError("需要设置 GEMINI_API_KEY 环境变量")
        return GeminiProvider(api_key)
    
    elif provider_name in ["dashscope", "aliyun", "qwen"]:
        api_key = (os.getenv("DASHSCOPE_API_KEY") or "").strip().strip('"').strip("'")
        if not api_key:
            raise ValueError("需要设置 DASHSCOPE_API_KEY 环境变量")
        return DashScopeProvider(api_key)
    
    else:
        raise ValueError(f"不支持的 AI 提供商: {provider_name}，支持: gemini, dashscope")


def get_default_model(provider_name: str = None) -> str:
    """获取默认模型名称"""
    provider_name = provider_name or os.getenv("AI_PROVIDER", "gemini").lower()
    
    defaults = {
        "gemini": "gemini-2.5-flash",
        "dashscope": "qwen-max",
        "aliyun": "qwen-max",
        "qwen": "qwen-max",
    }
    
    return os.getenv("AI_MODEL", defaults.get(provider_name, "gemini-2.5-flash"))
