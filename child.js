

const doWork = () => {
  const startTime = Date.now();
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

module.exports = { doWork };
