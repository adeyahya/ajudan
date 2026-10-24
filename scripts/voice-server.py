"""
Ajudan's local voice: OmniVoice (k2-fsa) text-to-speech behind a tiny HTTP server on
127.0.0.1. Started by src/lib/voice.ts when a voice note is needed, shared by every
business window, and gone after IDLE_SECONDS without a request (the model holds a few
GB of memory). Only this Mac's processes can reach it.

  POST /speak {"text", "out", "language"?, "instruct"?, "ref_audio"?, "ref_text"?}
       -> {"seconds": 4.2}   (writes a 24 kHz WAV to "out")
  GET  /health -> {"ok": true}

Set up with `pnpm voice:setup` (scripts/setup-voice.sh).
"""

import argparse
import json
import os
import re
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import soundfile as sf
import torch
from num2words import num2words
from omnivoice import OmniVoice

IDLE_SECONDS = int(os.environ.get("AJUDAN_VOICE_IDLE", "1200"))

parser = argparse.ArgumentParser()
parser.add_argument("--info", required=True, help="where to write {port, pid} once ready")
args = parser.parse_args()

if torch.cuda.is_available():
    device, dtype = "cuda:0", torch.float16
elif torch.backends.mps.is_available():
    device, dtype = "mps", torch.float16
else:
    device, dtype = "cpu", torch.float32
model = OmniVoice.from_pretrained("k2-fsa/OmniVoice", device_map=device, dtype=dtype)
lock = threading.Lock()  # one generation at a time
last_used = time.time()


CURRENCY = {"id": ("Rp", "rupiah"), "ms": ("RM", "ringgit")}


def spell_numbers(text, lang):
    """OmniVoice reads digits badly: "3 pesanan" -> "tiga pesanan", "Rp 150.000" -> words."""
    if not lang:
        return text
    lang = lang.split("-")[0].lower()
    group = "." if lang in ("id", "ms", "de", "nl", "es", "it", "pt", "tr", "vi") else ","
    decimal = "," if group == "." else "."
    point = {"id": "koma", "ms": "perpuluhan", "en": "point"}.get(lang, "")

    def words(n):
        try:
            return num2words(int(n), lang=lang)
        except (NotImplementedError, OverflowError, ValueError):
            return n

    # Times first: "jam 18.30" / "18:30" -> "delapan belas tiga puluh" (a stray "." in the
    # middle of the words makes OmniVoice produce noise), "19.00" -> "sembilan belas".
    def clock(m):
        h, mi = int(m.group(1)), int(m.group(2))
        if h > 24 or mi > 59:
            return m.group()
        return words(h) if mi == 0 else f"{words(h)} {words(mi)}"

    sep = r"[.:]" if group == "." else r":"
    text = re.sub(r"\b(\d{1,2})" + sep + r"(\d{2})\b(?!" + re.escape(group) + r"\d)", clock, text)
    # 150.000 / 150,000 -> 150000 (thousands separators of this language)
    text = re.sub(r"(?<=\d)" + re.escape(group) + r"(?=\d{3}\b)", "", text)
    # 2,5 -> "dua koma lima" (digits after the point one by one)
    text = re.sub(
        r"(\d+)" + re.escape(decimal) + r"(\d+)",
        lambda m: f"{words(m.group(1))} {point} {' '.join(words(d) for d in m.group(2))}".replace("  ", " "),
        text,
    )

    if lang in CURRENCY:
        sym, name = CURRENCY[lang]
        text = re.sub(re.escape(sym) + r"\.?\s?(\d+)", lambda m: f"{words(m.group(1))} {name}", text)
    return re.sub(r"\d+", lambda m: words(m.group()), text)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):  # quiet
        pass

    def reply(self, code, body):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/health":
            self.reply(200, {"ok": True, "device": device})
        else:
            self.reply(404, {"error": "not found"})

    def do_POST(self):
        global last_used
        if self.path != "/speak":
            return self.reply(404, {"error": "not found"})
        try:
            req = json.loads(self.rfile.read(int(self.headers.get("content-length", "0"))))
            kw = {"text": spell_numbers(req["text"], req.get("language"))}
            for k in ("language", "instruct", "ref_audio", "ref_text"):
                if req.get(k):
                    kw[k] = req[k]
            with lock:
                last_used = time.time()
                audio = model.generate(**kw)[0]
                last_used = time.time()
            sf.write(req["out"], audio, 24000)
            self.reply(200, {"seconds": round(len(audio) / 24000, 2)})
        except Exception as e:  # report, keep serving
            self.reply(500, {"error": f"{type(e).__name__}: {e}"})


server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)


def idle_watch():
    while True:
        time.sleep(30)
        if not lock.locked() and time.time() - last_used > IDLE_SECONDS:
            try:
                os.remove(args.info)
            except FileNotFoundError:
                pass
            os._exit(0)


threading.Thread(target=idle_watch, daemon=True).start()
tmp = f"{args.info}.{os.getpid()}.tmp"
with open(tmp, "w") as f:
    json.dump({"port": server.server_address[1], "pid": os.getpid(), "device": device}, f)
os.replace(tmp, args.info)
print(f"[voice] ready on {server.server_address[1]} ({device})", file=sys.stderr, flush=True)
server.serve_forever()
