const fastify = require("fastify")({ logger: true });
const { fork } = require("child_process");
const path = require("path");
const HistoryManager = require("./historyManager");
const os = require("os");

// Register @fastify/view for templating
fastify.register(require("@fastify/view"), {
  engine: {
    ejs: require("ejs"),
  },
  root: path.join(__dirname, "views"),
});
const routes = require("./routes");

const { doWork } = require('./child')




// Configuration constants
let config = {
  maxMemoryUsage: 100 * 1024 * 1024, // 100MB threshold
  maxJobDuration: 10000, // 10 seconds
  checkInterval: 2000, // how often we check memory/stuck workers
};

let isSpawningPaused = false;
const WORKERS = [];
let historyManager;

// Decide if we're running in parent or child mode
if (process.argv[2] === "child") {

  doWork();
} else {
  // PARENT LOGIC: Start the Fastify server and manage child processes

  // Initialize history manager
  historyManager = new HistoryManager("worker-history.json");


  function spawnWorker(priority = 1) {
    if (isSpawningPaused) {
      fastify.log.info("Spawning is currently paused.");
      return;
    }

    const child = fork(__filename, ["child"]);
    const workerData = {
      pid: child.pid,
      child,
      startTime: Date.now(),
      isDone: false,
      priority,
    };

    child.on("message", (msg) => {
      if (msg.event === "done") {
        fastify.log.info(`Worker ${child.pid} output: ${msg.result}`);
        workerData.isDone = true;
        const historyRecord = {
          pid: workerData.pid,
          startTime: workerData.startTime,
          endTime: Date.now(),
          priority: workerData.priority,
        };
        historyManager.addRecord(historyRecord);
        child.kill();
      }
    });

    child.on("exit", (code, signal) => {
      fastify.log.info(
        `Worker ${child.pid} exited (code: ${code}, signal: ${signal})`
      );
    });

    WORKERS.push(workerData);
  }

  setInterval(() => {
    const memoryUsed = process.memoryUsage().heapUsed;
    fastify.log.debug(`Current memory usage: ${memoryUsed}`);

    if (memoryUsed < config.maxMemoryUsage) {
      if (WORKERS.filter((w) => !w.isDone).length < 5) {
        fastify.log.info("Memory is sufficient, spawning a new worker...");
        spawnWorker();
      }
    }
  }, config.checkInterval);

  setInterval(() => {
    const now = Date.now();
    WORKERS.forEach((workerInfo) => {
      if (
        !workerInfo.isDone &&
        now - workerInfo.startTime > config.maxJobDuration
      ) {
        fastify.log.warn(
          `Worker ${workerInfo.pid} seems stuck, spawning another worker to assist...`
        );
        spawnWorker(workerInfo.priority + 1);
      }
    });
  }, config.checkInterval);

  
  // Cleanup function to be called on server shutdown
  async function cleanup() {
    fastify.log.info("Server shutting down, cleaning up...");
    await historyManager.cleanup();
    process.exit(0);
  }
  
  // Register cleanup handlers
  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);
  
  fastify.register(routes, {
    WORKERS,
    historyManager,
    config,
    spawnWorker,
    isSpawningPaused,
  });
  const start = async () => {
    try {
      // Initialize history manager before starting the server
      await historyManager.initialize();

      await fastify.listen({ port: 9999, host: "0.0.0.0" });
      fastify.log.info("Fastify server is up and running on port 3000");
    } catch (err) {
      fastify.log.error(err);
      process.exit(1);
    }
  };

  start();
}
