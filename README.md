# Radar Steering Wheel

Companion code for the video: https://youtu.be/zZ-v6Gz_YCc

A browser-based steering-wheel controller for the SparkFun XM125
(Acconeer A121, 60 GHz radar). The page reads hand motion from the radar over
Web Serial and turns it into a steering-wheel angle on screen. An optional
Python bridge maps that angle to a virtual Xbox 360 pad, so the wheel can drive
a game.

## Requirements

- Chrome or Edge (Web Serial)
- SparkFun XM125 over USB
- Python 3, to serve the files locally
- Optional: Windows with ViGEmBus for the virtual gamepad

## Run

```bash
cd source
python3 -m http.server 8000
```

Open http://localhost:8000 in Chrome or Edge.

Click **Connect**, pick the XM125 port, and check the probe view that both hands
are visible. Click **Demo** to try it without hardware.

## Gamepad bridge (optional)

On Windows:

```bash
pip install vgamepad websockets
python bridge/radar_pad.py
```

Then tick **Virtual gamepad** in the page. Full game setup is in `RUN_GTA.md`.

## Tests

```bash
node test/run-all.mjs
```

## Notes and limitations

- Radar phase measures radial motion only. Mount the radar off the wheel axis so
  a turn moves one hand toward it and the other away; mounted on-axis, the hands
  mostly move sideways and the signal is weak.
- Keep both hands inside the beam and, if possible, in separate range bins.
- Sparse IQ here is single-channel: range and phase only, no angle-of-arrival.
- The Acconeer SDK and documentation are not included in this repository.

## License

MIT. See [LICENSE](LICENSE).
