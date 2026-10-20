# Self-hosting Cogpit

How to run Cogpit on a machine you are not sitting at, reach it from a browser or a phone,
and not get owned doing it.

If you just want the desktop app on your laptop, you do not need any of this. Download it
from [Releases](https://github.com/gentritbiba/cogpit/releases) and open it.

---

## What you need first

Cogpit drives the Claude Code, Codex, and GitHub Copilot CLIs. It does not replace them and
it has no models of its own.

- At least one supported CLI installed and logged in on the machine that will run Cogpit:
  [Claude Code](https://docs.anthropic.com/en/docs/claude-code),
  [Codex](https://github.com/openai/codex), or
  [GitHub Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/install-copilot-cli).
- [Bun](https://bun.sh) if you are running from source.
- No API keys. Cogpit uses whatever login those CLIs already have.

The agents run on the box running Cogpit. Nothing is sent to a server of mine, because there
isn't one.

---

## The three ways to run it

| | What it is | Use when |
|---|---|---|
| Desktop app | Electron, macOS / Linux / Windows | You are at the machine |
| `bun run dev` | Vite dev server | You are hacking on Cogpit itself |
| `./CC-Copilot` or `bun server/standalone.ts` | Headless, no Electron | The machine has no display, or you want it always on |

Only the third one needs this page.

## Appearance

The browser interface defaults to a white light theme. Use the moon or sun button
in the top-right toolbar to switch between light and dark mode, including on a phone.
Your choice is saved in that browser and restored on reload. Existing saved themes
are kept. On desktop, **Appearance** in the command palette also offers the full
theme list and chat width settings.

Terminals keep a dark gray background and contrasting text in light mode. See
[the usage guide](usage.md#sessions-and-conversation-history) for automatic project
focus, and [message controls](usage.md#messages-models-and-permissions) for Enter,
new lines, and input-method candidate confirmation.

---

## Headless server

```bash
git clone https://github.com/gentritbiba/cogpit.git
cd cogpit
bun install --ignore-scripts
bun run build:web

# Loopback only. Safe default, not reachable from the network.
CC_COPILOT_UI_HOST=127.0.0.1 bun server/standalone.ts
```

It prints the `host:port` it bound. This example listens on `127.0.0.1:19384`.

### Build a portable server on RHEL 9

Run the build on the Linux architecture you will deploy to (`x86_64` or `aarch64`).
The output is a portable directory with a bundled Bun runtime, not a single static
executable. Other machines with the same OS/architecture can run it without
installing Bun, Node, npm, Electron, or build tools. The agent CLIs and their logins
are still required on each server. Build on RHEL 9 for RHEL 9 deployments.

```bash
# Build prerequisites (Bun must also be installed and on PATH).
sudo dnf install -y git tar gzip unzip curl
# If Bun is not installed, use the official installer:
curl -fsSL https://bun.sh/install | bash
export PATH="$HOME/.bun/bin:$PATH"

# From this repository (Bun >= 1.3.5):
./build-server.sh
# Equivalent: bun run build:server

# On an x86_64 Linux machine:
cd release/cc-copilot-linux-x64
CC_COPILOT_UI_PASSWORD='replace-with-your-own-password' CC_COPILOT_UI_PORT=19384 ./CC-Copilot
```

Open `http://<server-ip>:19384` from Windows over the VPN. The default bind address
is `0.0.0.0`; remote access still requires a password of at least 6 characters.
Set `CC_COPILOT_UI_PORT` for another port, or `CC_COPILOT_UI_HOST=127.0.0.1` for local access only.
If the server's firewall filters inbound traffic, allow the selected port from
your VPN clients.

The build installs locked dependencies with Electron lifecycle scripts disabled,
builds the web app, and packages production dependencies. It produces
`release/cc-copilot-linux-x64.tar.gz` (or `linux-arm64`). Copy and extract the
**entire archive** on the destination, then run `./CC-Copilot` inside it. Keep
`app/` and `runtime/` beside the launcher. The launcher works from another working
directory and forwards arguments and shutdown signals to the server. Builds on
macOS produce a macOS package for local verification, not a Linux package.
The portable package includes the personal edition.

For example, on a second RHEL 9 x86_64 machine:

```bash
tar -xzf cc-copilot-linux-x64.tar.gz
cd cc-copilot-linux-x64
CC_COPILOT_UI_PASSWORD='replace-with-your-own-password' ./CC-Copilot
```

To deploy an update, run `./build-server.sh` again from the updated checkout,
stop the running server with `Ctrl+C` or your service manager, and replace the
package directory with the new build. Preserve your data directory and password
settings. Restart the server and reload the browser to load the new web assets.

Server-owned configuration and data stay in `~/.config/cogpit`, separate from the
release directory. Agent transcripts remain in the CLIs' own directories.
Override the server data directory with `CC_COPILOT_UI_DATA_DIR=/your/data/path`. Existing
`CC_COPILOT_UI_PASSWORD_FILE` settings also work. Runtime plugins and background
workers are included; browser automation additionally needs its usual browser and
agent-browser installation on the host.

For HTTPS browser sessions behind a TLS reverse proxy:

```bash
CC_COPILOT_UI_HOST=127.0.0.1 \
CC_COPILOT_UI_PASSWORD='replace-with-your-own-long-password' \
./CC-Copilot --https
```

`--https` requires secure browser sessions; it does not load certificates or
create a TLS listener itself. See the proxy examples below.

### Reachable from your network

It refuses to bind a non-loopback address without a password. That is deliberate.

```bash
CC_COPILOT_UI_HOST=0.0.0.0 \
CC_COPILOT_UI_PASSWORD='a genuinely long passphrase' \
bun server/standalone.ts
```

The password is read from the environment and never written to disk. The minimum
is 6 characters. The server keeps its versioned scrypt hash in memory for
environment-supplied credentials.

If you would rather not put a secret in the environment directly, use a file. This works with
systemd `LoadCredential`:

```bash
CC_COPILOT_UI_PASSWORD_FILE=/run/credentials/cogpit/password bun server/standalone.ts
```

The password file takes precedence over the inline password. A single trailing
newline is trimmed. An unreadable password file stops startup; it does not fall
back to an unprotected listener.

### Starting a session in a folder

**Browse folders** in the project switcher lists the server's folders and can make a new one,
so a remote user can start a session somewhere that is not a project yet. It starts in the
projects root: the home directory of the account Cogpit runs as, unless `projectsRoot` in
`config.local.json` or `CC_COPILOT_UI_PROJECTS_ROOT` names another absolute path (the environment
wins). Anyone who may start a session may browse and make folders.

Scripts use the same API: `GET /api/folders?path=<absolute>` lists a folder's subfolders (no
`path` lists the projects root), and `POST /api/folders` with `{"parent", "name"}` makes one
folder. A session asked to start in a folder that does not exist is refused with a 400 that
names the folder.

---

## Remote browser access

The standalone server allows HTTP browser login by default, including
`http://192.168.x.x:19384` from a Windows browser over a private network or VPN.
Password authentication, session expiry and API/WebSocket authorization remain
required for remote clients.

To require HTTPS browser sessions, start with `--https` (or set
`CC_COPILOT_UI_ALLOW_HTTP=0`) and put a TLS terminator in front of the loopback listener.
Open the HTTPS origin instead. This mode uses host-only `HttpOnly; Secure;
SameSite=Strict` cookies and rejects plaintext remote browser login.

```caddyfile
cogpit.example.com {
    reverse_proxy 127.0.0.1:19384
}
```

```nginx
location / {
    proxy_pass http://127.0.0.1:19384;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_buffering off;              # SSE will not stream without this
}
```

Two things to get right:

1. **Your proxy must send a forwarding header.** Either `Forwarded` or `X-Forwarded-For`. The
   standard Caddy and nginx proxy presets already do. Proxied traffic is then treated as
   remote and has to authenticate normally. If you strip every forwarding header *and* rewrite
   `Host` to `localhost`, the proxy hop becomes indistinguishable from a local client, and
   local clients skip auth.
2. **Turn off proxy buffering.** Cogpit streams sessions over SSE. Buffered output means the
   timeline sits still and then arrives in a lump.

A displayed `http://` LAN address stays usable for authenticated Cogpit hub and device
traffic. With `--https`, use the HTTPS proxy address for browser login.

### HTTP mode for a private network or VPN

To use a Linux server directly from a Windows browser over HTTP, start normally:

```bash
CC_COPILOT_UI_HOST=0.0.0.0 \
CC_COPILOT_UI_PASSWORD='replace-with-your-own-long-password' \
bun server/standalone.ts
```

Open `http://<linux-server-ip>:19384` in the Windows browser. No reverse proxy or
certificate installation is needed. Build the frontend with `bun run build:web` when
updating the server so its HTTP-compatible browser code is included.

HTTP is the standalone default. Set `CC_COPILOT_UI_ALLOW_HTTP=0` or pass `--https` to
require HTTPS sessions. `--https` overrides `CC_COPILOT_UI_ALLOW_HTTP=1`; the legacy
`--http-only` flag explicitly enables HTTP and overrides `CC_COPILOT_UI_ALLOW_HTTP=0`.
Passing both flags is an error. `./CC-Copilot --help` lists the options. Other
entry points retain their HTTPS policy unless explicitly configured for HTTP.

| Startup setting | Browser session policy |
| --- | --- |
| No flag and no transport variable | HTTP allowed |
| `CC_COPILOT_UI_ALLOW_HTTP=0` | HTTPS required |
| `--https` | HTTPS required, even when the environment allows HTTP |
| `--http-only` | HTTP allowed, even when the environment requires HTTPS |
| Both flags | Startup error |

HTTP mode retains password verification, login rate limits, session expiry,
same-origin checks, and API/WebSocket authorization. Browser sessions use separate
host-only `HttpOnly; SameSite=Strict` cookies without `Secure`; HTTPS mode does not
accept these HTTP-mode cookies. Shared-session cookies follow the same mode and
retain their restricted access. Frontend UUID generation and plugin SHA-256
verification also work without the browser's HTTPS-only crypto APIs; plugin package
integrity checks remain enabled.

HTTP itself does not encrypt passwords, sessions, or conversation data. Use this
mode only on the private network or VPN you intend to trust, with firewall access
limited to those clients. Browser features such as the modern Clipboard API remain
subject to the browser's secure-context rules; the app uses its existing copy fallback.

---

## Session sharing

Sharing hands one session to one other person. The guest opens `/shared/<sessionId>`, types a
passphrase, and gets that session and nothing else: the live transcript, sending messages,
answering the agent's questions, approving or denying its tool permission requests, and
stopping or interrupting a turn. No project list, no other sessions, no configuration, no file
browser, no terminal, none of the open-in-editor or reveal-in-folder handoffs. Every guest
request is matched against an allowlist that denies by default, so a route added to Cogpit
later is closed to guests until someone deliberately opens it.

**The passphrase is equivalent to a shell on the host.** A guest can approve tool permission
requests, and approving one runs whatever the agent asked to run. Treat it exactly as you
treat the network password — narrower in scope, not smaller in consequence. Give it to someone
you would let type into that session over your shoulder, and send it through a different
channel than the link.

Turn sharing on from the share button above the session. Cogpit generates a four-word
passphrase and shows it once; after that the popover masks it, because only a scrypt hash is
kept, in `shares.local.json` beside your config at mode 0600. Lose it and you regenerate rather
than look it up. Every shared session has its own passphrase, and it is unrelated to the
network password: a guest cannot log in at `/` with it, and someone holding two share links
reaches two sessions and no more.

Network access has to be on before a session can be shared, and the guest needs the same
origin you do. Shares follow the host's browser transport policy. In the standalone
server's default HTTP mode, guests can use its HTTP URL. With `--https`, share login
uses a `Secure` cookie and a plaintext remote link returns `426 Upgrade Required`;
send the HTTPS URL from the reverse proxy instead. Login attempts are rate limited,
and a wrong passphrase and a session that was never shared return the same 401, so the endpoint
cannot be used to discover which sessions are shared.

To revoke, reopen the share button on that session and press **Stop sharing**, or open
**Configuration → Network**, where every shared session is listed with when it was shared, when
it was last opened, and how many guests are connected — revoke one row, or revoke all. Either
way the guest's live stream closes immediately rather than at their next click.
**Regenerate** rotates the passphrase and disconnects everyone currently connected. Shares also
end on their own when the session is deleted or when you point Cogpit at a different projects
directory, and turning network access off disconnects every guest while keeping the records, so
turning it back on does not silently re-admit anyone.

What sharing does not do yet: Codex sessions cannot be shared because a rollout's nested file
path does not fit the guest path rules, and Cogpit also rejects Copilot sessions. Shares are not
proxied through the multi-device hub, so a guest connects to the machine directly; a guest sees
the main transcript but not sub-agent transcripts, and the panel says so rather than sitting
empty. At most eight guests can hold one session at a time, and a guest login expires on the
same schedule as any other browser session — 30 minutes idle, 8 hours absolute — and does not
survive a server restart, though the share record does.

---

## Environment variables

Every one of these is read by the server. Edition packages document their own.

| Variable | Default | What it does |
|---|---|---|
| `CC_COPILOT_UI_HOST` | `0.0.0.0` | Bind address. Non-loopback requires a password. Set `127.0.0.1` for local-only access. |
| `CC_COPILOT_UI_ALLOW_HTTP` | on (standalone) | Set `0` to require HTTPS browser sessions. `--https` and `--http-only` override this variable. Other entry points require explicit `1` to allow HTTP. |
| `CC_COPILOT_UI_PORT` | `19384` | Bind port. |
| `CC_COPILOT_UI_DATA_DIR` | `~/.config/cogpit` | Where config lives. |
| `CC_COPILOT_UI_EDITION` | `personal` | Selects an installed edition package. Standalone server only; wins over the config file. |
| `CC_COPILOT_UI_PASSWORD` | none | Network password. Minimum 6 chars. Never written to disk. |
| `CC_COPILOT_UI_PASSWORD_FILE` | none | Read the password from a file instead. |
| `CC_COPILOT_UI_DEVICE_NAME` | hostname | Label shown in the multi-device switcher. |
| `CC_COPILOT_UI_PROJECTS_ROOT` | home of the account Cogpit runs as | Absolute path where [Browse folders](#starting-a-session-in-a-folder) starts. Wins over `projectsRoot` in the config file. |
| `CC_COPILOT_UI_STREAM_PARTIAL` | on | Set `0`, `false`, `off` or `no` to disable token-level streaming. Completed session updates still arrive. |
| `CC_COPILOT_UI_NTFY_TOPIC` | none | ntfy topic for phone push. Push is off until set. |
| `CC_COPILOT_UI_NTFY_URL` | `https://ntfy.sh` | ntfy base URL. Self-hosted works. |
| `CC_COPILOT_UI_NTFY_TOKEN` | none | Sent as `Authorization: Bearer` for protected topics. |
| `CC_COPILOT_UI_PUBLIC_URL` | none | Reachable Cogpit base URL. Without it, pushes carry no click target instead of a dead `127.0.0.1` link. |

Standalone startup maps these names to the internal settings. Restart after changing
environment variables. Legacy `COGPIT_*` deployment names are still accepted; the
corresponding `CC_COPILOT_UI_*` value takes precedence when both are set. The
internal session CLI continues to receive `COGPIT_PORT` with the actual bound port.

---

## systemd unit

```ini
[Unit]
Description=CC Copilot self-hosted server
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=you
WorkingDirectory=/opt/cc-copilot
Environment=CC_COPILOT_UI_HOST=0.0.0.0
Environment=CC_COPILOT_UI_PORT=19384
Environment=CC_COPILOT_UI_DEVICE_NAME=build-box
LoadCredential=password:/etc/cogpit/password
Environment=CC_COPILOT_UI_PASSWORD_FILE=%d/password
ExecStart=/opt/cc-copilot/CC-Copilot
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

Extract the portable package into `/opt/cc-copilot` and replace `User=you` with
the account whose agent CLI logins the server will use. The example serves HTTP
to your private network or VPN. For a TLS proxy on the same host, set
`CC_COPILOT_UI_HOST=127.0.0.1` and change `ExecStart` to
`/opt/cc-copilot/CC-Copilot --https`. When running from source instead, use your
installed Bun's absolute path and the absolute `server/standalone.ts` path.

---

## Phone push

Push only fires when nobody is at the desktop: no window open, screen locked or suspended, or
120 seconds with no keyboard or mouse input anywhere on the machine. That is system idle, not
window focus, so it will not go off while you are typing in another app.

Create `~/.cogpit/push.json` and `chmod 600` it. **The topic is a bearer secret. Anyone who
knows it can read every notification you get.**

```json
{ "topic": "some-long-unguessable-string", "publicUrl": "https://cogpit.example.com" }
```

Pick a topic like a password, not like a username. On a public ntfy server the topic is the
only thing standing between your session titles and the internet, so either make it long and
random or self-host ntfy.

---

## Multi-device hub

Register other machines and drive them from one window. Your browser only ever talks to the
hub, which reverse-proxies to each device, so there is nothing to configure per origin.

A device is addable if it runs either the desktop app with Network Access enabled, or
`./CC-Copilot`. Add one under **Devices → Add device** with its `host:port`, or
`https://host:port` if it sits behind a TLS proxy. A live probe tells you whether it is
reachable, needs a password, has network access disabled, or is running an older version.

`⌘⇧1` to `⌘⇧9` jump between devices, `⌘⇧0` cycles. Actions that only make sense on the
machine you are physically at, like open-in-editor and reveal-in-folder, are hidden while a
remote device is selected. The exception is open-in-editor with **Configuration → Open files
in Cogpit** enabled: files then open in Cogpit's own file workspace, which reads them through
the hub proxy.

---

## Ports and discovery

The Electron app binds an ephemeral port unless Network Access pins one. The
standalone server defaults to `19384`, configurable with `CC_COPILOT_UI_PORT`.
Both publish the bound port to `~/.cogpit/port` on start and remove it on exit.

Anything integrating with a running Cogpit should resolve the port in this order:

1. `$COGPIT_PORT` (the actual bound port forwarded to agents; configured at startup with `CC_COPILOT_UI_PORT`)
2. `~/.cogpit/port`
3. `19384`

---

## Security, stated plainly

What is actually there:

- Refuses to bind a non-loopback address without a password.
- Minimum 6-character password, with a versioned scrypt hash.
- Auth rate limited to 5 attempts per minute per client.
- Browser sessions expire after 30 minutes idle or 8 hours absolute, whichever comes first.
- Changing the password or disabling network access revokes every existing session.
- Password never written to disk when supplied by environment or credential file.
- [Session shares](#session-sharing) are per-session credentials, hashed the same way, and a
  guest reaches one session and nothing else — but a guest can approve tool calls, so a share
  passphrase is host code execution.
- No analytics, no account, no telemetry. It talks to localhost, to your CLIs, and to your
  ntfy topic if you configured one.

What is not there:

- **No security audit and no pentest.** This is one person's threat model.
- **No sandboxing of the agent.** Cogpit surfaces the CLI's own approval prompts and lets you
  pick a restrictive access profile, but it cannot sandbox what the CLI itself cannot. If
  isolation matters, run the agent in a container or a VM and use Cogpit to watch it.
- Credentials created by older releases that do not meet the current minimum must be reset
  from the local app.

**Do not expose this directly to the internet.** Put it behind Tailscale, a WireGuard tunnel,
or a Cloudflare tunnel with access control, and assume it is the weakest service on that
network. The bar it is built to is "reachable on my LAN," not "reachable from anywhere."

---

## Troubleshooting

**It exits immediately with a message about authentication.**
You set a non-loopback `CC_COPILOT_UI_HOST` without a password. Set `CC_COPILOT_UI_PASSWORD`, or
`CC_COPILOT_UI_PASSWORD_FILE`, or bind `127.0.0.1`.

**The login page loads over HTTP but the password never sticks.**
Check whether `--https` or `CC_COPILOT_UI_ALLOW_HTTP=0` is enabled. That mode requires
TLS at the reverse proxy. For direct HTTP on your private network or VPN, omit
`--https` and unset that variable, or explicitly pass `--http-only`.

**The timeline freezes and then jumps.**
Proxy buffering. Set `proxy_buffering off` in nginx. Caddy does not buffer by default.

**Local requests are being asked for a password.**
Your proxy is not sending `Forwarded` or `X-Forwarded-For`, or something upstream rewrote the
`Host`. Add the standard proxy headers.

**Sessions started in a terminal do not show up.**
Cogpit reads the session files the CLIs write. Confirm the CLI on that machine is writing to
the home directory of the user running Cogpit.

**Push never arrives.**
`topic` must be set, and it is off until it is. Check `~/.cogpit/push.json` is valid JSON.
Remember push is suppressed entirely while you are active at the desktop.

---

Something wrong or missing here? [Open an issue](https://github.com/gentritbiba/cogpit/issues).
