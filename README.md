# 🔁 Retro Board

A real-time retrospective meeting web app — hosted on **GitHub Pages**, no backend, no database.

## ✨ Features

| Feature | Details |
|---|---|
| 📋 **4 Columns** | Bad 😞 · Sad 😢 · Glad 😊 · Action Items ✅ |
| 🃏 **Cards** | Add, edit, delete cards with text or GIFs |
| 👍 **Voting** | Vote on cards (each peer votes once per card) |
| 🎞 **GIF Picker** | Search & embed GIFs powered by Giphy |
| 👁 **Hide/Reveal** | Facilitator can hide or reveal cards for everyone |
| 🗳 **Vote Visibility** | Facilitator can toggle vote counts on/off |
| 🔗 **Shareable Rooms** | Each session gets a unique URL (e.g. `#alpha-bravo-1234`) |
| 🎭 **Facilitator Role** | Passphrase = room ID; controls hide/reveal/votes |
| 📤 **Export** | Export Action Items as Markdown (copy or download) |
| 🌙 **Dark Mode** | Toggle between light and dark themes |
| 🔄 **Real-time P2P** | Powered by **Yjs + WebRTC** — no server needed |

## 🚀 Getting Started

### 1. Fork & Enable GitHub Pages

1. Fork this repository
2. Go to **Settings → Pages**
3. Set source to **Deploy from a branch → `main` → `/ (root)`**
4. Your app will be live at `https://<your-username>.github.io/<repo-name>/`

### 2. Use the App

1. Open the URL in your browser
2. Click **✨ Create New Room** — a unique room ID is generated
3. Share the URL with your team
4. Anyone with the link joins the same session automatically
5. To become the **Facilitator**, click 🎭 and enter the **room ID** as the passphrase

### 3. (Optional) Use your own Giphy API key

A working Giphy API key is already baked into `app.js` (it's a public client key). If you want to use your own — for higher rate limits or to keep usage isolated — get a free one at [developers.giphy.com/dashboard](https://developers.giphy.com/dashboard/) and replace the constant in `app.js`:

```js
const GIPHY_API_KEY = 'your_api_key_here';
```

## 🏗 Tech Stack

- **HTML / CSS / Vanilla JS** — zero frameworks
- **[Yjs](https://yjs.dev)** — CRDT-based real-time sync
- **[y-webrtc](https://github.com/yjs/y-webrtc)** — peer-to-peer WebRTC transport
- **[Giphy API](https://developers.giphy.com)** — GIF search

## ⚠️ Notes

- Sessions are **ephemeral** — data is lost when all peers disconnect
- The WebRTC signaling server (`signaling.yjs.dev`) is used only for peer discovery, **no data passes through it**
- The Facilitator passphrase is the **room ID** — keep it secret from participants if needed, or share it with co-facilitators

## 📄 File Structure

```
retro-board/
├── index.html   # Layout & modals
├── style.css    # All styles (light + dark theme)
├── app.js       # All logic (Yjs, cards, voting, GIF, export)
└── README.md    # This file
```
