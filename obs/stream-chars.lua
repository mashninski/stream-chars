-- stream-chars: скрипт OBS. Подключается один раз: OBS → «Сервис» → «Скрипты» → «+» → этот файл.
-- Дальше при каждом запуске OBS скрипт незаметно (без окна терминала) запускает программу
-- (node src/server.js --parent-pid <OBS>), а при выгрузке скрипта или закрытии OBS программа выходит
-- (файл-сигнал stop в папке данных; закрыли OBS — программа видит, что процесса нет).
-- В свойствах скрипта: путь к Node.js, порт, «Дадаць аверлэй у сцэну», «Абнавіць аверлэй»,
-- «Перазапусціць праграму», подсказка про док-панели. Ошибки — в журнал скриптов OBS, OBS не падает.
--
-- Windows: процесс запускается через WinAPI (LuaJIT FFI: CreateProcessW с CREATE_NO_WINDOW),
-- не через os.execute — тот открыл бы окно терминала.

obs = obslua
local ffi = require("ffi")

ffi.cdef([[
typedef struct {
  uint32_t cb; void* lpReserved; void* lpDesktop; void* lpTitle;
  uint32_t dwX, dwY, dwXSize, dwYSize, dwXCountChars, dwYCountChars, dwFillAttribute, dwFlags;
  uint16_t wShowWindow, cbReserved2; void* lpReserved2;
  void* hStdInput; void* hStdOutput; void* hStdError;
} SC_STARTUPINFOW;
typedef struct { void* hProcess; void* hThread; uint32_t dwProcessId; uint32_t dwThreadId; } SC_PROCESS_INFORMATION;
int CreateProcessW(const uint16_t* app, uint16_t* cmd, void* pa, void* ta, int inherit, uint32_t flags,
                   void* env, const uint16_t* cwd, SC_STARTUPINFOW* si, SC_PROCESS_INFORMATION* pi);
uint32_t GetCurrentProcessId(void);
int CloseHandle(void* h);
uint32_t WaitForSingleObject(void* h, uint32_t ms);
int GetExitCodeProcess(void* h, uint32_t* code);
int MultiByteToWideChar(uint32_t cp, uint32_t flags, const char* str, int cb, uint16_t* wstr, int cch);
uint32_t GetFileAttributesW(const uint16_t* path);
void* CreateFileW(const uint16_t* name, uint32_t access, uint32_t share, void* sa, uint32_t disp, uint32_t flags, void* tmpl);
int ReadFile(void* h, void* buf, uint32_t n, uint32_t* read, void* ov);
uint32_t GetLastError(void);
]])

local k32 = ffi.C
local CREATE_NO_WINDOW = 0x08000000
local STILL_ACTIVE = 259
local WAIT_TIMEOUT = 0x102
local INVALID_ATTR = 0xFFFFFFFF
local SOURCE_NAME = "stream-chars"

-- Состояние скрипта.
local root = nil           -- папка проекта (на уровень выше obs/)
local node_setting = ""    -- путь к node.exe из свойств (пусто — искать самому)
local port = 4700
local proc = nil           -- { handle, pid, started (os.time()) } — программа, которую запустил скрипт
local retries = 0
local last_state = "праграма не запушчана"

local function log(level, text)
  obs.script_log(level, "[stream-chars] " .. text)
end

-- UTF-8 → UTF-16 (строка для WinAPI, с нулём в конце).
local function wide(s)
  local n = k32.MultiByteToWideChar(65001, 0, s, -1, nil, 0)
  local buf = ffi.new("uint16_t[?]", n)
  k32.MultiByteToWideChar(65001, 0, s, -1, buf, n)
  return buf
end

local function exists(path)
  return k32.GetFileAttributesW(wide(path)) ~= INVALID_ATTR
end

local function invalid(h)
  return h == nil or ffi.cast("intptr_t", h) == -1
end

-- Прочитать файл целиком (пути с кириллицей: io.open их не открывает).
local function read_file(path)
  local h = k32.CreateFileW(wide(path), 0x80000000, 1, nil, 3, 0x80, nil) -- GENERIC_READ, SHARE_READ, OPEN_EXISTING
  if invalid(h) then return nil end
  local parts = {}
  local buf = ffi.new("uint8_t[4096]")
  local got = ffi.new("uint32_t[1]")
  while k32.ReadFile(h, buf, 4096, got, nil) ~= 0 and got[0] > 0 do
    parts[#parts + 1] = ffi.string(buf, got[0])
  end
  k32.CloseHandle(h)
  return table.concat(parts)
end

-- Создать пустой файл (файл-сигнал stop).
local function touch(path)
  local h = k32.CreateFileW(wide(path), 0x40000000, 0, nil, 2, 0x80, nil) -- GENERIC_WRITE, CREATE_ALWAYS
  if invalid(h) then return false end
  k32.CloseHandle(h)
  return true
end

local function join(a, b)
  return (a:gsub("[/\\]$", "")) .. "\\" .. b
end

-- Папка проекта: скрипт лежит в <проект>\obs\. OBS вызывает функции скрипта в разном порядке
-- (script_defaults бывает раньше script_load) — считаем при первой надобности.
local function project_root()
  if not root then
    root = script_path():gsub("[/\\]+$", ""):gsub("[/\\]obs$", ""):gsub("/", "\\")
  end
  return root
end

-- Порт по умолчанию: config.json, поверх — data/settings.json (если порт меняли в админке).
local function port_from_config()
  project_root()
  local p = 4700
  for _, file in ipairs({ join(root, "config.json"), join(join(root, "data"), "settings.json") }) do
    local text = read_file(file)
    local found = text and text:match('"port"%s*:%s*(%d+)')
    if found then p = tonumber(found) end
  end
  return p
end

-- node.exe: из свойств → из PATH → C:\Program Files\nodejs\node.exe.
local function find_node()
  if node_setting ~= "" then
    if exists(node_setting) then return node_setting end
    log(obs.LOG_WARNING, "Node.js па шляху з налад не знойдзены: " .. node_setting .. " — шукаю сам")
  end
  for dir in (os.getenv("PATH") or ""):gmatch("[^;]+") do
    local candidate = join(dir:gsub('"', ""), "node.exe")
    if exists(candidate) then return candidate end
  end
  local default = "C:\\Program Files\\nodejs\\node.exe"
  if exists(default) then return default end
  return nil
end

local function running()
  if not proc then return false end
  if k32.WaitForSingleObject(proc.handle, 0) == WAIT_TIMEOUT then return true end
  return false
end

local function exit_code()
  local code = ffi.new("uint32_t[1]")
  if proc and k32.GetExitCodeProcess(proc.handle, code) ~= 0 then return code[0] end
  return nil
end

local function forget_process()
  if proc then k32.CloseHandle(proc.handle) end
  proc = nil
end

local function start_program()
  if running() then
    log(obs.LOG_INFO, "праграма ўжо працуе")
    return true
  end
  forget_process()
  local node = find_node()
  if not node then
    last_state = "не знойдзены Node.js — пакажыце шлях да node.exe ў наладах скрыпта"
    log(obs.LOG_WARNING, last_state)
    return false
  end
  local server = join(join(root, "src"), "server.js")
  if not exists(server) then
    last_state = "не знойдзены " .. server .. " — скрыпт павінен ляжаць у папцы obs праекта"
    log(obs.LOG_WARNING, last_state)
    return false
  end
  local cmd = string.format('"%s" "%s" --parent-pid %d --port %d', node, server, k32.GetCurrentProcessId(), port)
  local si = ffi.new("SC_STARTUPINFOW")
  si.cb = ffi.sizeof(si)
  local pi = ffi.new("SC_PROCESS_INFORMATION")
  local ok = k32.CreateProcessW(nil, wide(cmd), nil, nil, 0, CREATE_NO_WINDOW, nil, wide(root), si, pi)
  if ok == 0 then
    last_state = "не атрымалася запусціць праграму (памылка Windows " .. k32.GetLastError() .. ")"
    log(obs.LOG_WARNING, last_state)
    return false
  end
  k32.CloseHandle(pi.hThread)
  proc = { handle = pi.hProcess, pid = pi.dwProcessId, started = os.time() }
  last_state = "праграма працуе (працэс " .. pi.dwProcessId .. ", порт " .. port .. ")"
  log(obs.LOG_INFO, "запушчана: " .. cmd)
  return true
end

-- Попросить программу выйти: файл stop в папке данных. wait_ms — сколько ждать своего процесса.
local function stop_program(wait_ms)
  local data = join(root, "data")
  if not touch(join(data, "stop")) then
    log(obs.LOG_WARNING, "не атрымалася стварыць файл " .. join(data, "stop"))
  end
  if proc and wait_ms and wait_ms > 0 then
    k32.WaitForSingleObject(proc.handle, wait_ms)
  end
  forget_process()
  last_state = "праграма спынена"
end

-- Раз в 5 с: не упала ли программа. Код 0 сразу после запуска — порт был занят (старая программа
-- ещё выходила или уже работает другая): пробуем ещё раз через 6 с, не больше двух раз.
local function watch()
  if not proc or running() then return end
  local code = exit_code()
  local quick = os.time() - proc.started < 10
  forget_process()
  if code == 0 and quick and retries < 2 then
    retries = retries + 1
    last_state = "порт " .. port .. " быў заняты — яшчэ адна спроба"
    log(obs.LOG_INFO, last_state)
    obs.timer_add(function()
      obs.remove_current_callback()
      start_program()
    end, 6000)
  elseif code ~= 0 then
    last_state = "праграма спынілася з памылкай (код " .. tostring(code) .. "). Журнал — data\\logs. Кнопка «Перазапусціць праграму»."
    log(obs.LOG_WARNING, last_state)
  else
    last_state = "праграма спынілася"
    log(obs.LOG_INFO, last_state)
  end
end

local function overlay_url()
  return "http://localhost:" .. port .. "/overlay"
end

-- «Дадаць аверлэй у сцэну»: Browser Source stream-chars 1920×1080 в текущую сцену, без дублей.
local function add_overlay()
  local current = obs.obs_frontend_get_current_scene()
  if current == nil then
    log(obs.LOG_WARNING, "няма бягучай сцэны")
    return false
  end
  local scene = obs.obs_scene_from_source(current)
  if obs.obs_scene_find_source(scene, SOURCE_NAME) ~= nil then
    log(obs.LOG_INFO, "аверлэй ужо ёсць у гэтай сцэне")
    obs.obs_source_release(current)
    return false
  end
  local source = obs.obs_get_source_by_name(SOURCE_NAME)
  if source == nil then
    local settings = obs.obs_data_create()
    obs.obs_data_set_string(settings, "url", overlay_url())
    obs.obs_data_set_int(settings, "width", 1920)
    obs.obs_data_set_int(settings, "height", 1080)
    source = obs.obs_source_create("browser_source", SOURCE_NAME, settings, nil)
    obs.obs_data_release(settings)
  end
  if source == nil then
    log(obs.LOG_WARNING, "не атрымалася стварыць крыніцу «Браўзер» — ці ўсталяваны browser source у OBS?")
  else
    obs.obs_scene_add(scene, source)
    obs.obs_source_release(source)
    log(obs.LOG_INFO, "аверлэй дададзены ў сцэну: " .. overlay_url())
  end
  obs.obs_source_release(current)
  return false
end

-- «Абнавіць аверлэй»: кнопка источника «Обновить кэш текущей страницы» (refreshnocache).
local function refresh_overlay()
  local source = obs.obs_get_source_by_name(SOURCE_NAME)
  if source == nil then
    log(obs.LOG_WARNING, "крыніцы «" .. SOURCE_NAME .. "» няма — спачатку «Дадаць аверлэй у сцэну»")
    return false
  end
  local props = obs.obs_source_properties(source)
  local button = obs.obs_properties_get(props, "refreshnocache")
  if button ~= nil then
    obs.obs_property_button_clicked(button, source)
    log(obs.LOG_INFO, "аверлэй абноўлены")
  end
  obs.obs_properties_destroy(props)
  obs.obs_source_release(source)
  return false
end

-- Повторные нажатия, пока перезапуск идёт, пропускаются: иначе каждое — ещё одна остановка.
local restarting = false
local function restart_program()
  if restarting then return false end
  restarting = true
  stop_program(5000)
  retries = 0
  last_state = "перазапуск… (праз 3 с — «Праверыць стан»)"
  -- Своего процесса могло и не быть (программу запускали руками) — даём ей время выйти.
  obs.timer_add(function()
    obs.remove_current_callback()
    restarting = false
    start_program()
  end, 2500)
end

-- ---------- функции скрипта OBS ----------

function script_description()
  return "<b>stream-chars</b> — героі гледачоў на стрыме.<br>" ..
    "Праграма запускаецца сама разам з OBS і спыняецца разам з ім.<br>" ..
    "Адмін-панэль: «Док-панэлі» → «Карыстальніцкія док-панэлі браўзера» → адрас <code>http://localhost:" ..
    port .. "/admin</code>."
end

-- Строка «Стан» в открытом окне свойств. OBS после кнопки (return true) перерисовывает
-- уже созданные свойства, script_properties заново не вызывает — текст меняем сами.
local function show_state(props)
  local p = obs.obs_properties_get(props, "state")
  if p ~= nil then obs.obs_property_set_description(p, "Стан: " .. last_state) end
  return true
end

function script_properties()
  local props = obs.obs_properties_create()
  obs.obs_properties_add_text(props, "state", "Стан: " .. last_state, obs.OBS_TEXT_INFO)
  obs.obs_properties_add_path(props, "node_path", "Шлях да Node.js (пуста — знайсці самому)", obs.OBS_PATH_FILE, "node.exe (node.exe)", nil)
  obs.obs_properties_add_int(props, "port", "Порт праграмы", 1024, 65535, 1)
  obs.obs_properties_add_button(props, "add_overlay", "Дадаць аверлэй у сцэну", function() return add_overlay() end)
  obs.obs_properties_add_button(props, "refresh_overlay", "Абнавіць аверлэй", function() return refresh_overlay() end)
  obs.obs_properties_add_button(props, "restart", "Перазапусціць праграму", function(p) restart_program() return show_state(p) end)
  obs.obs_properties_add_button(props, "check", "Праверыць стан", function(p) watch() return show_state(p) end)
  obs.obs_properties_add_text(props, "docks", "Адмін-панэль і вокны «Персанажы», «Рэдкасць» — док-панэлі OBS:\n" ..
    "«Док-панэлі» → «Карыстальніцкія док-панэлі браўзера…»,\n" ..
    "stream-chars — http://localhost:" .. port .. "/admin\n" ..
    "stream-chars персанажы — http://localhost:" .. port .. "/admin/viewers\n" ..
    "stream-chars рэдкасць — http://localhost:" .. port .. "/admin/weights", obs.OBS_TEXT_INFO)
  return props
end

function script_defaults(settings)
  obs.obs_data_set_default_string(settings, "node_path", "")
  obs.obs_data_set_default_int(settings, "port", port_from_config())
end

function script_update(settings)
  node_setting = obs.obs_data_get_string(settings, "node_path")
  local new_port = obs.obs_data_get_int(settings, "port")
  if new_port ~= port and proc then
    port = new_port
    log(obs.LOG_INFO, "порт зменены на " .. port .. " — перазапуск праграмы")
    restart_program()
  else
    port = new_port
  end
end

function script_load(settings)
  local ok, err = pcall(function()
    project_root()
    node_setting = obs.obs_data_get_string(settings, "node_path")
    port = obs.obs_data_get_int(settings, "port")
    if port == 0 then port = port_from_config() end
    start_program()
    obs.timer_add(watch, 5000)
  end)
  if not ok then log(obs.LOG_WARNING, "памылка пры запуску скрыпта: " .. tostring(err)) end
end

function script_unload()
  pcall(function()
    obs.timer_remove(watch)
    -- Ждём выхода (до 3 с): при перезагрузке скрипта новый запуск иначе упирается в занятый порт.
    stop_program(3000)
  end)
end
