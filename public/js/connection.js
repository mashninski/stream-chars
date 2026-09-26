// Подключение к программе по WebSocket с переподключением: программу перезапустили —
// страница сама подключится снова и получит текущий список.
export function connect(onMessage, onStatus = () => {}) {
  let ws;
  const open = () => {
    ws = new WebSocket(`ws://${location.host}/ws`);
    ws.onopen = () => onStatus(true);
    ws.onmessage = (e) => onMessage(JSON.parse(e.data));
    ws.onclose = () => {
      onStatus(false);
      setTimeout(open, 2000);
    };
  };
  open();
  return (msg) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  };
}
