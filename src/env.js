// Где программа держит данные и на каком порту работает — из аргументов и переменных окружения.
// Для проверок и разработки: другая папка данных и другой порт, чтобы не трогать настоящие.
//   --data-dir <папка>   или STREAM_CHARS_DATA_DIR  (по умолчанию data/ в папке проекта)
//   --port <число>       или STREAM_CHARS_PORT      (по умолчанию из настроек)
//   --parent-pid <число>                             (скрипт OBS: процесса нет — программа выходит)
//   --env-local <файл>   или STREAM_CHARS_ENV_LOCAL (по умолчанию .env.local в папке проекта)
// Аргумент важнее переменной окружения.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function arg(name, argv) {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < argv.length) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith(`--${name}=`));
  return eq?.slice(name.length + 3);
}

function positiveInt(v) {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

export function readEnv(argv = process.argv.slice(2), env = process.env) {
  const dataDir = arg('data-dir', argv) ?? env.STREAM_CHARS_DATA_DIR;
  const port = arg('port', argv) ?? env.STREAM_CHARS_PORT;
  const parentPid = arg('parent-pid', argv);
  const envFile = arg('env-local', argv) ?? env.STREAM_CHARS_ENV_LOCAL;
  return {
    dataDir: dataDir ? path.resolve(dataDir) : path.join(root, 'data'),
    port: port === undefined ? undefined : positiveInt(port),
    portGiven: port !== undefined,
    parentPid: parentPid === undefined ? undefined : positiveInt(parentPid),
    envFile: envFile ? path.resolve(envFile) : path.join(root, '.env.local'),
  };
}
