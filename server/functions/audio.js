import { safeSend } from "./helper.js";

export function handleRequestAudio(ws, msg) {
  console.log(`Audio list requested by player: ${msg.playerName}`);

  let audios = [
    {
      name: "Sample Audio 1",
      url: "https://example.com/audio1.mp3",
      key: "audio1.mp3",
    },
    {
      name: "Sample Audio 2",
      url: "https://example.com/audio2.mp3",
      key: "audio2.mp3",
    },
  ];

  safeSend(ws, {
    type: "AUDIO_LIST",
    playerName: msg.playerName,
    audios,
  });
}
