// Runs at most `limit` jobs at once. Urgent jobs start before background ones; a background job that turns urgent
// while it waits is moved up (`promote`). A job is a function returning a promise, started when its turn comes.
export function createQueue(limit) {
  const urgent = [];
  const background = [];
  let active = 0;

  function pump() {
    while (active < limit) {
      const job = urgent.shift() ?? background.shift();
      if (!job) return;
      job.waiting = false;
      active += 1;
      let result;
      try {
        result = Promise.resolve(job.start());
      } catch (error) {
        result = Promise.reject(error);
      }
      result.then(job.resolve, job.reject).finally(() => {
        active -= 1;
        pump();
      });
    }
  }

  function add(start, isUrgent = false) {
    const job = { start, waiting: true };
    job.promise = new Promise((resolve, reject) => {
      job.resolve = resolve;
      job.reject = reject;
    });
    (isUrgent ? urgent : background).push(job);
    pump();
    return {
      promise: job.promise,
      promote() {
        if (!job.waiting) return;
        const at = background.indexOf(job);
        if (at < 0) return;
        background.splice(at, 1);
        urgent.push(job);
      },
    };
  }

  return { add, get running() { return active; }, get waiting() { return urgent.length + background.length; } };
}
