// Запись файлов программы. Через временный файл и переименование: при сбое на диске
// остаётся либо старый файл, либо новый целиком, но не половина.
import fs from 'node:fs';
import path from 'node:path';

let tmpCounter = 0;

// Бросает ошибку, если записать не удалось; временный файл убирается.
export function writeFileAtomic(file, text) {
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}-${++tmpCounter}`;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const fd = fs.openSync(tmp, 'w');
    try {
      fs.writeSync(fd, text);
      fs.fsyncSync(fd);
    } finally {
      fs.closeSync(fd);
    }
    fs.renameSync(tmp, file);
  } catch (err) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {}
    throw err;
  }
}

export function writeJsonAtomic(file, data) {
  writeFileAtomic(file, JSON.stringify(data, null, 2) + '\n');
}

// JSON-файл или undefined, если файла нет. Битый — ошибка с понятным текстом.
export function readJson(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return undefined;
  }
  return JSON.parse(text.replace(/^﻿/, ''));
}
