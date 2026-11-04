// ルール説明（図解つき）とクイックガイド
import { dieHTML, cardHTML } from './util.js';

const chambers = (fired, live = -1) => {
  let h = '<span class="chambers">';
  for (let i = 0; i < 6; i++) h += `<i class="${i < fired ? 'spent' : ''} ${i === live ? 'live' : ''}"></i>`;
  return h + '</span>';
};
const back = (n) => Array.from({ length: n }, () => '<span class="mini-card back"><b></b></span>').join('');

export const RULES_TABS = [
  {
    id: 'basic', label: '基本',
    html: `
      <p class="lead">最大4人でテーブルを囲み、<b>嘘</b>と<b>見破り</b>で生き残りを競うデスゲームです。</p>
      <div class="example"><b>勝利条件</b><br>・<b>最後の1人まで生き残る</b>（カード・ダイス共通）<br>・カードで<b>手札を出し切り、次の人に告発されなかったら「あがり」</b> → 出し切った人以外の全員がリボルバーを撃つ</div>
      <div class="rule-grid">
        <div class="rule-box"><div class="rb-ico">🃏</div><b>カード</b><br>嘘がバレたら（または冤罪なら）<br>自分にリボルバーを撃つ</div>
        <div class="rule-box"><div class="rb-ico">🎲</div><b>ダイス</b><br>ベットの読み合いに負けたら<br>毒を飲む</div>
      </div>
      <h4>流れ</h4>
      <ol class="steps">
        <li>席はゲームごとに<b>ランダム</b>に決まります。順番は時計回り（あなたの<b>左隣</b>が次の人）。</li>
        <li>手番では「出す・ベットする」か、直前の人を<b>「ライアー！」</b>と告発します。</li>
        <li>告発できるのは<b>次の順番の人だけ</b>。</li>
        <li>負けた人がペナルティを受け、新しいラウンドが始まります。</li>
        <li>死亡すると観戦になります。観戦中は<b>生きている全員の手札・ダイスが頭の上に見えます</b>（見えるのは死亡した人だけ）。</li>
      </ol>
      <p class="note">手番には30秒の制限時間があります。時間切れになると自動で行動します。</p>`,
  },
  {
    id: 'card', label: 'カード',
    html: `
      <h4>使うカード（20枚）</h4>
      <div class="deck-row">${cardHTML('A')}<span>×6</span>${cardHTML('K')}<span>×6</span>${cardHTML('Q', '')}<span>×6</span>${cardHTML('J')}<span>×2</span></div>
      <p>全員に5枚ずつ配られます。<b>ジョーカーはどのカードの代わりにもなり、絶対に嘘になりません。</b></p>
      <h4>① テーブルカードが決まる</h4>
      <p>ラウンドごとに <b>A・K・Q</b> のどれかが「テーブルカード」になります（例：<b>Kのテーブル</b>）。</p>
      <h4>② 1〜5枚を裏向きで出す</h4>
      <div class="example">
        <div class="ex-row">${back(2)}<span class="say">「Kを2枚」</span></div>
        <p>出したカードはすべて「K」と宣言したことになります。本当は違うカードでもOK（それが嘘）。</p>
      </div>
      <h4>③ 次の人は「出す」か「ライアー！」</h4>
      <div class="rule-grid">
        <div class="rule-box bad"><div class="ex-row">${cardHTML('K')}${cardHTML('Q')}</div><b>嘘が混ざっていた</b><br>→ <b>出した人</b>が撃つ</div>
        <div class="rule-box good"><div class="ex-row">${cardHTML('K')}${cardHTML('J')}</div><b>全部本物（ジョーカー含む）</b><br>→ <b>告発した人</b>が撃つ</div>
      </div>
      <h4>④ リボルバー（ロシアンルーレット）</h4>
      <p>各自のリボルバーは<b>6発中1発が実弾</b>。生き残るたびに次の死亡率が上がります。頭の上の「残り○/6」が目安です。</p>
      <table class="odds"><tr><th>引き金</th><td>1回目</td><td>2回目</td><td>3回目</td><td>4回目</td><td>5回目</td><td>6回目</td></tr>
      <tr><th>死亡率</th><td>1/6</td><td>1/5</td><td>1/4</td><td>1/3</td><td>1/2</td><td>確実</td></tr></table>
      <div class="ex-row center">${chambers(2)}<span class="say">残り 4/6</span></div>
      <h4>⑤ あがり</h4>
      <div class="example">
        <p>手札を<b>全部出し切った</b>あと、次の人が「ライアー！」と言わずにカードを出したら<b>あがり</b>。<b>出し切った人以外の全員が、順番にリボルバーを自分に撃ちます</b>（見逃した人から）。最後のカードが嘘でも、見逃されればあがりです。</p>
        <p>自分が出し切れば他の3人が全員撃ち、相手が出し切ればその人以外の全員（自分も）が撃ちます。撃ち終わったら次のラウンドへ。</p>
        <p>次の人が「ライアー！」と言った場合は通常どおり判定します（嘘なら撃つ、本物なら告発した人が撃つ）。</p>
      </div>
      <h4>その他</h4>
      <ul>
        <li>手札がなくなった人は、そのラウンドは順番が飛ばされます。</li>
        <li>自分以外の全員が手札切れになると、最後に出されたカードは<b>自動的に告発</b>されます。</li>
        <li>撃った後は、新しいテーブルカードで全員に配り直します。</li>
      </ul>`,
  },
  {
    id: 'dice', label: 'ダイス',
    html: `
      <h4>① 全員が5個のダイスを振る</h4>
      <p>カップの中で振ります。<b>自分のダイスだけ</b>見えます。</p>
      <h4>② ベット（宣言）する</h4>
      <div class="example"><div class="ex-row"><span class="say">「${dieHTML(3)} が全部で <b>5個</b> 以上ある」</span></div>
      <p>テーブル全体（全員分）で、その目が最低何個あるかを宣言します。</p></div>
      <h4>③ 次の人は「上乗せ」か「ライアー！」</h4>
      <p>上乗せは <b>個数を増やす</b> か、<b>同じ個数でより大きい目</b> にします。<br><b>個数を増やすなら、目はどれでもOK</b>です（小さい目に戻してもかまいません）。</p>
      <div class="raise">
        <div><span class="tag">いまのベット</span> 5個 × ${dieHTML(3)}</div>
        <div class="ok">○ 5個 × ${dieHTML(4)}（同じ個数で大きい目）</div>
        <div class="ok">○ 6個 × ${dieHTML(2)}（個数を増やせば目は自由）</div>
        <div class="ng">× 5個 × ${dieHTML(2)}（小さい目）</div>
        <div class="ng">× 4個 × ${dieHTML(6)}（個数が減っている）</div>
      </div>
      <div class="example"><div>例：「${dieHTML(6)} が2個」の次は…</div>
        <div class="ok">○ 3個以上なら ${dieHTML(1)}${dieHTML(2)}${dieHTML(3)}${dieHTML(4)}${dieHTML(5)}${dieHTML(6)} どの目でもOK</div>
        <div class="ng">× 2個のまま（6より大きい目はないので不可）</div></div>
      <h4>④ 数えるのは宣言した目だけ</h4>
      <p>公開したら、<b>宣言した目と同じ目だけ</b>を数えます。${dieHTML(1)} もふつうの目で、ほかの目の代わりにはなりません。</p>
      <div class="example count">
        <div>ベット「${dieHTML(3)} が4個以上」→ 公開すると…</div>
        <div class="ex-row">${[3, 1, 5, 6, 2].map(v => dieHTML(v, v === 3 ? 'hit' : '')).join('')}</div>
        <div class="ex-row">${[4, 3, 3, 6, 5].map(v => dieHTML(v, v === 3 ? 'hit' : '')).join('')}</div>
        <div class="ex-row">${[2, 2, 6, 4, 1].map(v => dieHTML(v, v === 3 ? 'hit' : '')).join('')}</div>
        <div>${dieHTML(3)}×3 ＝ <b>3個</b>（${dieHTML(1)} は数えない）→ 4個に足りないので宣言はウソ</div>
      </div>
      <h4>⑤ ペナルティ（毒）</h4>
      <div class="rule-grid">
        <div class="rule-box bad"><b>実際が宣言より少ない</b><br>→ <b>宣言した人</b>が毒を飲む</div>
        <div class="rule-box good"><b>実際が宣言以上</b><br>→ <b>告発した人</b>が毒を飲む</div>
      </div>
      <p>毒は1人2本。<b>1本目は耐えられますが、2本目で死亡</b>します。</p>`,
  },
  {
    id: 'ctrl', label: '操作',
    html: `
      <ul class="ctrl">
        <li><b>視点</b>：画面をドラッグ（PCは矢印キーも可）。あなたの頭の動きは他の人にもそのまま見えます。右を向けば、正面の人からは左を向いて見えます。</li>
        <li><b>カードを出す</b>：手札をタップして選択（最大5枚）→「出す」。</li>
        <li><b>ベット</b>：「−／＋」で個数、ダイスの絵で目を選び →「ベット」。</li>
        <li><b>ライアー！</b>：直前の人を告発します。</li>
        <li><b>メニュー（≡）</b>：サウンド、画質、ヒント表示、ルール、退出。</li>
      </ul>
      <h4>オンライン対戦</h4>
      <ul>
        <li>1人が「ロビーを作成」し、<b>ロビーIDとパスワード</b>を友達に伝えます。</li>
        <li>空いている席はCPUで埋められます。</li>
        <li>他人の手札・ダイスは本人だけが読める暗号で送られ、あなたの端末には届きません。</li>
      </ul>`,
  },
];

export const QUICK = {
  card: [
    { t: '目的', b: '最後の1人まで生き残ること。嘘がバレるか、冤罪で告発すると、自分にリボルバーを撃ちます。手札を出し切って告発されなければ「あがり」で、ほかの全員が撃ちます。' },
    { t: '自分の番', b: 'テーブルカード（A/K/Qのどれか）と同じカードを1〜5枚選んで「出す」。本当は違うカードでも出せます。ジョーカーは常に本物扱い。' },
    { t: '疑うなら', b: '前の人の宣言が怪しければ「ライアー！」。嘘なら相手が、本物なら自分が撃ちます。弾は6発中1発。前の人が手札を出し切ったときに見逃すと「あがり」で、その人以外の全員が撃ちます。' },
  ],
  dice: [
    { t: '目的', b: '最後の1人まで生き残る。読み合いに負けると毒を飲み、2本目で死亡します。' },
    { t: '自分の番', b: '「○の目がテーブル全体でX個以上」とベット。個数を増やすなら目はどれでもOK（例：6が2個 → 次は3個以上ならどの目でも）。同じ個数なら大きい目に。数えるのは宣言した目だけ（1もふつうの目）。' },
    { t: '疑うなら', b: '前のベットが多すぎると思ったら「ライアー！」。全員のダイスを公開して数えます。' },
  ],
};
