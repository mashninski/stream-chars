// .env.local — секреты и ключи вне git (Client ID Twitch). Формат: строки КЛЮЧ=значение, # — комментарий.
// Чтение и запись одного ключа; остальные строки файла сохраняются как были.
import fs from 'node:fs';
import { writeFileAtomic } from './files.js';

export function readEnvFile(file) {
  let text = '';
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return {};
  }
  const out = {};
  for (const line of text.replace(/^﻿/, '').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
  return out;
}

// Записать КЛЮЧ=значение: есть строка — заменить, нет — добавить. value null — удалить строку.
export function setEnvValue(file, key, value) {
  let lines = [];
  try {
    lines = fs.readFileSync(file, 'utf8').replace(/^﻿/, '').split(/\r?\n/);
  } catch {}
  if (lines.at(-1) === '') lines.pop();
  const re = new RegExp(`^\\s*${key}\\s*=`);
  const i = lines.findIndex((l) => re.test(l));
  if (value === null) {
    if (i >= 0) lines.splice(i, 1);
  } else if (i >= 0) lines[i] = `${key}=${value}`;
  else lines.push(`${key}=${value}`);
  writeFileAtomic(file, lines.join('\n') + '\n');
}
