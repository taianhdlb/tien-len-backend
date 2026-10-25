import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createPhomDeck, isValidPhom, findMelds, bestHand, eatOptions, canSendTo, sortPhom } from '../src/phom/cards.js';
import * as phom from '../src/phom/game.js';

const deck = createPhomDeck();
const card = (id) => {
  const found = deck.find((c) => c.id === id);
  if (!found) throw new Error(`unknown card ${id}`);
  return found;
};
const cards = (...ids) => ids.map(card);

describe('deck', () => {
  test('52 unique cards, A low and K high', () => {
    assert.equal(deck.length, 52);
    assert.equal(new Set(deck.map((c) => c.id)).size, 52);
    assert.equal(card('A-♠').rankValue, 1);
    assert.equal(card('K-♥').rankValue, 13);
    assert.equal(card('7-♦').rankValue, 7);
  });
});

describe('phỏm', () => {
  test('sám và sảnh hợp lệ', () => {
    assert.ok(isValidPhom(cards('7-♠', '7-♥', '7-♦')));
    assert.ok(isValidPhom(cards('J-♠', 'J-♣', 'J-♦', 'J-♥')));
    assert.ok(isValidPhom(cards('4-♥', '5-♥', '6-♥')));
    assert.ok(isValidPhom(cards('A-♣', '2-♣', '3-♣', '4-♣')));
    assert.ok(isValidPhom(cards('Q-♠', 'K-♠', 'J-♠')));
  });

  test('chặn bộ sai và sảnh vòng K-A-2', () => {
    assert.ok(!isValidPhom(cards('7-♠', '7-♥')));
    assert.ok(!isValidPhom(cards('7-♠', '8-♠', '10-♠')));
    assert.ok(!isValidPhom(cards('K-♠', 'A-♠', '2-♠')));
    assert.ok(!isValidPhom(cards('7-♠', '7-♥', '7-♦', '7-♣', '7-♠')));
    assert.ok(!isValidPhom(cards('3-♠', '3-♥', '3-♦', '3-♣', '4-♠')));
  });

  test('liệt kê mọi cách tách phỏm của một tay bài', () => {
    const hand = cards('3-♠', '3-♥', '3-♦', '4-♠', '5-♠');
    const found = findMelds(hand).map((m) => sortPhom(m).map((c) => c.id).join('+'));
    assert.ok(found.includes('3-♠+3-♦+3-♥'));
    assert.ok(found.includes('3-♠+4-♠+5-♠'));
    assert.equal(findMelds(cards('3-♠', '9-♥', 'K-♦')).length, 0);
  });

  test('bestHand tối ưu hoá điểm được hạ', () => {
    // Sám 3 (3+3+3=9đ) hay sảnh 3-4-5 (12đ)? Sảnh cho 4♠-5♠-6♠ + sám 7.
    const hand = cards('3-♠', '3-♥', '3-♦', '4-♠', '5-♠', '6-♠', '9-♣');
    const best = bestHand(hand);
    assert.deepEqual(best.leftovers.map((c) => c.id), ['9-♣']);
    assert.equal(best.score, 9);
    assert.deepEqual(
      best.melds.map((m) => sortPhom(m).map((c) => c.id).join('+')).sort(),
      ['3-♠+3-♦+3-♥', '4-♠+5-♠+6-♠']
    );
  });

  test('ù khi tay bài sạch rác', () => {
    assert.equal(bestHand(cards('A-♠', '2-♠', '3-♠', '7-♥', '7-♣', '7-♦', '9-♠', '10-♠', 'J-♠')).leftovers.length, 0);
    assert.ok(bestHand(cards('A-♠', '2-♠', '3-♠', '7-♥')).leftovers.length > 0);
  });
});

describe('ăn và gửi bài', () => {
  test('ăn được khi lá vào ghép thành phỏm', () => {
    const hand = cards('8-♠', '9-♠', '4-♥', 'K-♦');
    const options = eatOptions(hand, card('7-♠'));
    assert.equal(options.length, 1);
    assert.deepEqual(sortPhom(options[0]).map((c) => c.id), ['8-♠', '9-♠']);
    assert.equal(eatOptions(hand, card('Q-♥')).length, 0);
  });

  test('sám cần đủ 2 lá trên tay', () => {
    const options = eatOptions(cards('8-♠', '8-♥', '2-♦'), card('8-♦'));
    assert.deepEqual(sortPhom(options[0]).map((c) => c.id), ['8-♠', '8-♥']);
  });

  test('gửi vào hai đầu sảnh và lá thứ 4 của sám', () => {
    const run = cards('5-♣', '6-♣', '7-♣');
    assert.ok(canSendTo(card('4-♣'), run));
    assert.ok(canSendTo(card('8-♣'), run));
    assert.ok(!canSendTo(card('9-♣'), run));
    assert.ok(!canSendTo(card('6-♠'), run));
    const set = cards('9-♠', '9-♥', '9-♦');
    assert.ok(canSendTo(card('9-♣'), set));
    assert.ok(!canSendTo(card('8-♣'), set));
    assert.ok(!canSendTo(card('9-♣'), [...set, card('9-♣')]));
  });
});

// Chiếu deterministic: chia bài tay cố định, bỏ qua xáo bài.
function table(hands, { turn = 0, round = 1, stock = [] } = {}) {
  const room = phom.createRoom('R');
  hands.forEach((_, i) => phom.join(room, { playerId: `p${i}`, name: `P${i}` }));
  phom.start(room, 'p0');
  room.players.forEach((p, i) => {
    p.hand = sortPhom(cards(...hands[i]));
  });
  room.stock = cards(...stock);
  room.turn = turn;
  room.round = round;
  room.phase = 'ACTION';
  room.claim = null;
  return room;
}

describe('luồng ván', () => {
  test('chủ chiếu chia 10 lá, người sau 9 lá, nọc phần còn lại', () => {
    const room = phom.createRoom('R');
    ['a', 'b', 'c', 'd'].forEach((id) => phom.join(room, { playerId: id, name: id.toUpperCase() }));
    phom.start(room, 'a');
    assert.equal(room.players[0].hand.length, 10);
    assert.equal(room.players[1].hand.length, 9);
    assert.equal(room.stock.length, 52 - 10 - 27);
    assert.equal(room.turn, 0);
    assert.equal(room.phase, 'ACTION');
    assert.equal(room.round, 1);
  });

  test('chặn vào giữa ván, chặn chia bài khi thiếu người', () => {
    const room = phom.createRoom('R');
    phom.join(room, { playerId: 'a', name: 'A' });
    assert.throws(() => phom.start(room, 'a'), /2 người/);
    phom.join(room, { playerId: 'b', name: 'B' });
    assert.throws(() => phom.start(room, 'b'), /chủ chiếu/);
    phom.start(room, 'a');
    assert.throws(() => phom.join(room, { playerId: 'c', name: 'C' }), /đang diễn ra/);
  });

  test('bốc rồi đánh, người sau được ăn lá vừa đánh', () => {
    const room = table(
      [
        ['3-♠', '9-♥', 'J-♦', '2-♣', '5-♠', '7-♦', 'K-♣', '4-♥', '8-♠', '10-♦'],
        ['9-♣', '9-♦', '4-♠', '6-♥', 'Q-♠', '2-♦', '7-♣', 'A-♥', '5-♦']
      ],
      { stock: ['Q-♣', 'K-♠'] }
    );
    phom.act(room, 'p0', { op: 'DISCARD', card: '9-♥' });
    assert.equal(room.turn, 1);
    assert.equal(room.phase, 'CLAIM');
    assert.deepEqual(room.claim, { playerId: 'p0', card: card('9-♥'), chot: false });

    assert.throws(() => phom.act(room, 'p1', { op: 'EAT', cards: ['4-♠', '6-♥'] }), /phỏm hợp lệ/);
    assert.throws(() => phom.act(room, 'p1', { op: 'EAT', cards: ['9-♣'] }), /2 lá/);

    phom.act(room, 'p1', { op: 'EAT', cards: ['9-♣', '9-♦'] });
    assert.equal(room.players[1].melds.length, 1);
    assert.deepEqual(room.players[1].melds[0].cards.map((c) => c.id), ['9-♣', '9-♦', '9-♥']);
    assert.equal(room.players[0].discards.length, 0);
    assert.equal(room.phase, 'ACTION');
    assert.deepEqual(
      room.fouls.map((f) => [f.payerId, f.playerId, f.amount]),
      [['p0', 'p1', 1]]
    );
  });

  test('sai lượt và sai bài bị chặn', () => {
    const room = table([['3-♠', '9-♥', 'J-♦'], ['8-♣', '9-♣', '4-♠']]);
    assert.throws(() => phom.act(room, 'p1', { op: 'DISCARD', card: '8-♣' }), /lượt/);
    assert.throws(() => phom.act(room, 'p0', { op: 'DISCARD', card: 'A-♠' }), /không giữ/);
    assert.throws(() => phom.act(room, 'p0', { op: 'MELD', cards: ['3-♠', '9-♥'] }), /3 lá/);
    assert.throws(() => phom.act(room, 'p0', { op: 'NOPE' }), /không hợp lệ/);
  });

  test('hạ phỏm rồi gửi vào phỏm đối thủ', () => {
    const room = table([
      ['4-♠', '5-♠', '6-♠', '9-♥', 'J-♦'],
      ['7-♠', '2-♣', '3-♣', '4-♣', 'K-♦']
    ]);
    phom.act(room, 'p0', { op: 'MELD', cards: ['4-♠', '5-♠', '6-♠'] });
    assert.equal(room.players[0].melds[0].cards.length, 3);
    phom.act(room, 'p0', { op: 'DISCARD', card: '9-♥' });

    assert.throws(() => phom.act(room, 'p1', { op: 'SEND', card: '7-♠', meldId: 1 }), /hạ được/);
    phom.act(room, 'p1', { op: 'MELD', cards: ['2-♣', '3-♣', '4-♣'] });
    assert.throws(() => phom.act(room, 'p1', { op: 'SEND', card: '7-♠', meldId: 99 }), /Phỏm đích/);
    assert.throws(() => phom.act(room, 'p1', { op: 'SEND', card: 'K-♦', meldId: 1 }), /không gửi được/);
    phom.act(room, 'p1', { op: 'SEND', card: '7-♠', meldId: 1 });
    assert.deepEqual(room.players[0].melds[0].cards.map((c) => c.id), ['4-♠', '5-♠', '6-♠', '7-♠']);
    assert.equal(room.players[1].hand.length, 1);
  });

  test('ù tuyệt đối khi sạch rác', () => {
    const room = table([
      ['A-♠', '2-♠', '3-♠', '7-♥', '7-♣', '7-♦', '9-♠', '10-♠', 'J-♠'],
      ['4-♥', '5-♥', 'Q-♣', '2-♦', '8-♣', 'K-♠', '6-♦', '3-♥', '9-♦']
    ]);
    assert.throws(() => phom.act(room, 'p1', { op: 'WIN' }), /lượt/);
    phom.act(room, 'p0', { op: 'WIN' });
    assert.equal(room.status, 'FINISHED');
    assert.equal(room.results.type, 'WIN');
    assert.equal(room.results.winnerId, 'p0');
    assert.equal(room.results.denPlayerId, null);
    assert.equal(room.results.rows.find((r) => r.playerId === 'p0').score, 0);
    assert.equal(room.results.rows.find((r) => r.playerId === 'p0').net, 4);
    assert.equal(room.results.rows.find((r) => r.playerId === 'p1').net, -4);
  });

  test('ván mới: người ù ván trước được đánh trước', () => {
    const room = table(
      [
        ['A-♠', '2-♠', '3-♠', '7-♥', '7-♣', '7-♦', '9-♠', '10-♠', 'J-♠'],
        ['4-♥', '5-♥', '6-♥', 'Q-♣', '2-♦', '8-♣', 'K-♠', '3-♥', '9-♦']
      ],
      { turn: 1 }
    );
    room.players[1].hand = sortPhom(cards('A-♥', '2-♥', '3-♥', '4-♠', '5-♠', '6-♠', '7-♣', '8-♣', '9-♣'));
    phom.act(room, 'p1', { op: 'WIN' });
    assert.equal(room.lastWinnerId, 'p1');

    phom.start(room, 'p0');
    assert.equal(room.status, 'PLAYING');
    assert.equal(room.turn, 1);
    assert.equal(room.round, 1);
    assert.equal(room.results, null);
    assert.equal(room.players[1].hand.length, 10);
    assert.equal(room.players[0].hand.length, 9);
  });

  test('bị ăn 3 lá rồi người đó ù => đền cả bàn', () => {
    const room = table(
      [
        ['3-♠', '9-♥', 'J-♦'],
        ['6-♣', '6-♥', '6-♠', '8-♣', '8-♦', '8-♥'],
        ['4-♥', '5-♦', 'Q-♠']
      ],
      { turn: 1 }
    );
    const winner = room.players[1];
    winner.ateFrom = { p0: 3 };
    winner.melds = [
      { id: 1, cards: cards('4-♠', '4-♥', '4-♦'), eaten: true, from: 'p0' },
      { id: 2, cards: cards('7-♣', '7-♥', '7-♠'), eaten: true, from: 'p0' }
    ];
    winner.firstMeld = 1;
    phom.act(room, 'p1', { op: 'WIN' });
    assert.equal(room.results.type, 'WIN');
    assert.equal(room.results.denPlayerId, 'p0');
    assert.equal(room.results.rows.find((r) => r.playerId === 'p0').net, -8); // trả thay p2
    assert.equal(room.results.rows.find((r) => r.playerId === 'p1').net, 8);
    assert.equal(room.results.rows.find((r) => r.playerId === 'p2').net, 0);
  });

  test('vòng 4 bắt buộc hạ hết phỏm trước khi đánh chốt', () => {
    const room = table(
      [
        ['4-♠', '5-♠', '6-♠', '9-♥'],
        ['2-♣', '3-♣', 'Q-♦', '7-♥']
      ],
      { round: 4 }
    );
    assert.throws(() => phom.act(room, 'p0', { op: 'DISCARD', card: '9-♥' }), /hạ hết phỏm/);
    phom.act(room, 'p0', { op: 'MELD', cards: ['4-♠', '5-♠', '6-♠'] });
    phom.act(room, 'p0', { op: 'DISCARD', card: '9-♥' });
    assert.equal(room.turn, 1);
  });

  test('hết 4 vòng: mở bài tính điểm, móm về bét', () => {
    const room = table([
      ['K-♦', '9-♥'],
      ['Q-♣', '8-♠', 'J-♦']
    ]);
    room.players[0].melds = [{ id: 1, cards: cards('5-♠', '5-♥', '5-♦'), eaten: false, from: null }];
    room.players[0].firstMeld = 1;
    room.turn = 1;
    room.round = 4;
    room.turnCount = 7;
    room.phase = 'ACTION';

    phom.act(room, 'p1', { op: 'DISCARD', card: 'J-♦' });
    assert.equal(room.status, 'FINISHED');
    const [first, second] = room.results.rows;
    assert.equal(room.results.type, 'POINTS');
    assert.equal(first.playerId, 'p0');
    assert.equal(first.score, 22);
    assert.equal(first.isMom, false);
    assert.equal(second.playerId, 'p1');
    assert.equal(second.isMom, true);
    assert.equal(second.net, -1); // nhì trả nhất 1 cược
    assert.equal(first.net, 1);
  });

  test('quân chốt vòng 3 bị ăn thì người đánh chịu 4 cược', () => {
    const room = table(
      [
        ['3-♠', '9-♥', 'J-♦'],
        ['9-♣', '9-♦', '4-♠']
      ],
      { turn: 0, round: 3 }
    );
    room.turnCount = 5; // 2 người chơi => lá thứ 6 là chốt của vòng 3
    phom.act(room, 'p0', { op: 'DISCARD', card: '9-♥' });
    assert.equal(room.players[0].discards[0].chot, true);
    assert.equal(room.round, 4);
    phom.act(room, 'p1', { op: 'EAT', cards: ['9-♣', '9-♦'] });
    assert.deepEqual(
      room.fouls.map((f) => [f.payerId, f.amount, f.reason]),
      [
        ['p0', 1, 'EAT'],
        ['p0', 4, 'CHOT']
      ]
    );
    assert.equal(room.players[1].chotFrom, 'p0');
  });

  test('mô phỏng ván 4 người tới khi hạ màn', () => {
    const room = phom.createRoom('R');
    ['a', 'b', 'c', 'd'].forEach((id) => phom.join(room, { playerId: id, name: id.toUpperCase() }));
    const seed = (() => {
      let s = 42;
      return () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
    })();
    phom.start(room, 'a', seed);

    for (let step = 0; step < 200 && room.status === 'PLAYING'; step++) {
      const me = room.players[room.turn];
      if (room.phase === 'CLAIM') {
        const opts = room.claim ? eatOptions(me.hand, room.claim.card) : [];
        if (opts.length && seed() > 0.5) phom.act(room, me.id, { op: 'EAT', cards: opts[0].map((c) => c.id) });
        else phom.act(room, me.id, { op: 'DRAW' });
      }
      const again = () => findMelds(room.players[room.turn].hand)[0];
      while (again()) phom.act(room, me.id, { op: 'MELD', cards: again().map((c) => c.id) });
      const view = phom.viewFor(room, me.id);
      if (view.legal.canWin) {
        phom.act(room, me.id, { op: 'WIN' });
        break;
      }
      phom.act(room, me.id, { op: 'DISCARD', card: me.hand[me.hand.length - 1].id });
    }

    assert.equal(room.status, 'FINISHED');
    assert.equal(room.results.rows.length, 4);
    assert.ok(room.results.rows.every((r) => Number.isFinite(r.score) && r.score >= 0));
    assert.equal(
      room.results.rows.reduce((sum, r) => sum + r.net, 0),
      0
    );
  });

  test('rời chiếu giữa ván kết thúc ván sớm', () => {
    const room = table([
      ['4-♠', '5-♠', '6-♠', '9-♥'],
      ['2-♣', '3-♣', 'Q-♦']
    ]);
    phom.leave(room, 'p1');
    assert.equal(room.status, 'FINISHED');
    assert.equal(room.winnerId, 'p0');
  });

  test('view giấu bài đối thủ và mở khoá nước đi hợp lệ', () => {
    const room = table(
      [
        ['4-♠', '5-♠', '6-♠', '9-♥', '2-♣'],
        ['7-♠', '3-♣', '4-♣', '8-♥', 'Q-♦']
      ],
      { stock: ['5-♣'] }
    );
    phom.act(room, 'p0', { op: 'DISCARD', card: '9-♥' });
    const view = phom.viewFor(room, 'p1');
    assert.equal(view.players[0].hand, undefined);
    assert.equal(view.players[0].cardCount, 4);
    assert.equal(view.players[1].hand.length, 5);
    assert.equal(view.myTurn, true);
    assert.equal(view.legal.phase, 'CLAIM');
    assert.equal(view.legal.canDraw, true);
    assert.deepEqual(view.legal.eatOptions, []);
    assert.equal(view.legal.discards.length, 0);

    phom.act(room, 'p1', { op: 'DRAW' });
    const after = phom.viewFor(room, 'p1');
    assert.equal(after.legal.phase, 'ACTION');
    assert.deepEqual(after.legal.suggestion, [['3-♣', '4-♣', '5-♣']]);
    assert.equal(after.legal.canMeld.length, 1);
    assert.equal(after.legal.canWin, false);
    assert.equal(after.legal.discards.length, 6);
  });
});
