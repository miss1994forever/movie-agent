from __future__ import annotations

from fastapi import APIRouter, HTTPException, Response

from ..schemas.history import HistoryItem, HistoryListResponse
from ..services.history_service import delete_history, get_history, list_history


router = APIRouter(prefix="/api/history", tags=["history"])


@router.get("", response_model=HistoryListResponse)
async def history_list() -> HistoryListResponse:
    return HistoryListResponse(items=await list_history())


@router.get("/{item_id}", response_model=HistoryItem)
async def history_detail(item_id: str) -> HistoryItem:
    item = await get_history(item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="History item not found.")
    return item


@router.delete("/{item_id}", status_code=204)
async def history_delete(item_id: str) -> Response:
    deleted = await delete_history(item_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="History item not found.")
    return Response(status_code=204)
