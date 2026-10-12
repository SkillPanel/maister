/**
 * A document read whole from stdin, without ever waiting on it for ever.
 *
 * A synchronous read of fd 0 blocks until the writer ends the stream, and a
 * writer that never does — a pipe or socket left open by whatever spawned the
 * verb, or a terminal nobody types into — leaves the verb idle for good, with
 * nothing on screen to say why. So stdin is read asynchronously to its end,
 * under a bound on silence: no byte and no end within `idleMs` is refused, and
 * the stream is destroyed so the process can exit. The bound runs from the last
 * byte, so a slow but steady writer is never cut off, and a document that
 * arrived without its end is refused rather than guessed complete. A terminal
 * is never read at all: a patch is never typed.
 *
 * The bytes are decoded once, after the end, exactly as `readFileSync(0,
 * 'utf8')` decodes them, so one document lands the same bytes whether it came
 * by pipe, by here-string or from a file. Zero dependencies, `node:` builtins
 * only, Node >= 20. Shared by the workflow engine and the umbrella runtime,
 * whose verbs take a JSON document on stdin, so it sits at the plugin root
 * rather than inside either skill. Each entry point keeps its own parse and its
 * own usage error; this module owns only the read and its bound.
 */

/**
 * How long stdin may stay silent, without ending, before the document on it is
 * refused. A here-string or a pipe delivers at once, so this only ever bounds a
 * writer that will never finish. The variable exists for the tests, which wait
 * on the bound and would otherwise take this long.
 */
export const STDIN_IDLE_MS = Number(process.env.MAISTER_STDIN_IDLE_MS) > 0 ? Number(process.env.MAISTER_STDIN_IDLE_MS) : 10_000;

/**
 * `{text}` once the stream ends; `{refused: 'tty', bytes: 0}` for a terminal,
 * never read; `{refused: 'idle', bytes}` when nothing more arrived for
 * `idleMs`, with the byte count received so far.
 */
export function readStdin({ stream = process.stdin, idleMs = STDIN_IDLE_MS } = {}) {
  if (stream.isTTY) return Promise.resolve({ refused: 'tty', bytes: 0 });
  return new Promise((resolve, reject) => {
    const chunks = [];
    let bytes = 0;
    let timer = null;
    const settle = (outcome, value) => {
      clearTimeout(timer);
      stream.off('data', onData);
      stream.off('end', onEnd);
      stream.off('error', onError);
      outcome(value);
    };
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        settle(resolve, { refused: 'idle', bytes });
        stream.destroy();
      }, idleMs);
    };
    const onData = chunk => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      chunks.push(buffer);
      bytes += buffer.length;
      arm();
    };
    const onEnd = () => settle(resolve, { text: Buffer.concat(chunks).toString('utf8') });
    const onError = err => settle(reject, err);
    stream.on('data', onData);
    stream.on('end', onEnd);
    stream.on('error', onError);
    arm();
  });
}
