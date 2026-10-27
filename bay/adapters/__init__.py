"""Runtime adapters. Register new runtimes here; nothing else needs to change."""
from .base import Adapter, BuildReport
from .claude_code import ClaudeCodeAdapter

REGISTRY: dict[str, type[Adapter]] = {
    ClaudeCodeAdapter.name: ClaudeCodeAdapter,
    # "managed-agents": ManagedAgentsAdapter,   # next: same specs, cloud runtime
    # "agent-sdk": AgentSdkAdapter,             # next: headless workers via Claude Agent SDK
}


def get(name: str) -> Adapter:
    if name not in REGISTRY:
        raise KeyError(f"unknown runtime '{name}' (have: {', '.join(REGISTRY)})")
    return REGISTRY[name]()


__all__ = ["Adapter", "BuildReport", "REGISTRY", "get"]
