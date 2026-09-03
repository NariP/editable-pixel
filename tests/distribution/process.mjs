import spawn from "cross-spawn";

export { spawn };

// Keep argument arrays intact, including npm .cmd launchers on Windows.
export function execFile(command, args, options = {}) {
  const { encoding = "utf8", maxBuffer = 20 * 1024 * 1024, ...spawnOptions } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...spawnOptions, windowsHide: true, stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout = [];
    const stderr = [];
    let size = 0;
    const collect = (chunks) => (chunk) => {
      size += chunk.length;
      if (size > maxBuffer) {
        child.kill();
        reject(new Error(`${command} exceeded the output limit.`));
      } else chunks.push(chunk);
    };
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.once("error", reject);
    child.once("close", (code, signal) => {
      const result = {
        stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr)
      };
      if (encoding !== "buffer") {
        result.stdout = result.stdout.toString(encoding);
        result.stderr = result.stderr.toString(encoding);
      }
      if (code === 0) resolve(result);
      else reject(Object.assign(new Error(`${command} failed (${code ?? signal}).\n${result.stderr}`), result, { code, signal }));
    });
  });
}
