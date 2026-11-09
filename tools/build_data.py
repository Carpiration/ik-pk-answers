"""Собирает data.js из .docx в папке source/ (список файлов — в FILES ниже).

Запуск из корня проекта:  python tools/build_data.py
Нужен только стандартный Python 3.8+.

Ожидаемая структура документа:
  стиль Title     — название
  стиль Subtitle  — подзаголовок
  стиль Heading1  — «Билет N» (для билетов) или «Источники ...»
  стиль Question  — «N Текст вопроса»
  обычный абзац   — ответ (или пункт списка источников)
"""
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
ROOT = Path(__file__).resolve().parent.parent

FILES = [
    {"id": "ik", "short": "ИК", "name": "ИК вопросы", "src": "source/ik.docx"},
    {"id": "pk", "short": "ПК", "name": "ПК вопросы", "src": "source/pk.docx"},
    {"id": "psy", "short": "Психология", "name": "ПК Психология", "src": "source/psy.docx"},
    {"id": "nerv", "short": "НС", "name": "Нервная система", "src": "source/nerv.docx"},
]


def paragraphs(path):
    root = ET.fromstring(zipfile.ZipFile(path).read("word/document.xml"))
    for p in root.find(W + "body").iter(W + "p"):
        style = ""
        ppr = p.find(W + "pPr")
        if ppr is not None and ppr.find(W + "pStyle") is not None:
            style = ppr.find(W + "pStyle").get(W + "val")
        text = "".join(t.text or "" for t in p.iter(W + "t"))
        text = re.sub(r"\s+", " ", text).strip()
        if text:
            yield style, text


def parse(cfg):
    out = {"id": cfg["id"], "short": cfg["short"], "name": cfg["name"],
           "title": "", "subtitle": "", "tickets": False, "items": [], "sources": []}
    ticket = None
    in_sources = False
    current = None
    for style, text in paragraphs(ROOT / cfg["src"]):
        if style == "Title":
            out["title"] = text
        elif style == "Subtitle":
            out["subtitle"] = text
        elif style == "Heading1":
            m = re.match(r"Билет\s+(\d+)", text)
            if m:
                ticket = int(m.group(1))
                out["tickets"] = True
            else:
                in_sources = True
            current = None
        elif style == "Question":
            m = re.match(r"(\d+)[.)]?\s+(.*)", text)
            if not m:
                sys.exit(f"{cfg['src']}: не найден номер вопроса: {text!r}")
            current = {"n": int(m.group(1)), "q": m.group(2), "a": []}
            if ticket is not None:
                current["t"] = ticket
            out["items"].append(current)
        elif in_sources:
            out["sources"].append(text)
        elif current is not None:
            current["a"].append(text)
        else:
            sys.exit(f"{cfg['src']}: абзац вне вопроса: {text[:60]!r}")
    for it in out["items"]:
        if not it["a"]:
            print(f"Внимание: {cfg['src']}: нет ответа у вопроса {it['n']}", file=sys.stderr)
    return out


def main():
    data = [parse(cfg) for cfg in FILES]
    js = "// Сгенерировано tools/build_data.py — не редактировать вручную.\nwindow.DATA = " \
        + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n"
    (ROOT / "data.js").write_text(js, encoding="utf-8")
    for f in data:
        extra = f", билетов: {f['items'][-1]['t']}" if f["tickets"] else ""
        print(f"{f['name']}: вопросов {len(f['items'])}{extra}, источников {len(f['sources'])}")


if __name__ == "__main__":
    main()
