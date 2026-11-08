# Driving GTA V with the radar wheel

The page only draws and computes the angle. GTA needs a **controller**, so a small
bridge on Windows turns the angle into a virtual Xbox 360 pad. The page talks to
the bridge over a local WebSocket (`ws://127.0.0.1:8765`).

```
Chrome (page) --ws://127.0.0.1:8765--> bridge/radar_pad.py --> ViGEmBus pad --> GTA V
```

The page may be served by Windows *or* by WSL; only the machine running Chrome
matters, because that is where the radar's USB device is.

## 1. Install on Windows

1. **ViGEmBus 1.22.0** - https://github.com/nefarius/ViGEmBus/releases
   (`ViGEmBus_1.22.0_x64_x86_arm64.exe`), then reboot.
2. **Python 3.11+** from python.org, with *Add python.exe to PATH* ticked.
3. In a Windows terminal:
   ```
   pip install vgamepad websockets
   ```
4. Chrome or Edge, plus the CH340 USB-serial driver for the XM125.

That is all. Do not install vJoy, DS4Windows, HidHide or x360ce.

## 2. Check the driver

From the project folder on Windows:

```
python bridge\radar_pad.py --check
```

It should print `ViGEmBus OK - virtual Xbox 360 pad created and released.`
If it reports a missing driver, ViGEmBus is not installed (or needs the reboot).

## 3. Start the bridge

```
python bridge\radar_pad.py
```

Leave it running. It creates the pad immediately, so **start it before launching
GTA**. Options:

| Flag | Meaning |
|---|---|
| `--port 8765` | WebSocket port; must match the page's *Pad bridge* field |
| `--invert` | swap left/right without touching the page |
| `--gain 1.0` | stick multiplier after the angle mapping |
| `--deadzone 0.0` | extra centre deadzone (the page already applies 0.06) |
| `--host` | listen interface; keep the loopback default |

## 4. Serve and open the page

Windows (easiest):

```
cd source
python -m http.server 8000
```

WSL works the same way from `source/`. Do **not** open `index.html` by
double-click - `file://` blocks ES modules and the page stays on “Initialising…”.

Open http://localhost:8000 in Chrome on Windows.

## 5. Connect and enable the pad

1. Plug in the XM125, click **Connect**, choose the CH340 port.
2. Confirm the probe shows both hands and the wheel angle moves.
3. Tick **Virtual gamepad · left stick only** in the Tuning panel. The
   **Gamepad** readout must go from `retrying…` to `linked`.
   If the bridge is not running it keeps retrying quietly - no effect on the rest
   of the app.
4. Optional: press **Demo** first. Synthetic hands drive the pad too, so you can
   verify the link in `joy.cpl` (Windows: *Set up USB game controllers*) before
   touching the game.

## 6. GTA V settings

- Launch the game **after** the bridge is running.
- Settings → Controls: **Input: Gamepad**, Steering Deadzone 0-2, and turn off
  mouse steering.
- Settings → Graphics: **Borderless Windowed**, so the page can stay visible on a
  second monitor while the game has focus.

The pad is OS-level, so the browser does not need focus: steering keeps working
while GTA is the foreground window.

## 7. Driving

- Steering is absolute: the wheel angle maps to stick X, full lock at ±90° of
  computed wheel angle (`PAD.maxAngleDeg` in `source/js/config.js`).
- **Hold turn** + **Recenter** is usually the right mode for a car: the angle
  stays where you left it instead of drifting back with the rolling baseline.
- **Invert direction** if left and right are swapped.
- Effects inside GTA are speed-sensitive (the game reduces steering at speed);
  that is the game, not the mapping.
- On hand loss the link sends stick 0 within ~20 ms, so the car straightens
  rather than veering. Same when you press Disconnect or stop Demo.

## 8. Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Pad readout stuck on `retrying…` | Bridge not running, wrong port, or `--host` changed; the page retries every 0.25-2 s |
| `[fatal] could not create the virtual pad` | ViGEmBus missing or pre-reboot; run `--check` |
| Gamepad appears in `joy.cpl` but GTA ignores it | Game was started before the pad existed; quit GTA, keep the bridge running, relaunch |
| Stick moves in `joy.cpl` but not in the car | GTA still on keyboard input, or the car is stationary/braking - input scheme switches on gamepad activity |
| Steering feels twitchy at centre | Raise `deadzone` or `curve` in `PAD` (config.js), or use GTA's own steering deadzone |
| Nothing in `joy.cpl` | The virtual pad never got created - check the bridge console |
| Page works, pad never links, page served from another PC | `ws://127.0.0.1` points at the *browser's* machine; the bridge must run there too |

## Anti-cheat

Use this in **Story Mode**. GTA Online on the Enhanced edition runs BattlEye;
feeding synthetic input into it looks like automation. Offline there is no
anti-cheat process involved, and ViGEmBus itself is ordinary virtual-controller
software used by DS4/Steam-controller users.
