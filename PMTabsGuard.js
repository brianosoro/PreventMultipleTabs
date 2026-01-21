class PMTabsGuard {
  constructor({
    lockKey = "single-window-lock",
    heartbeatKey = "single-window-heartbeat",
    heartbeatMs = 1500,
    staleMs = 5000,
    onBlock = () => {},
    onStatus = () => {},
  } = {}) {
    this.lockKey = lockKey;
    this.heartbeatKey = heartbeatKey;
    this.heartbeatMs = heartbeatMs;
    this.staleMs = staleMs;

    this.onBlock = onBlock;
    this.onStatus = onStatus;

    // Instance ID is to tell the two different tabs apart.
    this.instanceId =
      `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

    this.isBlocked = false;
    this.channel = null;
    this.heartbeatTimer = null;

    // Keep handler references so removeEventListener works
    this._onStorage = this._onStorage.bind(this);
    this._onUnload = this._onUnload.bind(this);
  }

  start() {
    // If someone else owns the lock and it's not stale, we block immediately.
    if (!this._canTakeLock()) {
      this._block("Another active window detected.");
      return;
    }

    this._takeLock();
    this.onStatus("Single window lock acquired.");

    this._startHeartbeat();
    this._setupBroadcastChannel();
    this._bindEvents();
  }

  stop() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    if (this.channel) {
      try { this.channel.close(); } catch (_) {}
      this.channel = null;
    }

    window.removeEventListener("storage", this._onStorage);
    window.removeEventListener("beforeunload", this._onUnload);
    window.removeEventListener("pagehide", this._onUnload);

    this._releaseLock();
  }

  // -------------------------
  // Helper functions for the Lock
  // -------------------------

  _now() {
    return Date.now();
  }

  _owner() {
    try {
      return localStorage.getItem(this.lockKey);
    } catch (_) {
      return null;
    }
  }

  _lastHeartbeat() {
    try {
      return Number(localStorage.getItem(this.heartbeatKey) || 0);
    } catch (_) {
      return 0;
    }
  }

  _isStale() {
    const last = this._lastHeartbeat();
    return !last || this._now() - last > this.staleMs;
  }

  _canTakeLock() {
    const owner = this._owner();

    // no lock yet
    if (!owner) return true;

    // we already own it (e.g. start called twice)
    if (owner === this.instanceId) return true;

    // lock exists but looks abandoned
    if (this._isStale()) return true;

    return false;
  }

  _takeLock() {
    try {
      localStorage.setItem(this.lockKey, this.instanceId);
      localStorage.setItem(this.heartbeatKey, String(this._now()));
    } catch (e) {
      this.onStatus("Storage blocked; cannot enforce single window.");
    }
  }

  _releaseLock() {
    try {
      if (this._owner() === this.instanceId) {
        localStorage.removeItem(this.lockKey);
        localStorage.removeItem(this.heartbeatKey);
      }
    } catch (_) {
      // ignore unload/storage errors
    }
  }

  _block(message) {
    if (this.isBlocked) return;
    this.isBlocked = true;

    if (message) this.onStatus(message);
    this.onBlock();

    //Optional: once blocked, stop spamming storage writes
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  // -------------------------
  // Heartbeat
  // -------------------------

  _startHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      if (this.isBlocked) return;

      //If another tab took ownership and it doesn't look stale, block.
      const owner = this._owner();
      if (owner && owner !== this.instanceId && !this._isStale()) {
        this._block("Another active window detected.");
        return;
      }

      //Otherwise refresh heartbeat (and re-assert lock if it disappeared).
      try {
        if (!owner || owner === this.instanceId) {
          localStorage.setItem(this.lockKey, this.instanceId);
        }
        localStorage.setItem(this.heartbeatKey, String(this._now()));
      } catch (e) {
        this.onStatus("Storage blocked; cannot enforce single window.");
      }
    }, this.heartbeatMs);
  }

  // -------------------------
  // Cross-tab messaging (optional)
  // -------------------------

  _setupBroadcastChannel() {
    if (!("BroadcastChannel" in window)) return;

    this.channel = new BroadcastChannel("single-window-guard");

    this.channel.onmessage = (event) => {
      if (this.isBlocked) return;

      const data = event && event.data;
      if (!data || typeof data.type !== "string") return;

      if (data.type === "ping") {
        this.channel.postMessage({ type: "pong", from: this.instanceId });
        return;
      }

      // If any other tab answers, we block.
      if (data.type === "pong" && data.from && data.from !== this.instanceId) {
        this._block("Another active window detected.");
      }
    };

    //Ask who else is around
    this.channel.postMessage({ type: "ping", from: this.instanceId });
  }

  // -------------------------
  // Events
  // -------------------------

  _bindEvents() {
    window.addEventListener("storage", this._onStorage);
    window.addEventListener("beforeunload", this._onUnload);
    window.addEventListener("pagehide", this._onUnload);
  }

  _onUnload() {
    this._releaseLock();
  }

  _onStorage(event) {
    //If someone else sets the lock to their id, we block.
    if (event.key === this.lockKey && event.newValue && event.newValue !== this.instanceId) {
      this._block("Another active window detected.");
    }
  }
}
