import { createFfmpegEngine } from "./ffmpeg-engine.js";

function createWorker(id, hooks) {
  const worker = {
    currentItem: null,
    engine: null,
    id,
    startedAt: 0,
  };

  worker.engine = createFfmpegEngine({
    onLog: (message) => {
      hooks.onLog?.(worker, message);
    },
    onProgress: (progress) => {
      hooks.onProgress?.(worker, progress);
    },
  });

  return worker;
}

export function createWorkerPool({ onLog, onProgress } = {}) {
  const workers = [];

  async function ensureSize(count) {
    while (workers.length < count) {
      workers.push(createWorker(workers.length + 1, { onLog, onProgress }));
    }

    while (workers.length > count) {
      const worker = workers.pop();
      worker.engine.terminate();
    }
  }

  async function init(count = 1) {
    await ensureSize(count);
    await Promise.all(workers.slice(0, count).map((worker) => worker.engine.init()));
  }

  function isReady(count = 1) {
    return workers.slice(0, count).every((worker) => worker.engine.isReady());
  }

  function terminateAll() {
    for (const worker of workers) {
      worker.currentItem = null;
      worker.startedAt = 0;
      worker.engine.terminate();
    }
  }

  async function run(items, { parallelism, settings, isCanceled, onStage } = {}) {
    const workerCount = Math.max(1, Number(parallelism) || 1);
    await init(workerCount);

    let nextIndex = 0;

    async function runWorker(worker) {
      while (!isCanceled?.()) {
        const item = items[nextIndex];
        nextIndex += 1;
        if (!item) return;

        worker.currentItem = item;
        worker.startedAt = 0;

        try {
          const result = await worker.engine.convertItem({
            isCanceled,
            item,
            onStage: (stage, payload) => {
              if (stage === "converting") {
                worker.startedAt = Date.now();
              }
              onStage?.({ item, payload, stage, worker });
            },
            settings,
          });

          onStage?.({
            item,
            payload: { result },
            stage: "done",
            worker,
          });
        } catch (error) {
          onStage?.({
            item,
            payload: { error },
            stage: "error",
            worker,
          });

          if (isCanceled?.()) return;
        } finally {
          worker.currentItem = null;
          worker.startedAt = 0;
        }
      }
    }

    await Promise.all(workers.slice(0, workerCount).map((worker) => runWorker(worker)));
  }

  function getActiveWorkers() {
    return workers.filter((worker) => worker.currentItem);
  }

  return {
    getActiveWorkers,
    init,
    isReady,
    run,
    terminateAll,
  };
}
