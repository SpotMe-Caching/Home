// ════════════════════════════════════════════════════════════════════════════
// SPOTME CHAT · WebRTC Integration (PeerJS)
//
// Nutzt den bereits vorhandenen PeerJS Server (/peerjs) für P2P-Kommunikation.
// Nach "Bereit"-Invite → Peer-Connection aufbauen → Nachrichten über Datenkanal.
// ════════════════════════════════════════════════════════════════════════════

import Peer from "https://unpkg.com/peerjs@1.5.2/dist/peerjs.esm.js";

export default class SpotMeWebRTC {
  // ── KONSTRUKTOR ───────────────────────────────────────────────────────────
  constructor(code, token, userName = null) {
    this.code = code;
    this.token = token;
    this.userName = userName || code; // ← FIX: User Name hier speichern
    this.peer = null;
    this.conn = null;
    this.room = null;
    this.onMessage = null;
    this.onConnect = null;
    this.onDisconnect = null;
    this.onError = null;
    this.reconnectAttempts = 0;
    this.MAX_RECONNECT = 5;
  }

  // ── INITIALISIERUNG ───────────────────────────────────────────────────────
  async connect(partnerCode, onReady) {
    console.log("[WebRTC] Connect zu", partnerCode);

    // Raum-ID generieren (symmetrisch: AB-CD == CD-AB)
    this.room = [this.code, partnerCode].sort().join("-");

    // Peer-Instance erstellen mit unserer Code als ID
    this.peer = new Peer(this.code, {
      debug: 2,
      host: window.location.hostname,
      port: window.location.port || 443,
      path: "/peerjs",
    });

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        if (this.peer && !this.peer.destroyed) {
          this.peer.destroy();
          reject(new Error("Verbindungs-Timeout"));
        }
      }, 60000);

      this.peer.on("open", (id) => {
        console.log("[WebRTC] Peer-ID:", id);
        clearTimeout(timeout);
        if (typeof onReady === "function") onReady(id);
        resolve(id);
      });

      this.peer.on("connection", (conn) => {
        // Partner kommt auf uns zu
        console.log("[WebRTC] Verbindung von", conn.peer);
        this.handleConnection(conn);
      });

      this.peer.on("error", (err) => {
        console.error("[WebRTC] Error:", err.type, err);
        clearTimeout(timeout);
        if (this.onError) this.onError(err);
        reject(err);
      });
    });
  }

  // ── HANDLER FÜR EINGEHENDE VERBINDUNGEN ──────────────────────────────────
  handleConnection(conn) {
    this.conn = conn;

    conn.on("open", () => {
      console.log("[WebRTC] Datenkanal geöffnet");
      if (this.onConnect) this.onConnect();
    });

    conn.on("data", (data) => {
      console.log("[WebRTC] Received:", data);
      if (this.onMessage && data.type === "MESSAGE") {
        this.onMessage({
          text: data.text,
          from: conn.peer,
          fromName: data.fromName,
          ts: Date.now(),
        });
      }
    });

    conn.on("close", () => {
      console.log("[WebRTC] Verbindung geschlossen");
      if (this.onDisconnect) this.onDisconnect();
      this.cleanup();
    });

    conn.on("error", (err) => {
      console.error("[WebRTC] Connection Error:", err);
      if (this.onError) this.onError(err);
      this.cleanup();
    });
  }

  // ── AUSGEHENDE VERBINDUNG INITIIEREN ─────────────────────────────────────
  initiateConnection(partnerCode) {
    console.log("[WebRTC] Initiate to", partnerCode);

    // FIX: this.userName statt PROFILE.name
    const conn = this.peer.connect(partnerCode, {
      metadata: { from: this.code, fromName: this.userName },
    });

    this.handleConnection(conn);
    return conn;
  }

  // ── NACHRICHT SENDEN (P2P) ────────────────────────────────────────────────
  send(text) {
    if (!this.conn || !this.conn.open) {
      console.warn("[WebRTC] Kein offener Kanal");
      return false;
    }

    // FIX: this.userName statt PROFILE.name
    const payload = {
      type: "MESSAGE",
      text,
      fromName: this.userName,
      ts: Date.now(),
    };

    this.conn.send(payload);
    return true;
  }

  // ── STATUS ABFRAGEN ───────────────────────────────────────────────────────
  isConnected() {
    return this.conn && this.conn.open;
  }

  getRoomId() {
    return this.room;
  }

  // ── AUFRÄUMEN ─────────────────────────────────────────────────────────────
  cleanup() {
    if (this.conn) {
      this.conn.close();
      this.conn = null;
    }
    if (this.peer && !this.peer.destroyed) {
      this.peer.destroy();
      this.peer = null;
    }
    this.reconnectAttempts = 0;
  }

  destroy() {
    this.cleanup();
  }
}
