class PMWindowGuard {
  constructor(config = {}) {

    this.lockKey = config.lockKey || "single-window-lock";
    this.heartbeatKey = config.heartbeatKey || "single-window-heartbeat";
    this.heartbeatMs = config.heartbeatMs || 1500;
    this.staleMs = config.staleMs || 5000;
    
    //UI updates
    this.onBlock = config.onBlock || (() => {});
    this.onStatus = config.onStatus || (() => {});

    //State management
    this.instanceId = Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
    this.isBlocked = false;
    this.channel = null;
    this.heartbeatInterval = null;

    //Bind methods to ensure 'this' context remains correct
    this.handleStorageEvent = this.handleStorageEvent.bind(this);
    this.releaseLock = this.releaseLock.bind(this);
  }



  start() {
    if (this.checkLock()) {
      this.claimLock();
      this.onStatus("Single window lock acquired.");
      this.startHeartbeat();
      this.broadcastPresence();
      this.bindEvents();
    } else {
      this.triggerBlock();
    }
  }

  stop() {
    // cleanup method to remove listeners/intervals
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.channel) this.channel.close();
    window.removeEventListener("storage", this.handleStorageEvent);
    window.removeEventListener("beforeunload", this.releaseLock);
    window.removeEventListener("pagehide", this.releaseLock);
    this.releaseLock();
  }


  now() {
    return Date.now();
  }

  triggerBlock() {
    if (this.isBlocked) return;
    this.isBlocked = true;
    this.onStatus("Another active window detected.");
    this.onBlock(); //Notify User Interface
  }

  claimLock() {
    try {
      localStorage.setItem(this.lockKey, this.instanceId);
      localStorage.setItem(this.heartbeatKey, String(this.now()));
    } catch (e) {
      this.onStatus("Storage blocked; cannot enforce single window.");
    }
  }

  getLockOwner() {
    return localStorage.getItem(this.lockKey);
  }

  isLockStale() {
    const last = Number(localStorage.getItem(this.heartbeatKey) || 0);
    return !last || this.now() - last > this.staleMs;
  }

  checkLock() {
    const owner = this.getLockOwner();
    if (!owner) return true;
    if (owner === this.instanceId) return true;
    if (this.isLockStale()) return true;
    return false;
  }

  startHeartbeat() {
    this.heartbeatInterval = setInterval(() => {
      if (this.isBlocked) return;
      try {
        if (this.getLockOwner() !== this.instanceId && !this.isLockStale()) {
          this.triggerBlock();
          return;
        }
        localStorage.setItem(this.heartbeatKey, String(this.now()));
      } catch (e) {
        this.onStatus("Storage blocked; cannot enforce single window.");
      }
    }, this.heartbeatMs);
  }

  broadcastPresence() {
    if (!("BroadcastChannel" in window)) return;
    
    this.channel = new BroadcastChannel("single-window-guard");
    this.channel.onmessage = (event) => {
      if (!event.data || this.isBlocked) return;

      if (event.data.type === "ping") {
        this.channel.postMessage({ type: "pong", from: this.instanceId });
      }
      
      if (event.data.type === "pong" && event.data.from !== this.instanceId) {
        this.triggerBlock();
      }
    };
    
    this.channel.postMessage({ type: "ping", from: this.instanceId });
  }

  releaseLock() {
    try {
      if (this.getLockOwner() === this.instanceId) {
        localStorage.removeItem(this.lockKey);
        localStorage.removeItem(this.heartbeatKey);
      }
    } catch (e) {
      //Throw error
    }
  }

  bindEvents() {
    window.addEventListener("storage", this.handleStorageEvent);
    window.addEventListener("beforeunload", this.releaseLock);
    window.addEventListener("pagehide", this.releaseLock);
  }

  handleStorageEvent(event) {
    if (event.key === this.lockKey && event.newValue && event.newValue !== this.instanceId) {
      this.triggerBlock();
    }
  }
}