/**
 * One function per case the static checks must get right. Each wrapper call ends in a `// case:` marker that
 * the test reads to find the call's line. The code is not meant to run.
 */
const vendor = require("../config/vendor");
const store = require("../config/store");
const { sleep, delay, pRetry, withRetry } = require("./helpers");

const MAX = 3;

// retry-without-idempotency-key

const keyFiresInLoop = async () => {
  for (let attempt = 0; attempt < MAX; attempt += 1) {
    try {
      return await vendor.charge({ amount: 5, timeoutMs: 10 }); // case: key-fires-loop
    } catch (error) {
      if (attempt === MAX - 1) throw error;
      await sleep(10);
    }
  }
  return null;
};

const keyFiresInHelper = async () => pRetry(async () => vendor.charge({ amount: 5 }), { retries: 2 }); // case: key-fires-helper

const keyQuietWithKey = async () => {
  for (let attempt = 0; attempt < MAX; attempt += 1) {
    try {
      return await vendor.charge({ amount: 5, idempotencyKey: "k1" }); // case: key-quiet-key
    } catch (error) {
      if (attempt === MAX - 1) throw error;
      await sleep(10);
    }
  }
  return null;
};

const keyQuietWithHeader = async () =>
  withRetry(async () => {
    await delay({ ms: 10 });
    return vendor.charge({ amount: 5, headers: { "Idempotency-Key": "k2" } }); // case: key-quiet-header
  });

const keyQuietOnRead = async () => {
  while (true) {
    try {
      return await vendor.getBalance({ timeout: 1 }); // case: key-quiet-read
    } catch (error) {
      if (!error.retryable) throw error;
      await sleep(10);
    }
  }
};

const keyQuietNoRetry = async () => vendor.charge({ amount: 5 }); // case: key-quiet-no-retry

const keyQuietLoopWithoutCatch = async () => {
  for (let attempt = 0; attempt < MAX; attempt += 1) {
    await vendor.charge({ amount: 5 }); // case: key-quiet-loop-no-catch
  }
};

// no-timeout

const timeoutFires = async () => vendor.ping(); // case: timeout-fires

const timeoutQuietInCall = async () => vendor.ping({ timeout: 250 }); // case: timeout-quiet-call

const timeoutQuietInMethod = async () => vendor.charge({ amount: 5 }); // case: timeout-quiet-method

const timeoutQuietInModule = async () => store.put({ key: "a" }); // case: timeout-quiet-module

// swallowed-catch

const swallowFires = async () => {
  try {
    await vendor.ping({ timeout: 1 }); // case: swallow-fires
  } catch (error) {
    console.error("ping failed", error);
  }
};

const swallowFiresBareReturn = async () => {
  try {
    await vendor.ping({ timeout: 1 }); // case: swallow-fires-bare-return
  } catch (error) {
    return;
  }
};

const swallowQuietThrows = async () => {
  try {
    await vendor.ping({ timeout: 1 }); // case: swallow-quiet-throw
  } catch (error) {
    throw new Error(`ping failed: ${error.message}`, { cause: error });
  }
};

const swallowQuietReturnsValue = async () => {
  try {
    return await vendor.ping({ timeout: 1 }); // case: swallow-quiet-return
  } catch (error) {
    return "down";
  }
};

const swallowQuietRejects = () => {
  try {
    return vendor.ping({ timeout: 1 }); // case: swallow-quiet-reject
  } catch (error) {
    return Promise.reject(error);
  }
};

const swallowQuietInCatch = async () => {
  try {
    return "fine";
  } catch (error) {
    await vendor.ping({ timeout: 1 }); // case: swallow-quiet-in-catch
  }
};

const swallowQuietFinally = async () => {
  try {
    await vendor.ping({ timeout: 1 }); // case: swallow-quiet-finally
  } finally {
    console.log("done");
  }
};

// retry-without-backoff

const backoffFiresInLoop = async () => {
  for (let attempt = 0; attempt < MAX; attempt += 1) {
    try {
      return await vendor.getBalance({ timeout: 1 }); // case: backoff-fires-loop
    } catch (error) {
      if (attempt === MAX - 1) throw error;
    }
  }
  return null;
};

const backoffFiresInHelper = async () => withRetry(async () => vendor.getBalance({ timeout: 1 })); // case: backoff-fires-helper

const backoffQuietSleep = async () => {
  do {
    try {
      return await vendor.getBalance({ timeout: 1 }); // case: backoff-quiet-sleep
    } catch (error) {
      if (!error.retryable) throw error;
      await sleep(10);
    }
  } while (true);
};

const backoffQuietSetTimeout = async () => {
  for (let attempt = 0; attempt < MAX; attempt += 1) {
    try {
      return await vendor.getBalance({ timeout: 1 }); // case: backoff-quiet-set-timeout
    } catch (error) {
      if (attempt === MAX - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  return null;
};

const backoffQuietDelayInHelper = async () =>
  withRetry(async () => {
    await delay({ ms: 10 });
    return vendor.getBalance({ timeout: 1 }); // case: backoff-quiet-delay-helper
  });

const backoffQuietNoRetry = async () => vendor.getBalance({ timeout: 1 }); // case: backoff-quiet-no-retry

// unawaited-call

const unawaitedFires = () => {
  vendor.ping({ timeout: 1 }); // case: unawaited-fires
  return true;
};

const unawaitedFiresVoid = () => {
  void vendor.ping({ timeout: 1 }); // case: unawaited-fires-void
};

const unawaitedFiresLogical = ({ ok }) => {
  ok && vendor.ping({ timeout: 1 }); // case: unawaited-fires-logical
};

const unawaitedQuietAwait = async () => {
  await vendor.ping({ timeout: 1 }); // case: unawaited-quiet-await
};

const unawaitedQuietReturn = () => {
  return vendor.ping({ timeout: 1 }); // case: unawaited-quiet-return
};

const unawaitedQuietArrowBody = () => vendor.ping({ timeout: 1 }); // case: unawaited-quiet-arrow

const unawaitedQuietAssigned = async () => {
  const pending = vendor.ping({ timeout: 1 }); // case: unawaited-quiet-assigned
  return pending;
};

const unawaitedQuietArgument = async () => Promise.race([vendor.ping({ timeout: 1 })]); // case: unawaited-quiet-argument

const unawaitedQuietThen = () => vendor.ping({ timeout: 1 }).then(() => "pong"); // case: unawaited-quiet-then

const unawaitedQuietCatch = () => {
  vendor.ping({ timeout: 1 }).catch(() => "down"); // case: unawaited-quiet-catch
};

// retry-shape-unknown

const recursesFromCatch = async ({ left = MAX } = {}) => {
  try {
    return await vendor.getBalance({ timeout: 1 }); // case: note-recursive
  } catch (error) {
    if (left === 0) throw error;
    return recursesFromCatch({ left: left - 1 });
  }
};

const callsAnotherFromCatch = async () => {
  try {
    return await vendor.getBalance({ timeout: 1 }); // case: note-quiet-other
  } catch (error) {
    return recursesFromCatch();
  }
};

module.exports = {
  keyFiresInLoop,
  keyFiresInHelper,
  keyQuietWithKey,
  keyQuietWithHeader,
  keyQuietOnRead,
  keyQuietNoRetry,
  keyQuietLoopWithoutCatch,
  timeoutFires,
  timeoutQuietInCall,
  timeoutQuietInMethod,
  timeoutQuietInModule,
  swallowFires,
  swallowFiresBareReturn,
  swallowQuietThrows,
  swallowQuietReturnsValue,
  swallowQuietRejects,
  swallowQuietInCatch,
  swallowQuietFinally,
  backoffFiresInLoop,
  backoffFiresInHelper,
  backoffQuietSleep,
  backoffQuietSetTimeout,
  backoffQuietDelayInHelper,
  backoffQuietNoRetry,
  unawaitedFires,
  unawaitedFiresVoid,
  unawaitedFiresLogical,
  unawaitedQuietAwait,
  unawaitedQuietReturn,
  unawaitedQuietArrowBody,
  unawaitedQuietAssigned,
  unawaitedQuietArgument,
  unawaitedQuietThen,
  unawaitedQuietCatch,
  recursesFromCatch,
  callsAnotherFromCatch,
};
