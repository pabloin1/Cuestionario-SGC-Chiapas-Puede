from __future__ import annotations

import hashlib
import hmac
import json
import os
import sqlite3
import time
from contextlib import closing
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from .questions import QUESTIONS, public_questions
from .reporting import PASSING_PERCENT, collect_report, make_workbook

ROOT = Path(__file__).resolve().parents[1]
load_dotenv(ROOT / ".env")
DATA_DIR = ROOT / "data"
DB_PATH = DATA_DIR / "cuestionario.sqlite3"
STATIC_DIR = ROOT / "app" / "static"
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "")
APP_SECRET = os.getenv("APP_SECRET", "")
COOKIE_SECURE = os.getenv("COOKIE_SECURE", "0").strip() == "1"
SESSION_SECONDS = 8 * 60 * 60

app = FastAPI(title="Cuestionario SGC · Chiapas Puede", docs_url=None, redoc_url=None)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


class AttemptPayload(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    answers: dict[int, Any]


class AdminLoginPayload(BaseModel):
    password: str = Field(min_length=1, max_length=200)


def connect_db() -> sqlite3.Connection:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_PATH, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


@app.on_event("startup")
def initialize() -> None:
    if not ADMIN_PASSWORD or not APP_SECRET:
        raise RuntimeError("Configura ADMIN_PASSWORD y APP_SECRET en el archivo .env antes de iniciar.")
    if not 0 <= PASSING_PERCENT <= 100:
        raise RuntimeError("PASSING_PERCENT debe estar entre 0 y 100.")
    with closing(connect_db()) as db:
        db.execute(
            """CREATE TABLE IF NOT EXISTS attempts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                participant_name TEXT NOT NULL,
                score INTEGER NOT NULL,
                total INTEGER NOT NULL,
                submitted_at TEXT NOT NULL,
                answers_json TEXT NOT NULL
            )"""
        )
        db.commit()


def session_signature(expires: str) -> str:
    payload = f"admin:{expires}".encode("utf-8")
    return hmac.new(APP_SECRET.encode("utf-8"), payload, hashlib.sha256).hexdigest()


def valid_admin_session(token: str | None) -> bool:
    if not token:
        return False
    try:
        expires, signature = token.split(".", 1)
        if int(expires) < int(time.time()):
            return False
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(signature, session_signature(expires))


def require_admin(request: Request) -> None:
    if not valid_admin_session(request.cookies.get("admin_session")):
        raise HTTPException(status_code=401, detail="Inicia sesión como administrador.")


@app.get("/")
def participant_page() -> FileResponse:
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/admin")
def admin_page() -> FileResponse:
    return FileResponse(STATIC_DIR / "admin.html")


@app.get("/api/questions")
def get_questions() -> list[dict[str, Any]]:
    return public_questions()


@app.post("/api/attempts")
def submit_attempt(payload: AttemptPayload) -> dict[str, Any]:
    name = " ".join(payload.name.split())
    if len(name) < 2:
        raise HTTPException(status_code=422, detail="Escribe tu nombre completo.")
    question_ids = {question["id"] for question in QUESTIONS}
    if set(payload.answers) != question_ids:
        raise HTTPException(status_code=422, detail=f"Responde las {len(QUESTIONS)} preguntas antes de enviar.")

    snapshots = []
    score = 0
    for question in QUESTIONS:
        kind = question.get("type", "multiple_choice")
        response_value = payload.answers[question["id"]]
        if kind in {"multiple_choice", "true_false"}:
            if type(response_value) is not int or response_value < 0 or response_value >= len(question["options"]):
                raise HTTPException(status_code=422, detail="Una respuesta seleccionada no es v?lida.")
            selected_text = question["options"][response_value]
            correct_text = question["options"][question["correct_index"]]
            is_correct = response_value == question["correct_index"]
        elif kind == "multiple_select":
            if not isinstance(response_value, list) or not response_value or any(type(i) is not int or i < 0 or i >= len(question["options"]) for i in response_value) or len(set(response_value)) != len(response_value):
                raise HTTPException(status_code=422, detail="Selecciona una o m?s opciones v?lidas.")
            selected_text = "; ".join(question["options"][i] for i in response_value)
            correct_indices = question["correct_indices"]
            correct_text = question["answer_text"]
            is_correct = set(response_value) == set(correct_indices)
        elif kind == "matching":
            options = question["right_options"]
            expected_count = len(question["left_items"])
            if not isinstance(response_value, list) or len(response_value) != expected_count or any(type(i) is not int or i < 0 or i >= len(options) for i in response_value):
                raise HTTPException(status_code=422, detail="Completa todas las relaciones con opciones v?lidas.")
            selected_text = "; ".join(f"{left}: {options[choice]}" for left, choice in zip(question["left_items"], response_value))
            correct_text = "; ".join(f"{left}: {options[choice]}" for left, choice in zip(question["left_items"], question["correct_matches"]))
            is_correct = response_value == question["correct_matches"]
        elif kind == "ordering":
            items = question["items"]
            if not isinstance(response_value, list) or len(response_value) != len(items) or sorted(response_value) != list(range(len(items))):
                raise HTTPException(status_code=422, detail="Ordena todos los elementos antes de continuar.")
            selected_text = " -> ".join(items[i] for i in response_value)
            correct_text = " -> ".join(items[i] for i in question["correct_order"])
            is_correct = response_value == question["correct_order"]
        else:
            raise HTTPException(status_code=500, detail="El examen contiene un tipo de pregunta desconocido.")
        score += int(is_correct)
        snapshots.append({
            "question_id": question["id"], "question_type": kind,
            "section": question["section"], "question": question["question"],
            "selected": selected_text, "correct": correct_text, "is_correct": is_correct,
        })

    submitted_at = datetime.now(timezone.utc).astimezone().isoformat(timespec="seconds")
    with closing(connect_db()) as db:
        cursor = db.execute(
            "INSERT INTO attempts (participant_name, score, total, submitted_at, answers_json) VALUES (?, ?, ?, ?, ?)",
            (name, score, len(QUESTIONS), submitted_at, json.dumps(snapshots, ensure_ascii=False)),
        )
        db.commit()
        attempt_id = cursor.lastrowid
    percent = round(score / len(QUESTIONS) * 100)
    return {"id": attempt_id, "score": score, "total": len(QUESTIONS), "percent": percent, "passed": percent >= PASSING_PERCENT}


@app.post("/api/admin/login")
def admin_login(payload: AdminLoginPayload, response: Response) -> dict[str, bool]:
    if not hmac.compare_digest(payload.password.encode("utf-8"), ADMIN_PASSWORD.encode("utf-8")):
        raise HTTPException(status_code=401, detail="La contraseña no es correcta.")
    expires = str(int(time.time()) + SESSION_SECONDS)
    token = f"{expires}.{session_signature(expires)}"
    response.set_cookie(
        "admin_session", token, max_age=SESSION_SECONDS, httponly=True,
        secure=COOKIE_SECURE, samesite="strict", path="/",
    )
    return {"ok": True}


@app.post("/api/admin/logout", dependencies=[Depends(require_admin)])
def admin_logout(response: Response) -> dict[str, bool]:
    response.delete_cookie("admin_session", path="/")
    return {"ok": True}


@app.get("/api/admin/results", dependencies=[Depends(require_admin)])
def admin_results(
    date_from: str | None = None, date_to: str | None = None, name: str | None = None,
) -> dict[str, Any]:
    report = collect_report(connect_db, date_from, date_to, name)
    report.pop("answer_rows")
    return report


@app.get("/api/admin/export.xlsx", dependencies=[Depends(require_admin)])
def export_report(date_from: str | None = None, date_to: str | None = None, name: str | None = None) -> StreamingResponse:
    report = collect_report(connect_db, date_from, date_to, name)
    filename = f"reporte_sgc_{datetime.now().strftime('%Y%m%d_%H%M%S')}.xlsx"
    return StreamingResponse(
        make_workbook(report),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/api/admin/results/{attempt_id}", dependencies=[Depends(require_admin)])
def admin_result_detail(attempt_id: int) -> dict[str, Any]:
    with closing(connect_db()) as db:
        row = db.execute(
            "SELECT id, participant_name, score, total, submitted_at, answers_json FROM attempts WHERE id = ?",
            (attempt_id,),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail="No se encontró ese resultado.")
    result = dict(row)
    result["answers"] = json.loads(result.pop("answers_json"))
    result["percent"] = round(result["score"] / result["total"] * 100) if result["total"] else 0
    result["passed"] = result["percent"] >= PASSING_PERCENT
    return result
