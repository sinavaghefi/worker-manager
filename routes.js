module.exports = async function routes(fastify, options) {
  const { WORKERS, historyManager, config, spawnWorker } = options;
  let { isSpawningPaused } = options;

  fastify.get("/", (request, reply) => {
    const currentPage = parseInt(request.query.page) || 1;
    const historyPage = parseInt(request.query.historyPage) || 1;
    const itemsPerPage = 10;

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
    const pid = parseInt(request.params.pid, 10);
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
};
