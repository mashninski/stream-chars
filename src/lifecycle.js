// Остановка программы без окна терминала (её запускает скрипт OBS):
// - родитель (OBS) закрылся — процесса с --parent-pid нет, проверка раз в 5 с;
// - файл-сигнал `stop` в папке данных (скрипт OBS выгружен или «Перазапусціць праграму»).
import fs from 'node:fs';
import path from 'node:path';

// Жив ли процесс. EPERM — процесс есть, но чужой: считаем живым.
export function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

// onStop(причина) вызывается один раз. Возвращает функцию, которая снимает таймеры.
// Старый файл `stop` (от прошлого запуска) убирает server.js после того, как занял порт:
// порт свободен — значит, прошлая программа уже вышла и сигнал ничей.
export function watchStop({ dataDir, parentPid, onStop, parentEveryMs = 5000, fileEveryMs = 1000, alive = processAlive }) {
  const stopFile = path.join(dataDir, 'stop');
  let stopped = false;
  const timers = [];
  const stop = (reason) => {
    if (stopped) return;
    stopped = true;
    for (const t of timers) clearInterval(t);
    onStop(reason);
  };
  if (parentPid) {
    timers.push(setInterval(() => {
      if (!alive(parentPid)) stop(`працэсу ${parentPid} (OBS) больш няма`);
    }, parentEveryMs));
  }
  timers.push(setInterval(() => {
    if (!fs.existsSync(stopFile)) return;
    try {
      fs.rmSync(stopFile, { force: true });
    } catch {}
    stop('файл-сігнал stop');
  }, fileEveryMs));
  return () => timers.forEach(clearInterval);
}

export function clearStopFile(dataDir) {
  try {
    fs.rmSync(path.join(dataDir, 'stop'), { force: true });
  } catch {}
}
