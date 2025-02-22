const fastify = require("fastify")({ logger: true });
const { fork } = require("child_process");
const path = require("path");
const HistoryManager = require("./historyManager");

// Register @fastify/view for templating
fastify.register(require("@fastify/view"), {
  engine: {
    ejs: require("ejs"),
  },
  root: path.join(__dirname, "views"),
});

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
  // CHILD LOGIC: Simulate a job that might get stuck
  const startTime = Date.now();

  const doWork = () => {
    let progress = 0;
    const endTime = Date.now() + Math.floor(Math.random() * 5000) + 2000; // up to 7s

    while (Date.now() < endTime) {
      progress++;
    }

    process.send({
      event: "done",
      result: `Worker PID ${process.pid} completed in ~${
        Date.now() - startTime
      }ms.`,
    });
  };

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

  fastify.get("/", (request, reply) => {
    const currentPage = parseInt(request.query.page) || 1;
    const historyPage = parseInt(request.query.historyPage) || 1;
    const itemsPerPage = 10; // Number of items per page

    return reply.view("monitor.ejs", {
      workers: WORKERS,
      activeWorkers: WORKERS.filter((w) => !w.isDone).length,
      totalWorkers: WORKERS.length,
      history: historyManager.getHistory(),
      currentPage,
      historyPage,
      itemsPerPage,
    });
  });

  fastify.post("/config", async (request, reply) => {
    const { maxMemoryUsage, maxJobDuration, checkInterval } = request.body;
    if (maxMemoryUsage) config.maxMemoryUsage = maxMemoryUsage;
    if (maxJobDuration) config.maxJobDuration = maxJobDuration;
    if (checkInterval) config.checkInterval = checkInterval;
    return { status: "Configuration updated", config };
  });

  fastify.post("/create-worker", async (request, reply) => {
    spawnWorker();
    return reply.send({
      activeWorkers: WORKERS.filter((w) => !w.isDone).length,
      totalWorkers: WORKERS.length,
      workers: WORKERS,
      history: historyManager.getHistory(),
    });
  });

  fastify.post("/stop-worker/:pid", async (request, reply) => {
    const pid = parseInt(request.params.pid);
    const worker = WORKERS.find((w) => w.pid === pid && !w.isDone);
    if (worker) {
      worker.child.kill();
      worker.isDone = true;
      const historyRecord = {
        pid: worker.pid,
        startTime: worker.startTime,
        endTime: Date.now(),
        priority: worker.priority,
      };
      historyManager.addRecord(historyRecord);
    }
    return reply.send({
      activeWorkers: WORKERS.filter((w) => !w.isDone).length,
      totalWorkers: WORKERS.length,
      workers: WORKERS,
      history: historyManager.getHistory(),
    });
  });

  fastify.post("/pause-spawning", async (request, reply) => {
    isSpawningPaused = true;
    return reply.send({ status: "Spawning paused" });
  });

  fastify.post("/unpause-spawning", async (request, reply) => {
    isSpawningPaused = false;
    return reply.send({ status: "Spawning unpaused" });
  });

  // Cleanup function to be called on server shutdown
  async function cleanup() {
    fastify.log.info("Server shutting down, cleaning up...");
    await historyManager.cleanup();
    process.exit(0);
  }

  // Register cleanup handlers
  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);

  const start = async () => {
    try {
      // Initialize history manager before starting the server
      await historyManager.initialize();

      await fastify.listen({ port: 3000, host: "0.0.0.0" });
      fastify.log.info("Fastify server is up and running on port 3000");
    } catch (err) {
      fastify.log.error(err);
      process.exit(1);
    }
  };

  start();
}
