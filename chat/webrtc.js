// ════════════════════════════════════════════════════════════════════════════
// SPOTME CHAT · WebRTC Integration (PeerJS)
//
// V2: Peer wird beim Login registriert, nicht erst beim Chat-Öffnen
// PeerJS wird global via <script> in index.html geladen
// ════════════════════════════════════════════════════════════════════════════

window.SpotMeWebRTC = class SpotMeWebRTC {
  // ── KONSTRUKTOR ───────────────────────────────────────────────────────────
  constructor(code, token, userName = null) {
    this.code = code;
    this.token = token;
    this.userName = userName || code;
    this.peer = null;
    this.conn = null;
    this.room = null;
    this.peerReady = false;

    // Callbacks
    this.onMessage = null; // Nachricht empfangen
    this.onConnect = null; // P2P Datenkanal geöffnet
    this.onDisconnect = null; // P2P Verbindung getrennt
    this.onError = null; // Fehler
    this.onPeerReady = null; // Peer beim Server registriert (NEU)

    // Reconnect
    this.reconnectAttempts = 0;
    this.MAX_RECONNECT = 5;
  }

  // ── PEER BEIM LOGIN REGISTRIEREN (NEU) ───────────────────────────────────
  // Wird sofort nach Login aufgerufen, damit andere Nutzer uns finden können
  register() {
    console.log("[WebRTC] Registriere Peer mit ID:", this.code);

    // Falls schon ein Peer existiert (z.B. Re-Login), erst zerstören
    if (this.peer && !this.peer.destroyed) {
      this.peer.destroy();
    }

    this.peer = new Peer(this.code, {
      debug: 2,
      host: "spotme-chat-obom.onrender.com",
      port: 443,
      path: "/peerjs",
      secure: true,
    });

    // ── Peer erfolgreich beim Server registriert ──
    this.peer.on("open", (id) => {
      console.log("[WebRTC] Peer registriert, ID:", id);
      this.peerReady = true;
      this.reconnectAttempts = 0;
      if (this.onPeerReady) this.onPeerReady(id);
    });

    // ── Eingehende Verbindung (Partner ruft uns an) ──
    this.peer.on("connection", (conn) => {
      console.log("[WebRTC] Eingehende Verbindung von:", conn.peer);
      this.handleConnection(conn);
    });

    // ── Fehler ──
    this.peer.on("error", (err) => {
      console.error("[WebRTC] Peer Error:", err.type, err);

      // ID bereits vergeben → alter Peer wahrscheinlich stale
      if (err.type === "unavailable-id") {
        console.warn("[WebRTC] ID bereits vergeben. Versuche Reconnect...");
        this.tryReconnect();
        return;
      }

      // Server nicht erreichbar → Reconnect versuchen
      if (err.type === "network" || err.type === "server-error") {
        console.warn("[WebRTC] Server nicht erreichbar. Versuche Reconnect...");
        this.tryReconnect();
        return;
      }

      // peer-unavailable → Partner ist nicht online, nicht kritisch
      if (err.type === "peer-unavailable") {
        if (this.onError) this.onError(err);
        return;
      }

      // Alle anderen Fehler weiterreichen
      if (this.onError) this.onError(err);
    });

    // ── Peer getrennt (z.B. Server-Restart) ──
    this.peer.on("disconnected", () => {
      console.warn("[WebRTC] Peer disconnected vom Server");
      this.peerReady = false;
      // Automatisch versuchen wiederzuverbinden
      if (!this.peer.destroyed) {
        this.peer.reconnect();
      }
    });

    // ── Peer geschlossen ──
    this.peer.on("close", () => {
      console.log("[WebRTC] Peer geschlossen");
      this.peerReady = false;
    });
  }

  // ── RECONNECT-LOGIK ─────────────────────────────────────────────────────
  tryReconnect() {
    if (this.reconnectAttempts >= this.MAX_RECONNECT) {
      console.error("[WebRTC] Max Reconnect-Versuche erreicht");
      if (this.onError) {
        this.onError(new Error("Maximale Reconnect-Versuche erreicht"));
      }
      return;
    }

    this.reconnectAttempts++;
    const delay = 2000 * this.reconnectAttempts; // 2s, 4s, 6s, 8s, 10s

    console.log(
      `[WebRTC] Reconnect in ${delay}ms (Versuch ${this.reconnectAttempts}/${this.MAX_RECONNECT})`,
    );

    setTimeout(() => {
      this.register();
    }, delay);
  }

  // ── AUF PEER-BEREITSCHAFT WARTEN (NEU) ───────────────────────────────────
  // Stellt sicher, dass der Peer registriert ist, bevor wir verbinden
  async waitForReady() {
    if (this.peerReady && this.peer && this.peer.id) {
      return this.peer.id;
    }

    console.log("[WebRTC] Warte auf Peer-Registrierung...");
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        clearInterval(checkInterval);
        reject(new Error("Peer-Registrierung Timeout (30s)"));
      }, 30000);

      const checkInterval = setInterval(() => {
        if (this.peerReady && this.peer && this.peer.id) {
          clearInterval(checkInterval);
          clearTimeout(timeout);
          console.log("[WebRTC] Peer ist bereit:", this.peer.id);
          resolve(this.peer.id);
        }
      }, 200);
    });
  }

  // ── VERBINDUNG ZU PARTNER AUFBAUEN ───────────────────────────────────────
  // Erstellt KEINEN neuen Peer mehr, sondern nutzt den beim Login registrierten
  async connect(partnerCode, onReady) {
    console.log("[WebRTC] Connect zu", partnerCode);

    this.room = [this.code, partnerCode].sort().join("-");

    // Warten bis unser eigener Peer bereit ist
    try {
      const peerId = await this.waitForReady();
      if (typeof onReady === "function") onReady(peerId);
      return peerId;
    } catch (err) {
      console.error("[WebRTC] Connect fehlgeschlagen:", err.message);
      throw err;
    }
  }

  // ── HANDLER FÜR VERBINDUNGEN (eingehend & ausgehend) ────────────────────
  handleConnection(conn) {
    // Duplikat-Verbindung vermeiden
    if (this.conn && this.conn.peer === conn.peer && this.conn.open) {
      console.log(
        "[WebRTC] Bereits verbunden mit",
        conn.peer,
        "ignoriere Duplikat",
      );
      conn.close();
      return;
    }

    this.conn = conn;

    // ── Datenkanal geöffnet ──
    conn.on("open", () => {
      console.log("[WebRTC] Datenkanal geöffnet zu", conn.peer);
      if (this.onConnect) this.onConnect(conn.peer);
    });

    // ── Nachricht empfangen ──
    conn.on("data", (data) => {
      console.log("[WebRTC] Nachricht von", conn.peer, ":", data);
      if (this.onMessage && data.type === "MESSAGE") {
        this.onMessage({
          text: data.text,
          from: conn.peer,
          fromName: data.fromName,
          ts: data.ts || Date.now(),
        });
      }
    });

    // ── Verbindung geschlossen ──
    conn.on("close", () => {
      console.log("[WebRTC] Verbindung geschlossen zu", conn.peer);
      if (this.conn === conn) {
        this.conn = null;
      }
      if (this.onDisconnect) this.onDisconnect(conn.peer);
    });

    // ── Verbindungsfehler ──
    conn.on("error", (err) => {
      console.error("[WebRTC] Connection Error:", err);
      if (this.onError) this.onError(err);
      // Verbindung nicht automatisch schließen — PeerJS handles das selbst
    });
  }

  // ── AUSGEHENDE VERBINDUNG INITIIEREN ─────────────────────────────────────
  initiateConnection(partnerCode) {
    if (!this.peer || !this.peerReady) {
      console.error("[WebRTC] Peer nicht bereit für initiateConnection");
      return null;
    }

    console.log("[WebRTC] Initiiere Verbindung zu", partnerCode);

    const conn = this.peer.connect(partnerCode, {
      metadata: { from: this.code, fromName: this.userName },
      reliable: true,
    });

    this.handleConnection(conn);
    return conn;
  }

  // ── NACHRICHT SENDEN (P2P) ────────────────────────────────────────────────
  send(text) {
    if (!this.conn || !this.conn.open) {
      console.warn("[WebRTC] Kein offener Datenkanal");
      return false;
    }

    const payload = {
      type: "MESSAGE",
      text: text,
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

  isPeerReady() {
    return this.peerReady;
  }

  getRoomId() {
    return this.room;
  }

  // ── AUFRÄUMEN ─────────────────────────────────────────────────────────────
  cleanup() {
    if (this.conn) {
      try {
        this.conn.close();
      } catch {}
      this.conn = null;
    }
    // Peer NICHT zerstören bei cleanup — nur bei Logout/destroy
    // Der Peer bleibt registriert, damit uns andere erreichen können
  }

  destroy() {
    if (this.conn) {
      try {
        this.conn.close();
      } catch {}
      this.conn = null;
    }
    if (this.peer && !this.peer.destroyed) {
      this.peer.destroy();
    }
    this.peer = null;
    this.peerReady = false;
    this.reconnectAttempts = 0;
  }
};
