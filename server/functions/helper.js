export function safeSend(ws, data) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(data));
}
