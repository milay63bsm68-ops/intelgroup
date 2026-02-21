# 💬 Intel Premium Groups — Full Project

A Telegram Mini App with group chats, premium membership, and automatic group owner earnings.

---

## 🏗️ Project Structure — Two Separate GitHub Repos & Render Services

```
┌─────────────────────────────────────┐    ┌─────────────────────────────────────┐
│         REPO 1 — Main Server         │    │       REPO 2 — Balance Server        │
│    intel-groups.onrender.com         │    │   promdashboard.onrender.com         │
│                                     │    │                                     │
│  server.js          ← main backend  │    │  server.js       ← balance backend  │
│  index.html         ← home + widget │    │  withdraw.html   ← withdrawal page  │
│  group.html         ← chat page     │    │  admin.html      ← balance admin    │
│  create-group.html                  │    │  balances.js     ← data file        │
│  premium.html       ← buy premium   │    │  package.json                       │
│  deposit.html       ← deposit funds │    │  .env.example                       │
│  admin.html         ← group admin   │    └─────────────────────────────────────┘
│  group.js           ← data file     │
│  premium.js         ← data file     │
│  package.json                       │
│  .env.example                       │
└─────────────────────────────────────┘
```

---

## 💰 How Premium Purchase Works (Automatic)

```
User taps "Get Premium" on premium.html
        ↓
Main server sends code request to Balance Server /generate-passcode
        ↓
Balance Server sends 6-digit code to user's Telegram
        ↓
User enters code on premium.html
        ↓
Main server calls Balance Server /api/premium-purchase with secretKey
        ↓
Balance Server:
  ① Validates the 6-digit passcode
  ② Checks buyer has ₦5,000
  ③ Deducts ₦5,000 from buyer
  ④ Credits ₦2,500 (50%) to group owner
  ⑤ Notifies buyer, owner, and admin via Telegram
  ⑥ Returns success + updated balances in ₦ AND $
        ↓
Main server adds user to premium.js on GitHub
        ↓
UI shows success with ₦ and $ amounts
```

---

## 🚀 Deployment

### Prerequisites

- Two GitHub repos (or two folders in one repo)
- Render account at [render.com](https://render.com)
- Telegram Bot Token from [@BotFather](https://t.me/BotFather)
- Your Telegram user ID (message [@userinfobot](https://t.me/userinfobot))
- GitHub Personal Access Token with **Contents read/write** permission

---

### Step 1 — Set Up the Balance Server (Repo 2 — promdashboard)

**Files needed in this repo:**
```
server.js        ← the balance-server/server.js file
withdraw.html
admin.html
balances.js      ← must contain:  window.USER_BALANCES = {}
package.json
.env.example
.gitignore
```

**Create `balances.js` in the repo:**
```js
window.USER_BALANCES = {}
```

**Deploy on Render:**
1. Go to [render.com](https://render.com) → **New Web Service**
2. Connect this GitHub repo
3. Settings:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
4. Add **Environment Variables:**

| Key | Value |
|-----|-------|
| `BOT_TOKEN` | Your Telegram bot token |
| `ADMIN_ID` | Your Telegram user ID |
| `ADMIN_PASSWORD` | A strong secret (e.g. `Str0ng$ecret2024`) |
| `GITHUB_TOKEN` | GitHub Personal Access Token |
| `GITHUB_REPO` | `yourusername/balance-repo-name` |
| `BALANCE_FILE` | `balances.js` |
| `PORT` | `3000` |

5. Click **Deploy**
6. Note your URL: `https://promdashboard.onrender.com` (or whatever Render assigns)

---

### Step 2 — Set Up the Main Server (Repo 1 — intel-groups)

**Files needed in this repo:**
```
server.js
index.html
group.html
create-group.html
premium.html
deposit.html
admin.html
group.js         ← must contain:  window.GROUPS_DATA = {}
premium.js       ← must contain:  window.PREMIUM_USERS = []
package.json
.env.example
.gitignore
```

**Create `group.js` in the repo:**
```js
window.GROUPS_DATA = {}
```

**Create `premium.js` in the repo:**
```js
window.PREMIUM_USERS = []
```

**Deploy on Render:**
1. Go to [render.com](https://render.com) → **New Web Service**
2. Connect this GitHub repo
3. Settings:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
4. Add **Environment Variables:**

| Key | Value |
|-----|-------|
| `BOT_TOKEN` | Same bot token |
| `ADMIN_ID` | Your Telegram user ID |
| `ADMIN_PASSWORD` | **Same** secret as balance server ⚠️ |
| `GITHUB_TOKEN` | GitHub Personal Access Token |
| `GITHUB_REPO` | `yourusername/groups-repo-name` |
| `GROUPS_FILE` | `group.js` |
| `PREMIUM_FILE` | `premium.js` |
| `OLD_RENDER` | `https://promdashboard.onrender.com` (no trailing slash) |
| `PORT` | `3000` |

5. Click **Deploy**
6. Your app URL: `https://intel-groups.onrender.com`

---

### Step 3 — Connect Telegram Bot

In [@BotFather](https://t.me/BotFather):

1. Select your bot → **Bot Settings** → **Menu Button**
2. Set the URL to your main server: `https://intel-groups.onrender.com`

**For the Withdrawal Mini App link** (`t.me/intelpremiumbot/withdraw`):
1. [@BotFather](https://t.me/BotFather) → `/newapp`
2. Short name: `withdraw`
3. URL: `https://promdashboard.onrender.com/withdraw`

---

### Step 4 — Keep Render Awake (Free Plan)

Free Render services sleep after 15 minutes of inactivity.

1. Go to [uptimerobot.com](https://uptimerobot.com) → Create free account
2. **New Monitor → HTTP(s)**
3. URL: `https://intel-groups.onrender.com`
4. Interval: **5 minutes**
5. Repeat for the balance server URL

---

## 🔑 Environment Variables Quick Reference

### Balance Server
```env
BOT_TOKEN=1234567890:AAxxxxxxxx...
ADMIN_ID=987654321
ADMIN_PASSWORD=YourSecretHere
GITHUB_TOKEN=github_pat_xxxxxx...
GITHUB_REPO=username/balance-repo
BALANCE_FILE=balances.js
PORT=3000
```

### Main Server
```env
BOT_TOKEN=1234567890:AAxxxxxxxx...
ADMIN_ID=987654321
ADMIN_PASSWORD=YourSecretHere        # ← MUST match balance server
GITHUB_TOKEN=github_pat_xxxxxx...
GITHUB_REPO=username/groups-repo
GROUPS_FILE=group.js
PREMIUM_FILE=premium.js
OLD_RENDER=https://promdashboard.onrender.com
PORT=3000
```

---

## 💵 Premium Pricing (Automatic)

| Who | Amount |
|-----|--------|
| User pays | **₦5,000** (shown in ₦ and $ on premium.html) |
| Group owner earns | **₦2,500** (50% commission) |
| Platform keeps | ₦2,500 |

Dollar amounts are calculated live using the real NGN/USD exchange rate from `exchangerate-api.com`.

---

## 📋 API Reference

### Balance Server Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/get-balance` | None | Get user's NGN + USD balance |
| POST | `/generate-passcode` | None | Send 6-digit code to Telegram |
| POST | `/withdraw` | Passcode | Process withdrawal request |
| POST | `/api/premium-purchase` | secretKey | **NEW** — Deduct buyer, credit owner, notify all |
| POST | `/admin/get-balance` | x-admin-password | Get any user's balance |
| POST | `/admin/update-balance` | x-admin-password | Manually deposit/withdraw |
| POST | `/unlock-promo` | None | Submit promo/task proof to admin |
| GET | `/withdraw` | None | Serves withdraw.html |
| GET | `/admin` | None | Serves admin.html |

### Main Server Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | `/get-balance` | None | Proxy to balance server |
| POST | `/generate-premium-passcode` | None | Proxy to balance server /generate-passcode |
| POST | `/api/buy-premium` | Passcode (via balance server) | Full premium purchase flow |
| GET | `/api/premium-list` | None | List all premium users |
| GET | `/api/groups` | None | List all groups |
| GET | `/api/groups/:id` | None | Get group info |
| POST | `/api/groups/create` | None | Create group |
| POST | `/api/groups/:id/join` | None | Join group |
| POST | `/api/groups/:id/leave` | None | Leave group |
| POST | `/api/groups/:id/edit` | Owner | Edit group |
| POST | `/api/groups/:id/delete` | Owner | Delete group |
| GET | `/api/groups/:id/messages` | None | Get messages |
| POST | `/api/groups/:id/messages` | None | Send message |
| DELETE | `/api/groups/:id/messages/:msgId` | Sender/Owner | Delete message |
| POST | `/deposit` | None | Submit deposit request |
| GET | `/admin` | None | Serves admin.html |
| GET | `/admin/groups` | x-admin-password | List all groups |
| POST | `/admin/groups/:id/delete` | x-admin-password | Delete group |
| POST | `/admin/premium/check` | x-admin-password | Check premium status |
| POST | `/admin/premium/add` | x-admin-password | Grant premium |
| POST | `/admin/premium/remove` | x-admin-password | Remove premium |

---

## 🔒 Security Notes

- `ADMIN_PASSWORD` must be **identical** on both servers — it's used as the `secretKey` for server-to-server premium purchase calls
- `x-admin-password` header is required on all admin endpoints
- Passcodes expire after **5 minutes** and are invalidated after **3 failed attempts**
- Never commit your `.env` file to GitHub

---

## ❗ Troubleshooting

| Problem | Fix |
|---------|-----|
| `Unauthorized` on purchase | `ADMIN_PASSWORD` doesn't match on both servers |
| `Invalid or expired passcode` | User waited more than 5 minutes or entered wrong code |
| Balance not loading | Check `OLD_RENDER` env var has no trailing slash |
| Groups not loading | Check `GROUPS_FILE=group.js` and that the file exists in GitHub |
| GitHub write fails | Verify `GITHUB_TOKEN` has `Contents: write` permission |
| Bot not sending messages | Check `BOT_TOKEN` and that user has started the bot |
| Render service sleeping | Set up UptimeRobot to ping every 5 minutes |
| Dollar price shows $— | Balance server may be sleeping; UptimeRobot will fix this |
