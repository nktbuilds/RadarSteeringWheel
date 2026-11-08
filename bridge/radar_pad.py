#!/usr/bin/env python3
"""Radar steering wheel -> virtual Xbox 360 pad bridge.

Runs on Windows, next to the game. The browser page opens a local WebSocket and
sends {"x": -1.0 .. 1.0}; this helper feeds that value to a ViGEmBus virtual
pad, which the game sees as ordinary controller hardware. Only the left stick is
touched - everything else stays on the keyboard.

Install (Windows):
    pip install vgamepad websockets

Start the bridge *before* launching the game (the pad must exist at boot):
    python radar_pad.py

Check the driver without streaming:
    python radar_pad.py --check
"""

from __future__ import annotations

import argparse
import asyncio
import json
import sys
import time

STALE_SECONDS = 0.6
VIGEM_URL = "https://github.com/nefarius/ViGEmBus/releases"


def fail(message: str) -> None:
    print(f"\n[fatal] {message}\n", file=sys.stderr)
    raise SystemExit(1)


def create_pad(args):
    try:
        import vgamepad as vg
    except ImportError:
        fail("the 'vgamepad' package is missing.\n  Install it with:  pip install vgamepad websockets")
    except Exception as exc:  # driver DLL missing, wrong platform, ...
        fail(
            f"could not load vgamepad ({exc}).\n"
            f"  ViGEmBus is probably not installed. Get it from {VIGEM_URL}"
        )

    try:
        return vg.VX360Gamepad()
    except Exception as exc:
        fail(
            f"could not create the virtual pad ({exc}).\n"
            f"  Install ViGEmBus from {VIGEM_URL} and reboot, then run --check again."
        )


def load_server():
    try:
        from websockets.asyncio.server import serve
    except ImportError:
        try:
            from websockets.server import serve
        except ImportError:
            fail("the 'websockets' package is missing.\n  Install it with:  pip install vgamepad websockets")
    return serve


def centre(pad) -> None:
    pad.left_joystick_float(x_value_float=0.0, y_value_float=0.0)
    pad.update()


def make_handler(pad, args):
    def apply(x: float) -> float:
        if args.invert:
            x = -x
        x = max(-1.0, min(1.0, x * args.gain))
        if abs(x) < args.deadzone:
            x = 0.0
        pad.left_joystick_float(x_value_float=x, y_value_float=0.0)
        pad.update()
        return x

    async def handler(ws, *_):
        print("  browser connected")
        apply(0.0)
        last_msg = time.monotonic()
        centred = True
        try:
            while True:
                try:
                    raw = await asyncio.wait_for(ws.recv(), timeout=0.25)
                except asyncio.TimeoutError:
                    if not centred and time.monotonic() - last_msg > STALE_SECONDS:
                        apply(0.0)
                        centred = True
                    continue

                last_msg = time.monotonic()
                centred = False
                try:
                    message = json.loads(raw)
                    value = float(message.get("x", 0.0))
                except (TypeError, ValueError, AttributeError):
                    continue
                apply(value)
        except Exception as exc:
            if not type(exc).__name__.startswith("ConnectionClosed"):
                print(f"  link error: {exc}")
        finally:
            try:
                centre(pad)
            except Exception:
                pass
            print("  browser disconnected - stick centred")

    return handler


async def serve_forever(serve, pad, args):
    handler = make_handler(pad, args)
    try:
        async with serve(handler, args.host, args.port, ping_interval=20, ping_timeout=20):
            print(f"Listening on ws://{args.host}:{args.port}")
            print("Start the game, then tick 'Virtual gamepad' in the page. Ctrl+C stops.")
            await asyncio.Future()
    except OSError as exc:
        fail(
            f"could not listen on {args.host}:{args.port} ({exc}).\n"
            "  Another copy of this script may be running; close it or use --port."
        )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Bridge the radar steering angle to a virtual Xbox pad.")
    parser.add_argument("--host", default="127.0.0.1", help="interface to listen on (default: loopback only)")
    parser.add_argument("--port", type=int, default=8765, help="WebSocket port (default: 8765)")
    parser.add_argument("--invert", action="store_true", help="swap left and right")
    parser.add_argument("--gain", type=float, default=1.0, help="stick multiplier after mapping (default: 1.0)")
    parser.add_argument("--deadzone", type=float, default=0.0, help="extra centre deadzone on the stick")
    parser.add_argument("--check", action="store_true", help="create the pad and exit, to test the driver")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    pad = create_pad(args)

    if args.check:
        centre(pad)
        print("ViGEmBus OK - virtual Xbox 360 pad created and released.")
        return 0

    serve = load_server()
    print("Virtual Xbox 360 pad created.")
    try:
        asyncio.run(serve_forever(serve, pad, args))
    except KeyboardInterrupt:
        pass
    finally:
        try:
            centre(pad)
        except Exception:
            pass
    print("Stopped. Stick centred.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
