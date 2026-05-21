from __future__ import annotations

import json

from ..schemas.history import HistoryItem
from ..schemas.recommendation import MovieRecommendation
from ..storage.database import connect


def _row_to_item(row) -> HistoryItem:
    raw_movies = row["movies_json"] or "[]"
    try:
        movies_data = json.loads(raw_movies)
    except json.JSONDecodeError:
        movies_data = []
    movies = [MovieRecommendation.model_validate(item) for item in movies_data if isinstance(item, dict)]
    return HistoryItem(
        id=row["id"],
        mood=row["mood"],
        result_text=row["result_text"],
        movies=movies,
        status=row["status"],
        error=row["error"],
        created_at=row["created_at"],
        finished_at=row["finished_at"],
    )


async def save_history(item: HistoryItem) -> None:
    db = await connect()
    try:
        await db.execute(
            """
            INSERT OR REPLACE INTO recommendation_history
            (id, mood, result_text, movies_json, status, error, created_at, finished_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                item.id,
                item.mood,
                item.result_text,
                json.dumps([movie.model_dump() for movie in item.movies], ensure_ascii=False),
                item.status,
                item.error,
                item.created_at.isoformat(),
                item.finished_at.isoformat() if item.finished_at else None,
            ),
        )
        await db.commit()
    finally:
        await db.close()


async def list_history() -> list[HistoryItem]:
    db = await connect()
    try:
        cursor = await db.execute(
            """
            SELECT id, mood, result_text, movies_json, status, error, created_at, finished_at
            FROM recommendation_history
            ORDER BY created_at DESC
            LIMIT 100
            """
        )
        rows = await cursor.fetchall()
    finally:
        await db.close()
    return [_row_to_item(row) for row in rows]


async def get_history(item_id: str) -> HistoryItem | None:
    db = await connect()
    try:
        cursor = await db.execute(
            """
            SELECT id, mood, result_text, movies_json, status, error, created_at, finished_at
            FROM recommendation_history
            WHERE id = ?
            """,
            (item_id,),
        )
        row = await cursor.fetchone()
    finally:
        await db.close()
    return _row_to_item(row) if row else None


async def delete_history(item_id: str) -> bool:
    db = await connect()
    try:
        cursor = await db.execute("DELETE FROM recommendation_history WHERE id = ?", (item_id,))
        await db.commit()
        return cursor.rowcount > 0
    finally:
        await db.close()
