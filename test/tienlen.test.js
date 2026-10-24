import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createDeck, detectCombo, canBeat, COMBO } from '../src/tienlen/cards.js';
import * as tl from '../src/tienlen/game.js';

const deck = createDeck();
const card = (id) => {
  const c = deck.find((x) => x.id === id);
  if (!c) throw new Error(`unknown card ${id}`);
  return c;
};
const cards = (...ids) => ids.map(card);
const played = (ids, mode = 'TLMN') => ({ cards: cards(...ids), combo: detectCombo(cards(...ids), mode) });

describe('combos', () => {
  test('detects basic combos', () => {
    assert.equal(detectCombo(cards('3-♠')).type, COMBO.SINGLE);
    assert.equal(detectCombo(cards('3-♠', '3-♥')).type, COMBO.PAIR);
    assert.equal(detectCombo(cards('3-♠', '4-♥')).type, COMBO.INVALID);
    assert.equal(detectCombo(cards('7-♠', '7-♥', '7-♦')).type, COMBO.TRIPLE);
    assert.equal(detectCombo(cards('9-♠', '9-♣', '9-♦', '9-♥')).type, COMBO.FOUR_OF_A_KIND);
    assert.equal(detectCombo(cards('5-♠', '3-♥', '4-♦')).type, COMBO.STRAIGHT);
    assert.equal(detectCombo(cards('K-♠', 'A-♥', '2-♦')).type, COMBO.INVALID);
    assert.equal(detectCombo(cards('3-♠', '3-♥', '4-♠', '4-♥', '5-♠', '5-♥')).type, COMBO.THREE_PAIRS_SERIES);
  });

  test('TLMB requires same colour pairs and same suit straights', () => {
    assert.equal(detectCombo(cards('3-♠', '3-♥'), 'TLMB').type, COMBO.INVALID);
    assert.equal(detectCombo(cards('3-♦', '3-♥'), 'TLMB').type, COMBO.PAIR);
    assert.equal(detectCombo(cards('3-♠', '4-♥', '5-♠'), 'TLMB').type, COMBO.INVALID);
    assert.equal(detectCombo(cards('3-♠', '4-♠', '5-♠'), 'TLMB').type, COMBO.STRAIGHT);
  });

  test('beats by highest card and matching shape', () => {
    assert.ok(canBeat(cards('4-♠'), played(['3-♥'])));
    assert.ok(!canBeat(cards('3-♠'), played(['3-♥'])));
    assert.ok(canBeat(cards('3-♥'), played(['3-♠'])));
    assert.ok(!canBeat(cards('5-♠', '5-♥'), played(['4-♠'])));
    assert.ok(canBeat(cards('4-♠', '5-♠', '6-♥'), played(['3-♠', '4-♥', '5-♦'])));
    assert.ok(!canBeat(cards('4-♠', '5-♠', '6-♥', '7-♥'), played(['3-♠', '4-♥', '5-♦'])));
  });

  test('TLMN chopping rules', () => {
    const fourKind = cards('9-♠', '9-♣', '9-♦', '9-♥');
    const threePairs = cards('3-♠', '3-♥', '4-♠', '4-♥', '5-♠', '5-♥');
    assert.ok(canBeat(threePairs, played(['2-♥'])));
    assert.ok(canBeat(fourKind, played(['2-♥'])));
    assert.ok(canBeat(fourKind, played(['2-♠', '2-♥'])));
    assert.ok(!canBeat(threePairs, played(['2-♠', '2-♥'])));
    assert.ok(canBeat(fourKind, played(['6-♠', '6-♥', '7-♠', '7-♥', '8-♠', '8-♥'])));
    assert.ok(!canBeat(threePairs, played(['A-♥'])));
  });

  test('TLMB single must follow suit unless a two is involved', () => {
    assert.ok(!canBeat(cards('5-♥'), played(['4-♠'], 'TLMB'), 'TLMB'));
    assert.ok(canBeat(cards('5-♠'), played(['4-♠'], 'TLMB'), 'TLMB'));
    assert.ok(canBeat(cards('2-♣'), played(['A-♥'], 'TLMB'), 'TLMB'));
  });
});

// Deterministic room with fixed hands.
function setup(hands, mode = 'TLMN') {
  const room = tl.createRoom('R');
  hands.forEach((_, i) => tl.join(room, { playerId: `p${i}`, name: `P${i}` }));
  tl.start(room, 'p0', mode);
  room.players.forEach((p, i) => {
    p.hand = cards(...hands[i]);
  });
  room.currentTurn = 0;
  return room;
}

describe('room flow', () => {
  test('lowest card holder starts the first game', () => {
    const room = tl.createRoom('R');
    tl.join(room, { playerId: 'a', name: 'A' });
    tl.join(room, { playerId: 'b', name: 'B' });
    tl.start(room, 'a', 'TLMN');
    const lowest = room.players.map((p) => p.hand[0].totalValue);
    assert.equal(room.currentTurn, lowest[0] < lowest[1] ? 0 : 1);
    assert.equal(room.players[0].hand.length, 13);
    assert.equal(room.players[1].hand.length, 13);
    assert.equal(new Set([...room.players[0].hand, ...room.players[1].hand].map((c) => c.id)).size, 26);
  });

  test('only the host can start and needs 2 players', () => {
    const room = tl.createRoom('R');
    tl.join(room, { playerId: 'a', name: 'A' });
    assert.throws(() => tl.start(room, 'a'), /ít nhất 2/);
    tl.join(room, { playerId: 'b', name: 'B' });
    assert.throws(() => tl.start(room, 'b'), /chủ phòng/);
  });

  test('rejects cards not in hand, wrong turn and invalid combos', () => {
    const room = setup([['3-♠', '4-♠', '9-♥'], ['5-♠', '6-♦', 'K-♥']]);
    assert.throws(() => tl.play(room, 'p1', ['5-♠']), /lượt/);
    assert.throws(() => tl.play(room, 'p0', ['5-♠']), /không có/);
    assert.throws(() => tl.play(room, 'p0', ['3-♠', '9-♥']), /không hợp lệ/);
    assert.throws(() => tl.pass(room, 'p0'), /tự do/);
  });

  test('round resets to the last player when everyone else passes', () => {
    const room = setup([['3-♠', '4-♠', '9-♥'], ['5-♠', '6-♦', 'K-♥'], ['7-♠', '8-♦', 'Q-♥']]);
    tl.play(room, 'p0', ['3-♠']);
    assert.equal(room.currentTurn, 1);
    tl.play(room, 'p1', ['5-♠']);
    tl.pass(room, 'p2');
    assert.equal(room.currentTurn, 0);
    tl.pass(room, 'p0');
    assert.equal(room.currentTurn, 1);
    assert.equal(room.lastPlayed, null);
    assert.deepEqual(room.passed, {});
    assert.throws(() => tl.pass(room, 'p1'), /tự do/);
  });

  test('passed players are skipped for the rest of the round', () => {
    const room = setup([['3-♠', '4-♠', '9-♥'], ['5-♠', '6-♦', 'K-♥'], ['7-♠', '8-♦', 'Q-♥']]);
    tl.play(room, 'p0', ['3-♠']);
    tl.pass(room, 'p1');
    tl.play(room, 'p2', ['7-♠']);
    assert.equal(room.currentTurn, 0);
    tl.play(room, 'p0', ['9-♥']);
    assert.equal(room.currentTurn, 2);
  });

  test('emptying the hand wins and the winner starts the next game', () => {
    const room = setup([['3-♠'], ['5-♠', '6-♦']]);
    tl.play(room, 'p0', ['3-♠']);
    assert.equal(room.status, 'FINISHED');
    assert.equal(room.winnerId, 'p0');
    tl.start(room, 'p0', 'TLMN');
    assert.equal(room.currentTurn, 0);
  });

  test('views hide opponent hands', () => {
    const room = setup([['3-♠', '4-♠'], ['5-♠', '6-♦']]);
    const view = tl.viewFor(room, 'p1');
    assert.equal(view.players[0].hand, undefined);
    assert.equal(view.players[0].cardCount, 2);
    assert.equal(view.players[1].hand.length, 2);
  });

  test('leaving mid-game hands the win to the last player', () => {
    const room = setup([['3-♠', '4-♠'], ['5-♠', '6-♦']]);
    tl.leave(room, 'p0');
    assert.equal(room.status, 'FINISHED');
    assert.equal(room.winnerId, 'p1');
  });

  test('leaving on your turn passes the turn on', () => {
    const room = setup([['3-♠', '4-♠'], ['5-♠', '6-♦'], ['7-♠', '8-♦']]);
    tl.leave(room, 'p0');
    assert.equal(room.status, 'PLAYING');
    assert.equal(room.currentTurn, 1);
  });

  test('cannot join a game in progress but can rejoin your seat', () => {
    const room = setup([['3-♠'], ['5-♠']]);
    assert.throws(() => tl.join(room, { playerId: 'x', name: 'X' }), /đang diễn ra/);
    tl.setConnected(room, 'p1', false);
    tl.join(room, { playerId: 'p1', name: 'P1' });
    assert.equal(room.players[1].connected, true);
  });
});
