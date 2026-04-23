/**
 * Poker Mombe — lógica de cliente (Firestore + UI).
 * La configuración de Firebase es pública en apps web; las reglas de Firestore son la capa de seguridad.
 */
const firebaseConfig = {
    apiKey: 'AIzaSyCCiWloa1spDlR6X0K4pdMjQ2Ie2jtIO2E',
    authDomain: 'pokermombe.firebaseapp.com',
    projectId: 'pokermombe',
    storageBucket: 'pokermombe.appspot.com',
    messagingSenderId: '158062738038',
    appId: '1:158062738038:web:698c7f9aec22b366cfbd57',
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();
const appId = 'pokermombe_casino_v4';
const gameDocRef = db.collection('artifacts').doc(appId).collection('public').doc('data').collection('games').doc('main_game');

let myPlayerId = sessionStorage.getItem('poker_pid') || 'p_' + Math.random().toString(36).substr(2, 9);
sessionStorage.setItem('poker_pid', myPlayerId);

let gameState = null;
let isProcessing = false;

const SUITS = ['♠', '♣', '♥', '♦'];
const VALUES = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const VALUE_MAP = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, J: 11, Q: 12, K: 13, A: 14 };

/**
 * Comprueba escalera con 5 rangos ya ordenados de mayor a menor.
 * Incluye escalera baja (rueda) A-2-3-4-5 con A como 14.
 */
function isStraightRanks(ranksDesc) {
    if (!ranksDesc || ranksDesc.length !== 5) return { straight: false, high: 0 };
    if (ranksDesc[0] === 14 && ranksDesc[1] === 5 && ranksDesc[2] === 4 && ranksDesc[3] === 3 && ranksDesc[4] === 2) {
        return { straight: true, high: 5 };
    }
    for (let i = 0; i < 4; i++) {
        if (ranksDesc[i] - ranksDesc[i + 1] !== 1) {
            return { straight: false, high: 0 };
        }
    }
    return { straight: true, high: ranksDesc[0] };
}

function evaluateBestHand(cards) {
    if (!cards || cards.length < 5) return { score: 0, name: '---' };
    const combinations = getCombinations(cards, 5);
    let best = { score: -1, name: '---' };
    combinations.forEach((combo) => {
        const res = scoreHand(combo);
        if (res.score > best.score) best = res;
    });
    return best;
}

function scoreHand(hand) {
    const ranks = hand
        .map((c) => VALUE_MAP[c.value])
        .sort((a, b) => b - a);
    const suits = hand.map((c) => c.suit);
    const counts = {};
    ranks.forEach((r) => {
        counts[r] = (counts[r] || 0) + 1;
    });
    const isFlush = new Set(suits).size === 1;
    const strInfo = isStraightRanks(ranks);
    const isStraight = strInfo.straight;
    const highStraight = strInfo.high;
    const freq = Object.values(counts).sort((a, b) => b - a);
    const tie = (isStraight ? highStraight : ranks[0]) * 0.01;

    if (isFlush && isStraight && highStraight === 14) {
        return { score: 900, name: 'Escalera Real' };
    }
    if (isFlush && isStraight) return { score: 800 + tie, name: 'Escalera Color' };
    if (freq[0] === 4) return { score: 700 + tie, name: 'Póker' };
    if (freq[0] === 3 && freq[1] === 2) return { score: 600 + tie, name: 'Full' };
    if (isFlush) return { score: 500 + tie, name: 'Color' };
    if (isStraight) return { score: 400 + tie, name: 'Escalera' };
    if (freq[0] === 3) return { score: 300 + tie, name: 'Trío' };
    if (freq[0] === 2 && freq[1] === 2) return { score: 200 + tie, name: 'Doble Par' };
    if (freq[0] === 2) return { score: 100 + tie, name: 'Par' };
    return { score: tie, name: 'Carta Alta' };
}

function getCombinations(array, size) {
    const result = [];
    function helper(start, combo) {
        if (combo.length === size) {
            result.push([...combo]);
            return;
        }
        for (let i = start; i < array.length; i++) {
            combo.push(array[i]);
            helper(i + 1, combo);
            combo.pop();
        }
    }
    helper(0, []);
    return result;
}

function createCard(card, hidden) {
    if (!card || (hidden && !gameState?.showAllCards)) {
        return '<div class="w-16 h-24 lg:w-20 lg:h-28 card-back rounded-lg shadow-lg flex items-center justify-center"><span class="opacity-20 text-white font-black text-2xl">M</span></div>';
    }
    const isRed = card.suit === '♥' || card.suit === '♦';
    return `<div class="w-16 h-24 lg:w-20 lg:h-28 bg-white rounded-lg flex flex-col items-center justify-between p-1.5 shadow-xl ${isRed ? 'text-red-600' : 'text-black'} card-visual font-black border border-zinc-300">
        <span class="text-xs self-start">${card.value}</span>
        <span class="text-3xl">${card.suit}</span>
        <span class="text-xs self-end rotate-180">${card.value}</span>
    </div>`;
}

async function sendEmoji(emoji) {
    if (!gameState) return;
    const players = [...gameState.players];
    const pIdx = players.findIndex((pl) => pl.id === myPlayerId);
    if (pIdx > -1) {
        players[pIdx].emoji = emoji;
        await gameDocRef.update({ players });
        setTimeout(async () => {
            const snap = await gameDocRef.get();
            if (!snap.exists) return;
            const currentPlayers = snap.data().players;
            const pIdxCurrent = currentPlayers.findIndex((pl) => pl.id === myPlayerId);
            if (pIdxCurrent > -1) {
                currentPlayers[pIdxCurrent].emoji = null;
                await gameDocRef.update({ players: currentPlayers });
            }
        }, 3000);
    }
}

function updateUI() {
    if (!gameState) return;
    const players = gameState.players || [];
    const meIndex = players.findIndex((p) => p.id === myPlayerId);
    const me = players[meIndex];

    if (me) {
        document.getElementById('login-screen').classList.add('hidden');
        document.getElementById('game-screen').classList.remove('hidden');
        document.getElementById('display-me-name').innerText = me.name;
    } else {
        document.getElementById('login-screen').classList.remove('hidden');
        document.getElementById('game-screen').classList.add('hidden');
    }

    document.getElementById('display-pot').innerText = `$${gameState.pot || 0}`;
    document.getElementById('action-log').innerText = gameState.lastAction || 'Esperando acción...';

    const layer = document.getElementById('players-layer');
    layer.innerHTML = '';

    const numPlayers = players.length;
    players.forEach((p, i) => {
        if (numPlayers === 0) return;
        const relativeIndex = (i - (meIndex >= 0 ? meIndex : 0) + numPlayers) % numPlayers;
        const angle = (relativeIndex / numPlayers) * 2 * Math.PI + Math.PI / 2;
        const x = 50 + 42 * Math.cos(angle);
        const y = 50 + 35 * Math.sin(angle);

        const isTurn = gameState.currentTurn === i && !['showdown', 'waiting'].includes(gameState.phase);
        const isWinner = gameState.winner === p.id;
        const isSmallBlind = i === gameState.smallBlindIndex;
        const isBigBlind = i === gameState.bigBlindIndex;

        const div = document.createElement('div');
        div.className = 'absolute -translate-x-1/2 -translate-y-1/2 z-20 pointer-events-auto text-center';
        div.style.left = `${x}%`;
        div.style.top = `${y}%`;
        div.innerHTML = `
            <div class="p-3 rounded-2xl min-w-[110px] border-2 transition-all duration-300 ${isTurn ? 'bg-amber-500 border-white scale-125 text-black shadow-[0_0_25px_rgba(251,191,36,0.8)]' : 'bg-zinc-900 border-zinc-700 text-white'} ${isWinner ? 'winner-glow' : ''} ${p.folded ? 'opacity-30' : ''}">
                ${p.emoji ? `<div class="chat-bubble">${p.emoji}</div>` : ''}
                <div class="relative">
                    <div class="text-[8px] font-black uppercase ${isTurn ? 'text-black' : 'opacity-60'}">${p.name}</div>
                    ${isSmallBlind ? '<span class="blind-badge bg-blue-600 text-white">SB</span>' : ''}
                    ${isBigBlind ? '<span class="blind-badge bg-red-600 text-white">BB</span>' : ''}
                </div>
                <div class="text-lg font-black font-mono">$${p.chips}</div>
                ${p.bet > 0 ? `<div class="${isTurn ? 'bg-black text-white' : 'bg-red-600 text-white'} text-[8px] px-2 py-0.5 rounded-full mt-1 font-bold">APUESTA: $${p.bet}</div>` : ''}
                ${(gameState.showAllCards || isWinner) && !p.folded && p.cards ? `
                    <div class="flex gap-1 justify-center mt-2 scale-75 origin-top">
                        ${createCard(p.cards[0], false)}${createCard(p.cards[1], false)}
                    </div>
                ` : ''}
            </div>
        `;
        layer.appendChild(div);
    });

    const comm = document.getElementById('community-cards');
    comm.innerHTML = '';
    const communityCards = gameState.communityCards || [];
    for (let i = 0; i < 5; i++) {
        comm.innerHTML += createCard(communityCards[i], !communityCards[i]);
    }

    if (me) {
        const myHandUI = document.getElementById('my-hand-cards');
        const hideHand = gameState.phase === 'waiting' || me.folded;
        myHandUI.innerHTML = createCard(me.cards?.[0], hideHand) + createCard(me.cards?.[1], hideHand);
        const best = evaluateBestHand([...(me.cards || []), ...communityCards]);
        document.getElementById('my-hand-name').innerText = me.folded
            ? 'RETIRADO'
            : gameState.phase === 'waiting'
              ? 'EN ESPERA'
              : best.name;

        const ctrl = document.getElementById('controls-container');
        const betUI = document.getElementById('betting-ui');
        ctrl.innerHTML = '';
        betUI.classList.add('hidden');

        if (gameState.phase === 'waiting' || gameState.phase === 'showdown') {
            const btn = document.createElement('button');
            btn.className = 'btn-casino btn-start';
            btn.innerText = players.length < 2 ? 'ESPERANDO RIVAL...' : 'NUEVA MANO';
            btn.disabled = players.length < 2 || isProcessing;
            btn.onclick = startRound;
            ctrl.appendChild(btn);
        } else {
            const isMyTurn = gameState.currentTurn === meIndex;
            if (isMyTurn) {
                const diff = (gameState.currentBet || 0) - (me.bet || 0);
                const canRaise = me.chips > diff;
                betUI.classList.remove('hidden');
                const slider = document.getElementById('bet-slider');
                // Mínima apuesta total al subir: apuesta a igualar + incremento 100
                const minTarget = (me.bet || 0) + diff + 100;
                slider.min = minTarget;
                slider.max = me.chips + me.bet;
                if (parseInt(slider.value, 10) < parseInt(slider.min, 10)) slider.value = slider.min;
                if (parseInt(slider.value, 10) > parseInt(slider.max, 10)) slider.value = slider.max;
                const fmt = (v) => (v == slider.max ? 'ALL-IN $' + v : '$' + v);
                document.getElementById('bet-value-display').innerText = fmt(slider.value);
                slider.oninput = () => {
                    document.getElementById('bet-value-display').innerText = fmt(slider.value);
                };
                ctrl.innerHTML = `
                    <button onclick="handleAction('FOLD')" class="btn-casino btn-fold">RETIRAR</button>
                    <button onclick="handleAction('CALL')" class="btn-casino btn-call">${diff > 0 ? 'CALL $' + diff : 'CHECK'}</button>
                    <button onclick="handleAction('RAISE', document.getElementById('bet-slider').value)" class="btn-casino btn-raise" ${!canRaise ? 'disabled' : ''}>${slider.value == slider.max ? 'ALL-IN' : 'SUBIR'}</button>
                `;
            } else {
                ctrl.innerHTML =
                    '<div class="flex-1 flex items-center justify-center text-zinc-600 font-black uppercase text-xs animate-pulse tracking-widest">Esperando turno de otro jugador...</div>';
            }
        }
    }
}

async function handleAction(type, amount = 0) {
    if (!gameState || isProcessing) return;
    const g = JSON.parse(JSON.stringify(gameState));
    const p = g.players.find((x) => x.id === myPlayerId);
    amount = parseInt(amount, 10);

    if (type === 'FOLD') {
        p.folded = true;
        g.lastAction = `${p.name} se retiró.`;
    } else if (type === 'CALL') {
        const diff = g.currentBet - p.bet;
        const toPay = Math.min(diff, p.chips);
        p.chips -= toPay;
        p.bet += toPay;
        g.pot += toPay;
        g.lastAction = diff > 0 ? `${p.name} igualó $${toPay}` : `${p.name} pasó.`;
    } else if (type === 'RAISE') {
        const targetBet = amount;
        const totalToPay = Math.min(targetBet - p.bet, p.chips);
        const newBet = p.bet + totalToPay;
        p.chips -= totalToPay;
        p.bet = newBet;
        g.pot += totalToPay;
        g.currentBet = Math.max(g.currentBet, newBet);
        g.lastAction = `${p.name} subió la apuesta a $${newBet}!`;
    }
    p.acted = true;
    await checkTurnTransition(g);
}

async function checkTurnTransition(g) {
    const active = g.players.filter((pl) => !pl.folded);
    const canStillBet = active.filter((pl) => pl.chips > 0);
    const roundOver = active.every((pl) => pl.acted && pl.bet === g.currentBet);
    const allInAction = active.length > 1 && canStillBet.length <= 1;

    if (active.length === 1) {
        await finalizeWinner(g);
        return;
    }
    if (roundOver) {
        if (allInAction) {
            await runShowdownSuspenso(g);
            return;
        }
        g.players.forEach((pl) => {
            pl.acted = false;
            pl.bet = 0;
        });
        g.currentBet = 0;
        if (g.phase === 'preflop') {
            g.phase = 'flop';
            g.communityCards = [g.deck.pop(), g.deck.pop(), g.deck.pop()];
        } else if (g.phase === 'flop') {
            g.phase = 'turn';
            g.communityCards.push(g.deck.pop());
        } else if (g.phase === 'turn') {
            g.phase = 'river';
            g.communityCards.push(g.deck.pop());
        } else {
            await finalizeWinner(g);
            return;
        }
        let first = g.smallBlindIndex % g.players.length;
        let safety = 0;
        while (g.players[first].folded && safety < g.players.length) {
            first = (first + 1) % g.players.length;
            safety++;
        }
        g.currentTurn = first;
    } else {
        let next = (g.currentTurn + 1) % g.players.length;
        let safety = 0;
        while (g.players[next].folded && safety < g.players.length) {
            next = (next + 1) % g.players.length;
            safety++;
        }
        g.currentTurn = next;
    }
    await gameDocRef.set(g);
}

async function runShowdownSuspenso(g) {
    isProcessing = true;
    g.showAllCards = true;
    g.lastAction = '¡ALL-IN! REVELANDO CARTAS...';
    await gameDocRef.set(g);
    while (g.communityCards.length < 5 && g.deck && g.deck.length) {
        await new Promise((r) => setTimeout(r, 1000));
        g.communityCards.push(g.deck.pop());
        await gameDocRef.set(g);
    }
    await new Promise((r) => setTimeout(r, 1500));
    await finalizeWinner(g);
    isProcessing = false;
}

async function finalizeWinner(g) {
    g.showAllCards = true;
    const active = g.players.filter((pl) => !pl.folded);
    if (active.length === 0) {
        g.phase = 'showdown';
        g.pot = 0;
        await gameDocRef.set(g);
        return;
    }
    const results = active.map((pl) => {
        const handRes = evaluateBestHand([...pl.cards, ...g.communityCards]);
        return { id: pl.id, score: handRes.score, name: handRes.name };
    });
    results.sort((a, b) => b.score - a.score);
    const top = results[0].score;
    const topIds = results.filter((r) => r.score === top).map((r) => r.id);
    const pot = g.pot;
    const share = Math.floor(pot / topIds.length);
    const rem = pot - share * topIds.length;
    topIds.forEach((id, i) => {
        const w = g.players.find((pl) => pl.id === id);
        if (w) w.chips += share + (i < rem ? 1 : 0);
    });
    g.phase = 'showdown';
    g.winner = topIds[0];
    if (topIds.length > 1) {
        g.lastAction = `¡Empate! Reparto: $${share} a cada uno. Mejor mano: ${results[0].name.toUpperCase()}`;
    } else {
        const winName = g.players.find((pl) => pl.id === topIds[0])?.name || '';
        g.lastAction = `¡${winName} GANA $${pot} CON ${results[0].name.toUpperCase()}!`;
    }
    g.pot = 0;
    await gameDocRef.set(g);
}

async function startRound() {
    const snap = await gameDocRef.get();
    if (!snap.exists) return;
    const g = snap.data();
    if (!g.players || g.players.length < 2) return;

    const deck = [];
    SUITS.forEach((s) => VALUES.forEach((v) => deck.push({ suit: s, value: v })));
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }

    const sbIdx = g.smallBlindIndex === undefined ? 0 : (g.smallBlindIndex + 1) % g.players.length;
    const bbIdx = (sbIdx + 1) % g.players.length;

    const players = g.players.map((p, i) => {
        let chips = p.chips;
        let bet = 0;
        if (i === sbIdx) {
            const sb = Math.min(chips, 100);
            bet += sb;
            chips -= sb;
        }
        if (i === bbIdx) {
            const bb = Math.min(chips, 200);
            bet += bb;
            chips -= bb;
        }
        return { ...p, chips, bet, cards: [deck.pop(), deck.pop()], folded: chips + bet <= 0, acted: false, emoji: null };
    });

    const actualBigBet = players[bbIdx] ? players[bbIdx].bet : 0;

    await gameDocRef.set({
        players,
        deck,
        communityCards: [],
        pot: players.reduce((a, b) => a + b.bet, 0),
        phase: 'preflop',
        showAllCards: false,
        smallBlindIndex: sbIdx,
        bigBlindIndex: bbIdx,
        currentTurn: (bbIdx + 1) % players.length,
        currentBet: actualBigBet,
        lastAction: 'Nueva mano repartida.',
        winner: null,
    });
}

async function joinGame() {
    const name = document.getElementById('username-input').value.trim().toUpperCase();
    if (!name) return;
    const doc = await gameDocRef.get();
    const pData = {
        id: myPlayerId,
        name,
        chips: 5000,
        cards: [],
        folded: false,
        bet: 0,
        acted: false,
        emoji: null,
    };

    if (!doc.exists) {
        await gameDocRef.set({ players: [pData], communityCards: [], pot: 0, phase: 'waiting', lastAction: `${name} inauguró la mesa.` });
    } else {
        const players = doc.data().players || [];
        const existingIdx = players.findIndex((p) => p.id === myPlayerId);
        if (existingIdx > -1) {
            players[existingIdx].name = name;
        } else {
            players.push(pData);
        }
        await gameDocRef.update({ players, lastAction: `${name} se unió a la partida.` });
    }
}

/** Expone en window sendEmoji y handleAction (onclick en index.html) */
window.sendEmoji = sendEmoji;
window.handleAction = handleAction;

document.getElementById('recharge-slider').oninput = function () {
    document.getElementById('recharge-value').innerText = '$' + parseInt(this.value, 10).toLocaleString();
};
document.getElementById('confirm-recharge-btn').onclick = async () => {
    const amount = parseInt(document.getElementById('recharge-slider').value, 10);
    const snap = await gameDocRef.get();
    if (!snap.exists) return;
    const g = snap.data();
    if (!g.players) return;
    const pIdx = g.players.findIndex((pl) => pl.id === myPlayerId);
    if (pIdx > -1) {
        g.players[pIdx].chips += amount;
        await gameDocRef.set(g);
        document.getElementById('recharge-modal').classList.add('hidden');
    }
};
document.getElementById('show-recharge-btn').onclick = () => {
    document.getElementById('recharge-modal').classList.remove('hidden');
};
document.getElementById('join-btn').onclick = joinGame;
document.getElementById('clear-table-btn').onclick = () => {
    if (confirm('¿Seguro que quieres resetear la mesa por completo?')) gameDocRef.delete();
};

auth
    .signInAnonymously()
    .then(() => {
        gameDocRef.onSnapshot(
            (doc) => {
                if (doc.exists) {
                    gameState = doc.data();
                    updateUI();
                } else {
                    gameState = null;
                    document.getElementById('login-screen').classList.remove('hidden');
                    document.getElementById('game-screen').classList.add('hidden');
                }
            },
            (err) => console.error('Listener Firestore:', err)
        );
    })
    .catch((err) => {
        console.error('Auth anónima falló:', err);
    });
