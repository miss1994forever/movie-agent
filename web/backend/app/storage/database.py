from __future__ import annotations

import aiosqlite

from ..core.settings import DATABASE_PATH, WEB_DATA_DIR


async def connect() -> aiosqlite.Connection:
    WEB_DATA_DIR.mkdir(parents=True, exist_ok=True)
    db = await aiosqlite.connect(DATABASE_PATH)
    db.row_factory = aiosqlite.Row
    return db


async def init_db() -> None:
    db = await connect()
    try:
        await db.execute(
            """
            CREATE TABLE IF NOT EXISTS recommendation_history (
              id TEXT PRIMARY KEY,
              mood TEXT NOT NULL,
              result_text TEXT NOT NULL,
              movies_json TEXT NOT NULL DEFAULT '[]',
              status TEXT NOT NULL,
              error TEXT,
              created_at TEXT NOT NULL,
              finished_at TEXT
            )
            """
        )
        await db.commit()
    finally:
        await db.close()
