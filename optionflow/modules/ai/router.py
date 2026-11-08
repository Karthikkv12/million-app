"""optionflow/modules/ai/router.py — POST /ai/chat (streamed text)."""
from __future__ import annotations

from typing import List, Literal

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from optionflow.core.deps import get_current_user
from optionflow.modules.ai import service

router = APIRouter(prefix="/ai", tags=["ai"])


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(BaseModel):
    messages: List[ChatMessage] = Field(min_length=1)


@router.post("/chat", response_class=StreamingResponse)
def chat(body: ChatRequest, user=Depends(get_current_user)) -> StreamingResponse:
    """Portfolio-aware assistant. Streams plain text; errors come back before the stream starts."""
    stream = service.chat(int(user["sub"]), [m.model_dump() for m in body.messages])
    return StreamingResponse(stream, media_type="text/plain; charset=utf-8")
