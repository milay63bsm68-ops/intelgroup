/**
 * ============================================================
 *  MAIN SERVER  —  intel-groups.onrender.com
 *  Handles: groups, messages, premium UI flow, deposit notify
 *  Balance ops are delegated to the BALANCE SERVER at OLD_RENDER
 *  (https://promdashboard.onrender.com)
 * ============================================================
 */

import express from "express";
import fetch   from "node-fetch";
import cors    from "cors";
import dotenv  from "dotenv";
import path    from "path";
import crypto  from "crypto";
import { fileURLToPath } from "url";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: "*", methods: ["GET", "POST", "DELETE"] }));
app.use(express.json({ limit: "50mb" }));

const {
  BOT_TOKEN,
  ADMIN_ID,
  ADMIN_PASSWORD,
  GITHUB_TOKEN,
  GITHUB_REPO,
  GROUPS_FILE,
  PREMIUM_FILE,
  OLD_RENDER        // https://promdashboard.onrender.com
} = process.env;

/* ════════════════════════════════════════════════════════════
   BALANCE  —  all calls forwarded to OLD RENDER
════════════════════════════════════════════════════════════ */

/** Get a user's NGN balance + usdRate from the balance server */
async function getBalance(telegramId) {
  const res  = await fetch(`${OLD_RENDER}/get-balance`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({ telegramId })
  });
  const data = await res.json();
  return { ngn: data?.ngn || 0, usdRate: data?.usdRate || 1600 };
}

/**
 * Full premium purchase flow on the balance server.
 * Deducts ₦5,000 from buyer, credits ₦2,500 to group owner,
 * sends Telegram notifications, returns updated balances.
 */
async function processPremiumPurchase({
  telegramId, buyerName, buyerUsername,
  groupOwnerId, groupOwnerName, groupName,
  passcode
}) {
  const res  = await fetch(`${OLD_RENDER}/api/premium-purchase`, {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      telegramId, buyerName, buyerUsername,
      groupOwnerId, groupOwnerName, groupName,
      passcode,
      secretKey: ADMIN_PASSWORD   // server-to-server auth
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Premium purchase failed");
  return data;
}

/* ════════════════════════════════════════════════════════════
   TELEGRAM
════════════════════════════════════════════════════════════ */

async function sendTelegram(text, chatId) {
  if (!BOT_TOKEN || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id:    Number(chatId),
        text,
        parse_mode: "HTML",
        disable_web_page_preview: true
      })
    });
  } catch (e) { console.error("sendTelegram:", e.message); }
}

async function sendTelegramPhoto(chatId, photoBase64, caption) {
  if (!BOT_TOKEN || !chatId) return;
  try {
    await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendPhoto`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id:    Number(chatId),
        photo:      photoBase64,
        caption,
        parse_mode: "HTML"
      })
    });
  } catch (e) { console.error("sendTelegramPhoto:", e.message); }
}

function sanitizeForBot(text) {
  text = text.replace(/https?:\/\/[^\s]+/gi, "[link]");
  text = text.replace(/(\+\d{1,4}[\s-]?)?\(?\d{3,5}\)?[\s-]?\d{3,5}[\s-]?\d{3,6}/g, "[phone]");
  text = text.replace(/\b\d{9,}\b/g, "[number]");
  return text;
}

/* ════════════════════════════════════════════════════════════
   GITHUB — groups.js and premium.js only
════════════════════════════════════════════════════════════ */

async function readGithubFile(filename) {
  const r = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${filename}`,
    { headers: { Authorization: `token ${GITHUB_TOKEN}` } }
  );
  if (!r.ok) throw new Error("GitHub read failed: " + r.status);
  const f = await r.json();
  return { content: Buffer.from(f.content, "base64").toString(), sha: f.sha };
}

async function writeGithubFile(filename, content, sha, message) {
  const r = await fetch(
    `https://api.github.com/repos/${GITHUB_REPO}/contents/${filename}`,
    {
      method:  "PUT",
      headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ message, sha, content: Buffer.from(content).toString("base64") })
    }
  );
  if (!r.ok) throw new Error("GitHub write failed: " + r.status);
}

/**
 * Sanitize avatar value before saving to GitHub.
 * - Accepts: emoji JSON string, URL JSON string, or a plain URL string.
 * - Rejects:  raw base64 (data:image/…) — strips it to null to keep file small.
 * - Returns a safe string (or null).
 */
function sanitizeAvatar(avatar) {
  if (!avatar) return null;
  // Block raw base64 — would bloat groups.js
  if (typeof avatar === "string" && avatar.startsWith("data:image/")) {
    console.warn("Avatar base64 rejected — use a URL instead.");
    return null;
  }
  // Already a JSON avatar object string  {"type":"emoji",...}  or  {"type":"url",...}
  if (typeof avatar === "string" && avatar.startsWith("{")) {
    try {
      const parsed = JSON.parse(avatar);
      if (parsed.type === "url" && typeof parsed.src === "string") {
        // Just store the URL directly — simpler
        return parsed.src;
      }
      if (parsed.type === "emoji") {
        // Keep emoji+color JSON as-is
        return avatar;
      }
    } catch { /* fall through */ }
  }
  // Plain URL string (http/https)
  if (typeof avatar === "string" && /^https?:\/\/.+/.test(avatar)) {
    return avatar;
  }
  return null;
}

async function readGroups() {
  const { content, sha } = await readGithubFile(GROUPS_FILE);
  return {
    groups: JSON.parse(content.replace("window.GROUPS_DATA =", "").trim()),
    sha
  };
}

async function saveGroups(groups, sha, msg) {
  await writeGithubFile(
    GROUPS_FILE,
    "window.GROUPS_DATA = " + JSON.stringify(groups, null, 2),
    sha, msg
  );
}

async function readPremium() {
  const { content, sha } = await readGithubFile(PREMIUM_FILE);
  return {
    users: JSON.parse(content.replace("window.PREMIUM_USERS =", "").trim()),
    sha
  };
}

async function savePremium(users, sha, msg) {
  await writeGithubFile(
    PREMIUM_FILE,
    "window.PREMIUM_USERS = " + JSON.stringify(users, null, 2),
    sha, msg
  );
}

/* ════════════════════════════════════════════════════════════
   PASSCODES  — only for premium purchase (withdrawal uses balance server)
════════════════════════════════════════════════════════════ */
const passcodes = {};
const attempts  = {};

function authAdmin(req, res) {
  if (req.headers["x-admin-password"] !== ADMIN_PASSWORD) {
    res.status(401).json({ error: "Unauthorized" });
    return false;
  }
  return true;
}

/* ════════════════════════════════════════════════════════════
   STATIC PAGES
════════════════════════════════════════════════════════════ */
app.get("/",                  (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/index.html",        (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/group.html",        (req, res) => res.sendFile(path.join(__dirname, "group.html")));
app.get("/create-group.html", (req, res) => res.sendFile(path.join(__dirname, "create-group.html")));
app.get("/premium.html",      (req, res) => res.sendFile(path.join(__dirname, "premium.html")));
app.get("/deposit.html",      (req, res) => res.sendFile(path.join(__dirname, "deposit.html")));
app.get("/admin",             (req, res) => res.sendFile(path.join(__dirname, "admin.html")));

/* ════════════════════════════════════════════════════════════
   GET BALANCE  —  proxy to balance server
════════════════════════════════════════════════════════════ */
app.post("/get-balance", async (req, res) => {
  const telegramId = req.body.telegramId ? String(req.body.telegramId) : null;
  if (!telegramId) return res.json({ ngn: 0, usd: 0, usdRate: 1600 });
  try {
    const r    = await fetch(`${OLD_RENDER}/get-balance`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ telegramId })
    });
    const data = await r.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "Failed to load balance: " + err.message });
  }
});

/* ════════════════════════════════════════════════════════════
   PREMIUM LIST
════════════════════════════════════════════════════════════ */
app.get("/api/premium-list", async (req, res) => {
  try {
    const { users } = await readPremium();
    res.json(users);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ════════════════════════════════════════════════════════════
   GENERATE PREMIUM PASSCODE
   Sends the code via the balance server's generate-passcode endpoint
   so the code is stored there — the purchase will be validated there too.
════════════════════════════════════════════════════════════ */
app.post("/generate-premium-passcode", async (req, res) => {
  const telegramId = req.body.telegramId ? String(req.body.telegramId) : null;
  if (!telegramId) return res.status(400).json({ error: "Missing Telegram ID" });

  try {
    /* Delegate to balance server so it can validate the code on purchase */
    const r    = await fetch(`${OLD_RENDER}/generate-passcode`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ telegramId })
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.error || "Failed to generate code");
    res.json({ success: true, message: "Passcode sent to your Telegram" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/* ════════════════════════════════════════════════════════════
   BUY PREMIUM  — fully automatic
   1. Calls balance server /api/premium-purchase
      → validates passcode, deducts buyer, credits owner
   2. On success, adds user to premium.js on GitHub
════════════════════════════════════════════════════════════ */
app.post("/api/buy-premium", async (req, res) => {
  const { telegramId, name, username, passcode, groupId } = req.body;
  if (!telegramId) return res.status(400).json({ error: "Missing Telegram ID" });

  try {
    /* Resolve group owner info if a groupId was provided */
    let groupOwnerId   = null;
    let groupOwnerName = null;
    let groupName      = null;

    if (groupId) {
      try {
        const { groups } = await readGroups();
        const g = groups[groupId];
        if (g && g.ownerId && g.ownerId !== telegramId) {
          groupOwnerId   = g.ownerId;
          groupOwnerName = g.ownerName || g.ownerId;
          groupName      = g.name || groupId;
        }
      } catch (e) { console.error("Group lookup error:", e.message); }
    }

    /* ── Call balance server — does everything ── */
    const result = await processPremiumPurchase({
      telegramId,
      buyerName:    name,
      buyerUsername: username || "",
      groupOwnerId,
      groupOwnerName,
      groupName,
      passcode
    });

    /* ── Update group totalEarnings on GitHub ── */
    if (groupId && groupOwnerId) {
      try {
        const { groups, sha: gSha } = await readGroups();
        if (groups[groupId]) {
          groups[groupId].totalEarnings = (groups[groupId].totalEarnings || 0) + 2500;
          await saveGroups(groups, gSha, `Premium sale in group ${groupId}`);
        }
      } catch (e) { console.error("Group earnings update error:", e.message); }
    }

    /* ── Add to premium.js on GitHub ── */
    const { users, sha: pSha } = await readPremium();
    if (!users.includes(telegramId)) {
      users.push(telegramId);
      await savePremium(users, pSha, `Premium added: ${telegramId}`);
    }

    res.json({
      success:        true,
      message:        result.message || "🎉 You are now Premium!",
      newBalance:     result.newBuyerBalance,
      buyerUsd:       result.buyerUsd,
      premiumCostNgn: result.premiumCostNgn,
      premiumCostUsd: result.premiumCostUsd,
      ownerEarnedNgn: result.ownerEarnedNgn,
      ownerEarnedUsd: result.ownerEarnedUsd
    });

  } catch (err) {
    console.error("Buy premium error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

/* ════════════════════════════════════════════════════════════
   GROUPS — CRUD
════════════════════════════════════════════════════════════ */

app.get("/api/groups", async (req, res) => {
  try {
    const { groups } = await readGroups();
    const stripped   = {};
    for (const [id, g] of Object.entries(groups)) {
      const { messages, ...rest } = g;
      stripped[id] = rest;
    }
    res.json(stripped);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/groups/:id", async (req, res) => {
  try {
    const { groups } = await readGroups();
    const group = groups[req.params.id];
    if (!group) return res.status(404).json({ error: "Group not found" });
    const { messages, ...rest } = group;
    res.json(rest);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/groups/create", async (req, res) => {
  const { telegramId, ownerName, name, description, isPrivate, isPremiumOnly, avatar } = req.body;
  if (!telegramId || !name) return res.status(400).json({ error: "Missing required fields" });
  try {
    const { groups, sha } = await readGroups();
    const groupId = crypto.randomBytes(5).toString("hex").toUpperCase();
    groups[groupId] = {
      name:          name.slice(0, 64),
      description:   (description || "").slice(0, 255),
      ownerId:       telegramId,
      ownerName,
      avatar:        sanitizeAvatar(avatar),   // ← safe: URL string or emoji JSON only
      isPrivate:     Boolean(isPrivate),
      isPremiumOnly: Boolean(isPremiumOnly),
      createdAt:     Date.now(),
      lastMessageAt: null,
      lastMessage:   null,
      totalEarnings: 0,
      members:       { [telegramId]: { name: ownerName, joinedAt: Date.now() } },
      messages:      []
    };
    await saveGroups(groups, sha, `Create group ${groupId}`);
    await sendTelegram(
      `🆕 <b>New Group Created</b>\n📌 ${name}\n🆔 ${groupId}\n👤 ${ownerName} (${telegramId})`,
      ADMIN_ID
    );
    res.json({ success: true, groupId });
  } catch (err) { res.status(500).json({ error: "Failed to create: " + err.message }); }
});

app.post("/api/groups/:id/join", async (req, res) => {
  const { telegramId, name, username } = req.body;
  if (!telegramId) return res.status(400).json({ error: "Missing Telegram ID" });
  try {
    const { groups, sha } = await readGroups();
    const group = groups[req.params.id];
    if (!group) return res.status(404).json({ error: "Group not found" });
    if (!group.members) group.members = {};
    if (!group.members[telegramId]) {
      group.members[telegramId] = { name, username, joinedAt: Date.now() };
      if (!group.messages) group.messages = [];
      group.messages.push({
        id: crypto.randomBytes(8).toString("hex"),
        type: "system",
        text: `${name} joined the group`,
        timestamp: Date.now()
      });
      group.lastMessage   = `${name} joined`;
      group.lastMessageAt = Date.now();
      await saveGroups(groups, sha, `${telegramId} joined ${req.params.id}`);
    }
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/groups/:id/leave", async (req, res) => {
  const { telegramId } = req.body;
  try {
    const { groups, sha } = await readGroups();
    const group = groups[req.params.id];
    if (!group) return res.status(404).json({ error: "Group not found" });
    if (group.ownerId === telegramId)
      return res.status(400).json({ error: "Owner cannot leave. Delete the group instead." });
    const leaverName = group.members?.[telegramId]?.name || telegramId;
    if (group.members) delete group.members[telegramId];
    if (!group.messages) group.messages = [];
    group.messages.push({
      id: crypto.randomBytes(8).toString("hex"),
      type: "system",
      text: `${leaverName} left the group`,
      timestamp: Date.now()
    });
    await saveGroups(groups, sha, `${telegramId} left ${req.params.id}`);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/groups/:id/edit", async (req, res) => {
  const { telegramId, name, description, avatar, isPrivate, isPremiumOnly } = req.body;
  try {
    const { groups, sha } = await readGroups();
    const group = groups[req.params.id];
    if (!group) return res.status(404).json({ error: "Group not found" });
    if (group.ownerId !== telegramId)
      return res.status(403).json({ error: "Only the group owner can edit" });
    if (name)                        group.name          = name.slice(0, 64);
    if (description !== undefined)   group.description   = description.slice(0, 255);
    if (avatar !== undefined)        group.avatar        = sanitizeAvatar(avatar);
    if (isPrivate !== undefined)     group.isPrivate     = Boolean(isPrivate);
    if (isPremiumOnly !== undefined) group.isPremiumOnly = Boolean(isPremiumOnly);
    await saveGroups(groups, sha, `Edit group ${req.params.id}`);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/api/groups/:id/delete", async (req, res) => {
  const { telegramId } = req.body;
  try {
    const { groups, sha } = await readGroups();
    const group = groups[req.params.id];
    if (!group) return res.status(404).json({ error: "Group not found" });
    if (group.ownerId !== telegramId && String(telegramId) !== String(ADMIN_ID))
      return res.status(403).json({ error: "Only the group owner can delete" });
    delete groups[req.params.id];
    await saveGroups(groups, sha, `Delete group ${req.params.id}`);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ════════════════════════════════════════════════════════════
   MESSAGES
════════════════════════════════════════════════════════════ */

app.get("/api/groups/:id/messages", async (req, res) => {
  try {
    const { groups } = await readGroups();
    const group = groups[req.params.id];
    if (!group) return res.status(404).json({ error: "Group not found" });
    const msgs = (group.messages || []).slice(-200);
    res.json(msgs.map(m => ({ ...m, audioData: undefined })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

const audioCache = {};

app.post("/api/groups/:id/messages", async (req, res) => {
  const { telegramId, senderName, type, text, audioData, duration } = req.body;
  if (!telegramId) return res.status(400).json({ error: "Missing Telegram ID" });
  if (type === "text" && !text?.trim()) return res.status(400).json({ error: "Empty message" });
  try {
    const { groups, sha } = await readGroups();
    const group = groups[req.params.id];
    if (!group) return res.status(404).json({ error: "Group not found" });

    const msgId     = crypto.randomBytes(8).toString("hex");
    const timestamp = Date.now();
    let msg;

    if (type === "voice") {
      audioCache[msgId] = audioData;
      msg = {
        id: msgId, type: "voice",
        senderId: telegramId, senderName,
        duration: duration || "0:00",
        audioUrl: `/api/audio/${msgId}`,
        timestamp
      };
    } else {
      msg = {
        id: msgId, type: "text",
        senderId: telegramId, senderName,
        text: text.slice(0, 4000),
        timestamp
      };
    }

    if (!group.messages) group.messages = [];
    group.messages.push(msg);
    if (group.messages.length > 500) group.messages = group.messages.slice(-500);

    group.lastMessage   = type === "voice"
      ? `🎤 ${senderName}: Voice note`
      : `${senderName}: ${text.slice(0, 60)}`;
    group.lastMessageAt = timestamp;

    await saveGroups(groups, sha, `Message in ${req.params.id}`);

    const memberIds = Object.keys(group.members || {}).filter(id => id !== telegramId);
    if (memberIds.length > 0) {
      const safe = type === "voice"
        ? "🎤 Sent a voice note"
        : sanitizeForBot(text.slice(0, 200));
      const notif =
        `💬 <b>${senderName}</b> in <b>${group.name}</b>:\n${safe}\n\n` +
        `<a href="https://t.me/intelligentverificationlinkbot">👉 View in group</a>`;
      Promise.all(memberIds.map(id => sendTelegram(notif, id))).catch(() => {});
    }

    res.json({ success: true, msgId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get("/api/audio/:msgId", (req, res) => {
  const data = audioCache[req.params.msgId];
  if (!data) return res.status(404).send("Audio not found");
  res.set("Content-Type", "audio/webm");
  res.send(Buffer.from(data, "base64"));
});

app.delete("/api/groups/:id/messages/:msgId", async (req, res) => {
  const { telegramId, isOwner } = req.body;
  try {
    const { groups, sha } = await readGroups();
    const group = groups[req.params.id];
    if (!group) return res.status(404).json({ error: "Group not found" });
    const idx = (group.messages || []).findIndex(m => m.id === req.params.msgId);
    if (idx === -1) return res.status(404).json({ error: "Message not found" });
    const msg = group.messages[idx];
    if (msg.senderId !== telegramId && !isOwner && group.ownerId !== telegramId)
      return res.status(403).json({ error: "Not allowed" });
    group.messages.splice(idx, 1);
    await saveGroups(groups, sha, `Delete msg ${req.params.msgId}`);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ════════════════════════════════════════════════════════════
   DEPOSIT  —  notifies admin via Telegram, no balance change
   (admin manually credits the balance server)
════════════════════════════════════════════════════════════ */
app.post("/deposit", async (req, res) => {
  const { telegramId, name, username, method, amount, whatsapp, image } = req.body;
  if (!telegramId || !image) return res.status(400).json({ error: "Missing required fields" });
  const caption =
    `<b>💰 DEPOSIT REQUEST</b>\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `👤 <b>Name:</b> ${name}\n` +
    `🔗 <b>Username:</b> ${username}\n` +
    `🆔 <b>ID:</b> <code>${telegramId}</code>\n` +
    `💳 <b>Method:</b> ${method}\n` +
    `💵 <b>Amount:</b> ₦${Number(amount).toLocaleString()}\n` +
    `📱 <b>WhatsApp:</b> ${whatsapp || "N/A"}\n` +
    `━━━━━━━━━━━━━━━━━━━━\n` +
    `Credit ID <code>${telegramId}</code> ₦${Number(amount).toLocaleString()} via balance server admin.`;
  try {
    await sendTelegramPhoto(ADMIN_ID, image, caption);
    await sendTelegram(
      `✅ Deposit request of ₦${Number(amount).toLocaleString()} received!\n` +
      `Admin will review and credit your balance shortly.`,
      telegramId
    );
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: "Failed: " + err.message }); }
});

/* ════════════════════════════════════════════════════════════
   ADMIN  —  Groups and Premium
════════════════════════════════════════════════════════════ */

app.get("/admin/groups", async (req, res) => {
  if (!authAdmin(req, res)) return;
  try {
    const { groups } = await readGroups();
    res.json(groups);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/admin/groups/:id/delete", async (req, res) => {
  if (!authAdmin(req, res)) return;
  try {
    const { groups, sha } = await readGroups();
    if (!groups[req.params.id]) return res.status(404).json({ error: "Not found" });
    delete groups[req.params.id];
    await saveGroups(groups, sha, `Admin deleted group ${req.params.id}`);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/admin/premium/check", async (req, res) => {
  if (!authAdmin(req, res)) return;
  try {
    const { users } = await readPremium();
    res.json({ isPremium: users.includes(String(req.body.telegramId)), users });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/admin/premium/add", async (req, res) => {
  if (!authAdmin(req, res)) return;
  try {
    const { users, sha } = await readPremium();
    const id = String(req.body.telegramId);
    if (!users.includes(id)) {
      users.push(id);
      await savePremium(users, sha, `Admin added premium: ${id}`);
      await sendTelegram(`⭐ You have been granted Premium access by admin!`, id);
    }
    res.json({ success: true, users });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post("/admin/premium/remove", async (req, res) => {
  if (!authAdmin(req, res)) return;
  try {
    const { users, sha } = await readPremium();
    const id      = String(req.body.telegramId);
    const updated = users.filter(u => u !== id);
    await savePremium(updated, sha, `Admin removed premium: ${id}`);
    await sendTelegram(`⚠️ Your Premium access has been removed by admin.`, id);
    res.json({ success: true, users: updated });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

/* ════════════════════════════════════════════════════════════
   START
════════════════════════════════════════════════════════════ */
app.listen(PORT, () => console.log(`✅ Main server running on port ${PORT}`));