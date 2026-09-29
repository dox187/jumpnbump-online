# Jump 'n Bump Online

![Screenshot](/public/screenshot.png 'Screenshot')

A self-hostable, browser-based **online multiplayer** version of _Jump 'n Bump_, the 1998 bunny game in which you
score by jumping on the other bunnies' heads. Players only need a browser: create a room, send your friends the
invite link, pick one of 250+ levels and play, each on your own computer.

## The original

- **Jump 'n Bump** was released in 1998 by **Brainchild Design** (Mattias Brynervall, Andreas Brynervall, Martin
  Magnusson, Anders Nilsson) as a DOS game for up to four players sharing one keyboard.
- Its source was released under the GPL. Chuck Mason ported it to Linux with SDL, and later maintainers moved it to
  SDL2 ([LibreGames/jumpnbump](https://gitlab.com/LibreGames/jumpnbump)).
- Jamie Sinclair ported the SDL2 code line by line to TypeScript
  ([jamsinclair/jumpnbump.js](https://github.com/jamsinclair/jumpnbump.js)), playable at
  [jumpnbump.net](https://jumpnbump.net). It adds 250+ fan levels, gamepad support and a web UI.

This repository is a fork of jumpnbump.js. It keeps the original local game and adds an online mode with a lobby
and a server. The game physics are unchanged: the player movement, collision and scoring code is the same code,
moved into a shared module, and a test comparing the old and new code on every level found no difference.

## What it is good for

- Playing Jump 'n Bump with friends who are not in the same room, over the internet or the local network.
- Hosting it yourself: one container (or one Node.js process) serves the website and runs the game server. There
  are no accounts, no database and no external services.

Features of the online mode:

- A lobby with rooms. Rooms can be protected with a password, and each room has an invite link (`/?room=<id>`).
- Up to four players per room. Everyone plays on their own keyboard or gamepad and picks their bunny (Dott, Jiffy,
  Fizz or Mijji).
- The host chooses the level and the score limit (first to 5, 10, 25, 50 or 100 bumps) and starts the match.
- The classic score screen at the end of a match, and a result table in the room afterwards.
- Local settings per player: controls, mute music or sound effects, no gore, no flies.

The original local game (up to four players on one keyboard, with computer players) is still available under
**LOCAL** (`/local`).

## Installation

### Container (Podman, Docker, Portainer)

Build the image on the host from a clone of this repository:

```sh
git clone <repository-url> jumpnbump-online
cd jumpnbump-online
podman build -t jumpnbump-online:latest .      # or: docker build -t jumpnbump-online:latest .
```

Run it directly:

```sh
podman run -d --name jumpnbump-online --init -p 8080:8080 --restart unless-stopped jumpnbump-online:latest
```

Or deploy it as a Portainer stack: paste [`portainer-stack.yml`](portainer-stack.yml) into the stack web editor. It
uses the image built above and does not build anything itself. Under Podman a locally built image is called
`localhost/jumpnbump-online:latest`; under Docker change it to `jumpnbump-online:latest`.

To update, pull and rebuild, then redeploy the stack (or recreate the container):

```sh
git pull
podman build -t jumpnbump-online:latest .
```

The game is then available at `http://<host>:8080`.

### Plain Node.js

Requires Node.js 20 or newer (tested with Node.js 24).

```sh
npm ci
npm run build   # builds the website into dist/ and the server into dist-server/
npm start       # serves everything on http://0.0.0.0:8080
```

### Configuration

| Environment variable | Default              | Meaning                                                                            |
| -------------------- | -------------------- | ---------------------------------------------------------------------------------- |
| `PORT`               | `8080`               | HTTP and WebSocket port                                                            |
| `HOST`               | `0.0.0.0`            | Address to listen on (use `127.0.0.1` behind a reverse proxy)                      |
| `STATIC_DIR`         | `dist`               | The built website                                                                  |
| `LEVELS_DIR`         | `$STATIC_DIR/levels` | Where the server reads level files from (it needs their collision maps)            |
| `TRUST_PROXY`        | off                  | Set to `1` behind a reverse proxy so rate limits see `X-Forwarded-For`             |
| `VITE_SOURCE_URL`    | upstream repository  | Build time: where the **SOURCE** link points; use your fork if you change the code |

Rooms and matches live in memory; restarting the server closes them.

### HTTPS and reverse proxies

Room passwords travel over the WebSocket, so put the server behind HTTPS when it is reachable from the internet.
The page connects to `wss://<host>/ws` automatically when it is served over HTTPS. The proxy has to pass WebSocket
upgrades on `/ws`.

Caddy:

```
jnb.example.com {
    reverse_proxy 127.0.0.1:8080
}
```

nginx:

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

In Nginx Proxy Manager, enable **Websockets Support** on the proxy host.

## Playing online

1. Open the site and enter a name.
2. Create a room (the password is optional) or join one from the list.
3. Copy the invite link from the room and send it to your friends. For a protected room they also need the
   password.
4. Pick your bunny by clicking a free slot. The host chooses the level and the score limit and starts the match.
5. In a match, move with the keys or the gamepad chosen under **Your Settings** (arrow keys by default).
   **SHIFT + F** toggles fullscreen. Pressing **ESC** twice leaves the match; for the host it ends the match for
   everyone.

Cheats and the 1-4 computer-player keys are disabled online, and each browser controls one bunny.

## How the netcode works

- The game physics (`src/sim/`) are shared by the local game, the browser client and the server. The gameplay
  random numbers (respawn positions) come from a seeded generator. Smoke, gore and sounds are cosmetic and never feed
  back into the simulation, so the simulation is deterministic.
- The server owns the clock. Every 1/60 s it confirms one frame of inputs for all bunnies and broadcasts it.
- Each client runs a little ahead of the server (about one round trip). It shows its own bunny without input delay,
  predicts the other bunnies from their last confirmed input, and rolls back and re-simulates when confirmations
  arrive.
- The server runs the same simulation. It decides when the score limit is reached, and every second it compares a
  hash of each client's state with its own; a client that diverged gets a snapshot.

## Changes compared with jumpnbump.js

- Online mode: lobby, rooms, server (`server/`), netcode (`src/net/`) and the online page.
- The physics were moved from `main.ts` into `src/sim/`; the local game uses the same code.
- Respawning no longer hangs on levels that have fewer free spawn tiles than bunnies (for example `jumpmoon` with
  three or more players); the original searched forever.
- The in-game score digits no longer pile up in memory, and a separate **mute music** option was added for the
  online mode.
- The fake member and online counters in the page header were replaced by the real number of connected players.

## Development

```sh
npm install
npm run dev:server   # multiplayer server on :8080, reading levels from public/levels
npm run dev          # Vite dev server; /ws is proxied to :8080
npm test             # type check
```

## Controls of the local game

The controls are keyboard layout-independent, which means that regardless of the layout that you are using (e.g.
AZERTY or Dvorak), they are located as if it were QWERTY.

The controls on a **QWERTY** keyboard are:

- ←, ↑, → to steer Dott
- A, W, D to steer Jiffy
- J, I, L to steer Fizz
- 4, 8, 6 to steer Mijji (on the numeric pad)

- ? (SHIFT + /) toggles the shortcut overlay
- F (SHIFT + f) toggles fullscreen
- ESC ends the current game. When pressed from the menu screen it will exit to the Web UI landing page.

Game controllers (gamepads) are supported via the Web Gamepad API. When a controller is connected, it appears as an
option in the player control dropdowns. Some controllers have built-in default mappings (e.g. 8BitDo Micro, Nintendo
Joy-Con); for others use the **Configure** button to map left, right and jump.

Additional levels can be chosen with the **Change Level** button, and any valid `.dat` level file can be loaded
with **Load Level File** in the local game.

## License

Jump 'n Bump is distributed under the GNU General Public License, version 2, or (at your option) any later version
(GPL-2.0+). See the AUTHORS file for credits.
