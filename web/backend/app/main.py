from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .api import auth, history, letterboxd, recommendations, status, taste_profile
from .storage.database import init_db


app = FastAPI(title="Movie Rec Web API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:5173",
        "http://localhost:5173",
    ],
    allow_origin_regex=r"http://(127\.0\.0\.1|localhost):\d+",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup() -> None:
    await init_db()


@app.get("/api/health")
async def health() -> dict[str, bool]:
    return {"ok": True}


app.include_router(auth.router)
app.include_router(recommendations.router)
app.include_router(letterboxd.router)
app.include_router(history.router)
app.include_router(status.router)
app.include_router(taste_profile.router)
