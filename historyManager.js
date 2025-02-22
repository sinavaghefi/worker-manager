const fs = require("fs").promises;
const path = require("path");

class HistoryManager {
  constructor(filePath = "worker-history.json", saveInterval = 20000) {
    this.filePath = filePath;
    this.saveInterval = saveInterval;
    this.history = [];
    this.isDirty = false;
    this.intervalId = null;
  }

  async initialize() {
    try {
      await this.loadHistory();
      this.startPeriodicSave();
    } catch (error) {
      console.error("Failed to initialize history manager:", error);
      // Create empty history file if it doesn't exist
      await this.saveHistory();
    }
  }

  async loadHistory() {
    try {
      const data = await fs.readFile(this.filePath, "utf8");
      this.history = JSON.parse(data);
    } catch (error) {
      if (error.code === "ENOENT") {
        this.history = [];
      } else {
        throw error;
      }
    }
  }

  async saveHistory() {
    if (!this.isDirty) return;

    try {
      await fs.writeFile(
        this.filePath,
        JSON.stringify(this.history, null, 2),
        "utf8"
      );
      this.isDirty = false;
    } catch (error) {
      console.error("Failed to save history:", error);
    }
  }

  startPeriodicSave() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }

    this.intervalId = setInterval(async () => {
      await this.saveHistory();
    }, this.saveInterval);
  }

  addRecord(record) {
    this.history.push(record);
    this.isDirty = true;
  }

  getHistory() {
    return this.history;
  }

  async cleanup() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
    }
    await this.saveHistory();
  }
}

module.exports = HistoryManager;
