// 任意の設定（GitHub Pages など P2P 接続時に使用）。
// つながりにくい環境（携帯回線・社内ネットワークなど）では TURN サーバーを追加すると改善します。
// 何も書かなければ、STUN と PeerJS の無料 TURN 中継を使います。
// iceServers を書くとその内容だけを使うので、自前の TURN を足すときは STUN も一緒に書いてください。
window.LIARS_TABLE_CONFIG = {
  // iceServers: [
  //   { urls: 'stun:stun.l.google.com:19302' },
  //   { urls: 'turn:YOUR_TURN_HOST:3478', username: 'USER', credential: 'PASS' },
  // ],
  // 自前の PeerJS サーバーを使う場合（https://github.com/peers/peerjs-server）
  // peerServer: { host: 'your-peer-server.example.com', port: 443, path: '/', secure: true },
};
